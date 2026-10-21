/**
 * Execução da seleção de uma turma de um edital (sorteio, classificação por nota ou ordem de inscrição).
 *
 * Numa única transação:
 *   - convoca os primeiros N (N = vagas livres da turma) e reserva essas vagas;
 *   - põe o resto na lista de espera (se o edital permitir) ou como não selecionado;
 *   - grava um registro auditável em selecoes/{editalId_turmaId}.
 * Só pode rodar UMA vez por turma e só com o edital na etapa "Em seleção" (inscrições encerradas).
 */
import { auth, db, doc, runTransaction, serverTimestamp, where } from '../core/firebase.js';
import { criarRepo } from '../core/repo.js';
import { ErroDeNegocio } from '../core/erros.js';
import { hojeISO } from '../core/datas.js';
import { COLECOES, MODALIDADE_SELECAO, STATUS_EDITAL, STATUS_INSCRICAO as S, idSelecao } from '../models/schema.js';
import {
  ALGORITMO_SORTEIO,
  distribuirVagas,
  gerarSemente,
  ordenarCandidatos,
  temSelecaoAutomatica,
} from '../domain/selecao.js';
import { camposDeConvocacao, inscricoesRepo } from './inscricoes.service.js';
import { vagasLivres } from './turmas.service.js';

export const selecoesRepo = criarRepo(COLECOES.SELECOES);

/** Uma transação do Firestore escreve no máximo 500 documentos: candidatos + registro + turma. */
export const MAX_CANDIDATOS = 490;

const MOTIVO_ELIMINACAO = {
  'sem-nota': 'Sem nota registrada.',
  'abaixo-da-nota-minima': 'Nota abaixo da mínima.',
};
const MOTIVO_SEM_VAGA = 'Fora do número de vagas.';

/** Registro da seleção de uma turma, ou null se ainda não foi executada. */
export const obterSelecao = (editalId, turmaId) => selecoesRepo.obter(idSelecao(editalId, turmaId));

/**
 * @param {{ editalId: string, turmaId: string, semente?: string }} opcoes
 *   semente: só vale para sorteio. Em branco, o sistema gera uma. Pode ser um dado público
 *   (ex.: números de uma extração da Loteria Federal) para dar transparência ao sorteio.
 * @returns {Promise<{ convocados: number, suplentes: number, naoSelecionados: number, semente: string|null }>}
 */
export async function executarSelecao({ editalId, turmaId, semente }) {
  // Os ids dos candidatos são buscados antes (sem consulta dentro de transação); a transação
  // relê cada inscrição e ignora as que mudaram de situação nesse intervalo.
  const candidatos = await inscricoesRepo.listar(
    where('editalId', '==', editalId),
    where('turmaId', '==', turmaId),
    where('status', '==', S.INSCRITA),
  );
  if (candidatos.length > MAX_CANDIDATOS) {
    throw new ErroDeNegocio(
      'muitas-inscricoes',
      `Esta turma tem ${candidatos.length} inscrições; o limite por execução é ${MAX_CANDIDATOS}.`,
    );
  }

  return runTransaction(db, (tx) =>
    executarSelecaoNaTransacao(tx, {
      editalId,
      turmaId,
      candidatoIds: candidatos.map((c) => c.id),
      semente: semente?.trim() || gerarSemente(),
      hoje: hojeISO(),
      executadaPor: auth.currentUser?.uid ?? null,
    }),
  );
}

export async function executarSelecaoNaTransacao(tx, { editalId, turmaId, candidatoIds, semente, hoje, executadaPor }) {
  const editalRef = doc(db, COLECOES.EDITAIS, editalId);
  const turmaRef = doc(db, COLECOES.TURMAS, turmaId);
  const registroRef = doc(db, COLECOES.SELECOES, idSelecao(editalId, turmaId));
  const inscricaoRefs = candidatoIds.map((id) => doc(db, COLECOES.INSCRICOES, id));

  // --- leituras ---
  const [editalSnap, turmaSnap, registroSnap, ...inscricaoSnaps] = await Promise.all([
    tx.get(editalRef),
    tx.get(turmaRef),
    tx.get(registroRef),
    ...inscricaoRefs.map((ref) => tx.get(ref)),
  ]);

  // --- validações ---
  if (!editalSnap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Edital não encontrado.');
  const edital = editalSnap.data();
  if (edital.status !== STATUS_EDITAL.SELECAO) {
    throw new ErroDeNegocio('edital-fora-da-etapa', 'A seleção só pode ser executada com o edital na etapa "Em seleção" (inscrições encerradas).');
  }
  if (!temSelecaoAutomatica(edital.modalidade)) {
    throw new ErroDeNegocio('modalidade-manual', 'Este edital é de análise individual: convoque as inscrições uma a uma.');
  }
  if (!turmaSnap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Turma não encontrada.');
  const turma = turmaSnap.data();
  if (!edital.turmaIds.includes(turmaId)) {
    throw new ErroDeNegocio('turma-fora-do-edital', 'Esta turma não faz parte do edital.');
  }
  if (registroSnap.exists()) {
    throw new ErroDeNegocio('selecao-ja-executada', 'A seleção desta turma já foi executada e não pode ser repetida.');
  }
  if (candidatoIds.length > MAX_CANDIDATOS) {
    throw new ErroDeNegocio('muitas-inscricoes', `O limite por execução é ${MAX_CANDIDATOS} inscrições.`);
  }

  // só entram as que continuam "inscrita" e pertencem a este edital/turma
  const candidatos = [];
  inscricaoSnaps.forEach((snap, i) => {
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.status === S.INSCRITA && d.editalId === editalId && d.turmaId === turmaId) {
      candidatos.push({ id: candidatoIds[i], criadoEm: d.criadoEm?.toMillis?.() ?? 0, nota: d.nota ?? null });
    }
  });

  // --- seleção (função pura) ---
  const { modalidade } = edital;
  const vagas = Math.max(0, vagasLivres(turma));
  const classificacao = ordenarCandidatos(modalidade, candidatos, {
    semente,
    notaMinima: edital.config?.notaMinima ?? 0,
  });
  const listaEspera = edital.config?.listaEspera ?? true;
  const resultado = distribuirVagas(classificacao, vagas, { listaEspera });

  // --- escritas ---
  const refDe = (id) => inscricaoRefs[candidatoIds.indexOf(id)];

  resultado.convocados.forEach((id, i) => {
    tx.update(refDe(id), {
      ...camposDeConvocacao(edital, hoje),
      selecao: { modalidade, posicao: i + 1 },
    });
  });
  resultado.suplentes.forEach((id, i) => {
    tx.update(refDe(id), { status: S.SUPLENTE, posicaoSuplencia: i + 1, atualizadoEm: serverTimestamp() });
  });
  resultado.naoSelecionados.forEach((id) => {
    tx.update(refDe(id), {
      status: S.NAO_SELECIONADA,
      motivo: MOTIVO_ELIMINACAO[resultado.motivosEliminacao[id]] ?? MOTIVO_SEM_VAGA,
      atualizadoEm: serverTimestamp(),
    });
  });

  if (resultado.convocados.length) {
    tx.update(turmaRef, {
      vagasReservadas: (turma.vagasReservadas ?? 0) + resultado.convocados.length,
      atualizadoEm: serverTimestamp(),
    });
  }

  const sorteio = modalidade === MODALIDADE_SELECAO.SORTEIO;
  tx.set(registroRef, {
    editalId,
    turmaId,
    modalidade,
    semente: sorteio ? semente : null,
    algoritmo: sorteio ? ALGORITMO_SORTEIO : modalidade,
    vagasLivres: vagas,
    listaEspera,
    notaMinima: modalidade === MODALIDADE_SELECAO.PROVA ? (edital.config?.notaMinima ?? 0) : null,
    candidatos: candidatos.map((c) => c.id).sort(), // base do sorteio: ids em ordem alfabética
    convocados: resultado.convocados, // na ordem do resultado
    suplentes: resultado.suplentes,
    naoSelecionados: resultado.naoSelecionados,
    executadaPor,
    executadaEm: serverTimestamp(),
  });

  return {
    convocados: resultado.convocados.length,
    suplentes: resultado.suplentes.length,
    naoSelecionados: resultado.naoSelecionados.length,
    semente: sorteio ? semente : null,
  };
}
