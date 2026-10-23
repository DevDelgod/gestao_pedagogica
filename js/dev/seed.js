/**
 * Dados do MODO DESENVOLVIMENTO (Firebase simulado, só em localhost e só enquanto
 * js/core/config.js não estiver preenchido). Nada daqui vai para o Firebase real.
 *
 * As contas abaixo existem apenas no navegador de quem está testando. A tela de login, no modo
 * desenvolvimento, mostra um botão por conta que preenche e envia o formulário.
 */

/** Mude a versão sempre que alterar a semente: os dados de exemplo salvos no navegador são refeitos. */
export const SEED_VERSAO = 7;

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
  // modoAvaliacao é só a forma SUGERIDA ao criar uma avaliação ('nota' ou 'apto'): cada avaliação escolhe a sua
  const curso = (id, nome, cargaHoraria, modoAvaliacao = 'nota') =>
    store.set(`cursos/${id}`, { nome, descricao: '', cargaHoraria, frequenciaMinima: 75, modoAvaliacao, mediaAprovacao: 7, ativo: true, ...auditoria(60) });
  curso('c1', 'Desenvolvimento Web', 60);
  curso('c2', 'Design Gráfico', 40);
  curso('c3', 'Robótica', 50);
  curso('c4', 'Fotografia', 30, 'apto'); // oficina que costuma avaliar por Apto / Não apto
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
  // turmas sem professor definido: o professor de exemplo (dev-prof) só enxerga t1, t5, t6 e t8 no Diário e nas Avaliações
  const semProfessor = { professorId: null, professorNome: null };
  turma('t2', 'Design 2026.1 — Tarde', 'c2', 2, 0, 'aberta', semProfessor);
  turma('t3', 'Robótica 2026.1', 'c3', 3, 0, 'aberta', semProfessor);
  turma('t4', 'Fotografia 2026.1', 'c4', 2, 0, 'aberta', semProfessor);
  turma('t7', 'Python 2026.1 — Manhã', 'c5', 3, 0, 'aberta', semProfessor);
  turma('t6', 'Web 2025.2 — Noite', 'c1', 10, 4, 'em_andamento', { dataInicio: '2025-08-04', dataFim: '2025-12-10' });
  turma('t5', 'Web 2025.1 — Encerrada', 'c1', 10, 0, 'encerrada');
  // curso avaliado por Apto / Não apto: mostra o outro modo das Avaliações
  turma('t8', 'Fotografia 2025.2 — Sábado', 'c4', 8, 3, 'em_andamento', {
    diasSemana: ['sab'], horarioInicio: '09:00', horarioFim: '12:00', dataInicio: '2025-08-02', dataFim: '2025-12-06',
  });

  // --- alunos e matrículas já existentes (mantêm vagasOcupadas coerente com as turmas) ---
  const aluno = (id, nome, status = 'ativo', extras = {}) =>
    store.set(`alunos/${id}`, { nome, email: `${id}@exemplo.com`, telefone: '(11) 90000-0000', cpf: '', dataNascimento: null, responsavel: null, endereco: null, documentos: [], observacoes: '', status, ...auditoria(90), ...extras });
  const endereco = (cidade, bairro) => ({ cidade, bairro });
  const anoAtual = new Date(agora).getFullYear();
  // documento de exemplo (imagem de 1 pixel): serve para mostrar a lista de documentos na ficha
  const documentoExemplo = { nome: 'rg-frente.png', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', publicId: 'fudev/alunos/documentos/exemplo01', tipo: 'image', formato: 'png', bytes: 70 };
  // `media` (cursos por nota) e `aptidao` (cursos Apto / Não apto) repetem o que as avaliações de exemplo, mais abaixo, resultam
  const matricula = (turmaId, alunoId, status, frequencia, riscoEvasao = false, media = null, aptidao = null) => {
    const t = store.get(`turmas/${turmaId}`);
    const a = store.get(`alunos/${alunoId}`);
    store.set(`matriculas/${turmaId}_${alunoId}`, {
      // a cópia do nome do aluno usa o nome social, se houver
      alunoId, alunoNome: a.nomeSocial || a.nome, turmaId, turmaNome: t.nome, cursoId: t.cursoId, cursoNome: t.cursoNome,
      inscricaoId: null, dataMatricula: '2025-07-28', status, frequencia, riscoEvasao, media, aptidao, ...auditoria(90),
    });
  };
  const freq = (aulas, presencas, faltas, justificadas, faltasConsecutivas, percentual) => ({ aulas, presencas, faltas, justificadas, faltasConsecutivas, percentual });
  aluno('a-lia', 'Lia Fernandes', 'ativo', { cpf: '52998224725', dataNascimento: '2001-04-12', genero: 'mulher_cis', endereco: endereco('São Paulo', 'Lapa'), documentos: [documentoExemplo] });
  aluno('a-caio', 'Caio Barros', 'ativo', { dataNascimento: '1999-09-30', genero: 'homem_cis', endereco: endereco('Osasco', 'Centro') });
  aluno('a-nina', 'Nina Moraes', 'ativo', { dataNascimento: '2003-01-22', observacoes: 'Trabalha à tarde; costuma faltar às quartas.' });
  aluno('a-tomas', 'Tomás Rezende', 'ativo', { cpf: '11144477735', dataNascimento: '1997-11-05' });
  aluno('a-olga', 'Olga Prado', 'evadido', { dataNascimento: '2000-07-18' });
  aluno('a-bia', 'Beatriz Lopes', 'ativo', {
    nomeSocial: 'Bia Lopes', // as telas mostram o nome social; o civil aparece como informação secundária
    genero: 'nao_binario',
    dataNascimento: `${anoAtual - 15}-06-15`, // menor de idade: tem responsável
    responsavel: { nome: 'Marta Lopes', telefone: '(11) 98888-1212', parentesco: 'mãe' },
    endereco: endereco('São Paulo', 'Pirituba'),
  });
  aluno('a-davi', 'Davi Nogueira', 'inativo', { dataNascimento: '1998-02-09', genero: 'outro', generoOutro: 'Demigênero' }); // concluiu a turma de 2025.1
  aluno('a-ravi', 'Ravi Menezes', 'ativo', { dataNascimento: '2000-03-10', endereco: endereco('São Paulo', 'Vila Madalena') });
  aluno('a-sol', 'Solange Andrade', 'ativo', { nomeSocial: 'Sol Andrade', genero: 'genero_fluido', dataNascimento: '1996-12-02' });
  aluno('a-yuri', 'Yuri Tanaka', 'ativo', { dataNascimento: '2002-08-21', genero: 'nao_informar' });
  matricula('t1', 'a-lia', 'ativa', freq(0, 0, 0, 0, 0, 100));
  matricula('t8', 'a-ravi', 'ativa', freq(0, 0, 0, 0, 0, 100), false, 9, { avaliadas: 2, aptas: 2, naoAptas: 0 });
  matricula('t8', 'a-sol', 'ativa', freq(0, 0, 0, 0, 0, 100), false, 8, { avaliadas: 2, aptas: 1, naoAptas: 1 });
  matricula('t8', 'a-yuri', 'ativa', freq(0, 0, 0, 0, 0, 100), false, null, { avaliadas: 1, aptas: 1, naoAptas: 0 });
  // t6 mistura as duas formas: provas e trabalho por nota (media) e uma entrega de atividades Apto / Não apto (aptidao)
  matricula('t6', 'a-caio', 'ativa', freq(10, 9, 1, 0, 0, 90), false, 8.2, { avaliadas: 1, aptas: 1, naoAptas: 0 });
  matricula('t6', 'a-nina', 'ativa', freq(10, 6, 4, 0, 3, 60), true, 5.5, { avaliadas: 1, aptas: 0, naoAptas: 1 }); // em risco de evasão
  matricula('t6', 'a-tomas', 'ativa', freq(10, 8, 1, 1, 0, 90), false, 7.4, { avaliadas: 1, aptas: 1, naoAptas: 0 });
  matricula('t6', 'a-bia', 'ativa', freq(10, 10, 0, 0, 0, 100), false, 9.1, { avaliadas: 1, aptas: 1, naoAptas: 0 });
  matricula('t6', 'a-olga', 'evadida', freq(10, 3, 7, 0, 7, 30), false, 4);
  matricula('t5', 'a-davi', 'concluida', freq(20, 19, 1, 0, 0, 95), false, 8.8);

  // --- diário: 10 aulas da turma t6, coerentes com o resumo de frequência das matrículas acima ---
  // (regravar uma aula sem mudar nada produz exatamente os mesmos números)
  const datasT6 = ['2025-08-04', '2025-08-06', '2025-08-11', '2025-08-13', '2025-08-18', '2025-08-20', '2025-08-25', '2025-08-27', '2025-09-01', '2025-09-03'];
  const conteudosT6 = [
    'Apresentação da turma e instalação do ambiente', 'HTML: estrutura da página', 'HTML: textos, listas e links', 'HTML: imagens e formulários',
    'CSS: seletores e cores', 'CSS: caixa e espaçamento', 'CSS: layout com flexbox', 'CSS: responsividade',
    'JavaScript: variáveis e tipos', 'JavaScript: funções e eventos',
  ];
  const marcasT6 = {
    // uma letra por aula, na ordem das datas: P presente, F falta, J falta justificada
    'a-caio': 'PPPPPFPPPP', // 9P 1F
    'a-nina': 'PPPPFPPFFF', // 6P 4F, três faltas seguidas no fim → risco de evasão
    'a-tomas': 'PPPFPPPJPP', // 8P 1F 1J
    'a-bia': 'PPPPPPPPPP', // 10P
    'a-olga': 'PPPFFFFFFF', // 3P 7F
  };
  datasT6.forEach((data, i) => {
    const registros = Object.fromEntries(Object.entries(marcasT6).map(([alunoId, sequencia]) => [alunoId, sequencia[i]]));
    const marcas = Object.values(registros);
    store.set(`aulas/t6_${data}`, {
      turmaId: 't6', data, conteudo: conteudosT6[i], professorId: 'dev-prof', registros,
      resumo: { presentes: marcas.filter((m) => m === 'P').length, faltas: marcas.filter((m) => m === 'F').length, justificadas: marcas.filter((m) => m === 'J').length },
      ...auditoria(90),
    });
  });

  // --- avaliações: os resultados batem com a `media` e a `aptidao` das matrículas acima ---
  // (regravar os resultados sem mudar nada produz exatamente os mesmos números)
  // `modo` é a forma de avaliar escolhida em cada avaliação: 'nota' usa `notas` (com peso e nota máxima), 'apto' usa `aptos`
  const avaliacao = (id, turmaId, modo, titulo, tipo, data, extras) =>
    store.set(`avaliacoes/${id}`, { turmaId, modo, titulo, tipo, data, ...extras, ...auditoria(60) });
  const porNota = (peso, notas) => ({ peso, notaMaxima: 10, notas, aptos: {} });
  const porAptidao = (aptos) => ({ peso: 1, notaMaxima: null, notas: {}, aptos });
  // média ponderada de t6 (pesos 2, 1 e 2): Caio 8,2 · Nina 5,5 · Tomás 7,4 · Bia 9,1 · Olga 4 (evadiu depois da 1ª prova)
  avaliacao('av1', 't6', 'nota', 'Prova 1 — HTML e CSS', 'prova', '2025-08-20', porNota(2, { 'a-caio': 8, 'a-nina': 5, 'a-tomas': 7, 'a-bia': 9, 'a-olga': 4 }));
  avaliacao('av2', 't6', 'nota', 'Trabalho — Página pessoal', 'trabalho', '2025-08-27', porNota(1, { 'a-caio': 9, 'a-nina': 7.5, 'a-tomas': 9, 'a-bia': 9.5 }));
  avaliacao('av3', 't6', 'nota', 'Prova 2 — CSS e JavaScript', 'prova', '2025-09-03', porNota(2, { 'a-caio': 8, 'a-nina': 5, 'a-tomas': 7, 'a-bia': 9 }));
  avaliacao('av4', 't5', 'nota', 'Projeto final', 'projeto', '2025-06-20', porNota(1, { 'a-davi': 8.8 }));
  avaliacao('av5', 't8', 'apto', 'Retrato em luz natural', 'projeto', '2025-09-06', porAptidao({ 'a-ravi': true, 'a-sol': true, 'a-yuri': true }));
  avaliacao('av6', 't8', 'apto', 'Prática de iluminação', 'trabalho', '2025-09-13', porAptidao({ 'a-ravi': true, 'a-sol': false }));
  // as duas formas convivem na mesma turma: Web também tem uma avaliação Apto / Não apto, e Fotografia uma por nota
  avaliacao('av7', 't6', 'apto', 'Entrega das atividades', 'participacao', '2025-09-02', porAptidao({ 'a-caio': true, 'a-nina': false, 'a-tomas': true, 'a-bia': true }));
  avaliacao('av8', 't8', 'nota', 'Crítica do portfólio', 'trabalho', '2025-09-20', porNota(1, { 'a-ravi': 9, 'a-sol': 8 }));

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

  // nome social e gênero de exemplo (o gênero "outro" traz o texto escrito pela própria pessoa)
  Object.assign(store.get('inscricoes/i5'), { nome: 'Eliseu Rocha', nomeSocial: 'Elisa Rocha', genero: 'mulher_trans' });
  Object.assign(store.get('inscricoes/i2'), { genero: 'homem_cis' });
  Object.assign(store.get('inscricoes/i7'), { genero: 'nao_informar' });
  Object.assign(store.get('inscricoes/k2'), { genero: 'outro', generoOutro: 'Bigênero' });
  Object.assign(store.get('inscricoes/k4'), { nomeSocial: 'Ben Salles', genero: 'homem_trans' });
}
