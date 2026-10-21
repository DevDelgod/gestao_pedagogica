import { collection, db, doc, runTransaction, serverTimestamp, where } from '../core/firebase.js';
import { auditoriaDeCriacao, criarRepo } from '../core/repo.js';
import { ErroDeNegocio } from '../core/erros.js';
import { validarTurma } from '../domain/cadastros.js';
import { COLECOES, STATUS_TURMA, STATUS_TURMA_MATRICULAVEL, novaTurma } from '../models/schema.js';

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

/** Todas as turmas, as mais recentes primeiro. */
export async function listarTurmas() {
  const turmas = await turmasRepo.listar();
  const instante = (t) => t.criadoEm?.toMillis?.() ?? 0;
  return turmas.sort((a, b) => instante(b) - instante(a) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Cria (turmaId nulo) ou edita uma turma. Devolve o id.
 *
 * Proteções ao editar, para os números de vagas nunca ficarem incoerentes:
 *  - o total de vagas não pode ficar abaixo do que já está comprometido (matriculados + convocados);
 *  - o curso não pode mudar se já há matriculados ou convocados (os nomes copiados ficariam errados);
 *  - a turma só encerra/cancela sem convocados aguardando matrícula.
 * Os contadores (vagasOcupadas / vagasReservadas) nunca são alterados por aqui.
 *
 * @param {string|null} turmaId
 * @param {Parameters<typeof validarTurma>[0]} entrada valores crus do formulário
 */
export async function salvarTurma(turmaId, entrada) {
  const { dados, erro } = validarTurma(entrada);
  if (erro) throw new ErroDeNegocio('dados-invalidos', erro);

  const turmaRef = turmaId ? doc(db, COLECOES.TURMAS, turmaId) : doc(collection(db, COLECOES.TURMAS));
  await runTransaction(db, (tx) => salvarTurmaNaTransacao(tx, { turmaRef, existente: Boolean(turmaId), dados }));
  return turmaRef.id;
}

/** Corpo da transação, exportado para teste com uma `tx` falsa. */
export async function salvarTurmaNaTransacao(tx, { turmaRef, existente, dados }) {
  // --- leituras (todas antes de qualquer escrita) ---
  const cursoSnap = await tx.get(doc(db, COLECOES.CURSOS, dados.cursoId));
  const turmaSnap = existente ? await tx.get(turmaRef) : null;
  const professorSnap = dados.professorId ? await tx.get(doc(db, COLECOES.USUARIOS, dados.professorId)) : null;

  // --- validações ---
  if (!cursoSnap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Curso não encontrado.');
  const curso = cursoSnap.data();

  let turma = null;
  if (existente) {
    if (!turmaSnap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Turma não encontrada.');
    turma = turmaSnap.data();
  }
  const trocouDeCurso = !turma || turma.cursoId !== dados.cursoId;
  if (trocouDeCurso && !curso.ativo) {
    throw new ErroDeNegocio('curso-inativo', `O curso "${curso.nome}" está desativado. Reative-o ou escolha outro.`);
  }

  let professorNome = null;
  if (dados.professorId) {
    if (!professorSnap.exists() || !professorSnap.data().ativo) {
      throw new ErroDeNegocio('professor-invalido', 'O professor escolhido não está ativo na equipe.');
    }
    const professor = professorSnap.data();
    professorNome = professor.nome ?? professor.email;
  }

  if (turma) {
    const ocupadas = turma.vagasOcupadas ?? 0;
    const reservadas = turma.vagasReservadas ?? 0;
    const comprometidas = ocupadas + reservadas;
    const detalhe = `${ocupadas} matriculado(s) e ${reservadas} convocado(s)`;

    if (trocouDeCurso && comprometidas > 0) {
      throw new ErroDeNegocio('curso-travado', `Não é possível trocar o curso: a turma já tem ${detalhe}.`);
    }
    if (dados.vagas < comprometidas) {
      throw new ErroDeNegocio('vagas-insuficientes', `O total de vagas não pode ser menor que ${comprometidas} (${detalhe}).`);
    }
    const encerrando = [STATUS_TURMA.ENCERRADA, STATUS_TURMA.CANCELADA].includes(dados.status);
    if (encerrando && reservadas > 0) {
      throw new ErroDeNegocio(
        'convocacoes-pendentes',
        `Há ${reservadas} convocado(s) aguardando matrícula. Matricule-os ou libere as vagas antes de encerrar ou cancelar a turma.`,
      );
    }
  }

  // --- escritas ---
  const campos = { ...dados, cursoNome: curso.nome, professorNome };
  if (turma) {
    tx.update(turmaRef, { ...campos, atualizadoEm: serverTimestamp() });
  } else {
    tx.set(turmaRef, { ...novaTurma(campos), ...auditoriaDeCriacao() });
  }
}
