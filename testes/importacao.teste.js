import { afirmar, grupo, igual, recusa, teste } from './lib.js';
import { lerPlanilha } from '../js/core/planilha.js';
import {
  chaveDeTexto,
  descreverTurma,
  detectarFrequencia,
  detectarListagem,
  lerCpf,
  lerData,
  lerFrequencia,
  lerHorario,
  lerInscricao,
  lerListagem,
  lerOpcaoComDetalhe,
  lerSimNao,
  lerUf,
  planejarFrequencia,
  planejarListagem,
  resolverTurmaDaFrequencia,
  sugerirPeriodo,
  sugerirSituacao,
  titularNome,
} from '../js/domain/importacao.js';
import { CABECALHO_LISTAGEM, cpfDe, criarXlsx, linhaListagem, linhasDaFrequencia, linhasDaListagem, linhasDaListagemOficial } from './fixtures.js';

const HOJE = '2026-10-23';
const NADA = { alunos: [], matriculas: [], turmas: [], cursos: [] };

function lerFicticia() {
  const linhas = linhasDaListagem();
  return lerListagem(linhas, detectarListagem(linhas), { hoje: HOJE });
}
const planejar = (existentes = NADA, opcoes = {}) => planejarListagem(lerFicticia().registros, existentes, { periodoPadrao: '2026.1', hoje: HOJE, ...opcoes });

/** O que o plano deixaria gravado no banco, para reimportar em cima. */
const gravado = (plano) => ({
  cursos: plano.cursos.filter((c) => c.novo).map((c) => ({ id: c.id, ...c.dados })),
  turmas: plano.turmas.map((t) => ({ id: t.id, ...t.dados })),
  alunos: plano.alunos.map((a) => ({ id: a.id, ...a.dados })),
  matriculas: plano.matriculas.map((m) => ({ id: m.id, ...m.dados })),
});

grupo('Valores da planilha', () => {
  teste('datas em vários formatos', () => {
    igual(lerData('05/10/2026'), '2026-10-05');
    igual(lerData('5/1/26'), '2026-01-05');
    igual(lerData('2026-10-05T14:30'), '2026-10-05');
    igual(lerData('05/10/2026 14:32'), '2026-10-05');
    igual(lerData('31/02/2026'), null);
    igual(lerData('abc'), null);
    igual(lerData(5), null);
  });

  teste('sim/não e "possui + qual"', () => {
    igual([lerSimNao('Sim'), lerSimNao('NÃO'), lerSimNao(''), lerSimNao('talvez')], [true, false, null, null]);
    igual(lerOpcaoComDetalhe('Sim', 'Bolsa Família'), { possui: true, qual: 'Bolsa Família' });
    igual(lerOpcaoComDetalhe('Não', 'Bolsa Família'), { possui: false, qual: '' });
    igual(lerOpcaoComDetalhe('', 'Visual'), { possui: true, qual: 'Visual' });
    igual(lerOpcaoComDetalhe('Sim', 'Nenhuma'), { possui: true, qual: '' });
    igual(lerOpcaoComDetalhe('', ''), null);
  });

  teste('CPF só com dígitos, completando os zeros que o Excel come', () => {
    igual(lerCpf('529.982.247-25'), '52998224725');
    igual(lerCpf(5299822472), '05299822472');
    igual(lerCpf(''), '');
  });

  teste('nome em maiúsculas vira nome próprio; os que já têm minúsculas ficam como estão', () => {
    igual(titularNome('ANA TERESA MARQUES DA TERESA'), 'Ana Teresa Marques da Teresa');
    igual(titularNome("D'ÁVILA DOS SANTOS"), "D'Ávila dos Santos");
    igual(titularNome('Bia Lopes'), 'Bia Lopes');
  });

  teste('situação do sistema oficial → a nossa, ou null quando não dá para ter certeza', () => {
    igual(
      ['Ativo', 'Inativo', 'Desistente', 'Evadido', 'Concluído', 'Trancado', 'Cancelado', 'Matriculado', 'Em curso', '', 'Aguardando vaga'].map(sugerirSituacao),
      ['ativa', 'cancelada', 'evadida', 'evadida', 'concluida', 'trancada', 'cancelada', 'ativa', 'ativa', 'ativa', null],
    );
  });

  teste('horário por extenso → dias e horas', () => {
    igual(lerHorario('Terça, Quarta e Quinta-feira - 18:00 às 21:00'), { diasSemana: ['ter', 'qua', 'qui'], horarioInicio: '18:00', horarioFim: '21:00' });
    igual(lerHorario('Sábado, das 9h às 12h'), { diasSemana: ['sab'], horarioInicio: '09:00', horarioFim: '12:00' });
    igual(lerHorario(''), { diasSemana: [], horarioInicio: '', horarioFim: '' });
    igual(lerHorario('Segunda - 21:00 às 18:00').horarioFim, '');
  });

  teste('a turma tem sempre o mesmo id para os mesmos dados, e outro quando muda o polo, o horário ou o período', () => {
    const base = { curso: '2026.1 - Audiovisual', polo: 'Sede', horario: 'Terça - 18:00' };
    const a = descreverTurma(base, '2025.2');
    igual(a.periodo, '2026.1'); // o período do nome do curso vale mais que o padrão
    igual(a.curso, 'Audiovisual');
    igual(a.nome, '2026.1 - Audiovisual - Sede - Terça - 18:00');
    igual(descreverTurma(base, '2030.1').id, a.id);
    igual(descreverTurma({ ...base, polo: 'sede ' }, '').id, a.id, 'caixa e espaços não mudam a turma');
    afirmar(descreverTurma({ ...base, polo: 'Outro' }, '').id !== a.id);
    afirmar(descreverTurma({ ...base, horario: 'Quarta - 18:00' }, '').id !== a.id);
    igual(descreverTurma({ curso: 'Audiovisual', polo: 'Sede', horario: '' }, '2026.2').periodo, '2026.2'); // sem período no nome: o padrão
  });
});

grupo('Importar a listagem', () => {
  teste('acha a linha de títulos mesmo com título do relatório antes', () => {
    const det = detectarListagem(linhasDaListagem());
    igual(det.cabecalho, 2);
    igual([det.colunas.numeroInscricao, det.colunas.nome, det.colunas.curso, det.colunas.dataInscricao], [0, 3, 23, 24]);
  });

  teste('não confunde a lista de frequência com a listagem (nem o contrário)', () => {
    afirmar(detectarListagem(linhasDaFrequencia()) === null);
    afirmar(detectarFrequencia(linhasDaListagem()) === null);
  });

  teste('lê as linhas e limpa os valores', () => {
    const { registros, ignoradas } = lerFicticia();
    igual(registros.length, 8);
    igual(ignoradas, []);
    const maria = registros[0];
    igual(
      [maria.numeroInscricao, maria.idCandidato, maria.nome, maria.email, maria.dataNascimento, maria.raca, maria.dataInscricao],
      ['QM00001', '9001', 'Maria das Graças Exemplo', 'maria@exemplo.com', '1990-04-12', 'Parda', '2026-02-10'],
    );
    igual(maria.deficiencia, { possui: false, qual: '' });
    igual(maria.programaSocial, { possui: true, qual: 'Bolsa Família' });
    igual(registros[1].deficiencia, { possui: true, qual: 'Visual' });
    igual(registros[1].mcmv, { possui: true, qual: 'Residencial Esperança' });
    afirmar(!maria.cpfInvalido && !maria.emailInvalido);
  });

  teste('ano de nascimento com 2 dígitos não vira data no futuro', () => {
    const linhas = [CABECALHO_LISTAGEM, linhaListagem({ inscricao: 'QM1', id: 1, nome: 'TESTE', email: 'a@b.co', cpf: '', nascimento: '12/04/85', horario: 'x', polo: 'y', curso: 'Z', inscritoEm: '01/02/2026' })];
    igual(lerListagem(linhas, detectarListagem(linhas), { hoje: HOJE }).registros[0].dataNascimento, '1985-04-12');
  });

  teste('linhas sem nome ou sem curso são ignoradas e contadas', () => {
    const linhas = [...linhasDaListagem(), linhaListagem({ inscricao: 'QM9', id: 9, nome: '', curso: 'X' }), linhaListagem({ inscricao: 'QM10', id: 10, nome: 'FULANA', curso: '' })];
    const { registros, ignoradas } = lerListagem(linhas, detectarListagem(linhas), { hoje: HOJE });
    igual(registros.length, 8);
    igual(ignoradas.length, 2);
  });

  teste('monta pessoas, matrículas, turma e curso a partir das linhas', () => {
    const plano = planejar();
    igual(plano.resumo, { linhas: 8, alunosNovos: 7, alunosAtualizados: 0, turmasNovas: 2, turmasAtualizadas: 0, cursosNovos: 1, matriculasNovas: 8, matriculasAtualizadas: 0 });
    igual(plano.pendencias, 0);
    igual(plano.cursos[0].nome, 'Audiovisual para Mulheres');

    const noite = plano.turmas.find((t) => t.descricao.horario.startsWith('Terça'));
    igual([noite.descricao.periodo, noite.quantidade, noite.dados.vagasOcupadas, noite.dados.status], ['2026.1', 4, 4, 'em_andamento']);
    igual([noite.dados.diasSemana, noite.dados.horarioInicio, noite.dados.horarioFim], [['ter', 'qua', 'qui'], '18:00', '21:00']);
    igual([noite.dados.polo, noite.dados.origem], ['Sede da Incubadora de Inovação Social em Cultura', 'importacao']);

    const tarde = plano.turmas.find((t) => t.descricao.horario.startsWith('Segunda'));
    igual([tarde.quantidade, tarde.dados.vagasOcupadas], [4, 3]); // uma das quatro desistiu: não ocupa vaga
  });

  teste('a mesma pessoa em duas turmas é uma só, com duas matrículas', () => {
    const plano = planejar();
    const maria = plano.alunos.filter((a) => a.dados.idExterno === '9001');
    igual(maria.length, 1);
    igual(maria[0].dados.status, 'ativo');
    igual(plano.matriculas.filter((m) => m.dados.alunoId === maria[0].id).length, 2);
  });

  teste('o que a planilha traz vai para o cadastro da pessoa', () => {
    const joana = planejar().alunos.find((a) => a.dados.idExterno === '9002').dados;
    igual([joana.nome, joana.cpf, joana.raca, joana.origem], ['Joana Exemplar da Silva', cpfDe(100000002), 'Preta', 'importacao']);
    igual(joana.deficiencia, { possui: true, qual: 'Visual' });
    igual(joana.endereco, { cep: '00000-000', rua: 'Rua das Flores', bairro: 'Centro', cidade: 'Sertópolis', estado: 'SP' });
  });

  teste('a situação do sistema oficial vira a nossa, e a original fica guardada', () => {
    const plano = planejar();
    const paula = plano.matriculas.find((m) => m.dados.numeroInscricao === 'QM00007').dados;
    igual([paula.status, paula.statusExterno, paula.dataMatricula], ['evadida', 'Desistente', '2026-02-12']);
    igual(plano.alunos.find((a) => a.dados.idExterno === '9007').dados.status, 'evadido');
  });

  teste('a escolha da pessoa vale mais que a sugestão', () => {
    const plano = planejar(NADA, { mapaStatus: { desistente: 'cancelada' } });
    igual(plano.matriculas.find((m) => m.dados.numeroInscricao === 'QM00007').dados.status, 'cancelada');
  });

  teste('situação que não dá para adivinhar fica pendente até a pessoa escolher', () => {
    const { registros } = lerFicticia();
    registros[2].statusExterno = 'Aguardando vaga';
    const plano = planejarListagem(registros, NADA, { periodoPadrao: '2026.1', hoje: HOJE });
    igual(plano.pendencias, 1);
    igual(plano.situacoes.find((s) => s.rotulo === 'Aguardando vaga').situacao, null);
    const resolvido = planejarListagem(registros, NADA, { periodoPadrao: '2026.1', hoje: HOJE, mapaStatus: { [chaveDeTexto('Aguardando vaga')]: 'ativa' } });
    igual(resolvido.pendencias, 0);
  });

  teste('reimportar o mesmo arquivo não cria nada de novo, só atualiza', () => {
    const primeira = planejar();
    const segunda = planejar(gravado(primeira));
    igual(segunda.resumo, { linhas: 8, alunosNovos: 0, alunosAtualizados: 7, turmasNovas: 0, turmasAtualizadas: 2, cursosNovos: 0, matriculasNovas: 0, matriculasAtualizadas: 8 });
    igual(segunda.alunos.map((a) => a.id).sort(), primeira.alunos.map((a) => a.id).sort());
    igual(segunda.matriculas.map((m) => m.id).sort(), primeira.matriculas.map((m) => m.id).sort());
  });

  teste('acha a pessoa já cadastrada à mão pelo CPF e preserva o que só existe aqui', () => {
    const existente = { id: 'manual1', nome: 'Joana', nomeSocial: 'Jô', cpf: cpfDe(100000002), email: '', observacoes: 'combinou horário', endereco: { cidade: 'Antiga', complemento: 'ap 2' }, status: 'inativo' };
    const plano = planejar({ ...NADA, alunos: [existente] });
    afirmar(!plano.alunos.some((a) => a.id.startsWith('cand9002')), 'criou uma pessoa duplicada');
    const joana = plano.alunos.find((a) => a.id === 'manual1');
    igual([joana.novo, joana.dados.idExterno, joana.dados.status], [false, '9002', 'ativo']);
    afirmar(!('nomeSocial' in joana.dados) && !('observacoes' in joana.dados), 'mexeu no que a planilha não traz');
    igual(joana.dados.endereco.complemento, 'ap 2'); // o que só existe aqui continua no endereço
    igual(joana.dados.endereco.cidade, 'Sertópolis');
    igual(plano.matriculas.find((m) => m.dados.numeroInscricao === 'QM00002').dados.alunoNome, 'Jô'); // o nome social continua sendo o nome de exibição
  });

  teste('campo em branco na planilha não apaga o que já existe', () => {
    const { registros } = lerFicticia();
    const existente = { id: 'cand9001', idExterno: '9001', nome: 'Maria', telefone: '(11) 11111-1111', cpf: registros[0].cpf, endereco: null };
    registros[0].telefone = '';
    registros[7].telefone = '';
    const plano = planejarListagem(registros, { ...NADA, alunos: [existente] }, { periodoPadrao: '2026.1', hoje: HOJE });
    afirmar(!('telefone' in plano.alunos.find((a) => a.id === 'cand9001').dados));
  });

  teste('avisa de CPF inválido sem recusar a linha', () => {
    const { registros } = lerFicticia();
    registros[3].cpf = '11111111111';
    registros[3].cpfInvalido = true;
    const plano = planejarListagem(registros, NADA, { periodoPadrao: '2026.1', hoje: HOJE });
    afirmar(plano.avisos.some((a) => a.texto.includes('CPF') && a.texto.includes('QM00004')));
    igual(plano.resumo.matriculasNovas, 8);
  });

  teste('lê a listagem de dentro de um .xlsx de verdade', async () => {
    const { abas } = await lerPlanilha(await criarXlsx([{ nome: 'Listagem', linhas: linhasDaListagem() }]));
    const deteccao = detectarListagem(abas[0].linhas);
    const { registros } = lerListagem(abas[0].linhas, deteccao, { hoje: HOJE });
    igual(registros.length, 8);
    igual(registros[0].cpf, cpfDe(100000001));
    igual(registros[0].idCandidato, '9001'); // número no Excel, texto aqui
  });
});

grupo('Importar a frequência', () => {
  async function lerDoXlsx() {
    const { abas } = await lerPlanilha(await criarXlsx([{ nome: 'Frequência', linhas: linhasDaFrequencia() }]));
    return lerFrequencia(abas[0].linhas, detectarFrequencia(abas[0].linhas));
  }

  /** O que o sistema teria depois de importar a listagem. */
  const depoisDaListagem = () => gravado(planejar());

  teste('lê a turma, as datas (texto e célula de data) e as marcas', async () => {
    const leitura = await lerDoXlsx();
    afirmar(leitura.turmaTexto.startsWith('2026.1 - Audiovisual para Mulheres - Sede'));
    igual(leitura.datas, ['2026-10-05', '2026-10-06', '2026-10-07']);
    igual(leitura.pessoas.length, 5);
    const joana = leitura.pessoas.find((p) => p.numeroInscricao === 'QM00002');
    igual([joana.marcas, joana.totalFaltas, joana.observacoes], [['F', 'F', 'F'], 3, 'Viaja às quartas']);
  });

  teste('descobre a turma pelos números de inscrição que já são matrículas', async () => {
    const leitura = await lerDoXlsx();
    const existentes = depoisDaListagem();
    const resolucao = resolverTurmaDaFrequencia(leitura, existentes);
    const noite = existentes.turmas.find((t) => t.horarioTexto.startsWith('Terça'));
    igual([resolucao.turmaId, resolucao.casadas, resolucao.emOutras, resolucao.pelaLista], [noite.id, 4, 1, true]);
  });

  teste('sem nenhuma matrícula conhecida, tenta pelo nome da turma; sem nada, devolve null', async () => {
    const leitura = await lerDoXlsx();
    afirmar(resolverTurmaDaFrequencia(leitura, NADA) === null);
    const turma = { id: 't1', nome: leitura.turmaTexto };
    igual(resolverTurmaDaFrequencia(leitura, { matriculas: [], turmas: [turma] }).turmaId, 't1');
  });

  teste('o número de inscrição casa sem diferença de caixa, espaço ou zeros à esquerda', async () => {
    const existentes = depoisDaListagem();
    const leitura = { turmaTexto: '', datas: ['2026-10-05'], avisos: [], pessoas: [{ numeroInscricao: 'qm00001', nome: 'x', marcas: ['P'] }, { numeroInscricao: '3', nome: 'y', marcas: ['F'] }] };
    igual(resolverTurmaDaFrequencia(leitura, existentes).casadas, 2);
  });

  teste('monta as aulas, o resumo de faltas e o risco de evasão', async () => {
    const leitura = await lerDoXlsx();
    const existentes = depoisDaListagem();
    const turma = existentes.turmas.find((t) => t.horarioTexto.startsWith('Terça'));
    const plano = planejarFrequencia(leitura, { turma, curso: { frequenciaMinima: 75 }, matriculas: existentes.matriculas.filter((m) => m.turmaId === turma.id), aulas: [] });

    igual([plano.resumo.casadas, plano.resumo.aulas, plano.resumo.marcacoes], [4, 3, 12]);
    igual(plano.naoCasadas.map((p) => p.numeroInscricao), ['QM99999']);
    afirmar(plano.avisos.some((a) => a.texto.includes('QM99999')), 'não avisou da pessoa que não está na listagem');
    afirmar(plano.avisos.some((a) => a.texto.includes('Total de faltas') && a.texto.includes('QM00004')), 'não avisou da soma de faltas errada');

    const aluno = (inscricao) => existentes.matriculas.find((m) => m.numeroInscricao === inscricao).alunoId;
    const primeira = plano.aulas.find((a) => a.data === '2026-10-05');
    igual([primeira.registros[aluno('QM00001')], primeira.registros[aluno('QM00002')]], ['P', 'F']);
    igual(primeira.dados.resumo, { presentes: 2, faltas: 2, justificadas: 0 });
    afirmar(primeira.novo);

    const resumoDe = (inscricao) => plano.resumos.find((r) => r.matriculaId === existentes.matriculas.find((m) => m.numeroInscricao === inscricao).id);
    igual([resumoDe('QM00002').frequencia.faltas, resumoDe('QM00002').frequencia.percentual, resumoDe('QM00002').riscoEvasao], [3, 0, true]); // 3 faltas seguidas
    igual([resumoDe('QM00001').frequencia.percentual, resumoDe('QM00001').riscoEvasao], [100, false]);
    // o histórico da planilha já foi tratado pela equipe: só a marca em que a pessoa está agora (3 faltas) fica para avisar
    igual([resumoDe('QM00002').faltasAvisadas, resumoDe('QM00001').faltasAvisadas], [2, 0]);
  });

  teste('somar a uma aula que já existe mantém quem não está na planilha', async () => {
    const leitura = await lerDoXlsx();
    const existentes = depoisDaListagem();
    const turma = existentes.turmas.find((t) => t.horarioTexto.startsWith('Terça'));
    const aulas = [
      { data: '2026-10-05', conteudo: 'Roteiro', registros: { 'outra-pessoa': 'P' } },
      { data: '2026-10-01', registros: { [existentes.matriculas.find((m) => m.numeroInscricao === 'QM00001').alunoId]: 'F' } },
    ];
    const plano = planejarFrequencia(leitura, { turma, curso: null, matriculas: existentes.matriculas.filter((m) => m.turmaId === turma.id), aulas });
    const primeira = plano.aulas.find((a) => a.data === '2026-10-05');
    afirmar(!primeira.novo && primeira.registros['outra-pessoa'] === 'P', 'perdeu quem já estava na aula');
    afirmar(!('conteudo' in primeira.dados), 'mexeu no conteúdo da aula');
    // a aula de 01/10 não está na planilha, mas conta no resumo: Maria faltou nela e foi a todas as outras
    const maria = plano.resumos.find((r) => r.matriculaId === existentes.matriculas.find((m) => m.numeroInscricao === 'QM00001').id);
    igual([maria.frequencia.aulas, maria.frequencia.faltas], [4, 1]);
  });

  teste('marcação desconhecida é avisada e não vira falta', () => {
    const linhas = [['Inscrição', 'Nome', '05/10/2026'], ['QM1', 'ANA', 'Talvez']];
    const leitura = lerFrequencia(linhas, detectarFrequencia(linhas));
    igual(leitura.pessoas[0].marcas, [null]);
    afirmar(leitura.avisos.some((a) => a.includes('Talvez')));
  });

  teste('a lista de frequência de um .xlsx que omite linhas vazias (como o do sistema oficial) é reconhecida', async () => {
    const arquivo = await criarXlsx([{ nome: 'Lista de Presença', linhas: linhasDaFrequencia() }], 'presencas.xlsx', { omitirLinhasVazias: true });
    const { abas } = await lerPlanilha(arquivo);
    const deteccao = detectarFrequencia(abas[0].linhas);
    afirmar(deteccao, 'não reconheceu a lista de frequência');
    igual(lerFrequencia(abas[0].linhas, deteccao).pessoas.length, 5);
  });
});

grupo('Formato real do sistema oficial', () => {
  const lerOficial = () => {
    const linhas = linhasDaListagemOficial();
    return lerListagem(linhas, detectarListagem(linhas), { hoje: HOJE });
  };

  teste('o número de inscrição vem com o período colado: separa os dois', () => {
    igual(lerInscricao('QM05075/2026.1'), { numero: 'QM05075', periodo: '2026.1' });
    igual(lerInscricao('QM05075'), { numero: 'QM05075', periodo: '' });
    igual(lerInscricao(' qm05075 / 2025.2 '), { numero: 'qm05075', periodo: '2025.2' });
  });

  teste('sim/não como 0 e 1 e estado por extenso', () => {
    igual([lerSimNao(1), lerSimNao(0), lerSimNao('1'), lerSimNao('0'), lerSimNao(2)], [true, false, true, false, null]);
    igual(lerOpcaoComDetalhe(0, null), { possui: false, qual: '' });
    igual(lerOpcaoComDetalhe(1, 'Bolsa família'), { possui: true, qual: 'Bolsa família' });
    igual([lerUf('Rio de Janeiro'), lerUf('rj'), lerUf('São Paulo'), lerUf('Atlântida')], ['RJ', 'RJ', 'SP', 'Atlântida']);
  });

  teste('acha os títulos técnicos das colunas (candidato_nome, inscricao_id…)', () => {
    const det = detectarListagem(linhasDaListagemOficial());
    igual(det.cabecalho, 0);
    igual([det.colunas.numeroInscricao, det.colunas.nome, det.colunas.deficienciaQual, det.colunas.mcmvQual, det.colunas.dataInscricao, det.colunas.etapaMatricula], [0, 3, 9, 13, 24, 25]);
    afirmar(detectarFrequencia(linhasDaListagemOficial()) === null);
  });

  teste('lê as linhas: inscrição, período, perfil em 0/1, datas e estado', () => {
    const { registros, ignoradas } = lerOficial();
    igual([registros.length, ignoradas.length], [4, 0]);
    const maria = registros[0];
    igual([maria.numeroInscricao, maria.periodo, maria.etapaMatricula, maria.statusExterno], ['QM00001', '2026.1', '7', 'Sorteado']);
    igual([maria.cpf, maria.dataNascimento, maria.dataInscricao, maria.email, maria.raca], [cpfDe(100000001), '1990-04-12', '2026-02-10', 'maria@exemplo.com', 'PARDA']);
    igual([maria.deficiencia, maria.programaSocial, maria.mcmv], [{ possui: false, qual: '' }, { possui: true, qual: 'Bolsa família e mumbuca' }, { possui: false, qual: '' }]);
    igual([registros[1].deficiencia, registros[1].endereco.estado, registros[0].endereco.estado], [{ possui: true, qual: 'Visual' }, 'RJ', 'RJ']);
  });

  teste('o período da turma vem da inscrição, e é a mesma turma de quem escreve o período no nome do curso', () => {
    const { registros } = lerOficial();
    const plano = planejarListagem(registros, NADA, { periodoPadrao: '2099.9', hoje: HOJE });
    igual(plano.turmas.length, 1);
    igual(plano.turmas[0].descricao.periodo, '2026.1');
    igual(plano.turmas[0].nome, '2026.1 - Audiovisual para Mulheres - Sede da Incubadora de Inovação Social em Cultura - Terça, Quarta e Quinta-feira - 18:00 às 21:00');
    igual(plano.turmas[0].id, planejar().turmas.find((t) => t.descricao.horario.startsWith('Terça')).id, 'o id mudaria conforme a forma de escrever o período');
    igual(sugerirPeriodo(registros, HOJE), '2026.1');
  });

  teste('"Inscrito" e "Sorteado" valem como ativa por sugestão, e a escolha da pessoa continua mandando', () => {
    const { registros } = lerOficial();
    const plano = planejarListagem(registros, NADA, { periodoPadrao: '2026.1', hoje: HOJE });
    igual(plano.situacoes.map((s) => [s.rotulo, s.situacao]).sort(), [['Inscrito', 'ativa'], ['Sorteado', 'ativa']]);
    igual(plano.pendencias, 0);
    const mudado = planejarListagem(registros, NADA, { periodoPadrao: '2026.1', hoje: HOJE, mapaStatus: { inscrito: 'cancelada' } });
    igual(mudado.matriculas.filter((m) => m.dados.status === 'cancelada').length, 2);
  });

  teste('a presença acha a matrícula pelo número SEM o período, mesmo com o mesmo número em dois períodos', () => {
    const { registros } = lerOficial();
    const plano = planejarListagem(registros, NADA, { periodoPadrao: '2026.1', hoje: HOJE });
    const existentes = gravado(plano);
    // o mesmo número QM00001 também existe numa turma de 2025.2: o período do título decide
    const antiga = { id: 'tAntiga', nome: '2025.2 - Outro', periodo: '2025.2', cursoId: 'x', cursoNome: 'Outro' };
    const matriculaAntiga = { id: 'tAntiga_aX', alunoId: 'aX', turmaId: 'tAntiga', numeroInscricao: 'QM00001', status: 'ativa' };
    const leitura = { turmaTexto: '2026.1 - Audiovisual para Mulheres - Sede - Terça', datas: ['2026-10-05'], avisos: [], pessoas: [{ numeroInscricao: 'QM00001', nome: 'x', marcas: ['P'] }, { numeroInscricao: 'QM00002', nome: 'y', marcas: ['F'] }] };
    const resolucao = resolverTurmaDaFrequencia(leitura, { matriculas: [...existentes.matriculas, matriculaAntiga], turmas: [...existentes.turmas, antiga] });
    igual(resolucao.turmaId, existentes.turmas[0].id);
    igual(resolucao.casadas, 2);
  });
});
