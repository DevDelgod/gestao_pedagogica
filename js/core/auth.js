/**
 * Autenticação e controle de acesso das páginas.
 *
 * Fluxo: Firebase Auth (e-mail/senha) identifica quem é → o documento users/{uid} diz
 * qual é o papel e se a pessoa está ativa. Sem esse documento, não há acesso.
 */
import {
  auth,
  db,
  doc,
  getDoc,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from './firebase.js';
import { COLECOES } from '../models/schema.js';

// Raiz do site calculada a partir deste arquivo (js/core/auth.js → ../../), então os
// redirecionamentos funcionam em qualquer subpasta ou domínio.
const RAIZ = new URL('../../', import.meta.url);
const rota = (caminho) => new URL(caminho, RAIZ).href;

const PAGINA_INICIAL = 'pages/dashboard.html';
const PAGINA_LOGIN = 'index.html';

const MENSAGENS_ERRO = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'Informe um e-mail válido.',
  'auth/user-disabled': 'Esta conta foi desativada.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
};
const NAO_CONFIGURADO = 'Firebase não configurado. Preencha js/core/config.js.';

export function mensagemDeErro(erro) {
  const codigo = erro?.code ?? '';
  // chave de API ausente/falsa chega como 'auth/invalid-api-key' ou 'auth/api-key-not-valid.-please-…'
  if (codigo === 'auth/invalid-api-key' || codigo.startsWith('auth/api-key-not-valid')) return NAO_CONFIGURADO;
  return MENSAGENS_ERRO[codigo] ?? 'Algo deu errado. Tente novamente.';
}

/** Resolve com o usuário atual (ou null) assim que o Firebase termina de restaurar a sessão. */
const usuarioAtual = () =>
  new Promise((resolve) => {
    const cancelar = onAuthStateChanged(auth, (u) => {
      cancelar();
      resolve(u);
    });
  });

/** Lê o perfil (papel, ativo) em users/{uid}. Retorna null se não existir. */
async function carregarPerfil(uid) {
  const snap = await getDoc(doc(db, COLECOES.USUARIOS, uid));
  return snap.exists() ? snap.data() : null;
}

export const entrar = (email, senha) => signInWithEmailAndPassword(auth, email, senha);

export const recuperarSenha = (email) => sendPasswordResetEmail(auth, email);

export async function sair() {
  await signOut(auth);
  location.href = rota(PAGINA_LOGIN);
}

/** Usada pela tela de login: se já há sessão válida, vai direto ao painel. */
export async function redirecionarSeLogado() {
  const user = await usuarioAtual();
  if (user) location.replace(rota(PAGINA_INICIAL));
}

export const irParaPainel = () => location.replace(rota(PAGINA_INICIAL));

/**
 * Guarda de página protegida. Chame no topo do script de toda página interna:
 *
 *   const eu = await exigirLogin();                       // qualquer membro da equipe
 *   const eu = await exigirLogin({ papeis: ['admin'] });  // só admin
 *
 * Retorna { uid, email, nome, papel, ativo }. Se não puder entrar, redireciona e
 * nunca resolve (o restante do script da página não chega a rodar).
 *
 * IMPORTANTE: isto é conveniência de UX. A proteção real dos dados está em firestore.rules.
 */
export async function exigirLogin({ papeis } = {}) {
  const user = await usuarioAtual();
  if (!user) return redirecionar(PAGINA_LOGIN);

  const perfil = await carregarPerfil(user.uid).catch(() => null);
  if (!perfil?.ativo) {
    await signOut(auth);
    return redirecionar(`${PAGINA_LOGIN}?erro=sem-acesso`);
  }
  if (papeis && !papeis.includes(perfil.papel)) return redirecionar(PAGINA_INICIAL);

  document.body.removeAttribute('data-auth'); // revela a página (ver base.css)
  return { uid: user.uid, email: user.email, ...perfil };
}

function redirecionar(caminho) {
  location.replace(rota(caminho));
  return new Promise(() => {}); // segura a execução até o navegador trocar de página
}
