/**
 * Planilhas FICTÍCIAS para os testes. Nada aqui é de pessoa real: os nomes, CPFs e e-mails são inventados
 * (os CPFs têm dígitos verificadores válidos, mas não pertencem a ninguém de propósito).
 *
 * criarXlsx monta um .xlsx de verdade (zip + XML) na memória, para o leitor de planilhas ser testado com o formato real.
 */

// ---------------------------------------------------------------------------
// Escrever um .xlsx
// ---------------------------------------------------------------------------
const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

async function comprimir(bytes) {
  const fluxo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/** @param {Array<{ nome: string, texto: string }>} arquivos */
async function criarZip(arquivos) {
  const codificar = new TextEncoder();
  const partes = [];
  const central = [];
  let deslocamento = 0;
  for (const { nome, texto } of arquivos) {
    const dados = codificar.encode(texto);
    const comprimidos = await comprimir(dados);
    const nomeBytes = codificar.encode(nome);
    const crc = crc32(dados);

    const local = new Uint8Array(30 + nomeBytes.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(8, 8, true); // método: deflate
    l.setUint16(12, 0x21, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, comprimidos.length, true);
    l.setUint32(22, dados.length, true);
    l.setUint16(26, nomeBytes.length, true);
    local.set(nomeBytes, 30);

    const entrada = new Uint8Array(46 + nomeBytes.length);
    const c = new DataView(entrada.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(10, 8, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, comprimidos.length, true);
    c.setUint32(24, dados.length, true);
    c.setUint16(28, nomeBytes.length, true);
    c.setUint32(42, deslocamento, true);
    entrada.set(nomeBytes, 46);

    partes.push(local, comprimidos);
    central.push(entrada);
    deslocamento += local.length + comprimidos.length;
  }
  const tamanhoCentral = central.reduce((n, e) => n + e.length, 0);
  const fim = new Uint8Array(22);
  const f = new DataView(fim.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, arquivos.length, true);
  f.setUint16(10, arquivos.length, true);
  f.setUint32(12, tamanhoCentral, true);
  f.setUint32(16, deslocamento, true);

  const saida = new Uint8Array(deslocamento + tamanhoCentral + 22);
  let pos = 0;
  for (const parte of [...partes, ...central, fim]) {
    saida.set(parte, pos);
    pos += parte.length;
  }
  return saida;
}

const escaparXml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const letra = (i) => (i >= 26 ? letra(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const serialDe = (iso) => Math.round((Date.UTC(...iso.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) - Date.UTC(1899, 11, 30)) / 86400000);

/**
 * Um .xlsx com as abas dadas. Em cada célula: texto, número, true/false, null (vazia) ou { data: 'AAAA-MM-DD' }
 * (célula numérica com formato de data, como o Excel grava).
 * @param {Array<{ nome: string, linhas: unknown[][] }>} abas
 * @returns {Promise<File>}
 */
export async function criarXlsx(abas, nomeDoArquivo = 'planilha.xlsx') {
  const textos = [];
  const indiceDe = (t) => {
    const i = textos.indexOf(t);
    return i >= 0 ? i : textos.push(t) - 1;
  };
  const folhas = abas.map(({ linhas }) => {
    const xmlLinhas = linhas.map((linha, i) => {
      const celulas = linha
        .map((valor, j) => {
          const ref = `${letra(j)}${i + 1}`;
          if (valor === null || valor === undefined) return '';
          if (typeof valor === 'number') return `<c r="${ref}"><v>${valor}</v></c>`;
          if (typeof valor === 'boolean') return `<c r="${ref}" t="b"><v>${valor ? 1 : 0}</v></c>`;
          if (typeof valor === 'object' && valor.data) return `<c r="${ref}" s="1"><v>${serialDe(valor.data)}</v></c>`;
          return `<c r="${ref}" t="s"><v>${indiceDe(String(valor))}</v></c>`;
        })
        .join('');
      return `<row r="${i + 1}">${celulas}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlLinhas.join('')}</sheetData></worksheet>`;
  });

  const arquivos = [
    { nome: '[Content_Types].xml', texto: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
    { nome: '_rels/.rels', texto: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    {
      nome: 'xl/workbook.xml',
      texto: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${abas
        .map((a, i) => `<sheet name="${escaparXml(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      texto: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    },
    {
      nome: 'xl/styles.xml',
      texto: '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    },
    ...folhas.map((texto, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, texto })),
  ];
  // por último, porque os textos só são conhecidos depois de montar as folhas
  arquivos.push({
    nome: 'xl/sharedStrings.xml',
    texto: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${textos.map((t) => `<si><t xml:space="preserve">${escaparXml(t)}</t></si>`).join('')}</sst>`,
  });
  return new File([await criarZip(arquivos)], nomeDoArquivo);
}

// ---------------------------------------------------------------------------
// Dados fictícios no formato das exportações do sistema oficial
// ---------------------------------------------------------------------------

/** CPF com dígitos verificadores corretos a partir de 9 dígitos. */
export function cpfDe(base) {
  const digitos = String(base).padStart(9, '0').split('').map(Number);
  const dv = (lista) => {
    const soma = lista.reduce((s, d, i) => s + d * (lista.length + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = dv(digitos);
  const d2 = dv([...digitos, d1]);
  return [...digitos, d1, d2].join('');
}

export const CABECALHO_LISTAGEM = [
  'Numero de Inscrição', 'Id do candidato', 'Status do Candidato', 'Nome do Candidato', 'Email do Candidato', 'CPF do Candidato',
  'Data de Nascimento', 'Raça', 'Possui Alguma deficiência?', 'Qual deficiência?', 'Programa Social?', 'Qual programa social?',
  'Reside em MCMV?', 'Qual MCMV', 'Telefone do candidato', 'Whatsapp do Candidato', 'Cep do Candidato', 'Rua do Candidato',
  'Bairro do Candidato', 'Cidade do Candidato', 'Estado do Candidato', 'Horário do curso', 'Polo do curso', 'Nome do curso', 'Data de Inscrição',
];

const HORARIO_NOITE = 'Terça, Quarta e Quinta-feira - 18:00 às 21:00';
const HORARIO_TARDE = 'Segunda e Sexta-feira - 14:00 às 17:00';
const POLO_SEDE = 'Sede da Incubadora de Inovação Social em Cultura';
const POLO_BAIRRO = 'Casa de Cultura do Bairro Novo';

/** Uma linha de listagem; o que não for dado fica em branco. */
export function linhaListagem(o) {
  const v = { situacao: 'Ativo', raca: '', deficiencia: '', deficienciaQual: '', programa: '', programaQual: '', mcmv: '', mcmvQual: '', bairro: 'Centro', cidade: 'Sertópolis', ...o };
  return [
    v.inscricao, v.id, v.situacao, v.nome, v.email, v.cpf, v.nascimento, v.raca, v.deficiencia, v.deficienciaQual, v.programa, v.programaQual,
    v.mcmv, v.mcmvQual, '(11) 3000-0000', v.whatsapp ?? '(11) 90000-0000', '00000-000', 'Rua das Flores', v.bairro, v.cidade, 'SP',
    v.horario, v.polo, v.curso, v.inscritoEm,
  ];
}

/** Oito pessoas fictícias em duas turmas (noite e tarde), do mesmo curso, mais uma desistente. */
export function linhasDaListagem() {
  const noite = { horario: HORARIO_NOITE, polo: POLO_SEDE, curso: '2026.1 - Audiovisual para Mulheres', inscritoEm: '10/02/2026' };
  const tarde = { horario: HORARIO_TARDE, polo: POLO_BAIRRO, curso: '2026.1 - Audiovisual para Mulheres', inscritoEm: '12/02/2026' };
  return [
    ['Relatório de candidatos'], // linha de título antes dos títulos das colunas, como alguns sistemas exportam
    [],
    CABECALHO_LISTAGEM,
    linhaListagem({ ...noite, inscricao: 'QM00001', id: 9001, nome: 'MARIA DAS GRAÇAS EXEMPLO', email: 'Maria@Exemplo.com', cpf: cpfDe(100000001), nascimento: '12/04/1990', raca: 'Parda', deficiencia: 'Não', programa: 'Sim', programaQual: 'Bolsa Família', mcmv: 'Não' }),
    linhaListagem({ ...noite, inscricao: 'QM00002', id: 9002, nome: 'JOANA EXEMPLAR DA SILVA', email: 'joana@exemplo.com', cpf: cpfDe(100000002), nascimento: '03/11/1985', raca: 'Preta', deficiencia: 'Sim', deficienciaQual: 'Visual', programa: 'Não', mcmv: 'Sim', mcmvQual: 'Residencial Esperança' }),
    linhaListagem({ ...noite, inscricao: 'QM00003', id: 9003, nome: 'ANA FICTÍCIA PEREIRA', email: 'ana@exemplo.com', cpf: cpfDe(100000003), nascimento: '25/07/2001', raca: 'Branca', deficiencia: 'Não', programa: 'Não', mcmv: 'Não', bairro: 'Jardim das Rosas' }),
    linhaListagem({ ...noite, inscricao: 'QM00004', id: 9004, nome: 'LUCIA DE TESTE MOURA', email: 'lucia@exemplo.com', cpf: cpfDe(100000004), nascimento: '30/01/1978', raca: 'Parda', deficiencia: 'Não', programa: 'Sim', programaQual: 'BPC', mcmv: 'Não' }),
    linhaListagem({ ...tarde, inscricao: 'QM00005', id: 9005, nome: 'CARLA MODELO ANDRADE', email: 'carla@exemplo.com', cpf: cpfDe(100000005), nascimento: '09/09/1995', raca: 'Amarela', deficiencia: 'Não', programa: 'Não', mcmv: 'Não' }),
    linhaListagem({ ...tarde, inscricao: 'QM00006', id: 9006, nome: 'BEATRIZ AMOSTRA LIMA', email: 'bea@exemplo.com', cpf: cpfDe(100000006), nascimento: '18/12/1999', raca: 'Parda', deficiencia: 'Não', programa: 'Sim', programaQual: 'Bolsa Família', mcmv: 'Sim', mcmvQual: 'Residencial Esperança', cidade: 'Vila Nova' }),
    linhaListagem({ ...tarde, inscricao: 'QM00007', id: 9007, nome: 'PAULA SIMULADA REIS', email: 'paula@exemplo.com', cpf: cpfDe(100000007), nascimento: '14/05/1988', raca: 'Indígena', deficiencia: 'Não', programa: 'Não', mcmv: 'Não', situacao: 'Desistente' }),
    // a mesma pessoa da primeira linha, agora inscrita também na turma da tarde (mesmo Id do candidato)
    linhaListagem({ ...tarde, inscricao: 'QM00008', id: 9001, nome: 'MARIA DAS GRAÇAS EXEMPLO', email: 'maria@exemplo.com', cpf: cpfDe(100000001), nascimento: '12/04/1990', raca: 'Parda', deficiencia: 'Não', programa: 'Sim', programaQual: 'Bolsa Família', mcmv: 'Não' }),
  ];
}

/** Lista de frequência da turma da noite: 3 aulas (a 3ª com a data como célula de data do Excel). */
export function linhasDaFrequencia() {
  return [
    [],
    ['Turma', `2026.1 - Audiovisual para Mulheres - ${POLO_SEDE} - ${HORARIO_NOITE}`],
    [],
    ['Inscrição', 'Nome', 'Situação', 'Observações', '05/10/2026', '06/10/2026', { data: '2026-10-07' }, 'Total de faltas'],
    ['QM00001', 'MARIA DAS GRAÇAS EXEMPLO', 'Ativo', '', 'Presente', 'Presente', 'Presente', 0],
    ['QM00002', 'JOANA EXEMPLAR DA SILVA', 'Ativo', 'Viaja às quartas', 'Faltou', 'Faltou', 'Faltou', 3],
    ['QM00003', 'ANA FICTÍCIA PEREIRA', 'Ativo', '', 'Presente', 'Faltou', 'Presente', 1],
    ['QM00004', 'LUCIA DE TESTE MOURA', 'Ativo', '', 'Faltou', 'Presente', 'Presente', 2], // total errado de propósito (a planilha diz 2, as marcas dizem 1)
    ['QM99999', 'PESSOA QUE NÃO ESTÁ NA LISTAGEM', 'Ativo', '', 'Presente', 'Presente', 'Presente', 0],
  ];
}
