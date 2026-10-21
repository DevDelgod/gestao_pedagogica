/**
 * Seleção de candidatos — funções puras (sem Firebase, sem DOM).
 *
 * Duas etapas separadas, para poder trocar a modalidade sem mexer no resto:
 *   1. ordenarCandidatos(modalidade, …) → quem está APTO e em que ORDEM (e quem foi eliminado e por quê)
 *   2. distribuirVagas(ordem, vagas, …) → os primeiros N são convocados, o resto vira suplente (ou não selecionado)
 *
 * Para criar uma modalidade nova (ex.: "análise de renda"), acrescente um `case` em
 * ordenarCandidatos. O restante do sistema não muda.
 */
import { MODALIDADE_SELECAO } from '../models/schema.js';

/** Texto gravado no registro de cada sorteio, para que o resultado possa ser refeito por terceiros. */
export const ALGORITMO_SORTEIO =
  'ids em ordem alfabética → embaralhados por Fisher-Yates com números de mulberry32 semeado por xmur3(semente)';

export const temSelecaoAutomatica = (modalidade) => modalidade !== MODALIDADE_SELECAO.ANALISE;

/** Semente aleatória (16 caracteres hexadecimais) para quando a equipe não informa uma. */
export function gerarSemente() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- gerador pseudoaleatório determinístico (algoritmos públicos: xmur3 + mulberry32) ---
function criarGerador(semente) {
  let h = 1779033703 ^ semente.length;
  for (let i = 0; i < semente.length; i++) {
    h = Math.imul(h ^ semente.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  let a = (h ^= h >>> 16) >>> 0; // estado inicial do mulberry32

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates determinístico: mesma lista + mesma semente = mesma ordem, em qualquer máquina. */
export function embaralhar(itens, semente) {
  const lista = [...itens];
  const sortear = criarGerador(String(semente));
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(sortear() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

// comparação de texto SEM localização: o resultado não pode variar entre navegadores
const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const porChegada = (a, b) => a.criadoEm - b.criadoEm || porId(a, b);

/**
 * @param {string} modalidade MODALIDADE_SELECAO.*
 * @param {Array<{ id: string, criadoEm: number, nota?: number|null }>} candidatos criadoEm em milissegundos
 * @param {{ semente?: string, notaMinima?: number }} [opcoes]
 * @returns {{ ordem: string[], eliminados: Array<{ id: string, motivo: 'sem-nota'|'abaixo-da-nota-minima' }> }}
 */
export function ordenarCandidatos(modalidade, candidatos, { semente, notaMinima = 0 } = {}) {
  switch (modalidade) {
    case MODALIDADE_SELECAO.SORTEIO: {
      if (!semente) throw new Error('O sorteio exige uma semente.');
      const base = [...candidatos].sort(porId).map((c) => c.id);
      return { ordem: embaralhar(base, semente), eliminados: [] };
    }

    case MODALIDADE_SELECAO.ORDEM_CHEGADA:
      return { ordem: [...candidatos].sort(porChegada).map((c) => c.id), eliminados: [] };

    case MODALIDADE_SELECAO.PROVA: {
      const aptos = [];
      const eliminados = [];
      for (const c of candidatos) {
        if (typeof c.nota !== 'number') eliminados.push({ id: c.id, motivo: 'sem-nota' });
        else if (c.nota < notaMinima) eliminados.push({ id: c.id, motivo: 'abaixo-da-nota-minima' });
        else aptos.push(c);
      }
      // maior nota primeiro; empate → quem se inscreveu antes
      aptos.sort((a, b) => b.nota - a.nota || porChegada(a, b));
      return { ordem: aptos.map((c) => c.id), eliminados };
    }

    default:
      throw new Error(`A modalidade "${modalidade}" não tem seleção automática.`);
  }
}

/**
 * Auditoria: refaz o sorteio só com o que foi registrado (candidatos, semente, vagas) e confere
 * se dá o mesmo resultado. Qualquer pessoa pode rodar isto com os dados do registro.
 * @param {{ candidatos: string[], semente: string, vagasLivres: number, listaEspera: boolean, convocados: string[], suplentes: string[] }} registro
 */
export function verificarSorteio({ candidatos, semente, vagasLivres, listaEspera, convocados, suplentes }) {
  const classificacao = ordenarCandidatos(
    MODALIDADE_SELECAO.SORTEIO,
    candidatos.map((id) => ({ id, criadoEm: 0 })),
    { semente },
  );
  const refeito = distribuirVagas(classificacao, vagasLivres, { listaEspera });
  const igual = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
  return igual(refeito.convocados, convocados) && igual(refeito.suplentes, suplentes);
}

/**
 * @param {{ ordem: string[], eliminados: Array<{ id: string, motivo: string }> }} classificacao
 * @param {number} vagas vagas livres na turma
 * @param {{ listaEspera?: boolean }} [opcoes]
 */
export function distribuirVagas({ ordem, eliminados }, vagas, { listaEspera = true } = {}) {
  const convocados = ordem.slice(0, Math.max(0, vagas));
  const restantes = ordem.slice(convocados.length);
  return {
    convocados,
    suplentes: listaEspera ? restantes : [],
    naoSelecionados: [...(listaEspera ? [] : restantes), ...eliminados.map((e) => e.id)],
    motivosEliminacao: Object.fromEntries(eliminados.map((e) => [e.id, e.motivo])),
  };
}
