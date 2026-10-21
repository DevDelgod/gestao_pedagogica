/**
 * Repositório genérico de uma coleção. Cada módulo cria o seu em uma linha:
 *
 *   export const turmasRepo = criarRepo(COLECOES.TURMAS);
 *
 * e acrescenta as consultas específicas em services/<modulo>.service.js.
 * Todos os documentos devolvidos já trazem o `id` junto: { id, ...dados }.
 */
import {
  auth,
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  serverTimestamp,
} from './firebase.js';

const comId = (snap) => ({ id: snap.id, ...snap.data() });

/** Campos de auditoria de um documento novo. Transações (que não passam pelo repo) usam esta mesma função. */
export const auditoriaDeCriacao = () => ({
  criadoEm: serverTimestamp(),
  atualizadoEm: serverTimestamp(),
  criadoPor: auth.currentUser?.uid ?? null,
});

export function criarRepo(nomeColecao) {
  const col = collection(db, nomeColecao);

  return {
    col,

    /** Documento por id, ou null se não existir. */
    async obter(id) {
      const snap = await getDoc(doc(col, id));
      return snap.exists() ? comId(snap) : null;
    },

    /** Lista com restrições opcionais: listar(where('status', '==', 'ativo'), orderBy('nome')). */
    async listar(...restricoes) {
      const snap = await getDocs(query(col, ...restricoes));
      return snap.docs.map(comId);
    },

    /** Cria o documento. Com `id`, usa id determinístico (setDoc); sem, o Firestore gera. */
    async criar(dados, id) {
      const auditoria = auditoriaDeCriacao();
      if (id) {
        await setDoc(doc(col, id), { ...dados, ...auditoria });
        return id;
      }
      const ref = await addDoc(col, { ...dados, ...auditoria });
      return ref.id;
    },

    /** Atualiza só os campos informados (merge raso). */
    atualizar(id, dados) {
      return updateDoc(doc(col, id), { ...dados, atualizadoEm: serverTimestamp() });
    },

    remover(id) {
      return deleteDoc(doc(col, id));
    },

    /** Escuta em tempo real. Devolve a função para cancelar a escuta. */
    observar(restricoes, aoMudar, aoFalhar) {
      return onSnapshot(
        query(col, ...restricoes),
        (snap) => aoMudar(snap.docs.map(comId)),
        aoFalhar,
      );
    },
  };
}
