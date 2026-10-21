/**
 * Serviço do módulo Inscrições: tudo o que acontece com uma inscrição depois que ela chega.
 *
 *   inscrita ─(seleção, ver selecao.service.js)─▶ convocada ─(requisitos ok)─▶ matriculada
 *      │ └─ remanescente ─(vaga liberada)─▶ convocada            └─ desistente (a vaga volta)
 *      └─ indeferida
 *
 * Toda mudança que mexe em vagas é uma transação, para os contadores da turma nunca divergirem
 * (turmas.vagasOcupadas / turmas.vagasReservadas). As funções `...NaTransacao` são exportadas
 * para poderem ser testadas com uma `tx` falsa.
 *
 * Fluxo completo e decisões: docs/modelo-de-dados.md → "Fluxos críticos".
 */
import {
  auth,
  db,
  addDoc,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from '../core/firebase.js';
import { auditoriaDeCriacao, criarRepo } from '../core/repo.js';
import { ErroDeNegocio } from '../core/erros.js';
import { hojeISO, somarDias } from '../core/datas.js';
import {
  COLECOES,
  STATUS_ALUNO,
  STATUS_INSCRICAO as S,
  idMatricula,
  novaInscricao,
  novaMatricula,
  novoAluno,
} from '../models/schema.js';
import { ROTULO_STATUS_INSCRICAO } from '../models/rotulos.js';
import { nomeExibicao } from '../domain/pessoa.js';
import { buscarAlunoPorEmail } from './alunos.service.js';
import { aceitaMatricula, vagasLivres } from './turmas.service.js';

export const inscricoesRepo = criarRepo(COLECOES.INSCRICOES);

const usuarioAtual = () => auth.currentUser?.uid ?? null;

// ---------------------------------------------------------------------------
// Entrada e consultas
// ---------------------------------------------------------------------------

/**
 * Única escrita permitida SEM login (formulário do site). Os campos enviados precisam ser exatamente
 * os aceitos em firestore.rules, e o edital precisa estar com inscrições abertas.
 */
export function enviarInscricaoPublica(dados) {
  const inscricao = novaInscricao({ ...dados, email: dados.email.trim().toLowerCase() });
  return addDoc(inscricoesRepo.col, { ...inscricao, criadoEm: serverTimestamp() });
}

/** Todas as inscrições de um edital (a tela agrupa e filtra no cliente). */
export const listarInscricoesDoEdital = (editalId) =>
  inscricoesRepo.listar(where('editalId', '==', editalId));

/** Lista de remanescentes de uma turma, na ordem de chamada. */
export async function listarRemanescentes(editalId, turmaId) {
  const remanescentes = await inscricoesRepo.listar(
    where('editalId', '==', editalId),
    where('turmaId', '==', turmaId),
    where('status', '==', S.REMANESCENTE),
  );
  return remanescentes.sort((a, b) => a.posicaoRemanescente - b.posicaoRemanescente);
}

// ---------------------------------------------------------------------------
// Utilitários das transações
// ---------------------------------------------------------------------------

/** Confere que a inscrição existe e está num dos status esperados (duas pessoas podem abrir a mesma). */
function lerInscricao(snap, permitidos) {
  if (!snap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Inscrição não encontrada.');
  const inscricao = snap.data();
  if (!permitidos.includes(inscricao.status)) {
    throw new ErroDeNegocio(
      'status-invalido',
      `Esta inscrição está como "${ROTULO_STATUS_INSCRICAO[inscricao.status]}" e não aceita esta ação.`,
    );
  }
  return inscricao;
}

const lerExistente = (snap, mensagem) => {
  if (!snap.exists()) throw new ErroDeNegocio('nao-encontrado', mensagem);
  return snap.data();
};

/**
 * Campos que transformam uma inscrição em "convocada": prazo e a lista de requisitos do edital
 * (copiada para a inscrição, com rótulo, para a tela não precisar consultar o edital).
 * Usada pela convocação individual e pela seleção em lote.
 */
export function camposDeConvocacao(edital, hoje) {
  return {
    status: S.CONVOCADA,
    convocadaEm: serverTimestamp(),
    prazoMatricula: somarDias(hoje, edital.config?.prazoMatriculaDias ?? 5),
    posicaoRemanescente: null,
    requisitos: Object.fromEntries(
      (edital.requisitosMatricula ?? []).map((r) => [r.id, { rotulo: r.rotulo, tipo: r.tipo, cumprido: false }]),
    ),
    atualizadoEm: serverTimestamp(),
  };
}

// ---------------------------------------------------------------------------
// Convocar (individual: análise manual, ou chamada de remanescente)
// ---------------------------------------------------------------------------

export async function convocarNaTransacao(tx, { inscricaoId, hoje }) {
  const inscricaoRef = doc(db, COLECOES.INSCRICOES, inscricaoId);
  const inscricaoSnap = await tx.get(inscricaoRef);
  const inscricao = lerInscricao(inscricaoSnap, [S.INSCRITA, S.REMANESCENTE]);

  const turmaRef = doc(db, COLECOES.TURMAS, inscricao.turmaId);
  const editalRef = doc(db, COLECOES.EDITAIS, inscricao.editalId);
  const [turmaSnap, editalSnap] = await Promise.all([tx.get(turmaRef), tx.get(editalRef)]);
  const turma = lerExistente(turmaSnap, 'Turma não encontrada.');
  const edital = lerExistente(editalSnap, 'Edital não encontrado.');

  if (!aceitaMatricula(turma)) {
    throw new ErroDeNegocio('turma-indisponivel', `A turma "${turma.nome}" não está recebendo matrículas.`);
  }
  if (vagasLivres(turma) <= 0) {
    throw new ErroDeNegocio(
      'turma-lotada',
      `Não há vaga livre na turma "${turma.nome}" (${turma.vagasOcupadas} ocupadas e ${turma.vagasReservadas ?? 0} reservadas, de ${turma.vagas}).`,
    );
  }

  tx.update(turmaRef, { vagasReservadas: (turma.vagasReservadas ?? 0) + 1, atualizadoEm: serverTimestamp() });
  tx.update(inscricaoRef, {
    ...camposDeConvocacao(edital, hoje),
    selecao: { modalidade: 'manual', convocadaPor: usuarioAtual() },
  });
  return { turmaNome: turma.nome };
}

export const convocarInscricao = (inscricaoId) =>
  runTransaction(db, (tx) => convocarNaTransacao(tx, { inscricaoId, hoje: hojeISO() }));

/** Chama o primeiro da lista de remanescentes quando há vaga livre. */
export async function convocarProximoRemanescente({ editalId, turmaId }) {
  // O remanescente é procurado antes (o Firestore não permite consulta dentro de transação);
  // a transação confirma que ele continua remanescente e que ainda há vaga.
  const [proximo] = await listarRemanescentes(editalId, turmaId);
  if (!proximo) throw new ErroDeNegocio('sem-remanescentes', 'Não há remanescentes nesta turma.');
  await convocarInscricao(proximo.id);
  return proximo;
}

// ---------------------------------------------------------------------------
// Efetivar matrícula (convocada → aluno + matrícula)
// ---------------------------------------------------------------------------

/**
 * Cria o aluno (ou reaproveita o cadastro existente com o mesmo e-mail), cria
 * matriculas/{turmaId_alunoId} e converte a vaga reservada em ocupada. Tudo ou nada.
 * Exige que TODOS os requisitos do edital estejam marcados como cumpridos.
 * @returns {Promise<{ alunoId: string, matriculaId: string, alunoNovo: boolean, turmaNome: string }>}
 */
export async function efetivarMatricula(inscricaoId) {
  const inscricao = await inscricoesRepo.obter(inscricaoId);
  if (!inscricao) throw new ErroDeNegocio('nao-encontrado', 'Inscrição não encontrada.');

  // Consulta por e-mail ANTES da transação (limitação do Firestore). A transação confirma o resultado.
  // Limite aceito: duas inscrições do mesmo e-mail efetivadas no mesmo instante por pessoas diferentes
  // poderiam gerar dois cadastros; a mesma inscrição nunca duplica.
  const alunoExistente = await buscarAlunoPorEmail(inscricao.email);
  const alunoId = alunoExistente?.id ?? doc(collection(db, COLECOES.ALUNOS)).id;

  return runTransaction(db, (tx) =>
    efetivarNaTransacao(tx, {
      inscricaoId,
      alunoId,
      alunoJaExiste: Boolean(alunoExistente),
      matriculadaPor: usuarioAtual(),
      hoje: hojeISO(),
    }),
  );
}

export async function efetivarNaTransacao(tx, { inscricaoId, alunoId, alunoJaExiste, matriculadaPor, hoje }) {
  const inscricaoRef = doc(db, COLECOES.INSCRICOES, inscricaoId);
  const alunoRef = doc(db, COLECOES.ALUNOS, alunoId);

  // --- leituras (o Firestore exige todas antes de qualquer escrita) ---
  const inscricaoSnap = await tx.get(inscricaoRef);
  const inscricao = lerInscricao(inscricaoSnap, [S.CONVOCADA]);

  const turmaId = inscricao.turmaId;
  const turmaRef = doc(db, COLECOES.TURMAS, turmaId);
  const matriculaId = idMatricula(turmaId, alunoId);
  const matriculaRef = doc(db, COLECOES.MATRICULAS, matriculaId);
  const leituras = [tx.get(turmaRef), tx.get(matriculaRef)];
  if (alunoJaExiste) leituras.push(tx.get(alunoRef));
  const [turmaSnap, matriculaSnap, alunoSnap] = await Promise.all(leituras);

  // --- validações ---
  const turma = lerExistente(turmaSnap, 'Turma não encontrada.');
  const pendentes = Object.values(inscricao.requisitos ?? {})
    .filter((r) => !r.cumprido)
    .map((r) => r.rotulo);
  if (pendentes.length) {
    throw new ErroDeNegocio('requisitos-pendentes', `Faltam requisitos para a matrícula: ${pendentes.join(', ')}.`);
  }
  if (!aceitaMatricula(turma)) {
    throw new ErroDeNegocio('turma-indisponivel', `A turma "${turma.nome}" não está recebendo matrículas.`);
  }
  if ((turma.vagasReservadas ?? 0) < 1) {
    // a convocação reservou uma vaga; se o contador não tem nenhuma, os dados estão inconsistentes
    throw new ErroDeNegocio('conflito', 'A contagem de vagas da turma está inconsistente. Corrija a turma antes de matricular.');
  }
  if (alunoJaExiste && !alunoSnap.exists()) {
    throw new ErroDeNegocio('conflito', 'O cadastro do aluno mudou durante a operação. Tente novamente.');
  }
  const alunoExistente = alunoJaExiste ? alunoSnap.data() : null;
  const alunoNome = nomeExibicao(alunoExistente ?? inscricao); // nome social, se houver
  if (matriculaSnap.exists()) {
    throw new ErroDeNegocio('ja-matriculado', `${alunoNome} já tem matrícula nesta turma (${matriculaSnap.data().status}).`);
  }

  // --- escritas ---
  if (!alunoJaExiste) {
    const aluno = novoAluno({
      nome: inscricao.nome,
      nomeSocial: inscricao.nomeSocial,
      genero: inscricao.genero,
      generoOutro: inscricao.generoOutro,
      email: inscricao.email,
      telefone: inscricao.telefone,
    });
    tx.set(alunoRef, { ...aluno, ...auditoriaDeCriacao() });
  } else if (alunoExistente.status !== STATUS_ALUNO.ATIVO) {
    tx.update(alunoRef, { status: STATUS_ALUNO.ATIVO, atualizadoEm: serverTimestamp() }); // quem volta, volta ativo
  }

  const matricula = novaMatricula({
    alunoId,
    alunoNome,
    turmaId,
    turmaNome: turma.nome,
    cursoId: turma.cursoId,
    cursoNome: turma.cursoNome,
    inscricaoId,
    dataMatricula: hoje,
  });
  tx.set(matriculaRef, { ...matricula, ...auditoriaDeCriacao() });

  tx.update(turmaRef, {
    vagasReservadas: turma.vagasReservadas - 1,
    vagasOcupadas: turma.vagasOcupadas + 1,
    atualizadoEm: serverTimestamp(),
  });
  tx.update(inscricaoRef, {
    status: S.MATRICULADA,
    alunoId,
    matriculaId,
    matriculadaPor,
    matriculadaEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });

  return { alunoId, matriculaId, alunoNovo: !alunoJaExiste, turmaNome: turma.nome };
}

// ---------------------------------------------------------------------------
// Desistência / prazo vencido (libera a vaga reservada)
// ---------------------------------------------------------------------------

export async function desistirNaTransacao(tx, { inscricaoId, motivo, por }) {
  const inscricaoRef = doc(db, COLECOES.INSCRICOES, inscricaoId);
  const inscricao = lerInscricao(await tx.get(inscricaoRef), [S.CONVOCADA]);

  const turmaRef = doc(db, COLECOES.TURMAS, inscricao.turmaId);
  const turma = lerExistente(await tx.get(turmaRef), 'Turma não encontrada.');

  tx.update(turmaRef, {
    vagasReservadas: Math.max(0, (turma.vagasReservadas ?? 0) - 1),
    atualizadoEm: serverTimestamp(),
  });
  tx.update(inscricaoRef, {
    status: S.DESISTENTE,
    motivo: motivo.trim(),
    encerradaPor: por,
    encerradaEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });
  return { turmaId: inscricao.turmaId };
}

/** Convocado que desistiu ou deixou o prazo vencer: a vaga volta para a turma. */
export const desistirDaVaga = (inscricaoId, motivo = '') =>
  runTransaction(db, (tx) => desistirNaTransacao(tx, { inscricaoId, motivo, por: usuarioAtual() }));

// ---------------------------------------------------------------------------
// Indeferir (recusa da equipe; não mexe em vagas)
// ---------------------------------------------------------------------------

export function indeferirInscricao(inscricaoId, motivo = '') {
  const ref = doc(db, COLECOES.INSCRICOES, inscricaoId);
  return runTransaction(db, async (tx) => {
    lerInscricao(await tx.get(ref), [S.INSCRITA, S.REMANESCENTE]);
    tx.update(ref, {
      status: S.INDEFERIDA,
      motivo: motivo.trim(),
      encerradaPor: usuarioAtual(),
      encerradaEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
    });
  });
}

// ---------------------------------------------------------------------------
// Nota (modalidade prova) e requisitos de matrícula
// ---------------------------------------------------------------------------

/** `nota` null apaga a nota. */
export function registrarNota(inscricaoId, nota) {
  if (nota !== null && !(Number.isFinite(nota) && nota >= 0)) {
    throw new ErroDeNegocio('nota-invalida', 'Informe uma nota válida (número maior ou igual a zero).');
  }
  return updateDoc(doc(db, COLECOES.INSCRICOES, inscricaoId), { nota, atualizadoEm: serverTimestamp() });
}

export function marcarRequisito(inscricaoId, requisitoId, cumprido) {
  const caminho = `requisitos.${requisitoId}`; // atualiza só estes campos, preservando rótulo e tipo
  return updateDoc(doc(db, COLECOES.INSCRICOES, inscricaoId), {
    [`${caminho}.cumprido`]: cumprido,
    [`${caminho}.em`]: cumprido ? serverTimestamp() : null,
    [`${caminho}.por`]: cumprido ? usuarioAtual() : null,
    atualizadoEm: serverTimestamp(),
  });
}
