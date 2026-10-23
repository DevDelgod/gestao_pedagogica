/**
 * Leitor de planilhas para o navegador: .xlsx e .csv, sem biblioteca e sem enviar nada para fora.
 *
 * Um .xlsx é um zip de arquivos XML; o navegador já sabe descompactar (DecompressionStream) e ler XML
 * (DOMParser). Devolve só valores (texto, número, verdadeiro/falso ou null), sem fórmulas nem estilos:
 *   { abas: [{ nome: 'Plan1', linhas: [[valor, valor, …], …] }] }
 * Células de data viram texto 'AAAA-MM-DD' (ou 'AAAA-MM-DDTHH:MM' quando têm hora). Linhas e colunas
 * saem completas: o que está em branco é null.
 */
import { ErroDeNegocio } from './erros.js';

const falha = (mensagem) => new ErroDeNegocio('planilha-invalida', mensagem);

/** @param {File} arquivo */
export async function lerPlanilha(arquivo) {
  const buffer = await arquivo.arrayBuffer();
  const inicio = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (inicio[0] === 0x50 && inicio[1] === 0x4b) return { abas: await lerXlsx(buffer) };
  if (inicio[0] === 0xd0 && inicio[1] === 0xcf) {
    throw falha('Este é um arquivo .xls antigo. Abra no Excel e salve como .xlsx (ou .csv).');
  }
  if (/\.(csv|txt)$/i.test(arquivo.name)) return { abas: [{ nome: 'CSV', linhas: lerCsv(decodificarTexto(buffer)) }] };
  throw falha('Formato não reconhecido. Use um arquivo .xlsx ou .csv.');
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** UTF-8; se o arquivo não for UTF-8 válido (Excel antigo), lê como Windows-1252. */
function decodificarTexto(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Separador (; , ou tab) escolhido pela primeira linha; aspas duplas protegem separadores e quebras de linha. */
export function lerCsv(texto) {
  const limpo = texto.replace(/^﻿/, '');
  const primeira = limpo.split(/\r?\n/, 1)[0];
  const [separador] = [';', '\t', ','].map((s) => [s, primeira.split(s).length]).sort((a, b) => b[1] - a[1])[0];

  const linhas = [];
  let linha = [];
  let atual = '';
  let entreAspas = false;
  const fecharCelula = () => {
    linha.push(atual === '' ? null : atual);
    atual = '';
  };
  const fecharLinha = () => {
    fecharCelula();
    if (linha.some((c) => c !== null)) linhas.push(linha);
    linha = [];
  };

  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (entreAspas) {
      if (c === '"' && limpo[i + 1] === '"') { atual += '"'; i++; }
      else if (c === '"') entreAspas = false;
      else atual += c;
    } else if (c === '"') entreAspas = true;
    else if (c === separador) fecharCelula();
    else if (c === '\n') fecharLinha();
    else if (c !== '\r') atual += c;
  }
  if (atual !== '' || linha.length) fecharLinha();

  const largura = Math.max(0, ...linhas.map((l) => l.length));
  return linhas.map((l) => Array.from({ length: largura }, (_, j) => l[j] ?? null));
}

// ---------------------------------------------------------------------------
// XLSX: zip + XML
// ---------------------------------------------------------------------------

/** Lê o índice do zip e devolve { existe(nome), texto(nome) }. */
async function abrirZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const v = new DataView(buffer);

  let fim = -1; // fim do índice (End of Central Directory), procurado de trás para a frente
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw falha('O arquivo está corrompido ou não é um .xlsx.');

  const entradas = new Map();
  let pos = v.getUint32(fim + 16, true);
  for (let n = v.getUint16(fim + 10, true); n > 0; n--) {
    if (pos + 46 > bytes.length || v.getUint32(pos, true) !== 0x02014b50) break;
    const tamNome = v.getUint16(pos + 28, true);
    const nome = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + tamNome));
    entradas.set(nome, { metodo: v.getUint16(pos + 10, true), tamanho: v.getUint32(pos + 20, true), deslocamento: v.getUint32(pos + 42, true) });
    pos += 46 + tamNome + v.getUint16(pos + 30, true) + v.getUint16(pos + 32, true);
  }

  async function conteudo({ metodo, tamanho, deslocamento }) {
    if (v.getUint32(deslocamento, true) !== 0x04034b50) throw falha('O arquivo está corrompido.');
    const ini = deslocamento + 30 + v.getUint16(deslocamento + 26, true) + v.getUint16(deslocamento + 28, true);
    const dados = bytes.subarray(ini, ini + tamanho);
    if (metodo === 0) return dados;
    if (metodo !== 8) throw falha('O arquivo usa uma compactação que não sei ler.');
    const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }

  return {
    existe: (nome) => entradas.has(nome),
    async texto(nome) {
      if (!entradas.has(nome)) throw falha(`Não parece uma planilha do Excel (falta "${nome}").`);
      return new TextDecoder().decode(await conteudo(entradas.get(nome)));
    },
  };
}

function lerXml(texto) {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw falha('O arquivo está corrompido (XML inválido).');
  return doc;
}
const todos = (no, nome) => [...no.getElementsByTagNameNS('*', nome)]; // ignora o prefixo do namespace
const filhos = (no, nome) => [...no.children].filter((f) => f.localName === nome);

const NS_RELACAO = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Formatos de número que o Excel considera data/hora. */
const FORMATOS_DE_DATA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function ehFormatoDeData(id, personalizados) {
  if (FORMATOS_DE_DATA.has(id)) return true;
  const codigo = personalizados.get(id);
  if (!codigo) return false;
  const semTextos = codigo.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ''); // tira textos entre aspas, escapes e [cores]/[h]
  return /[dmyhs]/i.test(semTextos) && !/^general$/i.test(semTextos);
}

/** Índices de estilo (atributo s das células) cujo formato é de data. */
async function estilosDeData(zip) {
  const datas = new Set();
  if (!zip.existe('xl/styles.xml')) return datas;
  const doc = lerXml(await zip.texto('xl/styles.xml'));
  const personalizados = new Map(todos(doc, 'numFmt').map((n) => [Number(n.getAttribute('numFmtId')), n.getAttribute('formatCode')]));
  const estilos = todos(doc, 'cellXfs')[0];
  if (estilos) filhos(estilos, 'xf').forEach((xf, i) => ehFormatoDeData(Number(xf.getAttribute('numFmtId')), personalizados) && datas.add(i));
  return datas;
}

/** Texto de um <si> ou <is>: junta os pedaços de texto formatado e ignora a pronúncia (rPh). */
const textoRico = (no) =>
  todos(no, 't')
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent)
    .join('');

async function textosCompartilhados(zip) {
  if (!zip.existe('xl/sharedStrings.xml')) return [];
  return todos(lerXml(await zip.texto('xl/sharedStrings.xml')), 'si').map(textoRico);
}

/** 45931 → '2025-10-05'; com fração de dia → '2025-10-05T14:30'; só hora → '14:30'. */
export function serialParaData(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  const p = (n) => String(n).padStart(2, '0');
  const hora = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  if (serial < 1) return hora;
  const data = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return Number.isInteger(serial) ? data : `${data}T${hora}`;
}

const colunaDe = (referencia) => [...referencia.replace(/\d+/g, '')].reduce((n, letra) => n * 26 + letra.charCodeAt(0) - 64, 0) - 1;

function valorDaCelula(c, textos, datas) {
  const tipo = c.getAttribute('t');
  const v = filhos(c, 'v')[0]?.textContent;
  let valor;
  switch (tipo) {
    case 's': valor = textos[Number(v)]; break;
    case 'inlineStr': valor = filhos(c, 'is')[0] ? textoRico(filhos(c, 'is')[0]) : null; break;
    case 'str': case 'd': valor = v; break;
    case 'b': return v === '1';
    case 'e': return null;
    default: {
      if (v === undefined || v === '') return null;
      const numero = Number(v);
      if (Number.isNaN(numero)) return v;
      return datas.has(Number(c.getAttribute('s') ?? 0)) ? serialParaData(numero) : numero;
    }
  }
  return valor === undefined || valor === '' ? null : valor;
}

function lerAba(doc, textos, datas) {
  const linhas = [];
  let proxima = 0;
  for (const linha of todos(doc, 'row')) {
    const indice = linha.getAttribute('r') ? Number(linha.getAttribute('r')) - 1 : proxima;
    proxima = indice + 1;
    const valores = [];
    let coluna = 0;
    for (const c of filhos(linha, 'c')) {
      const referencia = c.getAttribute('r');
      coluna = referencia ? colunaDe(referencia) : coluna;
      valores[coluna] = valorDaCelula(c, textos, datas);
      coluna++;
    }
    linhas[indice] = valores;
  }
  // O Excel não grava linhas vazias (as que faltam são buracos na lista): a largura é calculada sem espalhar a lista,
  // porque espalhar um buraco dá `undefined` e `Math.max(…, undefined)` dá NaN.
  const largura = linhas.reduce((maior, l) => Math.max(maior, l?.length ?? 0), 0);
  return Array.from({ length: linhas.length }, (_, i) => Array.from({ length: largura }, (_, j) => linhas[i]?.[j] ?? null));
}

/** @param {ArrayBuffer} buffer */
export async function lerXlsx(buffer) {
  const zip = await abrirZip(buffer);
  const livro = lerXml(await zip.texto('xl/workbook.xml'));
  const relacoes = new Map(
    todos(lerXml(await zip.texto('xl/_rels/workbook.xml.rels')), 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]),
  );
  const [textos, datas] = await Promise.all([textosCompartilhados(zip), estilosDeData(zip)]);

  const abas = [];
  for (const aba of todos(livro, 'sheet')) {
    const id = aba.getAttributeNS(NS_RELACAO, 'id') ?? aba.getAttribute('r:id');
    const alvo = relacoes.get(id);
    if (!alvo) continue;
    const caminho = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo}`;
    abas.push({ nome: aba.getAttribute('name'), linhas: lerAba(lerXml(await zip.texto(caminho)), textos, datas) });
  }
  if (!abas.length) throw falha('A planilha não tem nenhuma aba.');
  return abas;
}
