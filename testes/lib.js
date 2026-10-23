/**
 * Mini-framework de testes para rodar no navegador (sem Node, sem instalar nada): abra testes/index.html.
 *
 * ATENÇÃO: estes testes só usam código puro (domain/ e core/planilha.js). Não importe nada que fale com o banco
 * (services/, core/firebase.js): a página roda na mesma origem do sistema e mexeria nos dados reais guardados no navegador.
 */
const casos = [];
let grupoAtual = '';

export function grupo(nome, definicao) {
  const anterior = grupoAtual;
  grupoAtual = nome;
  definicao();
  grupoAtual = anterior;
}

export const teste = (nome, corpo) => casos.push({ grupo: grupoAtual, nome, corpo });

export function afirmar(condicao, mensagem = 'a afirmação é falsa') {
  if (!condicao) throw new Error(mensagem);
}

/** Compara por valor (JSON): objetos e listas iguais passam, mesmo que sejam instâncias diferentes. */
export function igual(real, esperado, mensagem = '') {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${mensagem} esperado ${b}, veio ${a}`.trim());
}

/** A função deve lançar um erro; `trecho`, se dado, precisa aparecer na mensagem. */
export async function recusa(funcao, trecho = '') {
  try {
    await funcao();
  } catch (erro) {
    if (trecho && !String(erro.message).includes(trecho)) throw new Error(`o erro foi outro: "${erro.message}"`);
    return;
  }
  throw new Error('deveria ter recusado, mas passou');
}

export async function rodarTodos() {
  const resultados = [];
  for (const caso of casos) {
    try {
      await caso.corpo();
      resultados.push({ ...caso, ok: true });
    } catch (erro) {
      resultados.push({ ...caso, ok: false, erro: erro.message });
    }
  }
  return resultados;
}
