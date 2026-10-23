/**
 * Serviço da importação: lê as planilhas do sistema oficial, monta o plano (domain/importacao.js) e grava.
 *
 * Ordem de uso, pelas telas:
 *   lerArquivoDeImportacao(arquivo)            → o que há na planilha (listagem ou frequência)
 *   carregarExistentes() + planejarListagem()  → pré-visualização, sem gravar nada
 *   aplicarListagem(plano) / aplicarFrequencia(plano)
 *
 * Os lotes gravados têm até 400 escritas (o Firestore aceita 500 por lote). Como cada lote é separado, uma falha no
 * meio deixa a importação pela metade, mas importar o MESMO arquivo de novo completa o que faltou sem duplicar nada.
 */
import { db, doc, serverTimestamp, writeBatch } from '../core/firebase.js';
import { auditoriaDeCriacao, criarRepo } from '../core/repo.js';
import { ErroDeNegocio } from '../core/erros.js';
import { hojeISO } from '../core/datas.js';
import { lerPlanilha } from '../core/planilha.js';
import {
  detectarFrequencia,
  detectarListagem,
  lerFrequencia,
  lerListagem,
  planejarFrequencia,
  resolverTurmaDaFrequencia,
  sugerirPeriodo,
} from '../domain/importacao.js';
import { COLECOES } from '../models/schema.js';
import { alunosRepo } from './alunos.service.js';
import { cursosRepo } from './cursos.service.js';
import { listarAulasDaTurma } from './diario.service.js';
import { matriculasRepo } from './matriculas.service.js';
import { turmasRepo } from './turmas.service.js';

export const importacoesRepo = criarRepo(COLECOES.IMPORTACOES);
const configuracoesRepo = criarRepo(COLECOES.CONFIGURACOES);

const TAMANHO_DO_LOTE = 400;
const ID_CONFIGURACAO = 'importacao';

// ---------------------------------------------------------------------------
// Ler o arquivo
// ---------------------------------------------------------------------------

/**
 * Descobre que planilha é e lê o que dá para ler dela, sem gravar nada.
 * @param {File} arquivo
 * @returns {Promise<{ tipo: 'listagem', nomeArquivo: string, registros: object[], ignoradas: number[], periodoSugerido: string }
 *   | { tipo: 'frequencia', nomeArquivo: string, leitura: object }>}
 */
export async function lerArquivoDeImportacao(arquivo) {
  const { abas } = await lerPlanilha(arquivo);
  for (const aba of abas) {
    const frequencia = detectarFrequencia(aba.linhas);
    if (frequencia) return { tipo: 'frequencia', nomeArquivo: arquivo.name, leitura: lerFrequencia(aba.linhas, frequencia) };

    const listagem = detectarListagem(aba.linhas);
    if (listagem) {
      const hoje = hojeISO();
      const { registros, ignoradas } = lerListagem(aba.linhas, listagem, { hoje });
      return { tipo: 'listagem', nomeArquivo: arquivo.name, registros, ignoradas, periodoSugerido: sugerirPeriodo(registros, hoje) };
    }
  }
  throw new ErroDeNegocio(
    'planilha-desconhecida',
    'Não reconheci esta planilha. Use a "Listagem" de candidatos exportada do sistema oficial (com Nome do candidato e Nome do curso) ou a lista de frequência da turma (com Inscrição, Nome e uma coluna por aula).',
  );
}

/** Tudo o que já está no sistema e que uma importação precisa conhecer para saber o que é novo. */
export async function carregarExistentes() {
  const [alunos, matriculas, turmas, cursos] = await Promise.all([alunosRepo.listar(), matriculasRepo.listar(), turmasRepo.listar(), cursosRepo.listar()]);
  return { alunos, matriculas, turmas, cursos };
}

/** Como a pessoa traduziu, em importações anteriores, as situações da planilha para as nossas ({ 'ativo': 'ativa' }). */
export async function obterMapaDeSituacoes() {
  return (await configuracoesRepo.obter(ID_CONFIGURACAO))?.mapaStatus ?? {};
}

// ---------------------------------------------------------------------------
// Gravar
// ---------------------------------------------------------------------------

const criar = (colecao, id, dados) => ({ tipo: 'set', ref: doc(db, colecao, id), dados: { ...dados, ...auditoriaDeCriacao() } });
const atualizar = (colecao, id, dados) => ({ tipo: 'update', ref: doc(db, colecao, id), dados: { ...dados, atualizadoEm: serverTimestamp() } });
const gravarNovoOuAtualizar = (colecao, item, dados) => (item.novo ? criar(colecao, item.id, dados) : atualizar(colecao, item.id, dados));

async function gravarEmLotes(escritas, aoProgresso) {
  aoProgresso?.(0, escritas.length);
  for (let i = 0; i < escritas.length; i += TAMANHO_DO_LOTE) {
    const lote = writeBatch(db);
    for (const e of escritas.slice(i, i + TAMANHO_DO_LOTE)) {
      e.tipo === 'set' ? lote.set(e.ref, e.dados) : lote.update(e.ref, e.dados);
    }
    await lote.commit();
    aoProgresso?.(Math.min(i + TAMANHO_DO_LOTE, escritas.length), escritas.length);
  }
}

/** Guarda no histórico o que foi importado (e os avisos), para a equipe saber de onde vieram os dados. */
const registrarImportacao = (dados) => importacoesRepo.criar(dados);

/**
 * Grava o plano de uma listagem: cursos, turmas, pessoas e matrículas, nessa ordem.
 * @param {ReturnType<import('../domain/importacao.js').planejarListagem>} plano
 * @param {{ arquivo: string, mapaStatus: Record<string, string>, aoProgresso?: (feito: number, total: number) => void }} opcoes
 */
export async function aplicarListagem(plano, { arquivo, mapaStatus, aoProgresso }) {
  if (plano.pendencias) throw new ErroDeNegocio('situacoes-pendentes', 'Escolha o que cada situação da planilha significa antes de importar.');

  const escritas = [
    ...plano.cursos.filter((c) => c.novo).map((c) => criar(COLECOES.CURSOS, c.id, c.dados)),
    ...plano.turmas.map((t) => gravarNovoOuAtualizar(COLECOES.TURMAS, t, t.dados)),
    ...plano.alunos.map((a) => gravarNovoOuAtualizar(COLECOES.ALUNOS, a, a.dados)),
    ...plano.matriculas.map((m) => gravarNovoOuAtualizar(COLECOES.MATRICULAS, m, m.dados)),
  ];
  await gravarEmLotes(escritas, aoProgresso);

  await configuracoesRepo.criar({ mapaStatus }, ID_CONFIGURACAO);
  await registrarImportacao({ tipo: 'listagem', arquivo, resumo: plano.resumo, avisos: plano.avisos.slice(0, 30).map((a) => a.texto) });
  return plano.resumo;
}

/**
 * Lê a turma e a lista de aulas dela e monta o plano da planilha de frequência. Não grava nada.
 * @returns {Promise<{ resolucao: object, plano: ReturnType<typeof planejarFrequencia> }>}
 */
export async function prepararFrequencia(leitura) {
  const [matriculas, turmas] = await Promise.all([matriculasRepo.listar(), turmasRepo.listar()]);
  const resolucao = resolverTurmaDaFrequencia(leitura, { matriculas, turmas });
  if (!resolucao) {
    throw new ErroDeNegocio(
      'turma-nao-encontrada',
      'Não encontrei a turma desta planilha. Importe antes a listagem de candidatos que inclui as pessoas desta turma.',
    );
  }
  const turma = turmas.find((t) => t.id === resolucao.turmaId);
  const [curso, aulas] = await Promise.all([cursosRepo.obter(turma.cursoId), listarAulasDaTurma(turma.id)]);
  const plano = planejarFrequencia(leitura, { turma, curso, matriculas: matriculas.filter((m) => m.turmaId === turma.id), aulas });
  return { resolucao, plano };
}

/** Grava as aulas da planilha de frequência e o resumo de frequência e de risco de evasão de cada matrícula da turma. */
export async function aplicarFrequencia(plano, { arquivo, aoProgresso }) {
  const escritas = [
    ...plano.aulas.map((a) => gravarNovoOuAtualizar(COLECOES.AULAS, a, a.dados)),
    ...plano.resumos.map(({ matriculaId, frequencia, riscoEvasao }) => atualizar(COLECOES.MATRICULAS, matriculaId, { frequencia, riscoEvasao })),
  ];
  await gravarEmLotes(escritas, aoProgresso);

  await registrarImportacao({
    tipo: 'frequencia',
    arquivo,
    turmaId: plano.turmaId,
    turmaNome: plano.turmaNome,
    resumo: plano.resumo,
    avisos: plano.avisos.slice(0, 30).map((a) => a.texto),
  });
  return plano.resumo;
}

/** Importações feitas, da mais recente para a mais antiga. */
export async function listarImportacoes() {
  const todas = await importacoesRepo.listar();
  const instante = (i) => i.criadoEm?.toMillis?.() ?? 0;
  return todas.sort((a, b) => instante(b) - instante(a));
}
