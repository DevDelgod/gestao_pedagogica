/**
 * FIREBASE SIMULADO — só para o modo desenvolvimento (ver js/core/config.js e js/core/firebase.js).
 *
 * Entrega a mesma API que js/core/firebase.js exporta (Auth + Firestore), mas tudo roda no
 * navegador e fica salvo no localStorage deste navegador: nada vai para a internet.
 *
 * O que imita: login por e-mail/senha com as contas de seed.js; consultas where/orderBy; ids
 * automáticos; campos com ponto no updateDoc; serverTimestamp e increment; transações (todas as
 * leituras antes das escritas; escritas aplicadas só no fim, tudo ou nada); writeBatch.
 *
 * O que NÃO imita: regras de segurança (firestore.rules), índices compostos e concorrência real.
 * Teste isso no Firebase de verdade (emulador ou projeto de teste).
 */
import { CONTAS_DEV, SEED_VERSAO, semear } from './seed.js';

// ---------------------------------------------------------------------------
// Armazenamento
// ---------------------------------------------------------------------------
const CHAVE_DADOS = 'fudev:dev:dados';
const CHAVE_SESSAO = 'fudev:dev:sessao';

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
/** Devolve false se o navegador recusar (armazenamento cheio ou bloqueado): os dados seguem só em memória. */
const gravarStorage = (chave, valor) => {
  try {
    valor === null ? localStorage.removeItem(chave) : localStorage.setItem(chave, valor);
    return true;
  } catch {
    return false;
  }
};

const store = new Map(); // 'colecao/id' -> dados

let avisouArmazenamentoCheio = false;
function salvar() {
  const ok = gravarStorage(CHAVE_DADOS, JSON.stringify({ versao: SEED_VERSAO, docs: [...store] }, (_, v) => (v instanceof Timestamp ? { __ts: v.ms } : v)));
  if (!ok && !avisouArmazenamentoCheio) {
    avisouArmazenamentoCheio = true; // sem isto os dados sumiriam na recarga sem ninguém perceber
    console.warn('[modo dev] Armazenamento do navegador cheio: as alterações não estão sendo salvas.');
    document.querySelector('#dev-faixa span')?.replaceChildren('ATENÇÃO: armazenamento do navegador cheio. As últimas alterações não serão salvas.');
  }
}

function carregar() {
  try {
    const salvo = JSON.parse(lerStorage(CHAVE_DADOS) ?? 'null', (_, v) => (v && typeof v === 'object' && '__ts' in v ? new Timestamp(v.__ts) : v));
    if (salvo?.versao === SEED_VERSAO) {
      salvo.docs.forEach(([caminho, dados]) => store.set(caminho, dados));
      return;
    }
  } catch { /* dados corrompidos: recomeça do seed */ }
  store.clear();
  semear(store, Timestamp);
  salvar();
}
carregar();

/** Apaga as alterações feitas em teste e volta aos dados de exemplo. */
function restaurarDadosDeExemplo() {
  gravarStorage(CHAVE_DADOS, null);
  location.reload();
}

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
  let docs = [...store.keys()]
    .filter((caminho) => caminho.startsWith(`${consulta.nome}/`) && !caminho.slice(consulta.nome.length + 1).includes('/'))
    .map(instantaneo);

  for (const r of consulta.restricoes.filter((x) => x.tipo === 'where')) {
    docs = docs.filter((d) => {
      const v = valorDe(d.data(), r.campo);
      if (r.op === '==') return v === r.valor;
      if (r.op === '!=') return v !== r.valor;
      if (r.op === 'in') return r.valor.includes(v);
      throw new Error(`[modo dev] operador "${r.op}" ainda não é suportado pelo Firebase simulado.`);
    });
  }
  for (const r of consulta.restricoes.filter((x) => x.tipo === 'orderBy').reverse()) {
    docs.sort((a, b) => {
      const x = comparavel(valorDe(a.data(), r.campo));
      const y = comparavel(valorDe(b.data(), r.campo));
      return (x > y ? 1 : x < y ? -1 : 0) * (r.dir === 'desc' ? -1 : 1);
    });
  }
  const lim = consulta.restricoes.find((x) => x.tipo === 'limit');
  return lim ? docs.slice(0, lim.n) : docs;
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
  salvar();
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
  salvar();
};
export const deleteDoc = async (ref) => {
  await pausa();
  store.delete(ref.path);
  salvar();
};

/** Aplica uma lista de escritas de uma vez: se alguma falhar na validação, nenhuma é aplicada. */
function aplicarEscritas(escritas) {
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
  salvar();
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
  aplicarEscritas(escritas);
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
// Avisos na tela: faixa de modo dev e atalhos de login
// ---------------------------------------------------------------------------
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
  faixa.innerHTML = '<span>MODO DESENVOLVIMENTO · dados de exemplo neste navegador</span><button type="button">Restaurar dados</button>';
  faixa.querySelector('button').addEventListener('click', () => {
    if (confirm('Apagar as alterações feitas em teste e voltar aos dados de exemplo?')) restaurarDadosDeExemplo();
  });
  document.body.append(faixa);

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
