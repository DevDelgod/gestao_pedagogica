/**
 * FIREBASE SIMULADO — só para o modo desenvolvimento/local (ver js/core/config.js e js/core/firebase.js).
 *
 * Entrega a mesma API que js/core/firebase.js exporta (Auth + Firestore), mas tudo roda no
 * navegador e fica salvo no IndexedDB deste navegador: nada vai para a internet.
 *
 * O que imita: login por e-mail/senha com as contas de seed.js; consultas where/orderBy; ids
 * automáticos; campos com ponto no updateDoc; serverTimestamp e increment; transações (todas as
 * leituras antes das escritas; escritas aplicadas só no fim, tudo ou nada); writeBatch.
 *
 * O que NÃO imita: regras de segurança (firestore.rules), índices compostos e concorrência real.
 * Teste isso no Firebase de verdade (emulador ou projeto de teste).
 *
 * O sistema abre VAZIO (só com o login das contas de teste). Os dados têm duas origens (`dev.origem()`):
 *  - 'local': dados de verdade (importados ou digitados), ou o sistema vazio. NUNCA são refeitos nem apagados por
 *    uma atualização do código: só saem por ação explícita (dev.limparDados, dev.restaurarBackup).
 *  - 'exemplo': o cenário fictício de seed.js, só se a pessoa pedir (dev.carregarExemplos). É descartável: quando
 *    SEED_VERSAO muda, o exemplo salvo é descartado e o sistema volta a abrir vazio.
 */
import { baixarArquivo } from '../core/arquivos.js';
import { CONTAS_DEV, SEED_VERSAO, semear, semearEquipe } from './seed.js';

// ---------------------------------------------------------------------------
// Armazenamento
// ---------------------------------------------------------------------------
const CHAVE_SESSAO = 'fudev:dev:sessao';
const CHAVE_LEGADA = 'fudev:dev:dados'; // versões antigas guardavam tudo no localStorage (limite de ~5 MB)
const BANCO = 'fudev-local';
const TABELA = 'dados';
const REGISTRO = 'principal';
const REGISTRO_CORROMPIDO = 'corrompido'; // cópia de segurança de um registro que não pôde ser lido

export class Timestamp {
  constructor(ms) { this.ms = ms; }
  static now() { return new Timestamp(Date.now()); }
  static fromDate(data) { return new Timestamp(data.getTime()); }
  static fromMillis(ms) { return new Timestamp(ms); }
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
}

const SERVER_TS = { __serverTimestamp: true };
export const serverTimestamp = () => SERVER_TS;
export const increment = (n) => ({ __incremento: n });

const lerStorage = (chave) => { try { return localStorage.getItem(chave); } catch { return null; } };
/** Devolve false se o navegador recusar (armazenamento bloqueado). */
const gravarStorage = (chave, valor) => {
  try {
    valor === null ? localStorage.removeItem(chave) : localStorage.setItem(chave, valor);
    return true;
  } catch {
    return false;
  }
};

const store = new Map(); // 'colecao/id' -> dados
let origem = 'exemplo';
let banco = null; // IndexedDB; null se o navegador não deixar abrir (os dados ficam só em memória, até fechar a aba)

const pedido = (req) => new Promise((ok, falha) => { req.onsuccess = () => ok(req.result); req.onerror = () => falha(req.error); });

async function abrirBanco() {
  const abertura = indexedDB.open(BANCO, 1);
  abertura.onupgradeneeded = () => abertura.result.createObjectStore(TABELA);
  return pedido(abertura);
}

const lerRegistro = (chave) => pedido(banco.transaction(TABELA).objectStore(TABELA).get(chave));

function gravarRegistro(texto, chave = REGISTRO) {
  return new Promise((ok, falha) => {
    const transacao = banco.transaction(TABELA, 'readwrite');
    texto === null ? transacao.objectStore(TABELA).delete(chave) : transacao.objectStore(TABELA).put(texto, chave);
    transacao.oncomplete = ok;
    transacao.onerror = transacao.onabort = () => falha(transacao.error);
  });
}

const substituto = (_, v) => (v instanceof Timestamp ? { __ts: v.ms } : v);
const reviver = (_, v) => (v && typeof v === 'object' && '__ts' in v ? new Timestamp(v.__ts) : v);
const serializar = () => JSON.stringify({ versao: SEED_VERSAO, origem, docs: [...store] }, substituto);

let avisouFalha = false;
function avisarFalhaDeGravacao(erro) {
  console.error('[modo local] Não foi possível gravar os dados neste navegador:', erro);
  if (avisouFalha) return;
  avisouFalha = true; // sem isto os dados sumiriam ao recarregar sem ninguém perceber
  document.querySelector('#dev-faixa span')?.replaceChildren('ATENÇÃO: o navegador não está guardando os dados (armazenamento cheio ou bloqueado). Baixe um backup.');
}

// Gravações seguidas viram uma só: enquanto uma grava, as novas só marcam "sujo" e o laço grava o estado mais recente.
let sujo = false;
let gravando = null;
/** Resolve quando o estado de AGORA já está guardado no navegador. */
function salvar() {
  if (!banco) return Promise.resolve();
  sujo = true;
  gravando ??= (async () => {
    while (sujo) {
      sujo = false;
      await gravarRegistro(serializar()).catch(avisarFalhaDeGravacao);
    }
    gravando = null;
  })();
  return gravando;
}

async function carregar() {
  let texto = null;
  try {
    banco = await abrirBanco();
    texto = await lerRegistro(REGISTRO);
  } catch (erro) {
    banco = null;
    console.warn('[modo local] IndexedDB indisponível: os dados não serão guardados entre visitas.', erro);
  }
  if (texto) {
    try {
      const salvo = JSON.parse(texto, reviver);
      if (salvo?.origem === 'local' || salvo?.versao === SEED_VERSAO) {
        origem = salvo.origem ?? 'exemplo';
        salvo.docs.forEach(([caminho, dados]) => store.set(caminho, dados));
        return;
      }
    } catch (erro) {
      // dados ilegíveis: guarda uma cópia antes de recomeçar, para não perder de vez
      console.error('[modo local] Dados guardados ilegíveis; uma cópia foi mantida.', erro);
      await gravarRegistro(texto, REGISTRO_CORROMPIDO).catch(() => {});
    }
  }
  // primeira visita, exemplo antigo descartado ou dados ilegíveis: começa vazio, só com a equipe de teste
  store.clear();
  semearEquipe(store, Timestamp);
  origem = 'local';
  gravarStorage(CHAVE_LEGADA, null);
  await salvar();
}
await carregar();

const pausa = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function clonar(v) {
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(clonar);
  if (v && typeof v === 'object' && v !== SERVER_TS) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clonar(x)]));
  return v;
}

const resolver = (v) =>
  v === SERVER_TS ? Timestamp.now()
  : Array.isArray(v) ? v.map(resolver)
  : v instanceof Timestamp ? v
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolver(x)]))
  : v;

/** Aplica { 'a.b.c': valor } a um documento; entende increment(). */
function escreverCampos(alvo, campos) {
  for (const [chave, valor] of Object.entries(campos)) {
    const partes = chave.split('.');
    let o = alvo;
    for (const p of partes.slice(0, -1)) o = o[p] ??= {};
    const ultimo = partes.at(-1);
    o[ultimo] = valor && typeof valor === 'object' && '__incremento' in valor ? (o[ultimo] ?? 0) + valor.__incremento : resolver(clonar(valor));
  }
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------
export const app = { dev: true };
export const db = { dev: true };

export const collection = (_db, nome) => ({ tipo: 'col', path: nome, nome });

export function doc(base, ...partes) {
  if (base === db) return { tipo: 'doc', path: partes.join('/'), id: partes.at(-1) };
  const id = partes[0] ?? crypto.randomUUID().replaceAll('-', '').slice(0, 20); // coleção + (id opcional)
  return { tipo: 'doc', path: `${base.path}/${id}`, id };
}

const instantaneo = (caminho) => ({
  id: caminho.split('/').at(-1),
  exists: () => store.has(caminho),
  data: () => clonar(store.get(caminho)),
});

export const where = (campo, op, valor) => ({ tipo: 'where', campo, op, valor });
export const orderBy = (campo, dir = 'asc') => ({ tipo: 'orderBy', campo, dir });
export const limit = (n) => ({ tipo: 'limit', n });
export const startAfter = () => ({ tipo: 'startAfter' });
export const query = (col, ...restricoes) => ({ tipo: 'query', nome: col.nome, restricoes });

const valorDe = (dados, campo) => campo.split('.').reduce((o, p) => o?.[p], dados);
const comparavel = (v) => (v instanceof Timestamp ? v.ms : v);

function executar(consulta) {
  // filtra e ordena direto nos dados guardados (sem clonar cada documento); só os que sobram são clonados, ao ler
  const prefixo = `${consulta.nome}/`;
  let itens = [];
  for (const [caminho, dados] of store) {
    if (caminho.startsWith(prefixo) && !caminho.slice(prefixo.length).includes('/')) itens.push({ caminho, dados });
  }

  for (const r of consulta.restricoes.filter((x) => x.tipo === 'where')) {
    itens = itens.filter(({ dados }) => {
      const v = valorDe(dados, r.campo);
      if (r.op === '==') return v === r.valor;
      if (r.op === '!=') return v !== r.valor;
      if (r.op === 'in') return r.valor.includes(v);
      throw new Error(`[modo dev] operador "${r.op}" ainda não é suportado pelo Firebase simulado.`);
    });
  }
  for (const r of consulta.restricoes.filter((x) => x.tipo === 'orderBy').reverse()) {
    itens.sort((a, b) => {
      const x = comparavel(valorDe(a.dados, r.campo));
      const y = comparavel(valorDe(b.dados, r.campo));
      return (x > y ? 1 : x < y ? -1 : 0) * (r.dir === 'desc' ? -1 : 1);
    });
  }
  const lim = consulta.restricoes.find((x) => x.tipo === 'limit');
  return (lim ? itens.slice(0, lim.n) : itens).map(({ caminho }) => instantaneo(caminho));
}

export const getDoc = async (ref) => (await pausa(), instantaneo(ref.path));
export const getDocs = async (consulta) => {
  await pausa();
  const docs = executar(consulta);
  return { docs, size: docs.length, empty: docs.length === 0 };
};
export const getCountFromServer = async (consulta) => (await pausa(), { data: () => ({ count: executar(consulta).length }) });
export const onSnapshot = (consulta, aoMudar, aoFalhar) => {
  getDocs(consulta).then(aoMudar, aoFalhar);
  return () => {};
};

export const setDoc = async (ref, dados) => {
  await pausa();
  store.set(ref.path, resolver(clonar(dados)));
  await salvar();
};
export const addDoc = async (col, dados) => {
  const ref = doc(col);
  await setDoc(ref, dados);
  return ref;
};
export const updateDoc = async (ref, campos) => {
  await pausa();
  if (!store.has(ref.path)) throw new Error(`NOT_FOUND: ${ref.path}`);
  escreverCampos(store.get(ref.path), campos);
  await salvar();
};
export const deleteDoc = async (ref) => {
  await pausa();
  store.delete(ref.path);
  await salvar();
};

/** Aplica uma lista de escritas de uma vez: se alguma falhar na validação, nenhuma é aplicada. */
async function aplicarEscritas(escritas) {
  if (escritas.length > 500) throw new Error('Uma transação/lote do Firestore aceita no máximo 500 escritas.');
  const existe = new Set(store.keys());
  for (const e of escritas) {
    if (e.op === 'update' && !existe.has(e.ref.path)) throw new Error(`NOT_FOUND: ${e.ref.path}`);
    e.op === 'delete' ? existe.delete(e.ref.path) : existe.add(e.ref.path);
  }
  for (const e of escritas) {
    if (e.op === 'set') store.set(e.ref.path, resolver(clonar(e.dados)));
    else if (e.op === 'update') escreverCampos(store.get(e.ref.path), e.campos);
    else store.delete(e.ref.path);
  }
  await salvar();
}

export async function runTransaction(_db, fn) {
  await pausa();
  const escritas = [];
  const tx = {
    get: async (ref) => {
      if (escritas.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
      return instantaneo(ref.path);
    },
    set: (ref, dados) => (escritas.push({ op: 'set', ref, dados }), tx),
    update: (ref, campos) => (escritas.push({ op: 'update', ref, campos }), tx),
    delete: (ref) => (escritas.push({ op: 'delete', ref }), tx),
  };
  const resultado = await fn(tx); // se lançar, nada é aplicado
  await aplicarEscritas(escritas);
  return resultado;
}

export function writeBatch() {
  const escritas = [];
  const lote = {
    set: (ref, dados) => (escritas.push({ op: 'set', ref, dados }), lote),
    update: (ref, campos) => (escritas.push({ op: 'update', ref, campos }), lote),
    delete: (ref) => (escritas.push({ op: 'delete', ref }), lote),
    commit: async () => (await pausa(), aplicarEscritas(escritas)),
  };
  return lote;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const sessaoSalva = CONTAS_DEV.find((c) => c.uid === lerStorage(CHAVE_SESSAO));
export const auth = { dev: true, currentUser: sessaoSalva ? { uid: sessaoSalva.uid, email: sessaoSalva.email } : null };

const ouvintes = new Set();
const notificar = () => ouvintes.forEach((aoMudar) => aoMudar(auth.currentUser));

export function onAuthStateChanged(_auth, aoMudar) {
  ouvintes.add(aoMudar);
  setTimeout(() => aoMudar(auth.currentUser), 0); // assíncrono, como no Firebase de verdade
  return () => ouvintes.delete(aoMudar);
}

const erroDeAuth = (codigo) => Object.assign(new Error(`Firebase: Error (${codigo}).`), { code: codigo });

export async function signInWithEmailAndPassword(_auth, email, senha) {
  await pausa(250);
  if (!String(email).includes('@')) throw erroDeAuth('auth/invalid-email');
  const conta = CONTAS_DEV.find((c) => c.email === String(email).trim().toLowerCase() && c.senha === senha);
  if (!conta) throw erroDeAuth('auth/invalid-credential');
  auth.currentUser = { uid: conta.uid, email: conta.email };
  gravarStorage(CHAVE_SESSAO, conta.uid);
  notificar();
  return { user: auth.currentUser };
}

export async function signOut() {
  auth.currentUser = null;
  gravarStorage(CHAVE_SESSAO, null);
  notificar();
}

export const sendPasswordResetEmail = async () => pausa(250); // não envia e-mail nenhum

// ---------------------------------------------------------------------------
// Gestão dos dados guardados no navegador (só existe no modo local; o Firebase de verdade não tem isto)
// ---------------------------------------------------------------------------
const nomeDoBackup = () => `fudev-backup-${new Date().toISOString().slice(0, 10)}.json`;

export const dev = {
  /** 'exemplo' (dados fictícios) ou 'local' (dados de verdade deste navegador). */
  origem: () => origem,

  /** Apaga TUDO, menos a equipe das contas de teste, e passa a tratar os dados como de verdade (nunca mais refeitos). */
  async limparDados() {
    for (const caminho of [...store.keys()]) if (!caminho.startsWith('users/')) store.delete(caminho);
    origem = 'local';
    atualizarFaixa();
    await salvar();
  },

  /** Apaga TUDO e carrega o cenário fictício de seed.js (para demonstrar o sistema). Os dados passam a ser 'exemplo'. */
  async carregarExemplos() {
    store.clear();
    semear(store, Timestamp);
    origem = 'exemplo';
    atualizarFaixa();
    await salvar();
  },

  /** O banco inteiro como texto JSON (para guardar num arquivo). */
  backup: () => JSON.stringify({ app: 'fudev', formato: 1, origem, docs: [...store] }, substituto),

  baixarBackup() {
    baixarArquivo(nomeDoBackup(), dev.backup(), 'application/json');
  },

  /** Troca TODOS os dados pelos de um backup. Recusa arquivos que não sejam um backup do FUDEV. */
  async restaurarBackup(texto) {
    let lido;
    try {
      lido = JSON.parse(texto, reviver);
    } catch {
      throw new Error('O arquivo não é um backup válido.');
    }
    if (lido?.app !== 'fudev' || !Array.isArray(lido.docs)) throw new Error('O arquivo não é um backup do FUDEV.');
    store.clear();
    lido.docs.forEach(([caminho, dados]) => store.set(caminho, dados));
    if (![...store.keys()].some((c) => c.startsWith('users/'))) semearEquipe(store, Timestamp); // sem equipe ninguém consegue entrar
    origem = 'local';
    atualizarFaixa();
    await salvar();
  },
};

// ---------------------------------------------------------------------------
// Avisos na tela: faixa do modo local e atalhos de login
// ---------------------------------------------------------------------------
function atualizarFaixa() {
  const faixa = document.getElementById('dev-faixa');
  if (!faixa) return;
  const exemplo = origem === 'exemplo';
  faixa.querySelector('span').textContent = exemplo
    ? 'MODO DESENVOLVIMENTO · dados de exemplo neste navegador'
    : 'MODO LOCAL · seus dados ficam só neste navegador';
  faixa.querySelector('button').textContent = exemplo ? 'Limpar exemplos' : 'Baixar backup';
}

function montarInterfaceDev() {
  const estilo = document.createElement('style');
  estilo.textContent = `
    body { padding-bottom: 56px; } /* espaço para a faixa não cobrir o fim da página */
    #dev-faixa { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 50; display: flex; align-items: center;
      gap: 8px; width: max-content; max-width: calc(100vw - 24px); padding: 6px 8px 6px 12px; border-radius: 999px;
      font: 600 12px/1.3 system-ui, sans-serif; background: #b45309; color: #fff; box-shadow: 0 2px 10px rgb(0 0 0 / 30%); }
    #dev-faixa button { padding: 3px 10px; border: 1px solid rgb(255 255 255 / 60%); border-radius: 999px; background: transparent;
      color: inherit; font: inherit; cursor: pointer; white-space: nowrap; }
    #dev-faixa button:hover { background: rgb(255 255 255 / 20%); }
    .dev-contas { margin-top: 20px; padding-top: 16px; border-top: 1px dashed var(--cor-borda, #ccc); }
    .dev-contas h2 { margin: 0 0 4px; font-size: .95rem; }
    .dev-contas p { margin: 0 0 12px; color: var(--cor-texto-suave, #666); font-size: .85rem; }
    .dev-contas button { display: block; width: 100%; margin-bottom: 8px; padding: 8px 12px; text-align: left; cursor: pointer;
      border: 1px solid var(--cor-borda, #ccc); border-radius: 10px; background: var(--cor-superficie-2, #eee); color: inherit; font: inherit; }
    .dev-contas button small { display: block; color: var(--cor-texto-suave, #666); }
  `;
  document.head.append(estilo);

  const faixa = document.createElement('div');
  faixa.id = 'dev-faixa';
  faixa.innerHTML = '<span></span><button type="button"></button>';
  faixa.querySelector('button').addEventListener('click', async () => {
    if (origem === 'local') return dev.baixarBackup();
    if (confirm('Apagar os dados de exemplo e deixar o sistema vazio?')) {
      await dev.limparDados();
      location.reload();
    }
  });
  document.body.append(faixa);
  atualizarFaixa();

  // na tela de login: um botão por conta de desenvolvimento
  const formulario = document.getElementById('form-login');
  if (formulario) {
    const caixa = document.createElement('section');
    caixa.className = 'dev-contas';
    caixa.innerHTML = '<h2>Contas de desenvolvimento</h2><p>Firebase não configurado: o login abaixo é simulado neste navegador.</p>';
    CONTAS_DEV.forEach((conta) => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.innerHTML = `${conta.nome} <small>${conta.descricao}</small>`;
      botao.addEventListener('click', () => {
        formulario.email.value = conta.email;
        formulario.senha.value = conta.senha;
        formulario.requestSubmit();
      });
      caixa.append(botao);
    });
    formulario.closest('section')?.append(caixa);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarInterfaceDev);
else montarInterfaceDev();
