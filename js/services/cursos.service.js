import { criarRepo } from '../core/repo.js';
import { COLECOES } from '../models/schema.js';

export const cursosRepo = criarRepo(COLECOES.CURSOS);
