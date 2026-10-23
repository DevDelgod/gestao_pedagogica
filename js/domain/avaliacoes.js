/**
 * Avaliações e notas — regras puras (sem Firebase, sem DOM).
 *
 * A forma de avaliar é escolhida em CADA avaliação, ao criá-la: nota numérica ou Apto / Não apto (o curso só
 * sugere uma forma padrão: cursos.modoAvaliacao). Uma avaliação guarda os resultados de toda a turma num
 * mapa { alunoId: nota } ou { alunoId: true | false }; quem não está no mapa ainda não foi avaliado. O resumo
 * de cada matrícula (media, das avaliações por nota, e aptidao, das Apto / Não apto) é SEMPRE recalculado do
 * zero com todas as avaliações da turma, nunca incrementado (mesmo princípio de regras.js e diario.js).
 */
import { MODO_AVALIACAO as MODO, STATUS_MATRICULA, TIPO_AVALIACAO } from '../models/schema.js';
import { calcularMedia } from './regras.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS = Object.values(TIPO_AVALIACAO);
const MODOS = Object.values(MODO);

/** '' / null / undefined viram o padrão; o resto vira número (pode dar NaN). */
const numero = (valor, padrao) => (valor === '' || valor === null || valor === undefined ? padrao : Number(valor));
const texto = (valor) => String(valor ?? '').trim();
const virgula = (n) => String(n).replace('.', ',');
const tem = (mapa, chave) => Object.hasOwn(mapa ?? {}, chave);

/** Forma de avaliar sugerida pelo curso ao criar uma avaliação; cursos antigos, sem o campo, sugerem nota. */
export const modoDoCurso = (curso) => (curso?.modoAvaliacao === MODO.APTO ? MODO.APTO : MODO.NOTA);

/** O mapa de resultados da avaliação, conforme o modo dela. */
export const resultadosDa = (avaliacao) => (avaliacao.modo === MODO.APTO ? avaliacao.aptos : avaliacao.notas) ?? {};

/** A avaliação já tem algum resultado lançado? (com resultados, ela não troca de forma de avaliar) */
export const temResultados = (avaliacao) => Object.keys(resultadosDa(avaliacao)).length > 0;

/**
 * Nota digitada ('7,5', ' 8 ') → número com até 2 casas; vazio → null; qualquer outra coisa → NaN.
 * Aceita vírgula, porque é assim que se escreve no Brasil.
 */
export function lerNota(entrada) {
  const t = texto(entrada).replace(',', '.');
  if (t === '') return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100) / 100;
}

/**
 * Definição de uma avaliação: forma de avaliar, título, tipo, data e, no modo nota, peso e nota máxima.
 * @param {object} entrada valores crus do formulário
 */
export function validarAvaliacao(entrada) {
  const modo = entrada.modo ?? MODO.NOTA;
  if (!MODOS.includes(modo)) return { erro: 'Escolha a forma de avaliar: nota ou Apto / Não apto.' };

  const titulo = texto(entrada.titulo);
  if (titulo.length < 2 || titulo.length > 120) return { erro: 'Informe o título da avaliação (de 2 a 120 caracteres).' };

  const tipo = entrada.tipo ?? TIPO_AVALIACAO.PROVA;
  if (!TIPOS.includes(tipo)) return { erro: 'Tipo de avaliação inválido.' };

  const data = texto(entrada.data) || null;
  if (data && !DATA.test(data)) return { erro: 'Data inválida.' };

  if (modo === MODO.APTO) return { dados: { modo, titulo, tipo, data, peso: 1, notaMaxima: null } };

  const peso = numero(entrada.peso, 1);
  if (!(peso > 0 && peso <= 100)) return { erro: 'O peso deve ser maior que 0 e no máximo 100.' };
  const notaMaxima = numero(entrada.notaMaxima, 10);
  if (!(notaMaxima > 0 && notaMaxima <= 100)) return { erro: 'A nota máxima deve ser maior que 0 e no máximo 100.' };

  return { dados: { modo, titulo, tipo, data, peso, notaMaxima } };
}

/**
 * Resultados lançados numa avaliação. Quem fica de fora do mapa continua "sem resultado" (null/undefined
 * também contam como de fora).
 * @param {Record<string, number|boolean|null>} resultados
 * @param {{ modo: string, notaMaxima: number|null, alunoIds: string[] }} contexto `alunoIds`: quem tem matrícula na turma
 */
export function validarResultados(resultados, { modo, notaMaxima, alunoIds }) {
  const permitidos = new Set(alunoIds);
  const dados = {};
  for (const [alunoId, valor] of Object.entries(resultados ?? {})) {
    if (valor === null || valor === undefined) continue;
    if (!permitidos.has(alunoId)) return { erro: 'Há um resultado para alguém que não tem matrícula nesta turma.' };
    if (modo === MODO.APTO) {
      if (typeof valor !== 'boolean') return { erro: 'Marque Apto ou Não apto para cada resultado.' };
    } else if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor > notaMaxima) {
      return { erro: `As notas devem estar entre 0 e ${virgula(notaMaxima)}.` };
    }
    dados[alunoId] = valor;
  }
  return { dados };
}

/**
 * Quem aparece na lista de lançamento: as matrículas ATIVAS e quem já tem resultado nesta avaliação,
 * mesmo que hoje esteja trancado ou tenha saído (o que foi lançado não pode sumir da tela).
 */
export function pessoasDaAvaliacao({ matriculas, avaliacao }) {
  const lancados = resultadosDa(avaliacao);
  return matriculas.filter((m) => tem(lancados, m.alunoId) || m.status === STATUS_MATRICULA.ATIVA);
}

/** Maior nota já lançada numa avaliação (0 se não houver): a nota máxima não pode ficar abaixo dela. */
export const maiorNotaLancada = (avaliacao) => Math.max(0, ...Object.values(avaliacao.notas ?? {}));

/**
 * Números de uma avaliação para a lista: quantos foram avaliados e, conforme o modo, a média da turma
 * (na escala da própria avaliação) ou quantos Aptos e Não aptos.
 * @param {number} total quantas pessoas deveriam ser avaliadas
 */
export function estatisticasDaAvaliacao(avaliacao, total) {
  const valores = Object.values(resultadosDa(avaliacao));
  if (avaliacao.modo === MODO.APTO) {
    return { total, lancadas: valores.length, aptas: valores.filter(Boolean).length, naoAptas: valores.filter((v) => v === false).length };
  }
  const soma = valores.reduce((s, n) => s + n, 0);
  return { total, lancadas: valores.length, media: valores.length ? Math.round((soma / valores.length) * 100) / 100 : null };
}

/**
 * Recalcula o resumo acadêmico de cada matrícula da turma. As duas formas de avaliar convivem na mesma turma:
 *  - `media`: média ponderada (0–10) das avaliações por nota; null se a pessoa não tem nenhuma nota;
 *  - `aptidao`: { avaliadas, aptas, naoAptas } das avaliações Apto / Não apto; null se não tem nenhum resultado.
 * @param {{ avaliacoes: object[], matriculas: Array<{ id: string, alunoId: string }> }} p
 * @returns {Array<{ matriculaId: string, media: number|null, aptidao: object|null }>}
 */
export function recalcularResumos({ avaliacoes, matriculas }) {
  const porNota = avaliacoes.filter((a) => (a.modo ?? MODO.NOTA) === MODO.NOTA);
  const porAptidao = avaliacoes.filter((a) => a.modo === MODO.APTO);
  return matriculas.map((m) => {
    const media = calcularMedia(porNota.map((a) => ({ nota: a.notas?.[m.alunoId], peso: a.peso, notaMaxima: a.notaMaxima })));
    const marcas = porAptidao.map((a) => a.aptos?.[m.alunoId]).filter((v) => typeof v === 'boolean');
    const aptidao = marcas.length
      ? { avaliadas: marcas.length, aptas: marcas.filter(Boolean).length, naoAptas: marcas.filter((v) => !v).length }
      : null;
    return { matriculaId: m.id, media, aptidao };
  });
}
