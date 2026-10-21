import { db, doc, serverTimestamp, where, writeBatch } from '../core/firebase.js';
import { criarRepo } from '../core/repo.js';
import { ErroDeNegocio } from '../core/erros.js';
import { validarCurso } from '../domain/cadastros.js';
import { COLECOES, novoCurso } from '../models/schema.js';
import { turmasRepo } from './turmas.service.js';

export const cursosRepo = criarRepo(COLECOES.CURSOS);

const semAcento = (texto) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Todos os cursos em ordem alfabética (inclusive os desativados). */
export async function listarCursos() {
  const cursos = await cursosRepo.listar();
  return cursos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Só os ativos: são os que aparecem ao criar uma turma. */
export async function listarCursosAtivos() {
  return (await listarCursos()).filter((c) => c.ativo);
}

/**
 * Cria (cursoId nulo) ou edita um curso. Cursos não são apagados, só desativados, para o
 * histórico (turmas, matrículas) continuar fazendo sentido.
 * Ao renomear, o nome copiado nas turmas do curso é atualizado na mesma operação; as cópias já
 * gravadas em matrículas e editais ficam como estavam (registro do que valia na época).
 */
export async function salvarCurso(cursoId, entrada) {
  const { dados, erro } = validarCurso(entrada);
  if (erro) throw new ErroDeNegocio('dados-invalidos', erro);

  const cursos = await listarCursos();
  if (cursos.some((c) => c.id !== cursoId && semAcento(c.nome) === semAcento(dados.nome))) {
    throw new ErroDeNegocio('curso-duplicado', 'Já existe um curso com este nome.');
  }

  if (!cursoId) return cursosRepo.criar(novoCurso(dados));

  if (!cursos.some((c) => c.id === cursoId)) throw new ErroDeNegocio('nao-encontrado', 'Curso não encontrado.');
  const turmas = await turmasRepo.listar(where('cursoId', '==', cursoId));
  const lote = writeBatch(db);
  lote.update(doc(db, COLECOES.CURSOS, cursoId), { ...dados, atualizadoEm: serverTimestamp() });
  turmas
    .filter((t) => t.cursoNome !== dados.nome)
    .forEach((t) => lote.update(doc(db, COLECOES.TURMAS, t.id), { cursoNome: dados.nome, atualizadoEm: serverTimestamp() }));
  await lote.commit();
  return cursoId;
}

/** Desativar esconde o curso de novas turmas; as turmas e matrículas existentes não mudam. */
export const definirCursoAtivo = (cursoId, ativo) => cursosRepo.atualizar(cursoId, { ativo });
