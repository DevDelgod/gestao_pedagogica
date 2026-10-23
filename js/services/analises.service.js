/**
 * Serviço das análises: reúne tudo o que as contas de domain/analises.js precisam, numa leitura só.
 *
 * Lê as coleções inteiras (pessoas, matrículas, turmas, cursos, aulas) e deixa as contas e os filtros para a tela,
 * que assim responde na hora a cada filtro. Para os volumes de uma instituição isso é leve; se um dia ficar pesado,
 * a saída é guardar totais por turma (como já se faz com a frequência) em vez de reler tudo.
 */
import { alunosRepo } from './alunos.service.js';
import { cursosRepo } from './cursos.service.js';
import { aulasRepo } from './diario.service.js';
import { matriculasRepo } from './matriculas.service.js';
import { turmasRepo } from './turmas.service.js';

/** @returns {Promise<{ alunos: object[], matriculas: object[], turmas: object[], cursos: object[], aulas: object[] }>} */
export async function carregarBaseDeAnalise() {
  const [alunos, matriculas, turmas, cursos, aulas] = await Promise.all([
    alunosRepo.listar(),
    matriculasRepo.listar(),
    turmasRepo.listar(),
    cursosRepo.listar(),
    aulasRepo.listar(),
  ]);
  return { alunos, matriculas, turmas, cursos, aulas };
}
