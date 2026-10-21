import { where } from '../core/firebase.js';
import { criarRepo } from '../core/repo.js';
import { COLECOES, STATUS_TURMA_MATRICULAVEL } from '../models/schema.js';

export const turmasRepo = criarRepo(COLECOES.TURMAS);

/** Vagas que ainda podem ser oferecidas: total − matrículas efetivadas − convocados reservando vaga. */
export const vagasLivres = (turma) => turma.vagas - turma.vagasOcupadas - (turma.vagasReservadas ?? 0);
export const temVaga = (turma) => vagasLivres(turma) > 0;
export const aceitaMatricula = (turma) => STATUS_TURMA_MATRICULAVEL.includes(turma.status);

/** Turmas de um curso que aceitam matrícula. O filtro de status é no cliente para não exigir índice composto. */
export async function listarTurmasMatriculaveis(cursoId) {
  const turmas = await turmasRepo.listar(where('cursoId', '==', cursoId));
  return turmas.filter(aceitaMatricula).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Turmas que podem ser ofertadas num edital (todas as que aceitam matrícula). */
export async function listarTurmasOfertaveis() {
  const turmas = await turmasRepo.listar();
  return turmas.filter(aceitaMatricula).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
