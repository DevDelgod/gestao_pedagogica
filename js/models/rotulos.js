/** Textos de tela para os valores de schema.js. Ficam separados para o modelo não depender de apresentação. */

export const ROTULO_MODALIDADE = Object.freeze({
  sorteio: 'Sorteio',
  prova: 'Prova (classificação por nota)',
  ordem_chegada: 'Ordem de inscrição',
  analise: 'Análise individual',
});

export const AJUDA_MODALIDADE = Object.freeze({
  sorteio: 'As vagas são sorteadas entre os inscritos da turma. O sorteio é registrado com uma semente e pode ser refeito por qualquer pessoa.',
  prova: 'A equipe lança a nota de cada inscrito e as vagas vão para as maiores notas. Notas abaixo da mínima ou ausentes ficam de fora.',
  ordem_chegada: 'As vagas vão para quem se inscreveu primeiro.',
  analise: 'Não há execução automática: a equipe convoca pessoa a pessoa, conforme analisa as inscrições.',
});

export const ROTULO_STATUS_EDITAL = Object.freeze({
  rascunho: 'Rascunho',
  inscricoes: 'Inscrições abertas',
  selecao: 'Em seleção',
  matriculas: 'Matrículas',
  encerrado: 'Encerrado',
});

/** Texto do botão que leva o edital à etapa seguinte, por etapa ATUAL. */
export const ROTULO_AVANCAR_EDITAL = Object.freeze({
  rascunho: 'Abrir inscrições',
  inscricoes: 'Encerrar inscrições',
  selecao: 'Publicar resultado e abrir matrículas',
  matriculas: 'Encerrar edital',
});

export const ROTULO_STATUS_INSCRICAO = Object.freeze({
  inscrita: 'Inscrita',
  convocada: 'Convocada',
  suplente: 'Suplente',
  matriculada: 'Matriculada',
  nao_selecionada: 'Não selecionada',
  indeferida: 'Indeferida',
  desistente: 'Desistente',
});

export const ROTULO_TIPO_REQUISITO = Object.freeze({
  documento: 'Documento',
  pagamento: 'Pagamento',
  termo: 'Termo / declaração',
  outro: 'Outro',
});
