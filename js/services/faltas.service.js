/**
 * Serviço dos avisos de falta: quem precisa receber e-mail (a cada 3 faltas não justificadas) e o registro de quais
 * e-mails já foram enviados. O sistema não envia e-mail: a equipe envia por fora e marca aqui, e as regras estão em
 * js/domain/faltas.js. O registro fica em matriculas.avisosDeFalta (só a gestão grava, pelas regras do Firestore).
 */
import { auth, db, doc, serverTimestamp, where, writeBatch } from '../core/firebase.js';
import { ErroDeNegocio } from '../core/erros.js';
import { hojeISO } from '../core/datas.js';
import { avisosPendentes, faltasAvisadasAoMarcar, marcarEnviados, pessoasParaAvisar } from '../domain/faltas.js';
import { COLECOES, STATUS_MATRICULA } from '../models/schema.js';
import { listarAlunos } from './alunos.service.js';
import { matriculasRepo } from './matriculas.service.js';
import { turmasRepo } from './turmas.service.js';

const TAMANHO_DO_LOTE = 400;

/**
 * Quem precisa receber e-mail agora, com o total de faltas e o contato.
 * @param {{ turmaIds?: string[] }} [filtro] só as turmas indicadas (o professor só vê as dele)
 */
export async function listarPessoasParaAvisar({ turmaIds = null } = {}) {
  const [matriculas, alunos, turmas] = await Promise.all([matriculasRepo.listar(where('status', '==', STATUS_MATRICULA.ATIVA)), listarAlunos(), turmasRepo.listar()]);
  const permitidas = turmaIds ? new Set(turmaIds) : null;
  return pessoasParaAvisar({
    matriculas: matriculas.filter((m) => !permitidas || permitidas.has(m.turmaId)),
    alunos,
    turmas,
  });
}

/** Quantas pessoas têm e-mail de falta a enviar (para o painel). */
export async function contarPessoasParaAvisar() {
  const ativas = await matriculasRepo.listar(where('status', '==', STATUS_MATRICULA.ATIVA));
  return ativas.filter((m) => avisosPendentes(m).length).length;
}

/**
 * Marca como enviados os avisos pendentes das matrículas indicadas (todos os que a pessoa já alcançou: se ela tem 6
 * faltas e nenhum aviso marcado, marca o de 3 e o de 6, porque um e-mail só já diz o total).
 * @returns {Promise<number>} quantas matrículas mudaram
 */
export async function marcarAvisosEnviados(matriculaIds) {
  const por = auth.currentUser?.uid ?? null;
  const em = hojeISO();
  const matriculas = (await Promise.all(matriculaIds.map((id) => matriculasRepo.obter(id)))).filter(Boolean);
  const mudancas = matriculas
    .map((m) => ({ m, pendentes: avisosPendentes(m) }))
    .filter(({ pendentes }) => pendentes.length)
    .map(({ m, pendentes }) => ({ id: m.id, avisosDeFalta: marcarEnviados(m, pendentes, { em, por }), faltasAvisadas: faltasAvisadasAoMarcar(m) }));
  if (!mudancas.length) throw new ErroDeNegocio('sem-pendencia', 'Não há aviso pendente para marcar.');

  for (let i = 0; i < mudancas.length; i += TAMANHO_DO_LOTE) {
    const lote = writeBatch(db);
    mudancas.slice(i, i + TAMANHO_DO_LOTE).forEach(({ id, avisosDeFalta, faltasAvisadas }) => {
      lote.update(doc(db, COLECOES.MATRICULAS, id), { avisosDeFalta, faltasAvisadas, atualizadoEm: serverTimestamp() });
    });
    await lote.commit();
  }
  return mudancas.length;
}
