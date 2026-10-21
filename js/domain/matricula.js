/**
 * Ciclo de vida da matrícula — funções puras (sem Firebase, sem DOM).
 *
 *   ativa ──▶ trancada ──▶ ativa        (volta, se houver vaga)
 *     │          └──▶ evadida | cancelada
 *     ├──▶ evadida ──▶ ativa            (retorno, se houver vaga)
 *     ├──▶ cancelada ──▶ ativa          (desfazer um engano, se houver vaga)
 *     └──▶ concluida                    (final)
 *
 * Só a matrícula ATIVA ocupa vaga. Passar de/para "ativa" muda turmas.vagasOcupadas em ±1
 * (feito em transação por js/services/matriculas.service.js).
 */
import { STATUS_ALUNO, STATUS_MATRICULA as S } from '../models/schema.js';

const TRANSICOES = {
  [S.ATIVA]: [S.TRANCADA, S.EVADIDA, S.CANCELADA, S.CONCLUIDA],
  [S.TRANCADA]: [S.ATIVA, S.EVADIDA, S.CANCELADA],
  [S.EVADIDA]: [S.ATIVA],
  [S.CANCELADA]: [S.ATIVA],
  [S.CONCLUIDA]: [],
};

export const ocupaVaga = (status) => status === S.ATIVA;
export const transicoesPossiveis = (de) => TRANSICOES[de] ?? [];
export const podeTransitar = (de, para) => transicoesPossiveis(de).includes(para);

/** Quanto muda turmas.vagasOcupadas ao passar de `de` para `para`: −1, 0 ou +1. */
export const variacaoDeVagas = (de, para) => Number(ocupaVaga(para)) - Number(ocupaVaga(de));

/**
 * Situação do aluno, derivada das situações de TODAS as suas matrículas:
 *  - alguma ativa ou trancada → ativo (continua vinculado à instituição);
 *  - senão, alguma evadida → evadido;
 *  - senão (só concluídas/canceladas, ou nenhuma) → inativo.
 */
export function statusDoAluno(situacoesDasMatriculas) {
  if (situacoesDasMatriculas.some((s) => s === S.ATIVA || s === S.TRANCADA)) return STATUS_ALUNO.ATIVO;
  if (situacoesDasMatriculas.includes(S.EVADIDA)) return STATUS_ALUNO.EVADIDO;
  return STATUS_ALUNO.INATIVO;
}
