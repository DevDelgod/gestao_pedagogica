/**
 * Serviço de matrículas: o ciclo de vida depois que a matrícula existe (trancar, evadir, cancelar,
 * concluir, reativar) e a matrícula direta, sem edital.
 *
 * Mexem em vagas, então são transações: a situação da matrícula, o contador turmas.vagasOcupadas e a
 * situação derivada do aluno mudam juntos ou não mudam. Só a matrícula ATIVA ocupa vaga
 * (regras em js/domain/matricula.js). As funções `...NaTransacao` são exportadas para teste.
 *
 * A matrícula nasce em inscricoes.service.js (efetivarMatricula, a partir de uma convocação) ou
 * aqui (matricularDireto).
 */
import { auth, db, doc, runTransaction, serverTimestamp, where } from '../core/firebase.js';
import { auditoriaDeCriacao, criarRepo } from '../core/repo.js';
import { ErroDeNegocio } from '../core/erros.js';
import { hojeISO } from '../core/datas.js';
import { podeTransitar, statusDoAluno, variacaoDeVagas } from '../domain/matricula.js';
import { nomeExibicao } from '../domain/pessoa.js';
import { COLECOES, STATUS_ALUNO, STATUS_MATRICULA as S, idMatricula, novaMatricula } from '../models/schema.js';
import { ROTULO_STATUS_MATRICULA as ROTULO } from '../models/rotulos.js';
import { aceitaMatricula, vagasLivres } from './turmas.service.js';

export const matriculasRepo = criarRepo(COLECOES.MATRICULAS);

export const listarMatriculas = () => matriculasRepo.listar();
export const listarMatriculasDoAluno = (alunoId) => matriculasRepo.listar(where('alunoId', '==', alunoId));
export const listarMatriculasDaTurma = (turmaId) => matriculasRepo.listar(where('turmaId', '==', turmaId));

const usuarioAtual = () => auth.currentUser?.uid ?? null;

const lerExistente = (snap, mensagem) => {
  if (!snap.exists()) throw new ErroDeNegocio('nao-encontrado', mensagem);
  return snap.data();
};

// ---------------------------------------------------------------------------
// Mudar a situação da matrícula
// ---------------------------------------------------------------------------

/**
 * @param {{ matriculaId: string, novoStatus: string, motivo?: string }} opcoes
 * @returns {Promise<{ status: string, turmaNome: string }>}
 */
export async function alterarSituacaoMatricula({ matriculaId, novoStatus, motivo = '' }) {
  const matricula = await matriculasRepo.obter(matriculaId);
  if (!matricula) throw new ErroDeNegocio('nao-encontrado', 'Matrícula não encontrada.');

  // As outras matrículas do aluno são procuradas antes (o Firestore não permite consulta dentro de
  // transação); a transação as relê para derivar a situação do aluno com os dados de agora.
  const doAluno = await listarMatriculasDoAluno(matricula.alunoId);
  const outrasIds = doAluno.map((m) => m.id).filter((id) => id !== matriculaId);

  return runTransaction(db, (tx) =>
    alterarSituacaoNaTransacao(tx, { matriculaId, outrasIds, novoStatus, motivo, por: usuarioAtual() }),
  );
}

export async function alterarSituacaoNaTransacao(tx, { matriculaId, outrasIds, novoStatus, motivo, por }) {
  const matriculaRef = doc(db, COLECOES.MATRICULAS, matriculaId);

  // --- leituras ---
  const matriculaSnap = await tx.get(matriculaRef);
  const matricula = lerExistente(matriculaSnap, 'Matrícula não encontrada.');
  const turmaRef = doc(db, COLECOES.TURMAS, matricula.turmaId);
  const alunoRef = doc(db, COLECOES.ALUNOS, matricula.alunoId);
  const [turmaSnap, alunoSnap, ...outrasSnaps] = await Promise.all([
    tx.get(turmaRef),
    tx.get(alunoRef),
    ...outrasIds.map((id) => tx.get(doc(db, COLECOES.MATRICULAS, id))),
  ]);

  // --- validações ---
  if (!podeTransitar(matricula.status, novoStatus)) {
    throw new ErroDeNegocio('transicao-invalida', `Uma matrícula "${ROTULO[matricula.status]}" não pode passar para "${ROTULO[novoStatus]}".`);
  }
  const turma = lerExistente(turmaSnap, 'Turma não encontrada.');
  const variacao = variacaoDeVagas(matricula.status, novoStatus);
  if (variacao > 0) {
    // voltando a ocupar uma vaga: ela precisa existir
    if (!aceitaMatricula(turma)) {
      throw new ErroDeNegocio('turma-indisponivel', `A turma "${turma.nome}" não está recebendo matrículas.`);
    }
    if (vagasLivres(turma) <= 0) {
      throw new ErroDeNegocio(
        'turma-lotada',
        `Não há vaga livre na turma "${turma.nome}" (${turma.vagasOcupadas} ocupadas e ${turma.vagasReservadas ?? 0} reservadas, de ${turma.vagas}).`,
      );
    }
  }

  // --- escritas ---
  tx.update(matriculaRef, {
    status: novoStatus,
    motivoSituacao: motivo.trim(),
    situacaoEm: serverTimestamp(),
    situacaoPor: por,
    atualizadoEm: serverTimestamp(),
  });
  if (variacao) {
    tx.update(turmaRef, { vagasOcupadas: Math.max(0, turma.vagasOcupadas + variacao), atualizadoEm: serverTimestamp() });
  }
  if (alunoSnap.exists()) {
    const situacoes = [novoStatus, ...outrasSnaps.filter((s) => s.exists()).map((s) => s.data().status)];
    const statusAluno = statusDoAluno(situacoes);
    if (alunoSnap.data().status !== statusAluno) {
      tx.update(alunoRef, { status: statusAluno, atualizadoEm: serverTimestamp() });
    }
  }
  return { status: novoStatus, turmaNome: turma.nome };
}

// ---------------------------------------------------------------------------
// Matrícula direta (sem edital)
// ---------------------------------------------------------------------------

/**
 * Matricula um aluno já cadastrado numa turma com vaga livre, sem passar por edital.
 * @returns {Promise<{ matriculaId: string, turmaNome: string }>}
 */
export const matricularDireto = ({ alunoId, turmaId }) =>
  runTransaction(db, (tx) => matricularDiretoNaTransacao(tx, { alunoId, turmaId, hoje: hojeISO() }));

export async function matricularDiretoNaTransacao(tx, { alunoId, turmaId, hoje }) {
  const alunoRef = doc(db, COLECOES.ALUNOS, alunoId);
  const turmaRef = doc(db, COLECOES.TURMAS, turmaId);
  const matriculaId = idMatricula(turmaId, alunoId);
  const matriculaRef = doc(db, COLECOES.MATRICULAS, matriculaId);

  // --- leituras ---
  const [alunoSnap, turmaSnap, matriculaSnap] = await Promise.all([tx.get(alunoRef), tx.get(turmaRef), tx.get(matriculaRef)]);

  // --- validações ---
  const aluno = lerExistente(alunoSnap, 'Aluno não encontrado.');
  const turma = lerExistente(turmaSnap, 'Turma não encontrada.');
  if (matriculaSnap.exists()) {
    const situacao = matriculaSnap.data().status;
    const dica = [S.ATIVA, S.CONCLUIDA].includes(situacao) ? '' : ' Reative-a na ficha do aluno.';
    throw new ErroDeNegocio('ja-matriculado', `${nomeExibicao(aluno)} já tem matrícula nesta turma (${ROTULO[situacao]}).${dica}`);
  }
  if (!aceitaMatricula(turma)) {
    throw new ErroDeNegocio('turma-indisponivel', `A turma "${turma.nome}" não está recebendo matrículas.`);
  }
  if (vagasLivres(turma) <= 0) {
    throw new ErroDeNegocio('turma-lotada', `A turma "${turma.nome}" está sem vaga livre (${turma.vagasOcupadas} matriculados e ${turma.vagasReservadas ?? 0} convocados, de ${turma.vagas}).`);
  }

  // --- escritas ---
  const matricula = novaMatricula({
    alunoId,
    alunoNome: nomeExibicao(aluno), // nome social, se houver
    turmaId,
    turmaNome: turma.nome,
    cursoId: turma.cursoId,
    cursoNome: turma.cursoNome,
    inscricaoId: null,
    dataMatricula: hoje,
  });
  tx.set(matriculaRef, { ...matricula, ...auditoriaDeCriacao() });
  tx.update(turmaRef, { vagasOcupadas: turma.vagasOcupadas + 1, atualizadoEm: serverTimestamp() });
  if (aluno.status !== STATUS_ALUNO.ATIVO) {
    tx.update(alunoRef, { status: STATUS_ALUNO.ATIVO, atualizadoEm: serverTimestamp() });
  }
  return { matriculaId, turmaNome: turma.nome };
}
