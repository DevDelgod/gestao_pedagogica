/**
 * Faltas e avisos por e-mail — regras puras (sem Firebase, sem DOM).
 *
 * A cada 3 faltas (3, 6, 9…) a equipe manda um e-mail à pessoa. O sistema não envia nada: ele AVISA quem precisa
 * receber e com quantas faltas, e guarda quais avisos já foram feitos (matriculas.avisosDeFalta), para o que já foi
 * enviado não aparecer de novo.
 *
 * Só conta a falta NÃO justificada ('F'). Justificar uma falta (marca 'J') a tira da conta; um aviso já enviado
 * continua registrado mesmo que a pessoa volte a ter menos faltas.
 */
import { PRESENCA, STATUS_MATRICULA } from '../models/schema.js';
import { nomeExibicao } from './pessoa.js';

export const FALTAS_POR_AVISO = 3;
export const MAXIMO_MOTIVO = 300;

/** Os avisos que as faltas já alcançaram: 7 faltas → [3, 6]. */
export const limiaresAtingidos = (faltas) => Array.from({ length: Math.floor(faltas / FALTAS_POR_AVISO) }, (_, i) => (i + 1) * FALTAS_POR_AVISO);

/** Em quantas faltas será o próximo aviso: com 4 faltas, 6. */
export const proximoAviso = (faltas) => (Math.floor(faltas / FALTAS_POR_AVISO) + 1) * FALTAS_POR_AVISO;

const faltasDe = (matricula) => matricula.frequencia?.faltas ?? 0;

/**
 * Até quantas faltas o passado conta como JÁ AVISADO, para quem o sistema encontra pela primeira vez. A equipe já
 * mandava os e-mails antes de o sistema existir, então quem está entre duas marcas (4 faltas, 5, 7, 8…) já recebeu o
 * aviso da marca anterior. Só a marca em que a pessoa está EXATAMENTE (3, 6, 9…) fica para conferir.
 */
export const faltasJaTratadas = (faltas) => (faltas > 0 && faltas % FALTAS_POR_AVISO === 0 ? faltas - 1 : faltas);

/** A marca de avisos da matrícula (`faltasAvisadas`): até onde as faltas já foram tratadas. Sem ela, vale o passado como avisado. */
const marcaDeAvisos = (matricula) => (typeof matricula.faltasAvisadas === 'number' ? matricula.faltasAvisadas : faltasJaTratadas(faltasDe(matricula)));

/**
 * Avisos pendentes: as marcas de 3 que as faltas alcançaram DEPOIS da marca de avisos da matrícula e cujo e-mail ainda
 * não foi marcado como enviado. Quem pula uma marca (de 2 para 4 faltas numa semana) também entra; quem só passou da
 * marca antes de o sistema conhecê-lo, não.
 */
export const avisosPendentes = (matricula) =>
  limiaresAtingidos(faltasDe(matricula)).filter((limiar) => limiar > marcaDeAvisos(matricula) && !matricula.avisosDeFalta?.[limiar]);

/**
 * O valor de `faltasAvisadas` a gravar quando as faltas de uma matrícula são recalculadas, ou null se já tem um (não mexe).
 * É o que faz a marca existir ANTES de as faltas crescerem: a pessoa sem marca ganha a do passado dela, e as faltas novas
 * a partir daí alcançam marcas novas. Na carga de uma planilha com todo o histórico (`historico: true`, matrícula
 * sem chamada antes), o passado inteiro é o histórico e vale como avisado.
 */
export function faltasAvisadasAoRecalcular(matricula, faltasDepois, { historico = false } = {}) {
  if (typeof matricula.faltasAvisadas === 'number') return null;
  const semChamadaAntes = (matricula.frequencia?.aulas ?? 0) === 0;
  return faltasJaTratadas(historico && semChamadaAntes ? faltasDepois : faltasDe(matricula));
}

/** A marca de avisos depois de marcar como enviado: sobe até as faltas de agora (e nunca desce). */
export const faltasAvisadasAoMarcar = (matricula) => Math.max(marcaDeAvisos(matricula), faltasDe(matricula));

/** Avisos já enviados, do mais antigo ao mais novo: [{ limiar, em, por }]. */
export const avisosEnviados = (matricula) =>
  Object.entries(matricula.avisosDeFalta ?? {})
    .map(([limiar, aviso]) => ({ limiar: Number(limiar), ...aviso }))
    .sort((a, b) => a.limiar - b.limiar);

/**
 * O que gravar em matriculas.avisosDeFalta para marcar os avisos como enviados (o mapa inteiro, mantendo os que já
 * estavam). `limiares` é a lista a marcar.
 */
export function marcarEnviados(matricula, limiares, { em, por }) {
  const mapa = { ...(matricula.avisosDeFalta ?? {}) };
  for (const limiar of limiares) if (!mapa[limiar]) mapa[limiar] = { em, por };
  return mapa;
}

/**
 * A turma em poucas palavras para uma lista: "Audiovisual para Mulheres · 2026.1 · Sede da Incubadora". O nome inteiro da
 * turma importada é enorme (período, curso, polo, dias e horário); turma sem período nem polo usa o próprio nome.
 */
export const resumoDaTurma = (turma) => (turma.periodo || turma.polo ? [turma.cursoNome, turma.periodo, turma.polo].filter(Boolean).join(' · ') : turma.nome);

/**
 * Quem precisa receber e-mail agora: matrículas ativas com algum aviso pendente. Para cada uma, o aviso a mandar é o
 * MAIOR pendente (um só e-mail, falando do total de faltas); os menores pendentes entram junto quando se marca como enviado.
 * @returns {Array<{ matriculaId, alunoId, nome, turmaId, turmaNome, cursoNome, faltas, limiar, pendentes, email, telefone }>}
 *   primeiro quem tem mais faltas
 */
export function pessoasParaAvisar({ matriculas, alunos, turmas }) {
  const aluno = new Map(alunos.map((a) => [a.id, a]));
  const turma = new Map(turmas.map((t) => [t.id, t]));
  return matriculas
    .filter((m) => m.status === STATUS_MATRICULA.ATIVA && turma.has(m.turmaId))
    .map((m) => ({ m, pendentes: avisosPendentes(m) }))
    .filter(({ pendentes }) => pendentes.length)
    .map(({ m, pendentes }) => ({
      matriculaId: m.id,
      alunoId: m.alunoId,
      nome: m.alunoNome,
      turmaId: m.turmaId,
      turmaNome: m.turmaNome,
      turmaResumo: resumoDaTurma(turma.get(m.turmaId)),
      cursoNome: m.cursoNome,
      faltas: faltasDe(m),
      limiar: pendentes.at(-1),
      pendentes,
      email: aluno.get(m.alunoId)?.email ?? '',
      telefone: aluno.get(m.alunoId)?.whatsapp || aluno.get(m.alunoId)?.telefone || '',
      pessoa: aluno.get(m.alunoId) ?? null,
    }))
    .sort((a, b) => b.faltas - a.faltas || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * As faltas de uma pessoa (não justificadas e justificadas), da mais recente para a mais antiga.
 * @param {Array<{ data: string, registros: Record<string, string>, justificativas?: Record<string, string> }>} aulas
 * @returns {Array<{ data: string, justificada: boolean, motivo: string }>}
 */
export function faltasDaPessoa(aulas, alunoId) {
  return aulas
    .filter((a) => a.registros?.[alunoId] === PRESENCA.FALTA || a.registros?.[alunoId] === PRESENCA.JUSTIFICADA)
    .map((a) => ({ data: a.data, justificada: a.registros[alunoId] === PRESENCA.JUSTIFICADA, motivo: a.justificativas?.[alunoId] ?? '' }))
    .sort((x, y) => (x.data < y.data ? 1 : x.data > y.data ? -1 : 0));
}

/** Rascunho do e-mail (a equipe edita antes de enviar): { assunto, corpo }. Linguagem neutra, com o nome de exibição. */
export function rascunhoDoEmail({ pessoa, nome, faltas, turmaNome, cursoNome }) {
  const chamar = nomeExibicao(pessoa ?? { nome }).split(' ')[0] || nome;
  return {
    assunto: `Faltas no curso ${cursoNome}`,
    corpo:
      `Olá, ${chamar}.\n\n` +
      `Passando para avisar que você está com ${faltas} faltas no curso ${cursoNome} (turma ${turmaNome}).\n\n` +
      'Se alguma delas teve um motivo, é só nos responder contando, que registramos a justificativa. ' +
      'E se houver qualquer dificuldade para continuar, conte com a gente.\n\n' +
      'Um abraço.',
  };
}

/** Link que abre o programa de e-mail da pessoa já com destinatário, assunto e texto (ela só confere e envia). */
export function linkDoEmail({ email, assunto, corpo }) {
  // o "@" do endereço fica como está: alguns programas de e-mail não entendem "%40" no destinatário
  return `mailto:${encodeURIComponent(email).replace('%40', '@')}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}
