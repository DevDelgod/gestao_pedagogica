/**
 * Modelo de dados do Firestore — fonte única de verdade para nomes de coleções,
 * valores permitidos (enums) e a "forma" de cada documento.
 *
 * Documentação com exemplos e justificativas: docs/modelo-de-dados.md
 *
 * Convenções:
 *  - Campos em português, camelCase, sem acento (ex.: dataNascimento).
 *  - Datas de calendário (aula, nascimento, início da turma) = string 'AAAA-MM-DD',
 *    para não sofrer com fuso horário. Datas de auditoria = Timestamp do servidor.
 *  - Nomes de aluno/turma/curso são copiados (denormalizados) nos documentos que os
 *    referenciam, porque o Firestore não tem JOIN e as listas precisam ser rápidas.
 */

// ---------------------------------------------------------------------------
// Coleções
// ---------------------------------------------------------------------------
export const COLECOES = Object.freeze({
  USUARIOS: 'users',
  CURSOS: 'cursos',
  TURMAS: 'turmas',
  ALUNOS: 'alunos',
  INSCRICOES: 'inscricoes',
  MATRICULAS: 'matriculas',
  AULAS: 'aulas', // diário de classe + frequência
  AVALIACOES: 'avaliacoes', // avaliações + notas
  EDITAIS: 'editais', // processos seletivos (inscrição → seleção → matrícula)
  SELECOES: 'selecoes', // registro auditável de cada sorteio/classificação executado
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const PAPEIS = Object.freeze({
  ADMIN: 'admin',
  COORDENADOR: 'coordenador',
  PROFESSOR: 'professor',
});

/**
 * Caminho de uma inscrição:
 *   inscrita ─(seleção)─▶ convocada ─(requisitos cumpridos)─▶ matriculada
 *      │                      └─(desistiu / prazo)─▶ desistente   (a vaga volta; chama-se um remanescente)
 *      ├──▶ remanescente ─(vaga liberada)─▶ convocada
 *      ├──▶ nao_selecionada
 *      └──▶ indeferida (recusada pela equipe)
 */
export const STATUS_INSCRICAO = Object.freeze({
  INSCRITA: 'inscrita', // recebida; aguarda a seleção
  CONVOCADA: 'convocada', // selecionada: reserva uma vaga e tem prazo para se matricular
  REMANESCENTE: 'remanescente', // lista de remanescentes, em ordem (posicaoRemanescente)
  MATRICULADA: 'matriculada',
  NAO_SELECIONADA: 'nao_selecionada',
  INDEFERIDA: 'indeferida',
  DESISTENTE: 'desistente', // convocada que desistiu ou perdeu o prazo
});

/** Como as vagas são preenchidas. Cada instituição escolhe a sua, por edital. */
export const MODALIDADE_SELECAO = Object.freeze({
  SORTEIO: 'sorteio',
  PROVA: 'prova', // classificação por nota (com nota mínima opcional)
  ORDEM_CHEGADA: 'ordem_chegada', // vale a ordem de inscrição
  ANALISE: 'analise', // a equipe convoca pessoa a pessoa (sem execução automática)
});

/** Etapas do edital. A equipe avança uma por vez. */
export const STATUS_EDITAL = Object.freeze({
  RASCUNHO: 'rascunho',
  INSCRICOES: 'inscricoes', // formulário do site aberto
  SELECAO: 'selecao', // inscrições encerradas; é aqui que se executa o sorteio/classificação
  MATRICULAS: 'matriculas', // resultado publicado; convocados se matriculando
  ENCERRADO: 'encerrado',
});

export const PROXIMO_STATUS_EDITAL = Object.freeze({
  [STATUS_EDITAL.RASCUNHO]: STATUS_EDITAL.INSCRICOES,
  [STATUS_EDITAL.INSCRICOES]: STATUS_EDITAL.SELECAO,
  [STATUS_EDITAL.SELECAO]: STATUS_EDITAL.MATRICULAS,
  [STATUS_EDITAL.MATRICULAS]: STATUS_EDITAL.ENCERRADO,
});

/** Tipos de requisito para a matrícula (a equipe marca cada um como cumprido). */
export const TIPO_REQUISITO = Object.freeze({
  DOCUMENTO: 'documento',
  PAGAMENTO: 'pagamento',
  TERMO: 'termo',
  OUTRO: 'outro',
});

export const STATUS_ALUNO = Object.freeze({
  ATIVO: 'ativo',
  INATIVO: 'inativo',
  EVADIDO: 'evadido',
});

export const STATUS_TURMA = Object.freeze({
  PLANEJADA: 'planejada',
  ABERTA: 'aberta', // recebendo matrículas
  EM_ANDAMENTO: 'em_andamento',
  ENCERRADA: 'encerrada',
  CANCELADA: 'cancelada',
});

/** Turmas que aceitam matrícula nova (em andamento = entrada tardia). */
export const STATUS_TURMA_MATRICULAVEL = Object.freeze([
  STATUS_TURMA.PLANEJADA, // a seleção do edital costuma acontecer antes de a turma começar
  STATUS_TURMA.ABERTA,
  STATUS_TURMA.EM_ANDAMENTO,
]);

export const STATUS_MATRICULA = Object.freeze({
  ATIVA: 'ativa',
  TRANCADA: 'trancada',
  EVADIDA: 'evadida',
  CONCLUIDA: 'concluida',
  CANCELADA: 'cancelada',
});

/** Marcação na chamada: P = presente, F = falta, J = falta justificada. */
export const PRESENCA = Object.freeze({
  PRESENTE: 'P',
  FALTA: 'F',
  JUSTIFICADA: 'J',
});

export const TIPO_AVALIACAO = Object.freeze({
  PROVA: 'prova',
  TRABALHO: 'trabalho',
  PROJETO: 'projeto',
  PARTICIPACAO: 'participacao',
});

/** Ordem de Date#getDay(): domingo = 0. */
export const DIAS_SEMANA = Object.freeze(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']);

/**
 * Gênero autodeclarado (opcional). Com 'outro' a pessoa escreve o próprio (campo generoOutro).
 * ATENÇÃO: esta lista é repetida em firestore.rules (criação pública de inscrição); mude nos dois lugares.
 */
export const GENEROS = Object.freeze([
  'mulher_cis',
  'homem_cis',
  'mulher_trans',
  'homem_trans',
  'travesti',
  'nao_binario',
  'genero_fluido',
  'agenero',
  'outro',
  'nao_informar',
]);

// ---------------------------------------------------------------------------
// IDs determinísticos — impedem duplicidade sem precisar de query antes de gravar
// ---------------------------------------------------------------------------
/** Um aluno só pode ter UMA matrícula por turma. */
export const idMatricula = (turmaId, alunoId) => `${turmaId}_${alunoId}`;
/** A seleção de uma turma num edital só pode ser executada UMA vez. */
export const idSelecao = (editalId, turmaId) => `${editalId}_${turmaId}`;
/** Uma turma só tem UM registro de aula por data (aulas duplas: use sufixo _2). */
export const idAula = (turmaId, data) => `${turmaId}_${data}`;

// ---------------------------------------------------------------------------
// Fábricas — devolvem o documento completo, com valores padrão.
// Os campos de auditoria (criadoEm, atualizadoEm, criadoPor) são colocados por
// core/repo.js na hora de gravar; não declare aqui.
// ---------------------------------------------------------------------------

/** users/{uid} — o id do documento é o uid do Firebase Auth. */
export const novoUsuario = (d) => ({
  nome: d.nome,
  email: d.email,
  papel: d.papel ?? PAPEIS.PROFESSOR,
  ativo: d.ativo ?? true,
});

/** cursos/{cursoId} */
export const novoCurso = (d) => ({
  nome: d.nome,
  descricao: d.descricao ?? '',
  cargaHoraria: d.cargaHoraria ?? 0,
  frequenciaMinima: d.frequenciaMinima ?? 75, // % exigido para aprovação
  mediaAprovacao: d.mediaAprovacao ?? 7, // na escala 0–10
  ativo: d.ativo ?? true,
});

/** turmas/{turmaId} */
export const novaTurma = (d) => ({
  cursoId: d.cursoId,
  cursoNome: d.cursoNome, // cópia
  nome: d.nome, // ex.: "Web Básico — 2026.1 — Noite"
  professorId: d.professorId ?? null, // uid em users/
  professorNome: d.professorNome ?? null, // cópia
  vagas: d.vagas ?? 20,
  vagasOcupadas: 0, // matrículas efetivadas — contador: só muda dentro de transações
  vagasReservadas: 0, // convocados que ainda não se matricularam (vaga livre = vagas − ocupadas − reservadas)
  diasSemana: d.diasSemana ?? [], // ex.: ['seg', 'qua']
  horarioInicio: d.horarioInicio ?? '', // 'HH:MM'
  horarioFim: d.horarioFim ?? '',
  dataInicio: d.dataInicio ?? null, // 'AAAA-MM-DD'
  dataFim: d.dataFim ?? null,
  status: d.status ?? STATUS_TURMA.PLANEJADA,
});

/** alunos/{alunoId} */
export const novoAluno = (d) => ({
  nome: d.nome, // nome civil (o do documento)
  nomeSocial: d.nomeSocial ?? '', // se houver, é o nome usado para chamar a pessoa (ver domain/pessoa.js)
  genero: d.genero ?? null, // um de GENEROS, ou null
  generoOutro: d.generoOutro ?? '', // texto livre, só quando genero === 'outro'
  email: (d.email ?? '').trim().toLowerCase(), // sempre minúsculo: é a chave para achar duplicados
  telefone: d.telefone ?? '',
  cpf: d.cpf ?? '',
  dataNascimento: d.dataNascimento ?? null, // 'AAAA-MM-DD'
  responsavel: d.responsavel ?? null, // { nome, telefone, parentesco } — para menores
  endereco: d.endereco ?? null, // { cidade, bairro, ... }
  documentos: d.documentos ?? [], // [{ nome, url, publicId, tipo, bytes }] — vindos do Cloudinary
  observacoes: d.observacoes ?? '',
  status: d.status ?? STATUS_ALUNO.ATIVO,
});

/**
 * editais/{editalId} — um processo seletivo. É ele que define COMO a instituição seleciona
 * e matricula: modalidade, requisitos de matrícula, prazos e as turmas ofertadas.
 * As datas de inscrição são Timestamp (o Firestore as confere ao aceitar uma inscrição).
 */
export const novoEdital = (d) => ({
  titulo: d.titulo,
  descricao: d.descricao ?? '',
  modalidade: d.modalidade ?? MODALIDADE_SELECAO.SORTEIO,
  status: STATUS_EDITAL.RASCUNHO,
  inscricoesInicio: d.inscricoesInicio, // Timestamp
  inscricoesFim: d.inscricoesFim, // Timestamp
  dataResultado: d.dataResultado ?? null, // 'AAAA-MM-DD' divulgada no edital (sorteio/divulgação)
  turmaIds: d.turmaIds ?? [], // usado pelas regras de segurança
  turmas: d.turmas ?? [], // [{ id, nome, cursoId, cursoNome }] — cópia para o formulário do site
  requisitosMatricula: d.requisitosMatricula ?? [], // [{ id, tipo, rotulo }]
  config: {
    listaRemanescentes: d.config?.listaRemanescentes ?? true, // quem não ficou nas vagas vira remanescente
    prazoMatriculaDias: d.config?.prazoMatriculaDias ?? 5, // dias para o convocado se matricular
    notaMinima: d.config?.notaMinima ?? 0, // só para modalidade 'prova'
    notaMaxima: d.config?.notaMaxima ?? 10, // só para modalidade 'prova'
  },
});

/**
 * inscricoes/{inscricaoId} — nasce no site (sem login), dentro de um edital e para uma turma.
 * Os campos aceitos na criação pública estão travados em firestore.rules. Os demais
 * (nota, selecao, posicaoRemanescente, prazoMatricula, requisitos, alunoId, matriculaId, motivo…)
 * são acrescentados pela equipe/sistema nas etapas seguintes.
 */
export const novaInscricao = (d) => ({
  nome: d.nome,
  email: d.email,
  telefone: d.telefone ?? '',
  editalId: d.editalId,
  turmaId: d.turmaId,
  mensagem: d.mensagem ?? '',
  origem: d.origem ?? 'site',
  status: STATUS_INSCRICAO.INSCRITA,
  // opcionais: só entram no documento quando preenchidos (as regras aceitam a ausência, não valores vazios)
  ...(d.nomeSocial ? { nomeSocial: d.nomeSocial } : {}),
  ...(d.genero ? { genero: d.genero } : {}),
  ...(d.generoOutro ? { generoOutro: d.generoOutro } : {}),
});

/** Estado inicial do resumo de frequência dentro de matriculas/{id}. */
export const frequenciaInicial = () => ({
  aulas: 0,
  presencas: 0,
  faltas: 0,
  justificadas: 0,
  faltasConsecutivas: 0,
  percentual: 100,
});

/** matriculas/{turmaId_alunoId} — liga aluno ↔ turma e guarda o resumo acadêmico. */
export const novaMatricula = (d) => ({
  alunoId: d.alunoId,
  alunoNome: d.alunoNome, // cópia
  turmaId: d.turmaId,
  turmaNome: d.turmaNome, // cópia
  cursoId: d.cursoId,
  cursoNome: d.cursoNome, // cópia
  inscricaoId: d.inscricaoId ?? null,
  dataMatricula: d.dataMatricula, // 'AAAA-MM-DD'
  status: d.status ?? STATUS_MATRICULA.ATIVA,
  frequencia: frequenciaInicial(), // recalculado a cada chamada (js/domain/regras.js)
  riscoEvasao: false, // idem
  media: null, // média ponderada atual; null = ainda sem notas
});

/** aulas/{turmaId_data} — uma chamada inteira cabe em UM documento. */
export const novaAula = (d) => ({
  turmaId: d.turmaId,
  data: d.data, // 'AAAA-MM-DD'
  conteudo: d.conteudo ?? '', // o que foi dado em aula (diário de classe)
  professorId: d.professorId ?? null,
  registros: d.registros ?? {}, // { [alunoId]: 'P' | 'F' | 'J' }
  resumo: { presentes: 0, faltas: 0, justificadas: 0 },
});

/** avaliacoes/{avaliacaoId} — uma avaliação da turma + as notas de todos. */
export const novaAvaliacao = (d) => ({
  turmaId: d.turmaId,
  titulo: d.titulo,
  tipo: d.tipo ?? TIPO_AVALIACAO.PROVA,
  data: d.data ?? null, // 'AAAA-MM-DD'
  peso: d.peso ?? 1,
  notaMaxima: d.notaMaxima ?? 10,
  notas: d.notas ?? {}, // { [alunoId]: number } — ausente = ainda não lançada
});
