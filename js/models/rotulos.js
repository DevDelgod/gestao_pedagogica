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
  remanescente: 'Remanescente',
  matriculada: 'Matriculada',
  nao_selecionada: 'Não selecionada',
  indeferida: 'Indeferida',
  desistente: 'Desistente',
});

export const ROTULO_GENERO = Object.freeze({
  mulher_cis: 'Mulher cis',
  homem_cis: 'Homem cis',
  mulher_trans: 'Mulher trans',
  homem_trans: 'Homem trans',
  travesti: 'Travesti',
  nao_binario: 'Pessoa não binária',
  genero_fluido: 'Gênero fluido',
  agenero: 'Agênero',
  outro: 'Outro (quero escrever)',
  nao_informar: 'Prefiro não informar',
});

export const ROTULO_STATUS_ALUNO = Object.freeze({
  ativo: 'Ativo',
  inativo: 'Inativo',
  evadido: 'Evadido',
});

export const ROTULO_STATUS_MATRICULA = Object.freeze({
  ativa: 'Ativa',
  trancada: 'Trancada',
  evadida: 'Evadida',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
});

/** Texto do botão que leva uma matrícula para a situação indicada (pela situação de destino). */
export const ROTULO_ACAO_MATRICULA = Object.freeze({
  ativa: 'Reativar',
  trancada: 'Trancar',
  evadida: 'Marcar como evadida',
  concluida: 'Concluir',
  cancelada: 'Cancelar matrícula',
});

export const ROTULO_STATUS_TURMA = Object.freeze({
  planejada: 'Planejada',
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
});

/** Mesma ordem de DIAS_SEMANA (domingo = 0). */
export const ROTULO_DIA = Object.freeze({
  dom: 'Domingo',
  seg: 'Segunda',
  ter: 'Terça',
  qua: 'Quarta',
  qui: 'Quinta',
  sex: 'Sexta',
  sab: 'Sábado',
});

export const ROTULO_MODO_AVALIACAO = Object.freeze({
  nota: 'Nota numérica',
  apto: 'Apto / Não apto',
});

export const AJUDA_MODO_AVALIACAO = Object.freeze({
  nota: 'Cada pessoa recebe uma nota. As notas entram na média ponderada, que precisa alcançar a média de aprovação do curso.',
  apto: 'Cada pessoa recebe Apto ou Não apto, sem número. A pessoa precisa estar apta nas avaliações deste tipo.',
});

export const ROTULO_TIPO_AVALIACAO = Object.freeze({
  prova: 'Prova',
  trabalho: 'Trabalho',
  projeto: 'Projeto',
  participacao: 'Participação',
});

const virgula = (n) => String(n).replace('.', ',');

/**
 * Desempenho de uma matrícula em uma frase curta: "Média 7,4", "Apto em 2 de 3 avaliações" ou as duas juntas
 * ("Média 7,4 · Apto em 2 de 3 avaliações"), conforme as formas de avaliar usadas na turma. Vazio se ainda não há resultados.
 */
export function textoDesempenho(matricula) {
  const partes = [];
  if (typeof matricula.media === 'number') partes.push(`Média ${virgula(matricula.media)}`);
  const a = matricula.aptidao;
  if (a?.avaliadas) partes.push(`Apto em ${a.aptas} de ${a.avaliadas} avaliação(ões)`);
  return partes.join(' · ');
}

export const ROTULO_TIPO_REQUISITO = Object.freeze({
  documento: 'Documento',
  pagamento: 'Pagamento',
  termo: 'Termo / declaração',
  outro: 'Outro',
});
