import { afirmar, grupo, igual, teste } from './lib.js';
import { AGRUPAMENTOS, comparar, curvaDePresenca, distribuir, filtrar, frequencia, funil, juntar, opcoesDeFiltro, perfil, pessoasEmRisco, pessoasUnicas, presencaPorDiaDaSemana } from '../js/domain/analises.js';
import { HOJE, baseFicticia } from './base-ficticia.js';

const base = baseFicticia();
const linhas = juntar(base);
const aprox = (real, esperado, mensagem) => afirmar(Math.abs(real - esperado) < 0.11, `${mensagem}: esperado ~${esperado}, veio ${real}`);
const pelo = (itens, rotulo) => itens.find((i) => i.rotulo === rotulo)?.quantidade;

grupo('Análises: contar e filtrar', () => {
  teste('conta sem se importar com caixa, acento e espaços; "não informado" vai por último', () => {
    const itens = distribuir(['PARDA', 'parda ', 'Preta', null, '', 'Pârda']);
    igual(itens.map((i) => [i.rotulo, i.quantidade]), [['Parda', 3], ['Preta', 1], ['Não informado', 2]]);
    igual(itens[0].percentual, 50);
  });

  teste('sigla curta em maiúsculas fica como está', () => {
    igual(distribuir(['BPC', 'bpc', 'CRAS']).map((i) => i.rotulo), ['BPC', 'CRAS']);
  });

  teste('o limite junta o resto em "Outros"', () => {
    const itens = distribuir(['a', 'a', 'a', 'b', 'b', 'c', 'd'], { limite: 2 });
    igual(itens.map((i) => [i.rotulo, i.quantidade]), [['A', 3], ['B', 2], ['Outros (2)', 2]]);
  });

  teste('junta matrícula, pessoa, turma e curso; matrícula de turma que não existe fica de fora', () => {
    igual(linhas.length, 8);
    afirmar(linhas.every((l) => l.aluno && l.turma && l.curso));
    igual(juntar({ ...base, turmas: [] }).length, 0);
  });

  teste('filtra por período, curso, polo, turma e situação', () => {
    igual(filtrar(linhas, { periodo: '2026.1' }).length, 8);
    igual(filtrar(linhas, { periodo: '2027.1' }).length, 0);
    igual(filtrar(linhas, { polo: 'Casa de Cultura do Bairro Novo' }).length, 4);
    igual(filtrar(linhas, { situacao: 'evadida' }).length, 1);
    igual(filtrar(linhas, { turmaId: base.turmaDaNoite.id, situacao: 'ativa' }).length, 4);
  });

  teste('opções dos filtros', () => {
    const o = opcoesDeFiltro(linhas);
    igual([o.periodos, o.cursos.length, o.polos.length, o.turmas.length], [['2026.1'], 1, 2, 2]);
  });

  teste('pessoa com duas matrículas conta uma vez', () => {
    igual(pessoasUnicas(linhas).length, 7);
  });
});

grupo('Análises: funil e perfil', () => {
  teste('funil: situações, taxa de evasão e a situação escrita pelo sistema oficial', () => {
    const f = funil(linhas);
    igual([f.inscricoes, f.pessoas, f.turmas], [8, 7, 2]);
    igual([f.porSituacao.ativa, f.porSituacao.evadida], [7, 1]);
    igual(f.taxaEvasao, 12.5);
    igual(f.situacoesExternas.map((s) => [s.rotulo, s.quantidade]), [['Ativo', 7], ['Desistente', 1]]);
  });

  teste('perfil: cada pessoa uma vez, com raça, deficiência, programa social e MCMV', () => {
    const p = perfil(linhas, { hoje: HOJE });
    igual(p.pessoas, 7);
    igual(p.raca.map((i) => [i.rotulo, i.quantidade]), [['Parda', 3], ['Amarela', 1], ['Branca', 1], ['Indígena', 1], ['Preta', 1]]);
    igual([pelo(p.deficiencia, 'Sim'), pelo(p.deficiencia, 'Não')], [1, 6]);
    igual(p.deficienciaQual.map((i) => [i.rotulo, i.quantidade]), [['Visual', 1]]);
    igual([pelo(p.programaSocial, 'Sim'), pelo(p.programaSocial, 'Não')], [3, 4]);
    igual(p.programaSocialQual.map((i) => [i.rotulo, i.quantidade]), [['Bolsa Família', 2], ['BPC', 1]]);
    igual(pelo(p.mcmv, 'Sim'), 2);
  });

  teste('perfil: faixa etária na ordem das idades, idade média e onde moram', () => {
    const p = perfil(linhas, { hoje: HOJE });
    igual(p.faixaEtaria.map((i) => [i.rotulo, i.quantidade]), [['25 a 34', 3], ['35 a 44', 3], ['45 a 59', 1]]);
    aprox(p.idadeMedia, 34.9, 'idade média');
    igual(p.cidades.map((i) => [i.rotulo, i.quantidade]), [['Sertópolis', 6], ['Vila Nova', 1]]);
    igual(pelo(p.bairros, 'Centro'), 6);
  });

  teste('perfil respeita os filtros', () => {
    const p = perfil(filtrar(linhas, { polo: 'Sede da Incubadora de Inovação Social em Cultura' }), { hoje: HOJE });
    igual(p.pessoas, 4);
    igual(pelo(p.deficiencia, 'Sim'), 1);
  });
});

grupo('Análises: frequência e evasão', () => {
  const f = frequencia(linhas, base.aulas);

  teste('resumo: só a turma da noite tem chamada; uma pessoa em risco', () => {
    igual([f.matriculas, f.ativas, f.comChamada, f.aulas, f.emRisco], [8, 7, 4, 3, 1]);
    aprox(f.frequenciaMedia, 58.4, 'frequência média');
  });

  teste('por turma: a turma sem chamada fica sem média e vai para o fim', () => {
    igual(f.turmas.length, 2);
    igual([f.turmas[0].frequenciaMedia === null, f.turmas[1].frequenciaMedia === null], [false, true]);
    igual([f.turmas[0].ativas, f.turmas[0].aulas, f.turmas[0].emRisco], [4, 3, 1]);
  });

  teste('curva: presença da 1ª, 2ª e 3ª aula juntando as turmas', () => {
    igual(f.curva.map((p) => [p.numero, p.presenca, p.marcados]), [[1, 50, 4], [2, 50, 4], [3, 75, 4]]);
    igual(curvaDePresenca([]), []);
  });

  teste('presença por dia da semana', () => {
    igual(f.diasDaSemana.map((d) => [d.dia, d.presenca]), [['Segunda', 50], ['Terça', 50], ['Quarta', 75]]);
    igual(presencaPorDiaDaSemana([]), []);
  });

  teste('quem está em risco, com contato', () => {
    const risco = pessoasEmRisco(linhas);
    igual(risco.length, 1);
    igual([risco[0].nome, risco[0].numeroInscricao, risco[0].faltasConsecutivas, risco[0].frequencia], ['Joana Exemplar da Silva', 'QM00002', 3, 0]);
    igual(risco[0].telefone, '(11) 90000-0000');
  });

  teste('"justificada" conta como presença na curva', () => {
    igual(curvaDePresenca([{ turmaId: 't', data: '2026-10-05', registros: { a: 'P', b: 'J', c: 'F', d: 'F' } }])[0].presenca, 50);
  });
});

grupo('Análises: comparar', () => {
  teste('por polo: matrículas, evasão e perfil lado a lado', () => {
    const grupos = comparar(linhas, base.aulas, 'polo', { hoje: HOJE });
    igual(grupos.map((g) => [g.rotulo, g.matriculas, g.ativas, g.evadidas, g.taxaEvasao]), [
      ['Casa de Cultura do Bairro Novo', 4, 3, 1, 25],
      ['Sede da Incubadora de Inovação Social em Cultura', 4, 4, 0, 0],
    ]);
    const sede = grupos[1];
    igual([sede.pessoas, sede.deficienciaPct, sede.emRisco, sede.emRiscoPct], [4, 25, 1, 25]);
    afirmar(grupos[0].frequenciaMedia === null, 'a turma sem chamada não deveria ter média');
  });

  teste('todas as formas de agrupar funcionam', () => {
    for (const por of Object.keys(AGRUPAMENTOS)) afirmar(comparar(linhas, base.aulas, por, { hoje: HOJE }).length >= 1, por);
    igual(comparar(linhas, base.aulas, 'curso', { hoje: HOJE }).length, 1);
    igual(comparar(linhas, base.aulas, 'turma', { hoje: HOJE }).length, 2);
    igual(comparar(linhas, base.aulas, 'periodo', { hoje: HOJE })[0].rotulo, '2026.1');
  });
});
