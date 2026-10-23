import { afirmar, grupo, igual, teste } from './lib.js';
import {
  estatisticasDaAvaliacao,
  lerNota,
  modoDoCurso,
  pessoasDaAvaliacao,
  recalcularResumos,
  temResultados,
  validarAvaliacao,
  validarResultados,
} from '../js/domain/avaliacoes.js';
import { textoDesempenho } from '../js/models/rotulos.js';

grupo('Avaliações: valores e validação', () => {
  teste('nota digitada: vírgula ou ponto, vazio e lixo', () => {
    igual([lerNota('7,5'), lerNota(' 8 '), lerNota('8.456'), lerNota('  ')], [7.5, 8, 8.46, null]);
    afirmar(Number.isNaN(lerNota('abc')) && Number.isNaN(lerNota('-1')));
  });

  teste('a forma de avaliar é escolhida na avaliação: nota usa peso e nota máxima, Apto / Não apto não', () => {
    igual(validarAvaliacao({ modo: 'nota', titulo: 'Prova', peso: '2', notaMaxima: '10' }).dados, { modo: 'nota', titulo: 'Prova', tipo: 'prova', data: null, peso: 2, notaMaxima: 10 });
    igual(validarAvaliacao({ modo: 'apto', titulo: 'Oficina', tipo: 'projeto', peso: '9', notaMaxima: '3' }).dados, { modo: 'apto', titulo: 'Oficina', tipo: 'projeto', data: null, peso: 1, notaMaxima: null });
    igual(validarAvaliacao({ titulo: 'Prova' }).dados.modo, 'nota');
    afirmar(validarAvaliacao({ modo: 'xyz', titulo: 'Prova' }).erro);
    afirmar(validarAvaliacao({ modo: 'nota', titulo: 'Prova', peso: '0' }).erro);
    afirmar(validarAvaliacao({ modo: 'nota', titulo: 'X' }).erro);
  });

  teste('resultados: nota dentro da escala, Apto/Não apto booleano, só quem tem matrícula', () => {
    const nota = { modo: 'nota', notaMaxima: 10, alunoIds: ['a', 'b'] };
    igual(validarResultados({ a: 7.5, b: null, c: undefined }, nota).dados, { a: 7.5 });
    afirmar(validarResultados({ a: 11 }, nota).erro);
    afirmar(validarResultados({ z: 5 }, nota).erro);
    const apto = { modo: 'apto', notaMaxima: null, alunoIds: ['a', 'b'] };
    igual(validarResultados({ a: true, b: false }, apto).dados, { a: true, b: false });
    afirmar(validarResultados({ a: 7 }, apto).erro);
  });

  teste('o curso só sugere a forma; cursos antigos sugerem nota', () => {
    igual([modoDoCurso({ nome: 'x' }), modoDoCurso({ modoAvaliacao: 'apto' }), modoDoCurso(null)], ['nota', 'apto', 'nota']);
  });
});

grupo('Avaliações: resumo da matrícula', () => {
  const notas = [
    { modo: 'nota', peso: 2, notaMaxima: 10, notas: { c: 8, n: 5 }, aptos: {} },
    { modo: 'nota', peso: 1, notaMaxima: 10, notas: { c: 9 }, aptos: {} },
    { modo: 'apto', aptos: { c: true, n: false }, notas: {} },
    { modo: 'apto', aptos: { c: true }, notas: {} },
  ];
  const matriculas = [{ id: 'mc', alunoId: 'c' }, { id: 'mn', alunoId: 'n' }, { id: 'mx', alunoId: 'x' }];

  teste('as duas formas convivem: média só das notas, aptidão só dos Apto / Não apto', () => {
    const [caio, nina, ninguem] = recalcularResumos({ avaliacoes: notas, matriculas });
    igual([caio.media, caio.aptidao], [8.33, { avaliadas: 2, aptas: 2, naoAptas: 0 }]);
    igual([nina.media, nina.aptidao], [5, { avaliadas: 1, aptas: 0, naoAptas: 1 }]);
    igual([ninguem.media, ninguem.aptidao], [null, null]);
  });

  teste('quem não aparece num mapa de resultados não ganha zero nem "não apto"', () => {
    const [, nina] = recalcularResumos({ avaliacoes: [{ modo: 'nota', peso: 1, notaMaxima: 10, notas: { c: 10 } }], matriculas });
    igual(nina.media, null);
  });

  teste('texto do desempenho junta as duas formas', () => {
    igual(textoDesempenho({ media: 7.4, aptidao: { avaliadas: 3, aptas: 2, naoAptas: 1 } }), 'Média 7,4 · Apto em 2 de 3 avaliação(ões)');
    igual(textoDesempenho({ media: null, aptidao: null }), '');
  });

  teste('lista de lançamento: ativos e quem já tem resultado; estatísticas; trava de troca de forma', () => {
    const pessoas = pessoasDaAvaliacao({
      matriculas: [{ alunoId: 'a', status: 'ativa' }, { alunoId: 'b', status: 'trancada' }, { alunoId: 'c', status: 'evadida' }],
      avaliacao: { modo: 'nota', notas: { c: 4 } },
    });
    igual(pessoas.map((p) => p.alunoId), ['a', 'c']);
    igual(estatisticasDaAvaliacao({ modo: 'nota', notas: { a: 8, b: 5 } }, 4), { total: 4, lancadas: 2, media: 6.5 });
    igual(estatisticasDaAvaliacao({ modo: 'apto', aptos: { a: true, b: false, c: true } }, 3), { total: 3, lancadas: 3, aptas: 2, naoAptas: 1 });
    afirmar(temResultados({ modo: 'nota', notas: { a: 1 } }) && !temResultados({ modo: 'apto', aptos: {}, notas: { a: 1 } }));
  });
});
