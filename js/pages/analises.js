import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { $, $$, escapar } from '../core/ui.js';
import { baixarCsv } from '../core/arquivos.js';
import { hojeISO } from '../core/datas.js';
import { AGRUPAMENTOS, comparar, filtrar, frequencia, funil, juntar, opcoesDeFiltro, perfil, pessoasEmRisco } from '../domain/analises.js';
import { PAPEIS, STATUS_MATRICULA } from '../models/schema.js';
import { ROTULO_STATUS_MATRICULA } from '../models/rotulos.js';
import { carregarBaseDeAnalise } from '../services/analises.service.js';

const eu = await exigirLogin({ papeis: [PAPEIS.ADMIN, PAPEIS.COORDENADOR] });
montarShell({ ativo: 'analises', perfil: eu });

const hoje = hojeISO();
const ABAS = ['funil', 'perfil', 'frequencia', 'comparar'];

const estado = {
  base: null,
  linhas: [], // uma por matrícula, ligada à pessoa, à turma e ao curso
  filtros: { periodo: '', cursoId: '', polo: '', turmaId: '', situacao: '' },
  aba: ABAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'funil',
  agrupar: 'curso', // como agrupar o funil e a comparação
  csvs: {}, // chave → { nome, cabecalho, linhas }: o que cada botão "Baixar CSV" baixa
};

// ---------------------------------------------------------------------------
// Peças de tela
// ---------------------------------------------------------------------------
const num = (n, sufixo = '') => (n === null || n === undefined ? '—' : `${String(n).replace('.', ',')}${sufixo}`);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const numero = (valor, rotulo) => `<div class="numero"><strong>${escapar(valor)}</strong><span>${escapar(rotulo)}</span></div>`;
const SEM_RESPOSTA = /^(Não informad|Não especificad|\(sem)/;

/** Barras horizontais: a largura de cada uma é a porcentagem do total. */
function barras(itens, { atencao = false } = {}) {
  if (!itens.length) return '<p class="item__meta">Sem dados.</p>';
  return `<ul class="barras">${itens
    .map(
      (i) => `<li class="${SEM_RESPOSTA.test(i.rotulo) ? 'vazio' : ''}">
        <span class="barras__rotulo">${escapar(i.rotulo)}</span>
        <span class="barras__trilho" aria-hidden="true"><span class="barras__preenchimento ${atencao ? 'barras__preenchimento--atencao' : ''}" style="width: ${Math.min(100, Math.max(0, i.percentual))}%"></span></span>
        <span class="barras__valor">${escapar(i.texto ?? `${i.quantidade} · ${num(i.percentual, '%')}`)}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

/** Tabela a partir de colunas { titulo, valor(linha), num? , html?(linha) }. */
function tabela(colunas, linhas, vazio = 'Sem dados para estes filtros.') {
  if (!linhas.length) return `<p class="estado-vazio">${escapar(vazio)}</p>`;
  return `<div class="tabela-rolagem"><table class="tabela">
    <thead><tr>${colunas.map((c) => `<th class="${c.num ? 'num' : ''}">${escapar(c.titulo)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map((l) => `<tr>${colunas.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(l) : escapar(c.valor(l) ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

/** Guarda o CSV de um bloco e devolve o botão que o baixa. */
function botaoCsv(chave, nome, cabecalho, linhas) {
  estado.csvs[chave] = { nome, cabecalho, linhas };
  return `<button class="botao botao--fantasma botao--pequeno" type="button" data-csv="${escapar(chave)}">Baixar CSV</button>`;
}

function seletorDeAgrupamento() {
  return `<div class="campo" style="margin: 0; min-width: 160px;">
    <label for="agrupar">Agrupar por</label>
    <select id="agrupar" data-agrupar>${Object.entries(AGRUPAMENTOS)
      .map(([id, a]) => `<option value="${id}" ${id === estado.agrupar ? 'selected' : ''}>${a.rotulo}</option>`)
      .join('')}</select>
  </div>`;
}

/** Linha do tempo da presença: eixo X é o número da aula (1ª, 2ª, 3ª…), eixo Y a porcentagem de presença. */
function graficoDeLinha(pontos) {
  const L = 460; // área de desenho pequena: o cartão é estreito e o SVG se ajusta a ele, então o texto dos eixos não encolhe demais
  const A = 250;
  const margem = { esquerda: 40, direita: 14, topo: 14, base: 34 };
  const w = L - margem.esquerda - margem.direita;
  const h = A - margem.topo - margem.base;
  const x = (i) => margem.esquerda + (pontos.length === 1 ? w / 2 : (i / (pontos.length - 1)) * w);
  const y = (p) => margem.topo + h - (p / 100) * h;
  const passo = Math.ceil(pontos.length / 12);
  const resumo = `Presença por número da aula: de ${num(pontos[0].presenca, '%')} na 1ª aula a ${num(pontos.at(-1).presenca, '%')} na ${pontos.at(-1).numero}ª.`;

  return `<svg class="grafico" viewBox="0 0 ${L} ${A}" role="img" aria-label="${escapar(resumo)}">
    <title>${escapar(resumo)}</title>
    ${[0, 25, 50, 75, 100]
      .map((v) => `<line class="grafico__grade" x1="${margem.esquerda}" x2="${L - margem.direita}" y1="${y(v)}" y2="${y(v)}"/><text class="grafico__texto" x="${margem.esquerda - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`)
      .join('')}
    <polyline class="grafico__linha" points="${pontos.map((p, i) => `${x(i)},${y(p.presenca)}`).join(' ')}"/>
    ${pontos.map((p, i) => `<circle class="grafico__ponto" cx="${x(i)}" cy="${y(p.presenca)}" r="4"><title>${p.numero}ª aula: ${num(p.presenca, '%')} de presença (${p.marcados} marcações, ${plural(p.turmas, 'turma', 'turmas')})</title></circle>`).join('')}
    ${pontos.map((p, i) => (i % passo === 0 ? `<text class="grafico__texto" x="${x(i)}" y="${A - 12}" text-anchor="middle">${p.numero}ª</text>` : '')).join('')}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------
function abaFunil(linhas) {
  const f = funil(linhas);
  const s = f.porSituacao;
  const situacoes = Object.values(STATUS_MATRICULA)
    .map((v) => ({ rotulo: ROTULO_STATUS_MATRICULA[v], quantidade: s[v], percentual: f.inscricoes ? Math.round((s[v] / f.inscricoes) * 1000) / 10 : 0 }))
    .filter((i) => i.quantidade);
  const grupos = comparar(linhas, [], estado.agrupar, { hoje });
  const colunas = [
    { titulo: AGRUPAMENTOS[estado.agrupar].rotulo, valor: (g) => g.rotulo },
    { titulo: 'Matrículas', valor: (g) => g.matriculas, num: true },
    { titulo: 'Pessoas', valor: (g) => g.pessoas, num: true },
    { titulo: 'Ativas', valor: (g) => g.ativas, num: true },
    { titulo: 'Concluídas', valor: (g) => g.concluidas, num: true },
    { titulo: 'Evadidas', valor: (g) => g.evadidas, num: true },
    { titulo: '% evasão', valor: (g) => num(g.taxaEvasao, '%'), num: true },
  ];
  const csv = botaoCsv('funil', 'funil-por-' + estado.agrupar, colunas.map((c) => c.titulo), grupos.map((g) => colunas.map((c) => c.valor(g))));

  return `
    <div class="numeros" style="margin-bottom: var(--espaco-4)">
      ${numero(f.inscricoes, 'inscrições (matrículas)')}
      ${numero(f.pessoas, f.pessoas === 1 ? 'pessoa' : 'pessoas')}
      ${numero(f.turmas, f.turmas === 1 ? 'turma' : 'turmas')}
      ${numero(s.ativa, 'ativas')}
      ${numero(s.concluida, `concluídas (${num(f.taxaConclusao, '%')})`)}
      ${numero(s.evadida, `evadidas (${num(f.taxaEvasao, '%')})`)}
    </div>
    <div class="analise-grade">
      <article class="cartao bloco"><h3>Situação no sistema oficial</h3>${barras(f.situacoesExternas)}</article>
      <article class="cartao bloco"><h3>Situação aqui</h3>${barras(situacoes)}</article>
    </div>
    <article class="cartao bloco">
      <div class="bloco__topo"><h3>Inscrições por ${escapar(AGRUPAMENTOS[estado.agrupar].rotulo.toLowerCase())}</h3>${seletorDeAgrupamento()}</div>
      ${tabela(colunas, grupos)}
      <div>${csv}</div>
    </article>`;
}

function abaPerfil(linhas) {
  const p = perfil(linhas, { hoje });
  const dimensoes = [
    ['Raça ou cor', p.raca],
    ['Faixa etária', p.faixaEtaria],
    ['Possui deficiência', p.deficiencia],
    ['Quais deficiências (menções)', p.deficienciaQual],
    ['Recebe programa social', p.programaSocial],
    ['Quais programas sociais (menções)', p.programaSocialQual],
    ['Reside em MCMV', p.mcmv],
    ['Quais empreendimentos MCMV (menções)', p.mcmvQual],
    ['Cidades', p.cidades],
    ['Bairros', p.bairros],
  ];
  const mostradas = dimensoes.filter(([, itens]) => itens.length);
  const csv = botaoCsv(
    'perfil',
    'perfil',
    ['Dimensão', 'Categoria', 'Quantidade', '% do total'],
    dimensoes.flatMap(([titulo, itens]) => itens.map((i) => [titulo, i.rotulo, i.quantidade, i.percentual])),
  );

  return `
    <div class="numeros" style="margin-bottom: var(--espaco-4)">
      ${numero(p.pessoas, p.pessoas === 1 ? 'pessoa' : 'pessoas')}
      ${numero(num(p.idadeMedia), 'anos de idade média')}
    </div>
    <p class="item__meta" style="margin-bottom: var(--espaco-3)">Cada pessoa conta uma vez, mesmo com mais de uma matrícula. "Não informado" mostra o que falta no cadastro do sistema oficial.</p>
    <div class="analise-grade">
      ${mostradas.map(([titulo, itens]) => `<article class="cartao bloco"><h3>${escapar(titulo)}</h3>${barras(itens)}</article>`).join('')}
    </div>
    <div>${csv}</div>`;
}

function abaFrequencia(linhas, aulas) {
  const f = frequencia(linhas, aulas);
  const emRisco = pessoasEmRisco(linhas);
  if (!f.comChamada) {
    return `<article class="cartao bloco"><h3>Sem chamada para estes filtros</h3>
      <p>Ainda não há presenças e faltas importadas. Importe a lista de frequência de cada turma para ver a evasão.</p>
      <div><a class="botao" href="importar.html">Importar dados</a></div></article>`;
  }

  const colunasTurmas = [
    { titulo: 'Turma', valor: (t) => t.nome },
    { titulo: 'Polo', valor: (t) => t.polo || '—' },
    { titulo: 'Ativas', valor: (t) => t.ativas, num: true },
    { titulo: 'Aulas', valor: (t) => t.aulas, num: true },
    { titulo: 'Frequência média', valor: (t) => num(t.frequenciaMedia, '%'), num: true },
    { titulo: 'Em risco', valor: (t) => t.emRisco, num: true },
    { titulo: 'Abaixo do mínimo', valor: (t) => t.abaixoDoMinimo, num: true },
    { titulo: 'Evadidas', valor: (t) => t.evadidas, num: true },
  ];
  const csvTurmas = botaoCsv('turmas', 'frequencia-por-turma', colunasTurmas.map((c) => c.titulo), f.turmas.map((t) => colunasTurmas.map((c) => c.valor(t))));

  const colunasRisco = [
    { titulo: 'Nome', valor: (r) => r.nome },
    { titulo: 'Inscrição', valor: (r) => r.numeroInscricao || '—' },
    { titulo: 'Turma', valor: (r) => r.turma },
    { titulo: 'Faltas', valor: (r) => `${r.faltas} em ${r.aulas}`, num: true },
    { titulo: 'Seguidas', valor: (r) => r.faltasConsecutivas, num: true },
    { titulo: 'Frequência', valor: (r) => num(r.frequencia, '%'), num: true },
    { titulo: 'Contato', valor: (r) => r.telefone || r.email || '—' },
  ];
  const csvRisco = botaoCsv(
    'risco',
    'pessoas-em-risco',
    ['Nome', 'Inscrição', 'Turma', 'Curso', 'Polo', 'Aulas', 'Faltas', 'Faltas seguidas', 'Frequência (%)', 'Telefone', 'E-mail'],
    emRisco.map((r) => [r.nome, r.numeroInscricao, r.turma, r.curso, r.polo, r.aulas, r.faltas, r.faltasConsecutivas, r.frequencia, r.telefone, r.email]),
  );

  return `
    <div class="numeros" style="margin-bottom: var(--espaco-4)">
      ${numero(num(f.frequenciaMedia, '%'), 'frequência média (todas as matrículas)')}
      ${numero(num(f.frequenciaMediaAtivas, '%'), 'frequência média das ativas')}
      ${numero(f.emRisco, 'ativas em risco de evasão')}
      ${numero(f.abaixoDoMinimo, 'ativas abaixo da frequência mínima')}
      ${numero(f.aulas, f.aulas === 1 ? 'aula registrada' : 'aulas registradas')}
    </div>
    <div class="analise-grade">
      <article class="cartao bloco">
        <h3>Presença da 1ª aula em diante</h3>
        <p class="item__meta">Junta todas as turmas dos filtros. Onde a linha cai, as turmas começam a esvaziar.</p>
        ${f.curva.length ? graficoDeLinha(f.curva) : '<p class="item__meta">Sem aulas.</p>'}
        <details><summary class="item__meta">Ver os números</summary>${tabela(
          [
            { titulo: 'Aula', valor: (p) => `${p.numero}ª`, num: true },
            { titulo: 'Turmas', valor: (p) => p.turmas, num: true },
            { titulo: 'Marcações', valor: (p) => p.marcados, num: true },
            { titulo: 'Presença', valor: (p) => num(p.presenca, '%'), num: true },
          ],
          f.curva,
        )}</details>
      </article>
      <article class="cartao bloco">
        <h3>Presença por dia da semana</h3>
        ${barras(f.diasDaSemana.map((d) => ({ rotulo: `${d.dia} (${plural(d.aulas, 'aula', 'aulas')})`, quantidade: d.marcados, percentual: d.presenca, texto: num(d.presenca, '%') })))}
      </article>
    </div>
    <article class="cartao bloco">
      <h3>Turmas, da menor para a maior frequência</h3>
      ${tabela(colunasTurmas, f.turmas)}
      <div>${csvTurmas}</div>
    </article>
    <article class="cartao bloco" style="margin-top: var(--espaco-4)">
      <h3>Pessoas em risco de evasão (${emRisco.length})</h3>
      <p class="item__meta">Três faltas seguidas, ou frequência abaixo do mínimo do curso depois de quatro aulas. Primeiro quem tem mais faltas seguidas.</p>
      ${tabela(colunasRisco, emRisco.slice(0, 50), 'Ninguém em risco com estes filtros.')}
      ${emRisco.length > 50 ? `<p class="item__meta">Mostrando 50 de ${emRisco.length}. O CSV traz todas.</p>` : ''}
      <div>${csvRisco}</div>
    </article>`;
}

function abaComparar(linhas, aulas) {
  const grupos = comparar(linhas, aulas, estado.agrupar, { hoje });
  const colunas = [
    { titulo: AGRUPAMENTOS[estado.agrupar].rotulo, valor: (g) => g.rotulo },
    { titulo: 'Matrículas', valor: (g) => g.matriculas, num: true },
    { titulo: 'Pessoas', valor: (g) => g.pessoas, num: true },
    { titulo: 'Ativas', valor: (g) => g.ativas, num: true },
    { titulo: 'Evadidas', valor: (g) => g.evadidas, num: true },
    { titulo: '% evasão', valor: (g) => num(g.taxaEvasao, '%'), num: true },
    { titulo: 'Frequência média', valor: (g) => num(g.frequenciaMedia, '%'), num: true },
    { titulo: '% das ativas em risco', valor: (g) => num(g.emRiscoPct, '%'), num: true },
    { titulo: '% com deficiência', valor: (g) => num(g.deficienciaPct, '%'), num: true },
    { titulo: '% em programa social', valor: (g) => num(g.programaSocialPct, '%'), num: true },
    { titulo: '% em MCMV', valor: (g) => num(g.mcmvPct, '%'), num: true },
    { titulo: 'Idade média', valor: (g) => num(g.idadeMedia), num: true },
  ];
  const csv = botaoCsv('comparar', 'comparacao-por-' + estado.agrupar, colunas.map((c) => c.titulo), grupos.map((g) => colunas.map((c) => c.valor(g))));

  return `
    <article class="cartao bloco">
      <div class="bloco__topo">
        <div><h3>Lado a lado</h3><p class="item__meta">As porcentagens de perfil só contam quem respondeu sim ou não.</p></div>
        ${seletorDeAgrupamento()}
      </div>
      ${tabela(colunas, grupos)}
      <div>${csv}</div>
    </article>
    <article class="cartao bloco" style="margin-top: var(--espaco-4)">
      <h3>Taxa de evasão</h3>
      ${barras(grupos.map((g) => ({ rotulo: g.rotulo, quantidade: g.evadidas, percentual: g.taxaEvasao, texto: `${g.evadidas} de ${g.matriculas} · ${num(g.taxaEvasao, '%')}` })), { atencao: true })}
    </article>`;
}

const RENDERIZAR_ABA = { funil: abaFunil, perfil: abaPerfil, frequencia: abaFrequencia, comparar: abaComparar };

// ---------------------------------------------------------------------------
// Filtros e tela
// ---------------------------------------------------------------------------
function opcoes(select, itens, todos, atual) {
  select.innerHTML = `<option value="">${todos}</option>${itens.map((i) => `<option value="${escapar(i.valor)}">${escapar(i.rotulo)}</option>`).join('')}`;
  select.value = atual;
  return select.value; // vazio se a opção escolhida não existe mais
}

function montarFiltros() {
  const todas = opcoesDeFiltro(estado.linhas);
  const f = estado.filtros;
  f.periodo = opcoes($('#f-periodo'), todas.periodos.map((p) => ({ valor: p, rotulo: p })), 'Todos os períodos', f.periodo);
  f.cursoId = opcoes($('#f-curso'), todas.cursos.map((c) => ({ valor: c.id, rotulo: c.nome })), 'Todos os cursos', f.cursoId);
  f.polo = opcoes($('#f-polo'), todas.polos.map((p) => ({ valor: p, rotulo: p })), 'Todos os polos', f.polo);
  f.situacao = opcoes($('#f-situacao'), Object.values(STATUS_MATRICULA).map((v) => ({ valor: v, rotulo: ROTULO_STATUS_MATRICULA[v] })), 'Todas as situações', f.situacao);
  montarOpcoesDeTurma();
}

/** As turmas oferecidas são só as que combinam com os outros filtros. */
function montarOpcoesDeTurma() {
  const { turmas } = opcoesDeFiltro(filtrar(estado.linhas, { ...estado.filtros, turmaId: '' }));
  estado.filtros.turmaId = opcoes($('#f-turma'), turmas.map((t) => ({ valor: t.id, rotulo: t.nome })), 'Todas as turmas', estado.filtros.turmaId);
}

function renderizar() {
  const doFiltro = filtrar(estado.linhas, estado.filtros);
  const turmaIds = new Set(doFiltro.map(({ turma }) => turma.id));
  const aulas = estado.base.aulas.filter((a) => turmaIds.has(a.turmaId));
  estado.csvs = {};

  const pessoas = new Set(doFiltro.map(({ m }) => m.alunoId)).size;
  $('#filtros-resumo').textContent = `${plural(doFiltro.length, 'matrícula', 'matrículas')} · ${plural(pessoas, 'pessoa', 'pessoas')} · ${plural(turmaIds.size, 'turma', 'turmas')} · ${plural(aulas.length, 'aula registrada', 'aulas registradas')}`;
  $('#conteudo').innerHTML = doFiltro.length
    ? RENDERIZAR_ABA[estado.aba](doFiltro, aulas)
    : '<p class="estado-vazio">Nenhuma matrícula com estes filtros.</p>';
  $$('.aba').forEach((aba) => aba.setAttribute('aria-selected', String(aba.dataset.aba === estado.aba)));
}

$('#filtros').addEventListener('change', () => {
  Object.assign(estado.filtros, {
    periodo: $('#f-periodo').value,
    cursoId: $('#f-curso').value,
    polo: $('#f-polo').value,
    turmaId: $('#f-turma').value,
    situacao: $('#f-situacao').value,
  });
  montarOpcoesDeTurma();
  renderizar();
});
$('#filtros').addEventListener('submit', (evento) => evento.preventDefault());

$('#abas').addEventListener('click', (evento) => {
  const aba = evento.target.closest('.aba');
  if (!aba) return;
  estado.aba = aba.dataset.aba;
  history.replaceState(null, '', `#${estado.aba}`);
  renderizar();
});

$('#conteudo').addEventListener('change', (evento) => {
  if (!evento.target.matches('[data-agrupar]')) return;
  estado.agrupar = evento.target.value;
  renderizar();
  $('#agrupar')?.focus();
});

$('#conteudo').addEventListener('click', (evento) => {
  const botao = evento.target.closest('[data-csv]');
  if (!botao) return;
  const { nome, cabecalho, linhas } = estado.csvs[botao.dataset.csv];
  baixarCsv(`${nome}-${hoje}.csv`, cabecalho, linhas);
});

async function iniciar() {
  $('#conteudo').innerHTML = '<div class="cartao item item--carregando"></div>';
  try {
    estado.base = await carregarBaseDeAnalise();
  } catch (erro) {
    console.error(erro);
    $('#erro').textContent = 'Não foi possível carregar os dados. Confira a configuração do Firebase e as regras do Firestore.';
    $('#erro').hidden = false;
    $('#conteudo').innerHTML = '';
    return;
  }
  estado.linhas = juntar(estado.base);
  if (!estado.linhas.length) {
    $('#filtros').hidden = $('#abas').hidden = $('#filtros-resumo').hidden = true;
    $('#conteudo').innerHTML = `<article class="cartao bloco"><h2>Ainda não há dados</h2>
      <p>As análises usam as matrículas, a frequência e o perfil das pessoas. Traga a listagem exportada do sistema oficial para começar.</p>
      <div><a class="botao" href="importar.html">Importar dados</a></div></article>`;
    return;
  }
  montarFiltros();
  renderizar();
}

iniciar();
