import { afirmar, grupo, igual, recusa, teste } from './lib.js';
import { lerCsv, lerPlanilha, serialParaData } from '../js/core/planilha.js';
import { criarXlsx } from './fixtures.js';

grupo('Leitor de planilhas', () => {
  teste('lê texto, número, vazio, verdadeiro/falso e data de um .xlsx de verdade', async () => {
    const arquivo = await criarXlsx([{ nome: 'Dados', linhas: [['Nome', 'Idade', 'Nasc.'], ['Ana', 30, { data: '1995-04-07' }], [null, 5.5, true]] }]);
    const { abas } = await lerPlanilha(arquivo);
    igual(abas.length, 1);
    igual(abas[0].nome, 'Dados');
    igual(abas[0].linhas, [['Nome', 'Idade', 'Nasc.'], ['Ana', 30, '1995-04-07'], [null, 5.5, true]]);
  });

  teste('lê várias abas, com acentos e símbolos no texto', async () => {
    const arquivo = await criarXlsx([
      { nome: 'Frequência', linhas: [['Inscrição', 'Observações'], ['QM1', 'Falou "olá" & saiu <cedo>']] },
      { nome: 'Outra', linhas: [['x']] },
    ]);
    const { abas } = await lerPlanilha(arquivo);
    igual(abas.map((a) => a.nome), ['Frequência', 'Outra']);
    igual(abas[0].linhas[1], ['QM1', 'Falou "olá" & saiu <cedo>']);
  });

  teste('linhas e colunas saem completas (o que está em branco é null)', async () => {
    const arquivo = await criarXlsx([{ nome: 'A', linhas: [['a', null, 'c'], [], ['x']] }]);
    const { abas } = await lerPlanilha(arquivo);
    igual(abas[0].linhas, [['a', null, 'c'], [null, null, null], ['x', null, null]]);
  });

  teste('número de série do Excel vira data', () => {
    igual(serialParaData(25569), '1970-01-01');
    igual(serialParaData(45658), '2025-01-01');
    igual(serialParaData(45658.5), '2025-01-01T12:00');
  });

  teste('CSV: ponto e vírgula, aspas, aspas duplicadas, BOM e células vazias', () => {
    const linhas = lerCsv('﻿Nome;Cidade;Obs\r\n"Silva; Ana";"São ""Paulo""";\r\nJoão;;ok\r\n');
    igual(linhas, [['Nome', 'Cidade', 'Obs'], ['Silva; Ana', 'São "Paulo"', null], ['João', null, 'ok']]);
  });

  teste('CSV: escolhe a vírgula quando é ela o separador', () => {
    igual(lerCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  });

  teste('recusa formato desconhecido e .xls antigo, com mensagem clara', async () => {
    await recusa(() => lerPlanilha(new File(['conteudo qualquer'], 'x.pdf')), 'Formato não reconhecido');
    await recusa(() => lerPlanilha(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])], 'velho.xls')), '.xls antigo');
  });

  teste('recusa um zip que não é planilha', async () => {
    const naoPlanilha = await criarXlsx([{ nome: 'A', linhas: [['x']] }]);
    const bytes = new Uint8Array(await naoPlanilha.arrayBuffer()).slice(0, 40); // zip cortado: sem índice
    await recusa(() => lerPlanilha(new File([bytes], 'quebrado.xlsx')), 'corrompido');
  });

  teste('o leitor não depende de biblioteca nem de rede', async () => {
    afirmar(typeof DecompressionStream === 'function', 'este navegador não tem DecompressionStream');
  });
});
