/**
 * Serviço do módulo Alunos — este arquivo é o MOLDE dos demais serviços:
 *   1. um repositório da coleção (criarRepo)
 *   2. funções com nome de negócio que montam o documento via fábrica de schema.js
 *   3. consultas específicas do módulo
 */
import { where, orderBy } from '../core/firebase.js';
import { criarRepo } from '../core/repo.js';
import { COLECOES, STATUS_ALUNO, novoAluno } from '../models/schema.js';

export const alunosRepo = criarRepo(COLECOES.ALUNOS);

export const cadastrarAluno = (dados) => alunosRepo.criar(novoAluno(dados));

export const listarAlunosAtivos = () =>
  alunosRepo.listar(where('status', '==', STATUS_ALUNO.ATIVO), orderBy('nome'));

/** Evita cadastro duplicado ao aprovar uma inscrição. */
export async function buscarAlunoPorEmail(email) {
  const [aluno] = await alunosRepo.listar(where('email', '==', email.trim().toLowerCase()));
  return aluno ?? null;
}
