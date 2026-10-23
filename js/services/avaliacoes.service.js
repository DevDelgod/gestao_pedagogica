/**
 * Serviço de avaliações: criar, editar, lançar os resultados e excluir uma avaliação da turma.
 *
 * A forma de avaliar (nota ou Apto / Não apto) é escolhida em cada avaliação, ao criá-la. Cada gravação é UMA
 * transação que escreve a avaliação e recalcula o resumo (media e aptidao) de todas as matrículas da turma com as
 * avaliações de agora, então a média nunca diverge dos resultados. As regras do Firestore deixam o professor da
 * turma fazer isto: ele escreve em `avaliacoes` da própria turma e só toca nos campos de resumo da matrícula.
 */
import { collection, db, doc, runTransaction, serverTimestamp, where } from '../core/firebase.js';
import { auditoriaDeCriacao, criarRepo } from '../core/repo.js';
import { ErroDeNegocio } from '../core/erros.js';
import {
  maiorNotaLancada,
  recalcularResumos,
  temResultados,
  validarAvaliacao,
  validarResultados,
} from '../domain/avaliacoes.js';
import { COLECOES, MODO_AVALIACAO, STATUS_TURMA, novaAvaliacao } from '../models/schema.js';
import { listarMatriculasDaTurma } from './matriculas.service.js';

export const avaliacoesRepo = criarRepo(COLECOES.AVALIACOES);

/** Avaliações de uma turma em ordem de data (as sem data por último). */
export async function listarAvaliacoesDaTurma(turmaId) {
  const avaliacoes = await avaliacoesRepo.listar(where('turmaId', '==', turmaId));
  return avaliacoes.sort((a, b) => (a.data ?? '9999').localeCompare(b.data ?? '9999') || a.titulo.localeCompare(b.titulo, 'pt-BR'));
}

async function obterOuFalhar(avaliacaoId) {
  const avaliacao = await avaliacoesRepo.obter(avaliacaoId);
  if (!avaliacao) throw new ErroDeNegocio('nao-encontrado', 'Avaliação não encontrada.');
  return avaliacao;
}

/**
 * Cria uma avaliação na turma (sem resultados).
 * @param {{ turmaId: string, modo: 'nota'|'apto', titulo: string, tipo?: string, data?: string, peso?: string|number, notaMaxima?: string|number }} entrada
 *   `peso` e `notaMaxima` só valem no modo nota
 * @returns {Promise<string>} id da avaliação
 */
export const criarAvaliacao = ({ turmaId, ...entrada }) => aplicar({ turmaId, operacao: { tipo: 'salvar', entrada } });

/**
 * Muda forma de avaliar, título, tipo, data, peso e nota máxima; os resultados lançados ficam como estão.
 * Com resultados lançados, a forma de avaliar não troca (limpe os resultados antes).
 */
export async function editarAvaliacao(avaliacaoId, entrada) {
  const { turmaId } = await obterOuFalhar(avaliacaoId);
  return aplicar({ avaliacaoId, turmaId, operacao: { tipo: 'salvar', entrada } });
}

/**
 * Grava os resultados da avaliação, substituindo os anteriores. Quem não entra em `resultados` fica sem resultado.
 * @param {Record<string, number|boolean|null>} resultados { alunoId: nota } no modo nota, { alunoId: true | false } no modo apto
 */
export async function lancarResultados(avaliacaoId, resultados) {
  const { turmaId } = await obterOuFalhar(avaliacaoId);
  return aplicar({ avaliacaoId, turmaId, operacao: { tipo: 'resultados', resultados } });
}

/** Exclui a avaliação e recalcula as médias sem ela (só a gestão pode, pelas regras). */
export async function excluirAvaliacao(avaliacaoId) {
  const { turmaId } = await obterOuFalhar(avaliacaoId);
  return aplicar({ avaliacaoId, turmaId, operacao: { tipo: 'excluir' } });
}

async function aplicar({ avaliacaoId = null, turmaId, operacao }) {
  // Consultas antes (o Firestore não as permite dentro de transação); a transação relê tudo pelo id.
  const [avaliacoes, matriculas] = await Promise.all([listarAvaliacoesDaTurma(turmaId), listarMatriculasDaTurma(turmaId)]);
  const avaliacaoRef = avaliacaoId ? doc(db, COLECOES.AVALIACOES, avaliacaoId) : doc(collection(db, COLECOES.AVALIACOES));
  await runTransaction(db, (tx) =>
    aplicarNaTransacao(tx, {
      avaliacaoRef,
      existente: Boolean(avaliacaoId),
      turmaId,
      operacao,
      outrasIds: avaliacoes.map((a) => a.id).filter((id) => id !== avaliacaoRef.id),
      matriculas: matriculas.map((m) => ({ id: m.id, alunoId: m.alunoId, status: m.status })),
    }),
  );
  return avaliacaoRef.id;
}

/**
 * Corpo da transação, exportado para teste com uma `tx` falsa.
 * `operacao`: { tipo: 'salvar', entrada } | { tipo: 'resultados', resultados } | { tipo: 'excluir' }.
 * Se outra pessoa criar uma avaliação entre a consulta e a gravação, ela não entra neste cálculo; a próxima
 * gravação (que recalcula tudo do zero) corrige sozinha.
 */
export async function aplicarNaTransacao(tx, { avaliacaoRef, existente, turmaId, operacao, outrasIds, matriculas }) {
  // --- leituras ---
  const [turmaSnap, avaliacaoSnap, ...outrasSnaps] = await Promise.all([
    tx.get(doc(db, COLECOES.TURMAS, turmaId)),
    tx.get(avaliacaoRef),
    ...outrasIds.map((id) => tx.get(doc(db, COLECOES.AVALIACOES, id))),
  ]);

  // --- validações ---
  if (!turmaSnap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Turma não encontrada.');
  const turma = turmaSnap.data();
  if (turma.status === STATUS_TURMA.CANCELADA) {
    throw new ErroDeNegocio('turma-indisponivel', `A turma "${turma.nome}" foi cancelada e não recebe avaliações.`);
  }
  if (existente && !avaliacaoSnap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Avaliação não encontrada.');
  const atual = existente ? avaliacaoSnap.data() : null;

  let campos = null; // o que muda no documento (null = a avaliação é excluída)
  if (operacao.tipo === 'salvar') {
    const { dados, erro } = validarAvaliacao(operacao.entrada);
    if (erro) throw new ErroDeNegocio('dados-invalidos', erro);
    if (atual && dados.modo !== atual.modo && temResultados(atual)) {
      throw new ErroDeNegocio('modo-travado', 'Esta avaliação já tem resultados lançados. Limpe os resultados e salve antes de trocar a forma de avaliar.');
    }
    const maior = atual ? maiorNotaLancada(atual) : 0;
    if (dados.modo === MODO_AVALIACAO.NOTA && dados.notaMaxima < maior) {
      throw new ErroDeNegocio('nota-acima-do-maximo', `A nota máxima não pode ser menor que a maior nota já lançada (${String(maior).replace('.', ',')}).`);
    }
    campos = dados;
  } else if (operacao.tipo === 'resultados') {
    const { dados, erro } = validarResultados(operacao.resultados, {
      modo: atual.modo,
      notaMaxima: atual.notaMaxima,
      alunoIds: matriculas.map((m) => m.alunoId),
    });
    if (erro) throw new ErroDeNegocio('dados-invalidos', erro);
    campos = atual.modo === MODO_AVALIACAO.APTO ? { aptos: dados } : { notas: dados };
  }

  // --- recálculo do resumo das matrículas com as avaliações de agora ---
  const outras = outrasSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));
  const resultante = campos && (atual ? { ...atual, ...campos } : novaAvaliacao({ ...campos, turmaId }));
  const atualizacoes = recalcularResumos({ avaliacoes: resultante ? [...outras, resultante] : outras, matriculas });

  // --- escritas ---
  if (!campos) {
    tx.delete(avaliacaoRef);
  } else if (atual) {
    tx.update(avaliacaoRef, { ...campos, atualizadoEm: serverTimestamp() });
  } else {
    tx.set(avaliacaoRef, { ...resultante, ...auditoriaDeCriacao() });
  }
  atualizacoes.forEach(({ matriculaId, media, aptidao }) => {
    tx.update(doc(db, COLECOES.MATRICULAS, matriculaId), { media, aptidao, atualizadoEm: serverTimestamp() });
  });
}
