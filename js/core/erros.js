/**
 * Erro esperado de regra de negócio (ex.: turma lotada). A mensagem já é própria para
 * mostrar ao usuário; `codigo` permite à tela reagir (recarregar vagas, fechar o diálogo…).
 * Qualquer outro tipo de erro é falha técnica: registre no console e mostre uma mensagem genérica.
 */
export class ErroDeNegocio extends Error {
  /** @param {string} codigo identificador estável, ex.: 'turma-lotada' */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroDeNegocio';
    this.codigo = codigo;
  }
}
