/**
 * Dados do MODO DESENVOLVIMENTO (Firebase simulado, só em localhost e só enquanto
 * js/core/config.js não estiver preenchido). Nada daqui vai para o Firebase real.
 *
 * As contas abaixo existem apenas no navegador de quem está testando. A tela de login, no modo
 * desenvolvimento, mostra um botão por conta que preenche e envia o formulário.
 */

/** Mude a versão sempre que alterar a semente: os dados de exemplo salvos no navegador são refeitos. */
export const SEED_VERSAO = 2;

export const CONTAS_DEV = [
  {
    uid: 'dev-admin',
    nome: 'Admin Dev',
    email: 'admin@dev.local',
    senha: 'dev12345',
    papel: 'admin',
    descricao: 'Acesso total.',
  },
  {
    uid: 'dev-coord',
    nome: 'Coordenação Dev',
    email: 'coordenacao@dev.local',
    senha: 'dev12345',
    papel: 'coordenador',
    descricao: 'Editais, inscrições e matrículas.',
  },
  {
    uid: 'dev-prof',
    nome: 'Professor Dev',
    email: 'professor@dev.local',
    senha: 'dev12345',
    papel: 'professor',
    descricao: 'Só o painel: não acessa editais nem inscrições.',
  },
];

const MIN = 60 * 1000;
const DIA = 24 * 60 * MIN;

/** Cenário: um edital em cada etapa, turmas, alunos e matrículas para o painel ter o que mostrar. */
export function semear(store, Timestamp) {
  const agora = Date.now();
  const ts = (ms) => new Timestamp(ms);
  const auditoria = (diasAtras) => ({ criadoEm: ts(agora - diasAtras * DIA), atualizadoEm: ts(agora - diasAtras * DIA) });

  // --- equipe (users/{uid}) ---
  CONTAS_DEV.forEach((c) =>
    store.set(`users/${c.uid}`, { nome: c.nome, email: c.email, papel: c.papel, ativo: true, ...auditoria(60) }),
  );

  // --- cursos e turmas ---
  const curso = (id, nome, cargaHoraria) =>
    store.set(`cursos/${id}`, { nome, descricao: '', cargaHoraria, frequenciaMinima: 75, mediaAprovacao: 7, ativo: true, ...auditoria(60) });
  curso('c1', 'Desenvolvimento Web', 60);
  curso('c2', 'Design Gráfico', 40);
  curso('c3', 'Robótica', 50);
  curso('c4', 'Fotografia', 30);
  curso('c5', 'Programação com Python', 60);

  const turma = (id, nome, cursoId, vagas, ocupadas = 0, status = 'aberta', extras = {}) => {
    const c = store.get(`cursos/${cursoId}`);
    store.set(`turmas/${id}`, {
      nome, cursoId, cursoNome: c.nome, vagas, vagasOcupadas: ocupadas, vagasReservadas: 0, status,
      professorId: 'dev-prof', professorNome: 'Professor Dev', diasSemana: ['seg', 'qua'],
      horarioInicio: '19:00', horarioFim: '21:00', dataInicio: null, dataFim: null, ...auditoria(40), ...extras,
    });
  };
  turma('t1', 'Web 2026.1 — Noite', 'c1', 5, 1); // 4 vagas livres
  turma('t2', 'Design 2026.1 — Tarde', 'c2', 2);
  turma('t3', 'Robótica 2026.1', 'c3', 3);
  turma('t4', 'Fotografia 2026.1', 'c4', 2);
  turma('t7', 'Python 2026.1 — Manhã', 'c5', 3);
  turma('t6', 'Web 2025.2 — Noite', 'c1', 10, 3, 'em_andamento', { dataInicio: '2025-08-04', dataFim: '2025-12-10' });
  turma('t5', 'Web 2025.1 — Encerrada', 'c1', 10, 0, 'encerrada');

  // --- alunos e matrículas já existentes (mantêm vagasOcupadas coerente com as turmas) ---
  const aluno = (id, nome, status = 'ativo') =>
    store.set(`alunos/${id}`, { nome, email: `${id}@exemplo.com`, telefone: '(11) 90000-0000', cpf: '', dataNascimento: null, responsavel: null, endereco: null, documentos: [], observacoes: '', status, ...auditoria(90) });
  const matricula = (turmaId, alunoId, status, frequencia, riscoEvasao = false, media = null) => {
    const t = store.get(`turmas/${turmaId}`);
    const a = store.get(`alunos/${alunoId}`);
    store.set(`matriculas/${turmaId}_${alunoId}`, {
      alunoId, alunoNome: a.nome, turmaId, turmaNome: t.nome, cursoId: t.cursoId, cursoNome: t.cursoNome,
      inscricaoId: null, dataMatricula: '2025-07-28', status, frequencia, riscoEvasao, media, ...auditoria(90),
    });
  };
  const freq = (aulas, presencas, faltas, justificadas, faltasConsecutivas, percentual) => ({ aulas, presencas, faltas, justificadas, faltasConsecutivas, percentual });
  aluno('a-lia', 'Lia Fernandes');
  aluno('a-caio', 'Caio Barros');
  aluno('a-nina', 'Nina Moraes');
  aluno('a-tomas', 'Tomás Rezende');
  aluno('a-olga', 'Olga Prado', 'evadido');
  matricula('t1', 'a-lia', 'ativa', freq(0, 0, 0, 0, 0, 100));
  matricula('t6', 'a-caio', 'ativa', freq(10, 9, 1, 0, 0, 90), false, 8.2);
  matricula('t6', 'a-nina', 'ativa', freq(10, 6, 4, 0, 3, 60), true, 5.5); // em risco de evasão
  matricula('t6', 'a-tomas', 'ativa', freq(10, 8, 1, 1, 0, 90), false, 7.4);
  matricula('t6', 'a-olga', 'evadida', freq(10, 3, 7, 0, 7, 30), false, 4);

  // --- editais, um em cada etapa ---
  const requisitos = [
    { id: 'documentos-pessoais', tipo: 'documento', rotulo: 'Documentos pessoais' },
    { id: 'taxa-de-matricula', tipo: 'pagamento', rotulo: 'Taxa de matrícula' },
  ];
  const edital = (id, titulo, modalidade, status, turmaIds, janela, extras = {}) =>
    store.set(`editais/${id}`, {
      titulo, descricao: '', modalidade, status,
      inscricoesInicio: ts(agora + janela[0] * DIA), inscricoesFim: ts(agora + janela[1] * DIA), dataResultado: null,
      turmaIds, turmas: turmaIds.map((t) => { const d = store.get(`turmas/${t}`); return { id: t, nome: d.nome, cursoId: d.cursoId, cursoNome: d.cursoNome }; }),
      requisitosMatricula: requisitos,
      config: { listaRemanescentes: true, prazoMatriculaDias: 5, notaMinima: 0, notaMaxima: 10 },
      ...auditoria(Math.max(1, 1 - janela[0])), ...extras,
    });
  edital('ed1', 'Edital 01/2026 — Sorteio', 'sorteio', 'selecao', ['t1', 't2'], [-30, -10], { dataResultado: '2026-02-20' });
  edital('ed2', 'Edital 02/2026 — Prova', 'prova', 'selecao', ['t3'], [-30, -10], { config: { listaRemanescentes: true, prazoMatriculaDias: 5, notaMinima: 5, notaMaxima: 10 } });
  edital('ed3', 'Edital 03/2026 — Análise individual', 'analise', 'matriculas', ['t4'], [-30, -10], { requisitosMatricula: [], config: { listaRemanescentes: false, prazoMatriculaDias: 3, notaMinima: 0, notaMaxima: 10 } });
  edital('ed4', 'Edital 04/2026 — Rascunho', 'sorteio', 'rascunho', ['t2'], [5, 20], { descricao: 'Ainda em preparação.', requisitosMatricula: [] });
  edital('ed5', 'Edital 05/2026 — Inscrições abertas', 'sorteio', 'inscricoes', ['t7'], [-2, 10], { dataResultado: '2026-12-15' });

  // --- inscrições ---
  const inscricao = (id, editalId, turmaId, nome, minutos, extras = {}) =>
    store.set(`inscricoes/${id}`, {
      nome, email: `${id}@exemplo.com`, telefone: '(11) 91111-0000', editalId, turmaId, mensagem: '', origem: 'site',
      status: 'inscrita', criadoEm: ts(agora - 15 * DIA + minutos * MIN), atualizadoEm: ts(agora - 15 * DIA + minutos * MIN), ...extras,
    });
  ['Ana Lima', 'Bruno Costa', 'Carla Dias', 'Diego Melo', 'Elisa Rocha', 'Fábio Nunes', 'Gabi Alves', 'Hugo Reis']
    .forEach((nome, i) => inscricao(`i${i + 1}`, 'ed1', 't1', nome, i));
  inscricao('j1', 'ed1', 't2', 'Iara Pires', 10, { mensagem: 'Quero muito participar!' });
  [['Paulo Silva', 9], ['Quitéria Gomes', 7.5], ['Rafael Tavares', 7.5], ['Sônia Matos', 4], ['Tiago Brito', null], ['Úrsula Vaz', 6]]
    .forEach(([nome, nota], i) => inscricao(`p${i + 1}`, 'ed2', 't3', nome, i, nota === null ? {} : { nota }));
  ['Vera Campos', 'Wagner Dias', 'Xavier Leal'].forEach((nome, i) => inscricao(`a${i + 1}`, 'ed3', 't4', nome, i));
  ['Yara Neves', 'Zeca Prado', 'Alice Rangel', 'Bento Salles', 'Cíntia Duarte']
    .forEach((nome, i) => inscricao(`k${i + 1}`, 'ed5', 't7', nome, i * 30, { criadoEm: ts(agora - 1 * DIA + i * 30 * MIN) }));
}
