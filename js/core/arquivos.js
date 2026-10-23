/** Baixar arquivos e montar CSV — funções de navegador sem regra de negócio, usadas por várias páginas. */

/** Dispara o download de um arquivo gerado na hora. */
export function baixarArquivo(nome, conteudo, tipo = 'application/octet-stream') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Número com vírgula decimal (o Excel em português lê "7,5" como número); o resto vira texto, entre aspas quando precisa. */
const celula = (valor) => {
  if (valor === null || valor === undefined) return '';
  const texto = typeof valor === 'number' ? String(valor).replace('.', ',') : String(valor);
  return /[";\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
};

/** CSV separado por ponto e vírgula, como o Excel em português espera. */
export const montarCsv = (cabecalho, linhas) => [cabecalho, ...linhas].map((linha) => linha.map(celula).join(';')).join('\r\n');

/** Baixa um CSV com BOM, para o Excel reconhecer os acentos. */
export const baixarCsv = (nome, cabecalho, linhas) => baixarArquivo(nome, `﻿${montarCsv(cabecalho, linhas)}`, 'text/csv;charset=utf-8');
