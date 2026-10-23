/**
 * Análises de dados — regras puras (sem Firebase, sem DOM).
 *
 * Tudo parte de uma lista de LINHAS, uma por matrícula, já ligada à pessoa, à turma e ao curso:
 *   const linhas = juntar({ alunos, matriculas, turmas, cursos });
 *   const doFiltro = filtrar(linhas, { periodo: '2026.1', polo: 'Sede' });
 * e cada análise recebe as linhas (e as aulas, quando precisa) e devolve números prontos para a tela.
 *
 * Quatro perguntas, na ordem em que a equipe costuma fazê-las:
 *  - funil: quantas inscrições, e quantas seguem ativas, concluíram, evadiram ou foram canceladas;
 *  - perfil: quem são as pessoas (raça, deficiência, programa social, MCMV, idade, onde moram);
 *  - frequência: quem falta, onde e quando, e quem está em risco de evasão;
 *  - comparar: o mesmo olhar lado a lado entre cursos, polos, períodos, horários ou turmas.
 */
import { PRESENCA, STATUS_MATRICULA as S } from '../models/schema.js';
import { idadeEm } from './cadastros.js';
import { chaveDeTexto, texto } from './importacao.js';
import { LIMITES } from './regras.js';

export const percentual = (parte, total) => (total ? Math.round((parte / total) * 1000) / 10 : 0);
const media = (lista, casas = 1) => {
  if (!lista.length) return null;
  const f = 10 ** casas;
  return Math.round((lista.reduce((s, n) => s + n, 0) / lista.length) * f) / f;
};

// ---------------------------------------------------------------------------
// Base: ligar matrícula, pessoa, turma e curso
// ---------------------------------------------------------------------------

/**
 * Uma linha por matrícula. Matrícula cuja turma não existe mais é deixada de fora (não há como situá-la).
 * @returns {Array<{ m: object, aluno: object|null, turma: object, curso: object|null }>}
 */
export function juntar({ alunos, matriculas, turmas, cursos }) {
  const aluno = new Map(alunos.map((a) => [a.id, a]));
  const turma = new Map(turmas.map((t) => [t.id, t]));
  const curso = new Map(cursos.map((c) => [c.id, c]));
  return matriculas
    .filter((m) => turma.has(m.turmaId))
    .map((m) => ({ m, aluno: aluno.get(m.alunoId) ?? null, turma: turma.get(m.turmaId), curso: curso.get(turma.get(m.turmaId).cursoId) ?? null }));
}

/** @param {{ periodo?: string, cursoId?: string, polo?: string, turmaId?: string, situacao?: string }} filtros vazio = sem filtro */
export function filtrar(linhas, { periodo = '', cursoId = '', polo = '', turmaId = '', situacao = '' } = {}) {
  return linhas.filter(
    ({ m, turma }) =>
      (!periodo || turma.periodo === periodo) &&
      (!cursoId || turma.cursoId === cursoId) &&
      (!polo || turma.polo === polo) &&
      (!turmaId || turma.id === turmaId) &&
      (!situacao || m.status === situacao),
  );
}

/** As opções dos filtros que as linhas oferecem, em ordem. */
export function opcoesDeFiltro(linhas) {
  const unicos = (valores) => [...new Set(valores.filter(Boolean))];
  const turmas = new Map(linhas.map(({ turma }) => [turma.id, turma.nome]));
  const cursos = new Map(linhas.map(({ turma }) => [turma.cursoId, turma.cursoNome]));
  return {
    periodos: unicos(linhas.map(({ turma }) => turma.periodo)).sort().reverse(),
    cursos: [...cursos].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    polos: unicos(linhas.map(({ turma }) => turma.polo)).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    turmas: [...turmas].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  };
}

/** Cada pessoa uma vez só, mesmo com várias matrículas nas linhas. */
export function pessoasUnicas(linhas) {
  const vistas = new Map();
  for (const { aluno } of linhas) if (aluno && !vistas.has(aluno.id)) vistas.set(aluno.id, aluno);
  return [...vistas.values()];
}

// ---------------------------------------------------------------------------
// Contagens por categoria
// ---------------------------------------------------------------------------

/**
 * "PARDA" e "parda" são a mesma categoria: aparece com a primeira letra maiúscula e o resto minúsculo.
 * Sigla curta em maiúsculas (BPC, CRAS) fica como está; o que já mistura maiúsculas e minúsculas também.
 */
const embelezar = (t) => {
  const sigla = t === t.toUpperCase() && t.length <= 4 && !t.includes(' ');
  return !sigla && (t === t.toUpperCase() || t === t.toLowerCase()) ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t;
};

/**
 * Conta quantas vezes cada valor aparece, sem se importar com acento, caixa e espaços.
 * "Não informado" (valores em branco) vai sempre por último; `limite` junta o resto em "Outros".
 * @returns {Array<{ rotulo: string, quantidade: number, percentual: number }>}
 */
export function distribuir(valores, { rotuloVazio = 'Não informado', limite = 0 } = {}) {
  const grupos = new Map();
  for (const bruto of valores) {
    const t = texto(bruto);
    const chave = t ? chaveDeTexto(t) : '';
    const grupo = grupos.get(chave) ?? { rotulo: t ? embelezar(t) : rotuloVazio, quantidade: 0, vazio: !t };
    grupo.quantidade++;
    grupos.set(chave, grupo);
  }
  let itens = [...grupos.values()].sort((a, b) => a.vazio - b.vazio || b.quantidade - a.quantidade || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  const vazio = itens.filter((i) => i.vazio);
  itens = itens.filter((i) => !i.vazio);
  if (limite && itens.length > limite) {
    const resto = itens.slice(limite);
    itens = [...itens.slice(0, limite), { rotulo: `Outros (${resto.length})`, quantidade: resto.reduce((s, i) => s + i.quantidade, 0) }];
  }
  return [...itens, ...vazio].map(({ rotulo, quantidade }) => ({ rotulo, quantidade, percentual: percentual(quantidade, valores.length) }));
}

const FAIXAS = [
  { rotulo: 'Menos de 18', ate: 17 },
  { rotulo: '18 a 24', ate: 24 },
  { rotulo: '25 a 34', ate: 34 },
  { rotulo: '35 a 44', ate: 44 },
  { rotulo: '45 a 59', ate: 59 },
  { rotulo: '60 ou mais', ate: Infinity },
];

const faixaEtaria = (nascimento, hoje) => {
  if (!nascimento) return null;
  const idade = idadeEm(nascimento, hoje);
  return idade < 0 ? null : FAIXAS.find((f) => idade <= f.ate).rotulo;
};

/** "Bolsa Família; BPC" → ["Bolsa Família", "BPC"]. */
const dividir = (valor) => texto(valor).split(/[;,]/).map(texto).filter(Boolean);

const simNao = (opcao) => (opcao?.possui === true ? 'Sim' : opcao?.possui === false ? 'Não' : null);

// ---------------------------------------------------------------------------
// Funil
// ---------------------------------------------------------------------------

const SITUACOES = Object.values(S);

/** Inscrições por situação (a nossa e a escrita pelo sistema oficial) e a taxa de evasão. */
export function funil(linhas) {
  const porSituacao = Object.fromEntries(SITUACOES.map((s) => [s, linhas.filter(({ m }) => m.status === s).length]));
  const total = linhas.length;
  return {
    inscricoes: total,
    pessoas: pessoasUnicas(linhas).length,
    turmas: new Set(linhas.map(({ turma }) => turma.id)).size,
    porSituacao,
    taxaEvasao: percentual(porSituacao[S.EVADIDA], total),
    taxaConclusao: percentual(porSituacao[S.CONCLUIDA], total),
    situacoesExternas: distribuir(linhas.map(({ m }) => m.statusExterno), { rotuloVazio: '(sem situação)' }),
  };
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

/** Quem são as pessoas das linhas (cada uma conta uma vez só). */
export function perfil(linhas, { hoje }) {
  const pessoas = pessoasUnicas(linhas);
  const faixas = distribuir(pessoas.map((a) => faixaEtaria(a.dataNascimento, hoje)), { rotuloVazio: 'Não informada' });
  const ordem = FAIXAS.map((f) => f.rotulo);
  faixas.sort((a, b) => (ordem.indexOf(a.rotulo) + 1 || 99) - (ordem.indexOf(b.rotulo) + 1 || 99));
  const idades = pessoas.filter((a) => a.dataNascimento).map((a) => idadeEm(a.dataNascimento, hoje)).filter((i) => i >= 0);

  return {
    pessoas: pessoas.length,
    idadeMedia: media(idades),
    faixaEtaria: faixas,
    raca: distribuir(pessoas.map((a) => a.raca)),
    deficiencia: distribuir(pessoas.map((a) => simNao(a.deficiencia))),
    deficienciaQual: distribuir(pessoas.filter((a) => a.deficiencia?.possui).flatMap((a) => dividir(a.deficiencia.qual).length ? dividir(a.deficiencia.qual) : [null]), { rotuloVazio: 'Não especificada', limite: 8 }),
    programaSocial: distribuir(pessoas.map((a) => simNao(a.programaSocial))),
    programaSocialQual: distribuir(pessoas.filter((a) => a.programaSocial?.possui).flatMap((a) => dividir(a.programaSocial.qual).length ? dividir(a.programaSocial.qual) : [null]), { rotuloVazio: 'Não especificado', limite: 8 }),
    mcmv: distribuir(pessoas.map((a) => simNao(a.mcmv))),
    mcmvQual: distribuir(pessoas.filter((a) => a.mcmv?.possui).flatMap((a) => dividir(a.mcmv.qual).length ? dividir(a.mcmv.qual) : [null]), { rotuloVazio: 'Não especificado', limite: 8 }),
    cidades: distribuir(pessoas.map((a) => a.endereco?.cidade), { limite: 10 }),
    bairros: distribuir(pessoas.map((a) => a.endereco?.bairro), { limite: 10 }),
  };
}

// ---------------------------------------------------------------------------
// Frequência e evasão
// ---------------------------------------------------------------------------

const temChamada = ({ m }) => (m.frequencia?.aulas ?? 0) > 0;
const abaixoDoMinimo = ({ m, curso }) => m.frequencia.percentual < (curso?.frequenciaMinima ?? LIMITES.frequenciaMinima);

/** Datas 'AAAA-MM-DD' → dia da semana 0 (domingo) a 6, sem passar pelo fuso. */
const diaDaSemana = (iso) => {
  const [a, mes, d] = iso.split('-').map(Number);
  return new Date(a, mes - 1, d).getDay();
};
const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Presença é presente ou falta justificada (como no cálculo da frequência da matrícula). */
const marcaPresente = (marca) => marca === PRESENCA.PRESENTE || marca === PRESENCA.JUSTIFICADA;

/**
 * @param {Array} linhas
 * @param {Array<{ turmaId: string, data: string, registros: Record<string, string> }>} aulas as aulas das turmas das linhas
 */
export function frequencia(linhas, aulas) {
  const ativas = linhas.filter(({ m }) => m.status === S.ATIVA);
  const comChamada = linhas.filter(temChamada);
  const ativasComChamada = ativas.filter(temChamada);

  const porTurma = new Map();
  for (const linha of linhas) {
    const t = porTurma.get(linha.turma.id) ?? { turma: linha.turma, linhas: [] };
    t.linhas.push(linha);
    porTurma.set(linha.turma.id, t);
  }
  const turmas = [...porTurma.values()].map(({ turma, linhas: doGrupo }) => {
    const ativasDoGrupo = doGrupo.filter(({ m }) => m.status === S.ATIVA);
    const comChamadaDoGrupo = doGrupo.filter(temChamada);
    return {
      turmaId: turma.id,
      nome: turma.nome,
      curso: turma.cursoNome,
      polo: turma.polo || '',
      periodo: turma.periodo || '',
      matriculas: doGrupo.length,
      ativas: ativasDoGrupo.length,
      evadidas: doGrupo.filter(({ m }) => m.status === S.EVADIDA).length,
      aulas: aulas.filter((a) => a.turmaId === turma.id).length,
      frequenciaMedia: media(comChamadaDoGrupo.map(({ m }) => m.frequencia.percentual)),
      emRisco: ativasDoGrupo.filter(({ m }) => m.riscoEvasao).length,
      abaixoDoMinimo: ativasDoGrupo.filter((l) => temChamada(l) && abaixoDoMinimo(l)).length,
    };
  });
  turmas.sort((a, b) => (a.frequenciaMedia ?? 101) - (b.frequenciaMedia ?? 101) || a.nome.localeCompare(b.nome, 'pt-BR'));

  return {
    matriculas: linhas.length,
    ativas: ativas.length,
    comChamada: comChamada.length,
    aulas: aulas.length,
    frequenciaMedia: media(comChamada.map(({ m }) => m.frequencia.percentual)),
    frequenciaMediaAtivas: media(ativasComChamada.map(({ m }) => m.frequencia.percentual)),
    emRisco: ativas.filter(({ m }) => m.riscoEvasao).length,
    abaixoDoMinimo: ativasComChamada.filter(abaixoDoMinimo).length,
    turmas,
    curva: curvaDePresenca(aulas),
    diasDaSemana: presencaPorDiaDaSemana(aulas),
  };
}

/**
 * Presença na 1ª aula, na 2ª, na 3ª…, juntando todas as turmas. É a "curva de evasão": costuma cair com o tempo, e
 * mostra em que aula a turma começa a esvaziar.
 */
export function curvaDePresenca(aulas) {
  const porTurma = new Map();
  for (const aula of aulas) porTurma.set(aula.turmaId, [...(porTurma.get(aula.turmaId) ?? []), aula]);
  const pontos = [];
  for (const doTurma of porTurma.values()) {
    doTurma.sort((a, b) => a.data.localeCompare(b.data)).forEach((aula, i) => {
      const marcas = Object.values(aula.registros ?? {});
      const ponto = (pontos[i] ??= { marcados: 0, presentes: 0, turmas: 0 });
      ponto.marcados += marcas.length;
      ponto.presentes += marcas.filter(marcaPresente).length;
      ponto.turmas++;
    });
  }
  return pontos.map((p, i) => ({ numero: i + 1, turmas: p.turmas, marcados: p.marcados, presenca: percentual(p.presentes, p.marcados) }));
}

/** Presença por dia da semana (só os dias em que houve aula). */
export function presencaPorDiaDaSemana(aulas) {
  const dias = new Map();
  for (const aula of aulas) {
    const marcas = Object.values(aula.registros ?? {});
    const dia = dias.get(diaDaSemana(aula.data)) ?? { aulas: 0, marcados: 0, presentes: 0 };
    dia.aulas++;
    dia.marcados += marcas.length;
    dia.presentes += marcas.filter(marcaPresente).length;
    dias.set(diaDaSemana(aula.data), dia);
  }
  return [...dias]
    .sort((a, b) => a[0] - b[0])
    .map(([indice, d]) => ({ dia: NOMES_DIAS[indice], aulas: d.aulas, marcados: d.marcados, presenca: percentual(d.presentes, d.marcados) }));
}

/** Matrículas ativas em risco de evasão, das mais urgentes (mais faltas seguidas, menor frequência) para as menos. */
export function pessoasEmRisco(linhas) {
  return linhas
    .filter(({ m }) => m.status === S.ATIVA && m.riscoEvasao)
    .map(({ m, aluno, turma }) => ({
      nome: m.alunoNome,
      numeroInscricao: m.numeroInscricao ?? '',
      turma: turma.nome,
      curso: turma.cursoNome,
      polo: turma.polo || '',
      aulas: m.frequencia?.aulas ?? 0,
      faltas: m.frequencia?.faltas ?? 0,
      faltasConsecutivas: m.frequencia?.faltasConsecutivas ?? 0,
      frequencia: m.frequencia?.percentual ?? 100,
      telefone: aluno?.whatsapp || aluno?.telefone || '',
      email: aluno?.email ?? '',
    }))
    .sort((a, b) => b.faltasConsecutivas - a.faltasConsecutivas || a.frequencia - b.frequencia || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Comparar
// ---------------------------------------------------------------------------

/** Como agrupar: cada chave devolve [identificador, texto a mostrar]. */
export const AGRUPAMENTOS = {
  curso: { rotulo: 'Curso', chave: ({ turma }) => [turma.cursoId, turma.cursoNome] },
  polo: { rotulo: 'Polo', chave: ({ turma }) => [turma.polo || '', turma.polo || '(sem polo)'] },
  periodo: { rotulo: 'Período', chave: ({ turma }) => [turma.periodo || '', turma.periodo || '(sem período)'] },
  horario: { rotulo: 'Horário', chave: ({ turma }) => [chaveDeTexto(turma.horarioTexto), turma.horarioTexto || '(sem horário)'] },
  turma: { rotulo: 'Turma', chave: ({ turma }) => [turma.id, turma.nome] },
};

/**
 * Uma linha por grupo, com os mesmos números lado a lado. As porcentagens de perfil consideram só as pessoas que
 * responderam (sim ou não): quem não informou fica de fora da conta.
 * @param {keyof typeof AGRUPAMENTOS} por
 */
export function comparar(linhas, aulas, por, { hoje }) {
  const grupos = new Map();
  for (const linha of linhas) {
    const [id, rotulo] = AGRUPAMENTOS[por].chave(linha);
    const g = grupos.get(id) ?? { id, rotulo, linhas: [] };
    g.linhas.push(linha);
    grupos.set(id, g);
  }
  const respondeu = (pessoas, campo) => pessoas.filter((a) => a[campo]?.possui === true || a[campo]?.possui === false);
  const pctSim = (pessoas, campo) => {
    const respostas = respondeu(pessoas, campo);
    return respostas.length ? percentual(respostas.filter((a) => a[campo].possui).length, respostas.length) : null;
  };

  return [...grupos.values()]
    .map(({ id, rotulo, linhas: doGrupo }) => {
      const turmasDoGrupo = new Set(doGrupo.map(({ turma }) => turma.id));
      const f = frequencia(doGrupo, aulas.filter((a) => turmasDoGrupo.has(a.turmaId)));
      const pessoas = pessoasUnicas(doGrupo);
      const evadidas = doGrupo.filter(({ m }) => m.status === S.EVADIDA).length;
      return {
        id,
        rotulo,
        matriculas: doGrupo.length,
        pessoas: pessoas.length,
        ativas: f.ativas,
        concluidas: doGrupo.filter(({ m }) => m.status === S.CONCLUIDA).length,
        evadidas,
        taxaEvasao: percentual(evadidas, doGrupo.length),
        frequenciaMedia: f.frequenciaMedia,
        emRisco: f.emRisco,
        emRiscoPct: percentual(f.emRisco, f.ativas),
        deficienciaPct: pctSim(pessoas, 'deficiencia'),
        programaSocialPct: pctSim(pessoas, 'programaSocial'),
        mcmvPct: pctSim(pessoas, 'mcmv'),
        idadeMedia: media(pessoas.filter((a) => a.dataNascimento).map((a) => idadeEm(a.dataNascimento, hoje)).filter((i) => i >= 0)),
      };
    })
    .sort((a, b) => b.matriculas - a.matriculas || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}
