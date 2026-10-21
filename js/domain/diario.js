/**
 * Diário de classe — regras puras (sem Firebase, sem DOM).
 *
 * Uma aula guarda a chamada inteira num mapa { alunoId: 'P' | 'F' | 'J' }. O resumo de frequência
 * de cada matrícula é SEMPRE recalculado do zero a partir de todas as aulas da turma (nunca
 * incrementado), então corrigir ou excluir uma aula antiga acerta os números sozinho.
 */
import { PRESENCA, STATUS_MATRICULA } from '../models/schema.js';
import { avaliarRiscoEvasao, calcularFrequencia } from './regras.js';

const MARCAS = Object.values(PRESENCA);
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {{ data: string, conteudo?: string, registros: Record<string, string> }} entrada
 * @param {{ hoje: string }} contexto `hoje` em 'AAAA-MM-DD' (injetado para a função continuar pura)
 */
export function validarAula({ data, conteudo, registros }, { hoje }) {
  if (!DATA.test(data ?? '')) return { erro: 'Informe a data da aula.' };
  if (data > hoje) return { erro: 'A aula não pode ser registrada numa data futura.' };

  const texto = String(conteudo ?? '').trim();
  if (texto.length > 1000) return { erro: 'O conteúdo da aula pode ter no máximo 1000 caracteres.' };

  const entradas = Object.entries(registros ?? {});
  if (!entradas.length) return { erro: 'Não há ninguém na chamada desta data.' };
  if (entradas.some(([, marca]) => !MARCAS.includes(marca))) {
    return { erro: 'Marque presença, falta ou falta justificada para todas as pessoas da lista.' };
  }
  return { dados: { data, conteudo: texto, registros: Object.fromEntries(entradas) } };
}

/** Totais de uma chamada: { presentes, faltas, justificadas }. */
export function resumoDaChamada(registros) {
  const marcas = Object.values(registros ?? {});
  const conta = (m) => marcas.filter((x) => x === m).length;
  return { presentes: conta(PRESENCA.PRESENTE), faltas: conta(PRESENCA.FALTA), justificadas: conta(PRESENCA.JUSTIFICADA) };
}

/**
 * Quem entra na chamada de uma data:
 *  - matrículas ATIVAS feitas até essa data (não se chama quem ainda não estava matriculado);
 *  - e quem já consta na chamada gravada dessa data, mesmo que hoje esteja trancado ou tenha saído
 *    (o histórico daquele dia não pode perder gente).
 * @param {{ matriculas: Array<{ alunoId: string, status: string, dataMatricula?: string }>, registro?: { registros: object }, data: string }} p
 */
export function pessoasDaChamada({ matriculas, registro, data }) {
  const noRegistro = new Set(Object.keys(registro?.registros ?? {}));
  return matriculas.filter(
    (m) => noRegistro.has(m.alunoId) || (m.status === STATUS_MATRICULA.ATIVA && (m.dataMatricula ?? '') <= data),
  );
}

/** As marcas de um aluno em todas as aulas, em ordem cronológica. */
export function sequenciaDoAluno(aulas, alunoId) {
  return aulas
    .filter((a) => alunoId in (a.registros ?? {}))
    .sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0))
    .map((a) => a.registros[alunoId]);
}

/**
 * Recalcula a frequência e o risco de evasão de cada matrícula da turma.
 * @param {{ aulas: Array<{ data: string, registros: object }>, matriculas: Array<{ id: string, alunoId: string, status: string }>, frequenciaMinima: number }} p
 * @returns {Array<{ matriculaId: string, frequencia: object, riscoEvasao: boolean }>}
 */
export function recalcularMatriculas({ aulas, matriculas, frequenciaMinima }) {
  return matriculas.map((m) => {
    const frequencia = calcularFrequencia(sequenciaDoAluno(aulas, m.alunoId));
    // risco só faz sentido para quem está cursando
    const riscoEvasao = m.status === STATUS_MATRICULA.ATIVA && avaliarRiscoEvasao(frequencia, { frequenciaMinima });
    return { matriculaId: m.id, frequencia, riscoEvasao };
  });
}
