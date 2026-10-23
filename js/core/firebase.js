/**
 * Único ponto de contato com o SDK do Firebase.
 * Todo o resto do projeto importa daqui. Para atualizar o SDK, troque VERSAO. Sem bundler:
 * o navegador carrega os módulos direto do CDN do Google.
 *
 * Em modo desenvolvimento (Firebase não configurado + localhost; ver config.js) este módulo
 * entrega, no lugar do SDK, o Firebase simulado de js/dev/firebase-fake.js, com a mesma API.
 */
import { firebaseConfig, configurado, modoDesenvolvimento } from './config.js';

const VERSAO = '10.14.1';
const cdn = (modulo) => `https://www.gstatic.com/firebasejs/${VERSAO}/firebase-${modulo}.js`;

const FUNCOES_AUTH = ['onAuthStateChanged', 'signInWithEmailAndPassword', 'signOut', 'sendPasswordResetEmail'];
const FUNCOES_FIRESTORE = [
  'collection', 'doc', 'getDoc', 'getDocs', 'getCountFromServer', 'addDoc', 'setDoc', 'updateDoc', 'deleteDoc',
  'onSnapshot', 'query', 'where', 'orderBy', 'limit', 'startAfter', 'serverTimestamp', 'increment',
  'writeBatch', 'runTransaction', 'Timestamp',
];
const escolher = (modulo, nomes) => Object.fromEntries(nomes.map((nome) => [nome, modulo[nome]]));

async function carregarSdkReal() {
  if (!configurado) console.warn('[firebase] Preencha js/core/config.js com os dados do seu projeto.');
  const [{ initializeApp }, sdkAuth, sdkFirestore] = await Promise.all([
    import(cdn('app')),
    import(cdn('auth')),
    import(cdn('firestore')),
  ]);
  const app = initializeApp(firebaseConfig);
  return {
    app,
    auth: sdkAuth.getAuth(app),
    db: sdkFirestore.getFirestore(app),
    ...escolher(sdkAuth, FUNCOES_AUTH),
    ...escolher(sdkFirestore, FUNCOES_FIRESTORE),
  };
}

const sdk = modoDesenvolvimento ? await import('../dev/firebase-fake.js') : await carregarSdkReal();

/**
 * Só existe no modo local (Firebase simulado): backup, restauração e limpeza dos dados guardados no navegador.
 * Com o Firebase de verdade vale undefined, e as telas escondem essas opções.
 */
export const { dev } = sdk;

export const {
  app,
  auth,
  db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  increment,
  writeBatch,
  runTransaction,
  Timestamp,
} = sdk;
