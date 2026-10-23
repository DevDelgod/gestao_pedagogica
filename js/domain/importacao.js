/**
 * Importação das planilhas do sistema oficial — regras puras (sem Firebase, sem DOM, sem arquivos).
 *
 * Este sistema é SECUNDÁRIO: a inscrição, a seleção e a chamada acontecem no sistema oficial, e aqui entram as
 * exportações dele. Há dois tipos de planilha:
 *  - LISTAGEM: uma linha por inscrição (número de inscrição, pessoa, curso, polo, horário, situação, perfil…).
 *    Dela saem as pessoas, as matrículas e as turmas (o sistema oficial não exporta turmas: aqui elas são montadas
 *    agrupando período + curso + polo + horário);
 *  - FREQUÊNCIA: a grade de uma turma, uma linha por pessoa e uma coluna por aula (Presente / Faltou). É ligada à
 *    matrícula pelo número de inscrição.
 *
 * Reimportar é seguro: tudo tem identificador estável (Id do candidato, número de inscrição, data da aula), então
 * a mesma planilha atualiza em vez de duplicar. As funções daqui só calculam o PLANO (o que criar e o que atualizar);
 * quem grava é services/importacao.service.js.
 */
import { PRESENCA, STATUS_MATRICULA as S, STATUS_TURMA, DIAS_SEMANA, idAula, idMatricula, novaAula, novaMatricula, novaTurma, novoAluno, novoCurso } from '../models/schema.js';
import { cpfValido } from './cadastros.js';
import { recalcularMatriculas, resumoDaChamada } from './diario.js';
import { statusDoAluno } from './matricula.js';
import { nomeExibicao } from './pessoa.js';

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------
const p2 = (n) => String(n).padStart(2, '0');

/** Texto limpo: sem espaços repetidos nem nas pontas. Números viram texto. */
export const texto = (valor) => (valor === null || valor === undefined ? '' : String(valor).replace(/\s+/g, ' ').trim());

/** Para comparar rótulos, nomes e situações sem se importar com acento, caixa e pontuação. */
export const chaveDeTexto = (valor) =>
  texto(valor).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Identificador curto e estável de um texto (FNV-1a em base 36): dá ids iguais para os mesmos dados em qualquer reimportação. */
export function resumoDe(valor) {
  let h = 0x811c9dc5;
  for (const c of String(valor)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const PARTICULAS = /\s(Da|De|Do|Das|Dos|E)(?=\s)/g;

/** "ANA TERESA DA SILVA" → "Ana Teresa da Silva". Nomes que já têm minúsculas ficam como vieram. */
export function titularNome(valor) {
  const nome = texto(valor);
  if (!nome || nome !== nome.toUpperCase()) return nome;
  return nome
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, separador, letra) => separador + letra.toUpperCase())
    .replace(PARTICULAS, (particula) => particula.toLowerCase());
}

// ---------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------
function dataValida(ano, mes, dia) {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${String(ano).padStart(4, '0')}-${p2(mes)}-${p2(dia)}`;
}

/** '05/10/2026', '5/10/26', '2026-10-05', '2026-10-05T14:30', '05/10/2026 14:32' → 'AAAA-MM-DD'; o que não for data → null. */
export function lerData(valor) {
  const t = texto(valor);
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return dataValida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/.exec(t);
  if (m) return dataValida(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** Ano de dois dígitos vira 20xx; se isso cair no futuro numa data de nascimento, era 19xx. */
const corrigirSeculo = (iso, hoje) => (iso && iso > hoje ? `${Number(iso.slice(0, 4)) - 100}${iso.slice(4)}` : iso);

/** Sim/Não escritos de qualquer jeito → true, false ou null (sem resposta). */
export function lerSimNao(valor) {
  if (typeof valor === 'boolean') return valor;
  const t = chaveDeTexto(valor);
  if (!t) return null;
  if (/^(sim|s|yes|true|verdadeiro|possui|x)$/.test(t)) return true;
  if (/^(nao|n|no|false|falso|nenhum|nenhuma)$/.test(t)) return false;
  return null;
}

/** Um "Possui…?" mais o "Qual…?": { possui, qual } ou null quando a planilha não diz nada. */
export function lerOpcaoComDetalhe(possui, qual) {
  const detalhe = texto(qual);
  const semDetalhe = !detalhe || /^(nao|nenhum|nenhuma|n a|na)$/.test(chaveDeTexto(detalhe));
  let resposta = lerSimNao(possui);
  if (resposta === null && !semDetalhe) resposta = true; // escreveu qual, então possui
  if (resposta === null) return null;
  return { possui: resposta, qual: resposta && !semDetalhe ? detalhe : '' };
}

/** Só os dígitos do CPF. O Excel come os zeros à esquerda de CPF guardado como número: completa até 11. */
export function lerCpf(valor) {
  const digitos = texto(valor).replace(/\D/g, '');
  return digitos.length >= 9 && digitos.length < 11 ? digitos.padStart(11, '0') : digitos;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Situação (status) da matrícula
// ---------------------------------------------------------------------------

/**
 * A situação nossa que mais combina com o que o sistema oficial escreve, ou null se não der para ter certeza
 * (a tela então pede para a pessoa escolher, em vez de chutar). Sem texto nenhum: ativa.
 */
export function sugerirSituacao(statusExterno) {
  const t = chaveDeTexto(statusExterno);
  if (!t) return S.ATIVA;
  if (/\b(tranc|suspens)/.test(t)) return S.TRANCADA;
  if (/\b(evad|evas|desist|abandon)/.test(t)) return S.EVADIDA;
  if (/\b(conclu|formad|aprovad|certific|finaliz)/.test(t)) return S.CONCLUIDA;
  if (/\b(cancel|indefer|exclu|reprov|inativ|desclassific|elimin)/.test(t)) return S.CANCELADA;
  if (/^(ativ|cursand|matricul|regular|frequent|em curso|confirmad)/.test(t)) return S.ATIVA;
  return null;
}

// ---------------------------------------------------------------------------
// Reconhecer as colunas das planilhas
// ---------------------------------------------------------------------------

/** Cada campo, com os títulos de coluna que o sistema oficial pode usar (já sem acento nem pontuação). */
const COLUNAS_LISTAGEM = {
  numeroInscricao: ['numero de inscricao', 'numero da inscricao', 'n de inscricao', 'n inscricao', 'inscricao'],
  idCandidato: ['id do candidato', 'id candidato', 'id'],
  statusExterno: ['status do candidato', 'status', 'situacao'],
  nome: ['nome do candidato', 'nome'],
  email: ['email do candidato', 'e mail do candidato', 'email', 'e mail'],
  cpf: ['cpf do candidato', 'cpf'],
  dataNascimento: ['data de nascimento', 'nascimento'],
  raca: ['raca', 'raca cor', 'cor'],
  deficiencia: ['possui alguma deficiencia', 'possui deficiencia', 'deficiencia'],
  deficienciaQual: ['qual deficiencia'],
  programaSocial: ['programa social'],
  programaSocialQual: ['qual programa social'],
  mcmv: ['reside em mcmv', 'mcmv'],
  mcmvQual: ['qual mcmv'],
  telefone: ['telefone do candidato', 'telefone'],
  whatsapp: ['whatsapp do candidato', 'whatsapp'],
  cep: ['cep do candidato', 'cep'],
  rua: ['rua do candidato', 'rua', 'endereco'],
  bairro: ['bairro do candidato', 'bairro'],
  cidade: ['cidade do candidato', 'cidade'],
  estado: ['estado do candidato', 'estado', 'uf'],
  horario: ['horario do curso', 'horario'],
  polo: ['polo do curso', 'polo'],
  curso: ['nome do curso', 'curso'],
  dataInscricao: ['data de inscricao', 'inscrito em'],
};

/** { campo: índice da coluna } para os títulos encontrados nesta linha. */
function localizarColunas(linha, definicao) {
  const achadas = {};
  linha.forEach((celula, indice) => {
    const chave = chaveDeTexto(celula);
    if (!chave) return;
    for (const [campo, titulos] of Object.entries(definicao)) {
      if (achadas[campo] === undefined && titulos.includes(chave)) achadas[campo] = indice;
    }
  });
  return achadas;
}

/** Acha a linha de títulos de uma LISTAGEM (nas 20 primeiras linhas): { cabecalho, colunas } ou null. */
export function detectarListagem(linhas) {
  let melhor = null;
  for (let i = 0; i < Math.min(linhas.length, 20); i++) {
    const colunas = localizarColunas(linhas[i], COLUNAS_LISTAGEM);
    const quantas = Object.keys(colunas).length;
    const ehListagem = colunas.nome !== undefined && (colunas.curso !== undefined || colunas.numeroInscricao !== undefined) && quantas >= 4;
    if (ehListagem && (!melhor || quantas > melhor.quantas)) melhor = { cabecalho: i, colunas, quantas };
  }
  return melhor;
}

/** Acha a linha de títulos de uma planilha de FREQUÊNCIA (Inscrição, Nome… e uma coluna por data): ou null. */
export function detectarFrequencia(linhas) {
  for (let i = 0; i < Math.min(linhas.length, 20); i++) {
    const chaves = linhas[i].map(chaveDeTexto);
    const inscricao = chaves.findIndex((c) => c === 'inscricao' || c === 'numero de inscricao');
    const nome = chaves.indexOf('nome');
    if (inscricao < 0 || nome < 0) continue;
    const datas = [];
    linhas[i].forEach((celula, coluna) => {
      const data = coluna > nome ? lerData(celula) : null;
      if (data) datas.push({ coluna, data });
    });
    if (!datas.length) continue;
    return {
      cabecalho: i,
      inscricao,
      nome,
      situacao: chaves.indexOf('situacao'),
      observacoes: chaves.indexOf('observacoes'),
      totalFaltas: chaves.indexOf('total de faltas'),
      datas,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// LISTAGEM: ler as linhas
// ---------------------------------------------------------------------------

/** Os números que a planilha traz como inscrição ou id viram texto seguro para usar em id de documento. */
const seguroParaId = (valor) => texto(valor).replace(/[^A-Za-z0-9_-]/g, '');

/**
 * Lê as linhas de uma listagem e devolve registros já limpos: nome em maiúsculas vira nome próprio, CPF só dígitos,
 * datas em AAAA-MM-DD, sim/não em verdadeiro/falso. Linhas sem nome ou sem curso são ignoradas (e contadas).
 * @param {Array<Array<unknown>>} linhas
 * @param {{ cabecalho: number, colunas: Record<string, number> }} deteccao
 * @param {{ hoje: string }} contexto
 */
export function lerListagem(linhas, { cabecalho, colunas }, { hoje }) {
  const registros = [];
  const ignoradas = [];
  for (let i = cabecalho + 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.every((c) => texto(c) === '')) continue;
    const v = (campo) => (colunas[campo] === undefined ? null : l[colunas[campo]]);

    const nome = titularNome(v('nome'));
    const curso = texto(v('curso'));
    if (!nome || !curso) {
      ignoradas.push(i + 1);
      continue;
    }

    const email = texto(v('email')).toLowerCase();
    const cpf = lerCpf(v('cpf'));
    const nascimentoTexto = texto(v('dataNascimento'));
    const nascimento = corrigirSeculo(lerData(v('dataNascimento')), hoje);
    registros.push({
      linha: i + 1, // número da linha na planilha, para as mensagens
      numeroInscricao: seguroParaId(v('numeroInscricao')),
      idCandidato: seguroParaId(v('idCandidato')),
      statusExterno: texto(v('statusExterno')),
      nome,
      email,
      emailInvalido: Boolean(email) && !EMAIL.test(email),
      cpf,
      cpfInvalido: Boolean(cpf) && !cpfValido(cpf),
      dataNascimento: nascimento,
      nascimentoInvalido: Boolean(nascimentoTexto) && !nascimento,
      raca: texto(v('raca')),
      deficiencia: lerOpcaoComDetalhe(v('deficiencia'), v('deficienciaQual')),
      programaSocial: lerOpcaoComDetalhe(v('programaSocial'), v('programaSocialQual')),
      mcmv: lerOpcaoComDetalhe(v('mcmv'), v('mcmvQual')),
      telefone: texto(v('telefone')),
      whatsapp: texto(v('whatsapp')),
      endereco: { cep: texto(v('cep')), rua: texto(v('rua')), bairro: texto(v('bairro')), cidade: texto(v('cidade')), estado: texto(v('estado')) },
      horario: texto(v('horario')),
      polo: texto(v('polo')),
      curso,
      dataInscricao: lerData(v('dataInscricao')),
    });
  }
  return { registros, ignoradas };
}

/** Semestre de uma data: '2026-03-10' → '2026.1'; '2026-09-01' → '2026.2'. */
export const periodoDaData = (iso) => (iso ? `${iso.slice(0, 4)}.${Number(iso.slice(5, 7)) <= 6 ? 1 : 2}` : '');

/** O período mais comum entre as datas de inscrição (ou o de hoje), para sugerir quando o nome do curso não traz o período. */
export function sugerirPeriodo(registros, hoje) {
  const contagem = new Map();
  registros.forEach((r) => r.dataInscricao && contagem.set(periodoDaData(r.dataInscricao), (contagem.get(periodoDaData(r.dataInscricao)) ?? 0) + 1));
  return [...contagem].sort((a, b) => b[1] - a[1])[0]?.[0] ?? periodoDaData(hoje);
}

// ---------------------------------------------------------------------------
// Turma
// ---------------------------------------------------------------------------

const DIAS_POR_EXTENSO = [
  ['domingo', 'dom'],
  ['segunda', 'seg'],
  ['terca', 'ter'],
  ['quarta', 'qua'],
  ['quinta', 'qui'],
  ['sexta', 'sex'],
  ['sabado', 'sab'],
];

/** "Terça, Quarta e Quinta-feira - 18:00 às 21:00" → { diasSemana: ['ter','qua','qui'], horarioInicio: '18:00', horarioFim: '21:00' }. O que não der para ler fica vazio. */
export function lerHorario(valor) {
  const t = chaveDeTexto(valor);
  const diasSemana = DIAS_POR_EXTENSO.filter(([extenso]) => new RegExp(`\\b${extenso}`).test(t)).map(([, sigla]) => sigla);
  diasSemana.sort((a, b) => DIAS_SEMANA.indexOf(a) - DIAS_SEMANA.indexOf(b));
  const horas = [...texto(valor).matchAll(/(\d{1,2})\s*(?::|h)\s*(\d{2})?/gi)].map((m) => `${p2(Number(m[1]))}:${m[2] ?? '00'}`);
  const [inicio, fim] = horas.filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h));
  return { diasSemana, horarioInicio: inicio ?? '', horarioFim: fim && inicio && fim > inicio ? fim : '' };
}

const PERIODO_NO_NOME = /^\s*(\d{4}\.\d)\s*[-–—]\s*(.+)$/;

/**
 * A turma de uma linha: período + curso + polo + horário. Se o nome do curso já começa com o período
 * ("2026.1 - Audiovisual para Mulheres"), ele vale; senão vale o período padrão escolhido na importação.
 * O id é o mesmo em qualquer reimportação.
 */
export function descreverTurma({ curso, polo, horario }, periodoPadrao) {
  const m = PERIODO_NO_NOME.exec(curso);
  const periodo = m ? m[1] : periodoPadrao;
  const nomeCurso = texto(m ? m[2] : curso);
  const chave = [periodo, nomeCurso, polo, horario].map(chaveDeTexto).join('|');
  return {
    id: `t${resumoDe(chave)}`,
    chave,
    periodo,
    curso: nomeCurso,
    polo: texto(polo),
    horario: texto(horario),
    nome: [periodo, nomeCurso, polo, horario].map(texto).filter(Boolean).join(' - '),
  };
}

/** O curso a partir do nome. O id é o mesmo em qualquer reimportação. */
export const idDoCurso = (nome) => `c${resumoDe(chaveDeTexto(nome))}`;

/** "2026.1 - Audiovisual - Sede - Terça e Quinta - 18:00 às 21:00" → { periodo, curso, polo, horario }. Só serve de pista. */
export function interpretarTituloDaTurma(titulo) {
  const partes = texto(titulo).split(/\s+[-–—]\s+/);
  const temPeriodo = /^\d{4}\.\d$/.test(partes[0] ?? '');
  const [periodo, curso, polo, ...resto] = temPeriodo ? partes : ['', ...partes];
  return { periodo, curso: curso ?? '', polo: polo ?? '', horario: resto.join(' - ') };
}

// ---------------------------------------------------------------------------
// LISTAGEM: planejar o que criar e o que atualizar
// ---------------------------------------------------------------------------

const so = (objeto) => Object.fromEntries(Object.entries(objeto).filter(([, v]) => v !== null && v !== undefined && v !== ''));
const resumirLista = (itens, max = 5) => (itens.length > max ? `${itens.slice(0, max).join(', ')} e mais ${itens.length - max}` : itens.join(', '));

/** O que a linha traz sobre a PESSOA (o que está em branco não entra, para não apagar o que já existe). */
function camposDoAluno(r) {
  const endereco = so(r.endereco);
  return so({
    nome: r.nome,
    email: r.email,
    telefone: r.telefone,
    whatsapp: r.whatsapp,
    cpf: r.cpf,
    dataNascimento: r.dataNascimento,
    raca: r.raca,
    deficiencia: r.deficiencia,
    programaSocial: r.programaSocial,
    mcmv: r.mcmv,
    idExterno: r.idCandidato,
    endereco: Object.keys(endereco).length ? endereco : null,
  });
}

/**
 * @param {ReturnType<typeof lerListagem>['registros']} registros
 * @param {{ alunos: object[], matriculas: object[], turmas: object[], cursos: object[] }} existentes o que já está no sistema
 * @param {{ periodoPadrao: string, mapaStatus?: Record<string, string>, hoje: string }} opcoes
 *   `mapaStatus`: { chaveDoStatus: situação nossa } escolhido pela pessoa; vale mais que a sugestão automática
 */
export function planejarListagem(registros, existentes, { periodoPadrao, mapaStatus = {}, hoje }) {
  const porIdExterno = new Map();
  const porCpf = new Map();
  const porEmail = new Map();
  for (const a of existentes.alunos) {
    if (a.idExterno) porIdExterno.set(String(a.idExterno), a);
    if (a.cpf) porCpf.set(a.cpf, a);
    if (a.email) porEmail.set(a.email, a);
  }
  const cursosPorChave = new Map(existentes.cursos.map((c) => [chaveDeTexto(c.nome), c]));
  const turmasAtuais = new Map(existentes.turmas.map((t) => [t.id, t]));
  const matriculasAtuais = new Map(existentes.matriculas.map((m) => [m.id, m]));

  const situacoes = new Map(); // chave do status → { chave, rotulo, quantidade }
  const alunos = new Map(); // id → { id, existente, campos }
  const turmas = new Map(); // id → { id, descricao, cursoId, existente }
  const cursos = new Map(); // id → { id, nome, existente }
  const matriculas = new Map(); // id → { id, alunoId, turmaId, situacao, registro }
  const repetidas = [];
  const semIdentificacao = [];

  for (const r of registros) {
    // --- situação ---
    const chaveStatus = chaveDeTexto(r.statusExterno);
    const atual = situacoes.get(chaveStatus) ?? { chave: chaveStatus, rotulo: r.statusExterno || '(em branco)', quantidade: 0 };
    atual.quantidade++;
    situacoes.set(chaveStatus, atual);
    const situacao = mapaStatus[chaveStatus] ?? sugerirSituacao(r.statusExterno);

    // --- pessoa ---
    const existente = (r.idCandidato && porIdExterno.get(r.idCandidato)) || (r.cpf && porCpf.get(r.cpf)) || (r.email && porEmail.get(r.email)) || null;
    const idAluno =
      existente?.id ??
      (r.idCandidato ? `cand${r.idCandidato}` : r.cpf ? `cpf${r.cpf}` : r.email ? `em${resumoDe(r.email)}` : r.numeroInscricao ? `ins${resumoDe(r.numeroInscricao)}` : null);
    if (!idAluno) {
      semIdentificacao.push(r.linha);
      continue;
    }
    const aluno = alunos.get(idAluno) ?? { id: idAluno, existente, campos: {} };
    const campos = camposDoAluno(r);
    aluno.campos = { ...aluno.campos, ...campos, endereco: { ...aluno.campos.endereco, ...campos.endereco } };
    if (!Object.keys(aluno.campos.endereco).length) delete aluno.campos.endereco;
    alunos.set(idAluno, aluno);

    // --- curso e turma ---
    const descricao = descreverTurma(r, periodoPadrao);
    const cursoExistente = cursosPorChave.get(chaveDeTexto(descricao.curso));
    const idCurso = cursoExistente?.id ?? idDoCurso(descricao.curso);
    cursos.set(idCurso, { id: idCurso, nome: cursoExistente?.nome ?? descricao.curso, existente: cursoExistente ?? null });
    if (!turmas.has(descricao.id)) turmas.set(descricao.id, { id: descricao.id, descricao, cursoId: idCurso, existente: turmasAtuais.get(descricao.id) ?? null });

    // --- matrícula ---
    const idDaMatricula = idMatricula(descricao.id, idAluno);
    if (matriculas.has(idDaMatricula)) repetidas.push(r.numeroInscricao || `linha ${r.linha}`);
    matriculas.set(idDaMatricula, { id: idDaMatricula, alunoId: idAluno, turmaId: descricao.id, situacao, registro: r });
  }

  // --- situação de cada matrícula depois da importação (a que já existia e as deste arquivo) ---
  const finais = new Map(existentes.matriculas.map((m) => [m.id, { alunoId: m.alunoId, turmaId: m.turmaId, status: m.status }]));
  for (const m of matriculas.values()) finais.set(m.id, { alunoId: m.alunoId, turmaId: m.turmaId, status: m.situacao ?? S.ATIVA });
  const porAluno = new Map();
  const porTurma = new Map();
  for (const f of finais.values()) {
    porAluno.set(f.alunoId, [...(porAluno.get(f.alunoId) ?? []), f.status]);
    const t = porTurma.get(f.turmaId) ?? { total: 0, ativas: 0 };
    t.total++;
    if (f.status === S.ATIVA) t.ativas++;
    porTurma.set(f.turmaId, t);
  }

  // --- documentos ---
  const planoCursos = [...cursos.values()].map((c) => ({
    id: c.id,
    nome: c.nome,
    novo: !c.existente,
    dados: c.existente ? null : { ...novoCurso({ nome: c.nome }), origem: 'importacao' },
  }));

  const planoTurmas = [...turmas.values()].map((t) => {
    const { descricao, existente } = t;
    const contagem = porTurma.get(t.id) ?? { total: 0, ativas: 0 };
    const doNome = [...cursos.values()].find((c) => c.id === t.cursoId)?.nome ?? descricao.curso;
    const horario = lerHorario(descricao.horario);
    const novos = { cursoNome: doNome, polo: descricao.polo, periodo: descricao.periodo, horarioTexto: descricao.horario };
    return {
      id: t.id,
      nome: descricao.nome,
      descricao,
      novo: !existente,
      quantidade: [...matriculas.values()].filter((m) => m.turmaId === t.id).length,
      dados: existente
        ? { ...novos, vagas: Math.max(existente.vagas ?? 0, contagem.ativas), vagasOcupadas: contagem.ativas }
        : {
            ...novaTurma({
              ...novos,
              cursoId: t.cursoId,
              nome: descricao.nome,
              vagas: Math.max(1, contagem.total),
              status: STATUS_TURMA.EM_ANDAMENTO,
              ...horario,
              origem: 'importacao',
            }),
            vagasOcupadas: contagem.ativas,
          },
    };
  });

  const planoAlunos = [...alunos.values()].map((a) => {
    const status = statusDoAluno(porAluno.get(a.id) ?? [S.ATIVA]);
    const { existente, campos } = a;
    return {
      id: a.id,
      novo: !existente,
      nome: campos.nome,
      dados: existente
        ? { ...campos, ...(campos.endereco ? { endereco: { ...existente.endereco, ...campos.endereco } } : {}), status }
        : { ...novoAluno({ ...campos, origem: 'importacao', status }) },
    };
  });
  const planoMatriculas = [...matriculas.values()].map((m) => {
    const r = m.registro;
    const turma = turmas.get(m.turmaId);
    const aluno = alunos.get(m.alunoId);
    const nomeDoAluno = nomeExibicao({ nome: aluno.campos.nome, nomeSocial: aluno.existente?.nomeSocial });
    const existente = matriculasAtuais.get(m.id);
    const status = m.situacao ?? S.ATIVA;
    const externos = so({ numeroInscricao: r.numeroInscricao, statusExterno: r.statusExterno, dataInscricao: r.dataInscricao });
    return {
      id: m.id,
      novo: !existente,
      situacao: m.situacao,
      dados: existente
        ? { ...externos, status, alunoNome: nomeDoAluno }
        : novaMatricula({
            alunoId: m.alunoId,
            alunoNome: nomeDoAluno,
            turmaId: m.turmaId,
            turmaNome: turma.descricao.nome,
            cursoId: turma.cursoId,
            cursoNome: planoCursos.find((c) => c.id === turma.cursoId).nome,
            dataMatricula: r.dataInscricao ?? hoje,
            status,
            ...externos,
            origem: 'importacao',
          }),
    };
  });

  // --- avisos ---
  const avisos = [];
  const aviso = (textoDoAviso, nivel = 'aviso') => avisos.push({ nivel, texto: textoDoAviso });
  const listar = (filtro) => registros.filter(filtro).map((r) => r.numeroInscricao || `linha ${r.linha}`);
  const cpfs = listar((r) => r.cpfInvalido);
  if (cpfs.length) aviso(`${cpfs.length} CPF(s) com dígitos verificadores inválidos (inscrições: ${resumirLista(cpfs)}). Foram importados como vieram.`);
  const emails = listar((r) => r.emailInvalido);
  if (emails.length) aviso(`${emails.length} e-mail(s) em formato inválido (inscrições: ${resumirLista(emails)}).`);
  const nascimentos = listar((r) => r.nascimentoInvalido);
  if (nascimentos.length) aviso(`${nascimentos.length} data(s) de nascimento não reconhecida(s) (inscrições: ${resumirLista(nascimentos)}).`);
  if (semIdentificacao.length) aviso(`${semIdentificacao.length} linha(s) sem Id do candidato, CPF, e-mail nem número de inscrição foram ignoradas (linhas ${resumirLista(semIdentificacao)}).`);
  if (repetidas.length) aviso(`${repetidas.length} pessoa(s) aparecem mais de uma vez na mesma turma (inscrições: ${resumirLista(repetidas)}). Valeu a última linha.`);
  const semPolo = [...turmas.values()].filter((t) => !t.descricao.polo).length;
  if (semPolo) aviso(`${semPolo} turma(s) sem polo na planilha.`, 'info');

  const rotuloDeSituacao = [...situacoes.values()].map((s) => ({
    ...s,
    situacao: mapaStatus[s.chave] ?? sugerirSituacao(s.rotulo === '(em branco)' ? '' : s.rotulo),
  }));

  return {
    tipo: 'listagem',
    situacoes: rotuloDeSituacao,
    pendencias: rotuloDeSituacao.filter((s) => s.situacao === null).length,
    cursos: planoCursos,
    turmas: planoTurmas,
    alunos: planoAlunos,
    matriculas: planoMatriculas,
    avisos,
    resumo: {
      linhas: registros.length,
      alunosNovos: planoAlunos.filter((a) => a.novo).length,
      alunosAtualizados: planoAlunos.filter((a) => !a.novo).length,
      turmasNovas: planoTurmas.filter((t) => t.novo).length,
      turmasAtualizadas: planoTurmas.filter((t) => !t.novo).length,
      cursosNovos: planoCursos.filter((c) => c.novo).length,
      matriculasNovas: planoMatriculas.filter((m) => m.novo).length,
      matriculasAtualizadas: planoMatriculas.filter((m) => !m.novo).length,
    },
  };
}

// ---------------------------------------------------------------------------
// FREQUÊNCIA
// ---------------------------------------------------------------------------

/** "Presente" / "Faltou" (e variações) → 'P' / 'F' / 'J'; em branco → null; qualquer outra coisa → undefined. */
export function lerMarca(valor) {
  const t = chaveDeTexto(valor);
  if (!t) return null;
  if (/^(presente|presenca|p|c|compareceu)$/.test(t)) return PRESENCA.PRESENTE;
  if (/^(faltou|falta|f|ausente|a|nao compareceu)$/.test(t)) return PRESENCA.FALTA;
  if (/^(justificad|j|fj|falta justificada)/.test(t)) return PRESENCA.JUSTIFICADA;
  return undefined;
}

/** O que a planilha de frequência traz: a turma (texto da etapa), as datas e as marcas de cada pessoa. */
export function lerFrequencia(linhas, deteccao) {
  const { cabecalho, inscricao, nome, situacao, observacoes, totalFaltas, datas } = deteccao;
  let turmaTexto = '';
  for (let i = 0; i < cabecalho && !turmaTexto; i++) {
    const k = linhas[i].findIndex((c) => chaveDeTexto(c) === 'turma');
    if (k >= 0) turmaTexto = texto(linhas[i].slice(k + 1).find((c) => texto(c) !== ''));
  }

  const pessoas = [];
  const avisos = [];
  const desconhecidas = new Set();
  for (let i = cabecalho + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const numeroInscricao = seguroParaId(l[inscricao]);
    if (!numeroInscricao) {
      if (texto(l[nome])) avisos.push(`Linha ${i + 1}: "${texto(l[nome])}" sem número de inscrição foi ignorada.`);
      continue;
    }
    const marcas = datas.map(({ coluna }) => {
      const marca = lerMarca(l[coluna]);
      if (marca === undefined) {
        desconhecidas.add(texto(l[coluna]));
        return null;
      }
      return marca;
    });
    const total = totalFaltas >= 0 && typeof l[totalFaltas] === 'number' ? l[totalFaltas] : null;
    pessoas.push({
      linha: i + 1,
      numeroInscricao,
      nome: titularNome(l[nome]),
      situacao: situacao >= 0 ? texto(l[situacao]) : '',
      observacoes: observacoes >= 0 ? texto(l[observacoes]) : '',
      marcas,
      totalFaltas: total,
    });
  }
  if (desconhecidas.size) avisos.push(`Marcações que não reconheci (contadas como sem chamada): ${resumirLista([...desconhecidas].map((d) => `"${d}"`))}.`);
  return { turmaTexto, datas: datas.map((d) => d.data), pessoas, avisos };
}

const chaveDeInscricao = (valor) => texto(valor).toUpperCase().replace(/\s+/g, '');
const soDigitos = (valor) => texto(valor).replace(/\D/g, '');

/** Índice de matrículas pelo número de inscrição (inteiro, ou só os dígitos quando isso não for ambíguo). */
function indiceDeInscricoes(matriculas) {
  const exato = new Map();
  const digitos = new Map();
  for (const m of matriculas) {
    if (!m.numeroInscricao) continue;
    exato.set(chaveDeInscricao(m.numeroInscricao), m);
    const d = soDigitos(m.numeroInscricao).replace(/^0+/, '');
    if (d) digitos.set(d, digitos.has(d) ? null : m); // null = dois com os mesmos dígitos: não dá para usar
  }
  return (numero) => exato.get(chaveDeInscricao(numero)) ?? digitos.get(soDigitos(numero).replace(/^0+/, '')) ?? null;
}

/**
 * Descobre de qual turma é a planilha: pela maioria dos números de inscrição que já são matrículas conhecidas
 * (mais confiável) ou, na falta disso, pelo texto "Turma:" do topo. null se não achar.
 */
export function resolverTurmaDaFrequencia(leitura, { matriculas, turmas }) {
  const achar = indiceDeInscricoes(matriculas);
  const contagem = new Map();
  for (const p of leitura.pessoas) {
    const m = achar(p.numeroInscricao);
    if (m) contagem.set(m.turmaId, (contagem.get(m.turmaId) ?? 0) + 1);
  }
  if (contagem.size) {
    const [[turmaId, casadas]] = [...contagem].sort((a, b) => b[1] - a[1]);
    return { turmaId, casadas, pelaLista: true, emOutras: leitura.pessoas.length - casadas };
  }
  const alvo = chaveDeTexto(leitura.turmaTexto);
  const turma = alvo && turmas.find((t) => chaveDeTexto(t.nome) === alvo);
  return turma ? { turmaId: turma.id, casadas: 0, pelaLista: false, emOutras: leitura.pessoas.length } : null;
}

/**
 * O plano de uma planilha de frequência para UMA turma: as aulas a gravar (somando ao que já existe) e o resumo
 * de frequência e risco de evasão recalculado de todas as matrículas da turma.
 * @param {ReturnType<typeof lerFrequencia>} leitura
 * @param {{ turma: object, curso: object|null, matriculas: object[], aulas: object[] }} turmaAtual só o que é desta turma
 */
export function planejarFrequencia(leitura, { turma, curso, matriculas, aulas }) {
  const achar = indiceDeInscricoes(matriculas);
  const avisos = leitura.avisos.map((mensagem) => ({ nivel: 'aviso', texto: mensagem }));

  const casadas = [];
  const naoCasadas = [];
  for (const p of leitura.pessoas) {
    const m = achar(p.numeroInscricao);
    m ? casadas.push({ ...p, matricula: m }) : naoCasadas.push(p);
  }
  if (naoCasadas.length) {
    avisos.push({
      nivel: 'aviso',
      texto: `${naoCasadas.length} inscrição(ões) da planilha não são matrículas desta turma e foram ignoradas: ${resumirLista(naoCasadas.map((p) => `${p.numeroInscricao} (${p.nome})`))}. Importe a listagem antes.`,
    });
  }

  const divergentes = casadas.filter((p) => p.totalFaltas !== null && p.totalFaltas !== p.marcas.filter((m) => m === PRESENCA.FALTA).length);
  if (divergentes.length) {
    avisos.push({
      nivel: 'aviso',
      texto: `${divergentes.length} pessoa(s) com "Total de faltas" diferente das faltas marcadas (${resumirLista(divergentes.map((p) => p.numeroInscricao))}). Valeram as marcas das aulas.`,
    });
  }

  const aulasAtuais = new Map(aulas.map((a) => [a.data, a]));
  const planoAulas = [];
  leitura.datas.forEach((data, i) => {
    const marcadas = casadas.filter((p) => p.marcas[i] !== null);
    if (!marcadas.length) return;
    const atual = aulasAtuais.get(data);
    const registros = { ...(atual?.registros ?? {}) };
    marcadas.forEach((p) => (registros[p.matricula.alunoId] = p.marcas[i]));
    const resumo = resumoDaChamada(registros);
    planoAulas.push({
      id: idAula(turma.id, data),
      data,
      novo: !atual,
      registros,
      dados: atual ? { registros, resumo } : { ...novaAula({ turmaId: turma.id, data, registros }), resumo },
    });
  });

  const aulasFinais = [...aulas.filter((a) => !planoAulas.some((p) => p.data === a.data)), ...planoAulas].map((a) => ({ data: a.data, registros: a.registros }));
  const resumos = recalcularMatriculas({
    aulas: aulasFinais,
    matriculas: matriculas.map((m) => ({ id: m.id, alunoId: m.alunoId, status: m.status })),
    frequenciaMinima: curso?.frequenciaMinima,
  });

  return {
    tipo: 'frequencia',
    turmaId: turma.id,
    turmaNome: turma.nome,
    datas: leitura.datas,
    aulas: planoAulas,
    resumos,
    casadas: casadas.length,
    naoCasadas,
    avisos,
    resumo: {
      pessoas: leitura.pessoas.length,
      casadas: casadas.length,
      aulas: planoAulas.length,
      aulasNovas: planoAulas.filter((a) => a.novo).length,
      marcacoes: casadas.reduce((n, p) => n + p.marcas.filter((m) => m !== null).length, 0),
    },
  };
}
