/**
 * Serviço do Diário de classe: registrar, corrigir e excluir a chamada de uma aula.
 *
 * Cada gravação é UMA transação que escreve a aula e atualiza a frequência e o risco de evasão de todas as
 * matrículas da turma (recalculados do zero com as aulas de agora). Assim os números do painel e da
 * lista de alunos nunca divergem da chamada. As regras do Firestore deixam o professor da turma fazer
 * isto: ele escreve em `aulas` da própria turma e só toca nos campos de resumo da matrícula.
 */
import { auth, db, doc, runTransaction, serverTimestamp, where } from '../core/firebase.js';
import { auditoriaDeCriacao, criarRepo } from '../core/repo.js';
import { ErroDeNegocio } from '../core/erros.js';
import { hojeISO } from '../core/datas.js';
import { recalcularMatriculas, resumoDaChamada, validarAula } from '../domain/diario.js';
import { COLECOES, STATUS_MATRICULA, STATUS_TURMA, idAula, novaAula } from '../models/schema.js';
import { matriculasRepo } from './matriculas.service.js';

export const aulasRepo = criarRepo(COLECOES.AULAS);

/** Aulas de uma turma, da mais recente para a mais antiga. */
export async function listarAulasDaTurma(turmaId) {
  const aulas = await aulasRepo.listar(where('turmaId', '==', turmaId));
  return aulas.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
}

export const listarMatriculasDaTurma = (turmaId) => matriculasRepo.listar(where('turmaId', '==', turmaId));

/**
 * Grava (ou corrige) a chamada de uma data.
 * @param {{ turmaId: string, data: string, conteudo?: string, registros: Record<string, 'P'|'F'|'J'> }} aula
 * @returns {Promise<{ resumo: { presentes: number, faltas: number, justificadas: number }, emRisco: number }>}
 */
export function registrarAula({ turmaId, data, conteudo = '', registros }) {
  const { dados, erro } = validarAula({ data, conteudo, registros }, { hoje: hojeISO() });
  if (erro) throw new ErroDeNegocio('dados-invalidos', erro);
  return aplicar({ turmaId, data: dados.data, aula: dados });
}

/** Exclui a aula de uma data e recalcula a frequência sem ela (só a gestão pode, pelas regras). */
export const excluirAula = ({ turmaId, data }) => aplicar({ turmaId, data, aula: null });

async function aplicar({ turmaId, data, aula }) {
  // Consultas antes (o Firestore não as permite dentro de transação); a transação relê as aulas pelo id.
  const [aulas, matriculas] = await Promise.all([listarAulasDaTurma(turmaId), listarMatriculasDaTurma(turmaId)]);
  return runTransaction(db, (tx) =>
    aplicarNaTransacao(tx, {
      turmaId,
      data,
      aula,
      outrasDatas: aulas.map((a) => a.data).filter((d) => d !== data),
      matriculas: matriculas.map((m) => ({ id: m.id, alunoId: m.alunoId, status: m.status })),
      professorId: auth.currentUser?.uid ?? null,
    }),
  );
}

/**
 * Corpo da transação, exportado para teste com uma `tx` falsa.
 * Se outra pessoa criar uma aula nova entre a consulta e a gravação, ela não entra neste cálculo; a
 * próxima gravação (que recalcula tudo do zero) corrige sozinha.
 */
export async function aplicarNaTransacao(tx, { turmaId, data, aula, outrasDatas, matriculas, professorId }) {
  const turmaRef = doc(db, COLECOES.TURMAS, turmaId);
  const aulaRef = doc(db, COLECOES.AULAS, idAula(turmaId, data));

  // --- leituras ---
  const [turmaSnap, aulaSnap, ...outrasSnaps] = await Promise.all([
    tx.get(turmaRef),
    tx.get(aulaRef),
    ...outrasDatas.map((d) => tx.get(doc(db, COLECOES.AULAS, idAula(turmaId, d)))),
  ]);
  if (!turmaSnap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Turma não encontrada.');
  const turma = turmaSnap.data();
  const cursoSnap = await tx.get(doc(db, COLECOES.CURSOS, turma.cursoId));

  // --- validações ---
  if (turma.status === STATUS_TURMA.CANCELADA) {
    throw new ErroDeNegocio('turma-indisponivel', `A turma "${turma.nome}" foi cancelada e não recebe chamada.`);
  }
  if (!aula && !aulaSnap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Não há aula registrada nesta data.');

  // --- recálculo da frequência com as aulas de agora ---
  const outras = outrasSnaps.filter((s) => s.exists()).map((s) => s.data());
  const todas = aula ? [...outras, { data, registros: aula.registros }] : outras;
  const frequenciaMinima = cursoSnap.exists() ? cursoSnap.data().frequenciaMinima : undefined;
  const atualizacoes = recalcularMatriculas({ aulas: todas, matriculas, frequenciaMinima });

  // --- escritas ---
  if (!aula) {
    tx.delete(aulaRef);
  } else if (aulaSnap.exists()) {
    // correção: preserva quem criou a aula e quando
    tx.update(aulaRef, {
      conteudo: aula.conteudo,
      registros: aula.registros,
      resumo: resumoDaChamada(aula.registros),
      atualizadoEm: serverTimestamp(),
    });
  } else {
    tx.set(aulaRef, {
      ...novaAula({ turmaId, data, conteudo: aula.conteudo, professorId, registros: aula.registros }),
      resumo: resumoDaChamada(aula.registros),
      ...auditoriaDeCriacao(),
    });
  }
  atualizacoes.forEach(({ matriculaId, frequencia, riscoEvasao }) => {
    tx.update(doc(db, COLECOES.MATRICULAS, matriculaId), { frequencia, riscoEvasao, atualizadoEm: serverTimestamp() });
  });

  const ativas = new Set(matriculas.filter((m) => m.status === STATUS_MATRICULA.ATIVA).map((m) => m.id));
  return {
    resumo: aula ? resumoDaChamada(aula.registros) : null,
    emRisco: atualizacoes.filter((u) => u.riscoEvasao && ativas.has(u.matriculaId)).length,
  };
}
