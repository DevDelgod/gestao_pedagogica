/**
 * Números do painel do administrador.
 *
 * Usa consultas de contagem (getCountFromServer): o Firestore conta no servidor e cobra
 * ~1 leitura por 1000 documentos, então NÃO é preciso manter contadores globais à mão.
 */
import { db, collection, query, where, getCountFromServer } from '../core/firebase.js';
import {
  COLECOES,
  STATUS_ALUNO,
  STATUS_TURMA,
  STATUS_MATRICULA,
  STATUS_INSCRICAO,
} from '../models/schema.js';
import { taxaEvasao } from '../domain/regras.js';

const contar = async (colecao, ...filtros) => {
  const snap = await getCountFromServer(query(collection(db, colecao), ...filtros));
  return snap.data().count;
};

/**
 * @param {{ incluirInscricoes?: boolean }} [opcoes] o professor não pode ler inscrições (firestore.rules):
 *   para ele, os dois números que dependem delas voltam 0 em vez de gerar erro de permissão.
 */
export async function carregarResumo({ incluirInscricoes = true } = {}) {
  const [
    alunosAtivos,
    turmasEmAndamento,
    matriculasAtivas,
    aguardandoSelecao,
    aMatricular,
    emRisco,
    matriculasTotal,
    matriculasEvadidas,
  ] = await Promise.all([
    contar(COLECOES.ALUNOS, where('status', '==', STATUS_ALUNO.ATIVO)),
    contar(COLECOES.TURMAS, where('status', '==', STATUS_TURMA.EM_ANDAMENTO)),
    contar(COLECOES.MATRICULAS, where('status', '==', STATUS_MATRICULA.ATIVA)),
    incluirInscricoes ? contar(COLECOES.INSCRICOES, where('status', '==', STATUS_INSCRICAO.INSCRITA)) : 0,
    incluirInscricoes ? contar(COLECOES.INSCRICOES, where('status', '==', STATUS_INSCRICAO.CONVOCADA)) : 0,
    contar(
      COLECOES.MATRICULAS,
      where('status', '==', STATUS_MATRICULA.ATIVA),
      where('riscoEvasao', '==', true),
    ),
    contar(COLECOES.MATRICULAS),
    contar(COLECOES.MATRICULAS, where('status', '==', STATUS_MATRICULA.EVADIDA)),
  ]);

  return {
    alunosAtivos,
    turmasEmAndamento,
    matriculasAtivas,
    aguardandoSelecao, // inscritas que ainda não passaram pela seleção
    aMatricular, // convocadas com vaga reservada, ainda sem matrícula
    emRisco,
    taxaEvasao: taxaEvasao(matriculasTotal, matriculasEvadidas),
  };
}
