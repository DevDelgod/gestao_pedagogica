/**
 * Regras de negócio puras (sem Firebase, sem DOM) — fáceis de testar e de reaproveitar.
 *
 * Princípio: o resumo de frequência/média da matrícula é SEMPRE recalculado do zero a
 * partir dos registros, nunca incrementado. Assim, corrigir uma chamada antiga ou
 * refazer uma nota não deixa o contador errado.
 */
import { PRESENCA } from '../models/schema.js';

export const LIMITES = Object.freeze({
  frequenciaMinima: 75, // % — o curso pode sobrescrever (cursos.frequenciaMinima)
  faltasConsecutivasAlerta: 3, // 3 faltas seguidas já acende o alerta
  minAulasParaAvaliar: 4, // evita alarme falso nas primeiras aulas
});

/**
 * @param {Array<'P'|'F'|'J'>} registros marcações do aluno, em ordem cronológica
 * @param {{ justificadaContaComoPresenca?: boolean }} [opcoes]
 */
export function calcularFrequencia(registros, { justificadaContaComoPresenca = true } = {}) {
  let presencas = 0;
  let faltas = 0;
  let justificadas = 0;
  let faltasConsecutivas = 0; // sequência de faltas no FIM do histórico

  for (const r of registros) {
    if (r === PRESENCA.PRESENTE) {
      presencas++;
      faltasConsecutivas = 0;
    } else if (r === PRESENCA.JUSTIFICADA) {
      justificadas++;
      faltasConsecutivas = 0;
    } else if (r === PRESENCA.FALTA) {
      faltas++;
      faltasConsecutivas++;
    }
  }

  const aulas = presencas + faltas + justificadas;
  const contadasComoPresente = presencas + (justificadaContaComoPresenca ? justificadas : 0);
  const percentual = aulas === 0 ? 100 : Math.round((contadasComoPresente / aulas) * 1000) / 10;

  return { aulas, presencas, faltas, justificadas, faltasConsecutivas, percentual };
}

/** Um aluno está "em risco" por faltas seguidas OU por frequência abaixo do mínimo. */
export function avaliarRiscoEvasao(frequencia, limites = {}) {
  const l = { ...LIMITES, ...limites };
  if (frequencia.faltasConsecutivas >= l.faltasConsecutivasAlerta) return true;
  return frequencia.aulas >= l.minAulasParaAvaliar && frequencia.percentual < l.frequenciaMinima;
}

/**
 * Média ponderada normalizada para 0–10. Só entram avaliações com nota lançada.
 * @param {Array<{ nota: number|null|undefined, peso: number, notaMaxima: number }>} itens
 * @returns {number|null} null quando ainda não há nenhuma nota
 */
export function calcularMedia(itens) {
  let soma = 0;
  let pesos = 0;
  for (const { nota, peso, notaMaxima } of itens) {
    if (typeof nota !== 'number' || !notaMaxima) continue;
    soma += (nota / notaMaxima) * 10 * peso;
    pesos += peso;
  }
  return pesos === 0 ? null : Math.round((soma / pesos) * 100) / 100;
}

/** Taxa de evasão (%) = matrículas evadidas ÷ total de matrículas. */
export function taxaEvasao(total, evadidas) {
  return total === 0 ? 0 : Math.round((evadidas / total) * 1000) / 10;
}
