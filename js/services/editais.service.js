/**
 * Serviço do módulo Editais (processos seletivos).
 *
 * O edital é o que torna o processo configurável: modalidade (sorteio, prova, ordem de inscrição,
 * análise), requisitos de matrícula (documentos, pagamento…), prazos e turmas ofertadas.
 * A etapa do edital controla o que pode acontecer: só recebe inscrições em "inscricoes", só executa
 * a seleção em "selecao" (ver firestore.rules e selecao.service.js).
 */
import { db, doc, runTransaction, serverTimestamp, Timestamp, where } from '../core/firebase.js';
import { criarRepo } from '../core/repo.js';
import { ErroDeNegocio } from '../core/erros.js';
import { temSelecaoAutomatica } from '../domain/selecao.js';
import {
  COLECOES,
  PROXIMO_STATUS_EDITAL,
  STATUS_EDITAL,
  idSelecao,
  novoEdital,
} from '../models/schema.js';

export const editaisRepo = criarRepo(COLECOES.EDITAIS);

const instante = (e) => e.criadoEm?.toMillis?.() ?? 0;

export async function listarEditais() {
  const editais = await editaisRepo.listar();
  return editais.sort((a, b) => instante(b) - instante(a)); // mais recentes primeiro
}

/** Para o formulário público do site: editais com inscrições abertas (as regras só deixam ler estes). */
export const listarEditaisAbertos = () =>
  editaisRepo.listar(where('status', '==', STATUS_EDITAL.INSCRICOES));

/**
 * Valida e converte os dados do formulário.
 * @param {{ titulo: string, descricao?: string, modalidade: string, inscricoesInicio: Date, inscricoesFim: Date,
 *   dataResultado?: string|null, turmas: Array<{ id: string, nome: string, cursoId: string, cursoNome: string }>,
 *   requisitosMatricula?: Array<{ id: string, tipo: string, rotulo: string }>,
 *   config?: { listaEspera?: boolean, prazoMatriculaDias?: number, notaMinima?: number, notaMaxima?: number } }} dados
 */
function prepararDados(dados) {
  if (!dados.titulo?.trim()) throw new ErroDeNegocio('dados-invalidos', 'Informe o título do edital.');
  if (!(dados.inscricoesInicio instanceof Date) || !(dados.inscricoesFim instanceof Date)) {
    throw new ErroDeNegocio('dados-invalidos', 'Informe o início e o fim das inscrições.');
  }
  if (dados.inscricoesFim <= dados.inscricoesInicio) {
    throw new ErroDeNegocio('dados-invalidos', 'O fim das inscrições precisa ser depois do início.');
  }
  if (!dados.turmas?.length) throw new ErroDeNegocio('dados-invalidos', 'Escolha ao menos uma turma.');
  const dias = dados.config?.prazoMatriculaDias;
  if (dias !== undefined && !(Number.isInteger(dias) && dias >= 1)) {
    throw new ErroDeNegocio('dados-invalidos', 'O prazo de matrícula deve ser de pelo menos 1 dia.');
  }

  return novoEdital({
    ...dados,
    titulo: dados.titulo.trim(),
    inscricoesInicio: Timestamp.fromDate(dados.inscricoesInicio),
    inscricoesFim: Timestamp.fromDate(dados.inscricoesFim),
    turmaIds: dados.turmas.map((t) => t.id),
  });
}

export const criarEdital = (dados) => editaisRepo.criar(prepararDados(dados));

/** Só é possível editar enquanto o edital é rascunho: depois, mudar turmas ou regras invalidaria inscrições. */
export function atualizarEdital(editalId, dados) {
  const { status, ...campos } = prepararDados(dados); // `status` não muda por aqui
  const ref = doc(db, COLECOES.EDITAIS, editalId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Edital não encontrado.');
    if (snap.data().status !== STATUS_EDITAL.RASCUNHO) {
      throw new ErroDeNegocio('edital-fora-da-etapa', 'Só é possível editar um edital em rascunho.');
    }
    tx.update(ref, { ...campos, atualizadoEm: serverTimestamp() });
  });
}

/**
 * Leva o edital à etapa seguinte (rascunho → inscrições → seleção → matrículas → encerrado).
 * Guardas: não abre inscrições com a janela já vencida e não publica o resultado sem ter executado
 * a seleção de todas as turmas (nas modalidades automáticas).
 */
export function avancarEtapa(editalId) {
  const ref = doc(db, COLECOES.EDITAIS, editalId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new ErroDeNegocio('nao-encontrado', 'Edital não encontrado.');
    const edital = snap.data();
    const proxima = PROXIMO_STATUS_EDITAL[edital.status];
    if (!proxima) throw new ErroDeNegocio('edital-fora-da-etapa', 'Este edital já está encerrado.');

    if (proxima === STATUS_EDITAL.INSCRICOES && edital.inscricoesFim.toMillis() <= Date.now()) {
      throw new ErroDeNegocio('janela-vencida', 'A data de término das inscrições já passou. Edite o edital antes de abrir.');
    }
    if (proxima === STATUS_EDITAL.MATRICULAS && temSelecaoAutomatica(edital.modalidade)) {
      const registros = await Promise.all(
        edital.turmaIds.map((turmaId) => tx.get(doc(db, COLECOES.SELECOES, idSelecao(editalId, turmaId)))),
      );
      const faltam = edital.turmas.filter((_, i) => !registros[i].exists()).map((t) => t.nome);
      if (faltam.length) {
        throw new ErroDeNegocio('selecao-pendente', `Execute a seleção antes de publicar o resultado. Faltam: ${faltam.join(', ')}.`);
      }
    }

    tx.update(ref, { status: proxima, atualizadoEm: serverTimestamp() });
    return proxima;
  });
}
