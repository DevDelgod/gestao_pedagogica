/** Serviço da equipe (users/{uid}): por ora só a leitura que as outras telas precisam (ex.: professor da turma). */
import { where } from '../core/firebase.js';
import { criarRepo } from '../core/repo.js';
import { COLECOES } from '../models/schema.js';

export const usuariosRepo = criarRepo(COLECOES.USUARIOS);

/** Membros ativos da equipe, em ordem alfabética. Só a gestão pode ler esta coleção (firestore.rules). */
export async function listarEquipeAtiva() {
  const equipe = await usuariosRepo.listar(where('ativo', '==', true));
  return equipe.sort((a, b) => (a.nome ?? a.email).localeCompare(b.nome ?? b.email, 'pt-BR'));
}
