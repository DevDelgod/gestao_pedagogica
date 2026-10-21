/**
 * Serviço do módulo Alunos — também é o MOLDE dos demais serviços:
 *   1. um repositório da coleção (criarRepo)
 *   2. funções com nome de negócio que montam o documento via fábrica de schema.js
 *   3. consultas específicas do módulo
 */
import { db, doc, orderBy, runTransaction, serverTimestamp, where, writeBatch } from '../core/firebase.js';
import { criarRepo } from '../core/repo.js';
import { ErroDeNegocio } from '../core/erros.js';
import { enviarArquivo } from '../core/cloudinary.js';
import { hojeISO } from '../core/datas.js';
import { validarAluno } from '../domain/cadastros.js';
import { nomeExibicao } from '../domain/pessoa.js';
import { COLECOES, STATUS_ALUNO, novoAluno } from '../models/schema.js';
import { listarMatriculasDoAluno } from './matriculas.service.js';

export const alunosRepo = criarRepo(COLECOES.ALUNOS);

export const cadastrarAluno = (dados) => alunosRepo.criar(novoAluno(dados));

export const listarAlunosAtivos = () =>
  alunosRepo.listar(where('status', '==', STATUS_ALUNO.ATIVO), orderBy('nome'));

/** Todos os alunos em ordem alfabética do nome de exibição (ordena no cliente: sem índice composto). */
export async function listarAlunos() {
  const alunos = await alunosRepo.listar();
  return alunos.sort((a, b) => nomeExibicao(a).localeCompare(nomeExibicao(b), 'pt-BR'));
}

/** Evita cadastro duplicado ao efetivar uma matrícula a partir de uma inscrição. */
export async function buscarAlunoPorEmail(email) {
  const [aluno] = await alunosRepo.listar(where('email', '==', email.trim().toLowerCase()));
  return aluno ?? null;
}

/**
 * Cria (alunoId nulo) ou edita o cadastro. E-mail e CPF não podem repetir entre alunos: o e-mail é a
 * chave que liga uma inscrição a um cadastro existente.
 * Um aluno novo nasce "inativo" (cadastrado, sem matrícula) e passa a "ativo" quando for matriculado;
 * a situação do aluno é derivada das matrículas e nunca editada à mão.
 * Devolve o id.
 */
export async function salvarAluno(alunoId, entrada) {
  const { dados, erro } = validarAluno(entrada, { hoje: hojeISO() });
  if (erro) throw new ErroDeNegocio('dados-invalidos', erro);

  const alunos = await alunosRepo.listar();
  if (alunoId && !alunos.some((a) => a.id === alunoId)) throw new ErroDeNegocio('nao-encontrado', 'Aluno não encontrado.');
  const outros = alunos.filter((a) => a.id !== alunoId);
  if (dados.email && outros.some((a) => a.email === dados.email)) {
    throw new ErroDeNegocio('email-duplicado', 'Já existe um aluno com este e-mail.');
  }
  if (dados.cpf && outros.some((a) => a.cpf === dados.cpf)) {
    throw new ErroDeNegocio('cpf-duplicado', 'Já existe um aluno com este CPF.');
  }

  if (!alunoId) return alunosRepo.criar(novoAluno({ ...dados, status: STATUS_ALUNO.INATIVO }));

  const depois = nomeExibicao(dados);
  if (nomeExibicao(alunos.find((a) => a.id === alunoId)) === depois) {
    await alunosRepo.atualizar(alunoId, dados);
    return alunoId;
  }

  // O nome de exibição mudou (nome ou nome social): a cópia guardada nas matrículas do aluno
  // acompanha, na mesma operação, para as listas não mostrarem o nome antigo.
  const matriculas = await listarMatriculasDoAluno(alunoId);
  const lote = writeBatch(db);
  lote.update(doc(db, COLECOES.ALUNOS, alunoId), { ...dados, atualizadoEm: serverTimestamp() });
  matriculas
    .filter((m) => m.alunoNome !== depois)
    .forEach((m) => lote.update(doc(db, COLECOES.MATRICULAS, m.id), { alunoNome: depois, atualizadoEm: serverTimestamp() }));
  await lote.commit();
  return alunoId;
}

// ---------------------------------------------------------------------------
// Documentos (arquivos no Cloudinary; no Firestore ficam só url + publicId)
// ---------------------------------------------------------------------------
const MAX_DOCUMENTOS = 10;

/**
 * Envia o arquivo e o anexa ao aluno. Quem chama deve tratar `Error` comum (falha de envio) além de
 * ErroDeNegocio. No modo desenvolvimento o envio é simulado (ver core/cloudinary.js).
 */
export async function anexarDocumento(alunoId, arquivo) {
  const ref = doc(db, COLECOES.ALUNOS, alunoId);
  const atual = await alunosRepo.obter(alunoId);
  if (!atual) throw new ErroDeNegocio('nao-encontrado', 'Aluno não encontrado.');
  if ((atual.documentos ?? []).length >= MAX_DOCUMENTOS) {
    throw new ErroDeNegocio('limite-documentos', `Cada aluno pode ter até ${MAX_DOCUMENTOS} documentos.`);
  }

  const documento = await enviarArquivo(arquivo, 'alunos/documentos');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Aluno não encontrado.');
    tx.update(ref, { documentos: [...(snap.data().documentos ?? []), documento], atualizadoEm: serverTimestamp() });
  });
  return documento;
}

/**
 * Desvincula o documento do aluno. O arquivo em si continua no Cloudinary: apagar exige a chave
 * secreta e, portanto, um servidor (o publicId fica registrado em `documentos` até aqui).
 */
export async function removerDocumento(alunoId, publicId) {
  const ref = doc(db, COLECOES.ALUNOS, alunoId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Aluno não encontrado.');
    tx.update(ref, {
      documentos: (snap.data().documentos ?? []).filter((d) => d.publicId !== publicId),
      atualizadoEm: serverTimestamp(),
    });
  });
}
