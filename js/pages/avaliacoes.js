import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { $, $$, confirmar, escapar, toast } from '../core/ui.js';
import { formatarData } from '../core/datas.js';
import { ErroDeNegocio } from '../core/erros.js';
import {
  estatisticasDaAvaliacao,
  lerNota,
  modoDoCurso,
  pessoasDaAvaliacao,
  resultadosDa,
  temResultados,
} from '../domain/avaliacoes.js';
import { MODO_AVALIACAO, PAPEIS, STATUS_MATRICULA, TIPO_AVALIACAO } from '../models/schema.js';
import {
  AJUDA_MODO_AVALIACAO,
  ROTULO_MODO_AVALIACAO,
  ROTULO_STATUS_MATRICULA,
  ROTULO_STATUS_TURMA,
  ROTULO_TIPO_AVALIACAO,
  textoDesempenho,
} from '../models/rotulos.js';
import { criarAvaliacao, editarAvaliacao, excluirAvaliacao, lancarResultados, listarAvaliacoesDaTurma } from '../services/avaliacoes.service.js';
import { cursosRepo } from '../services/cursos.service.js';
import { listarMatriculasDaTurma } from '../services/matriculas.service.js';
import { listarTurmasDeTrabalho } from '../services/turmas.service.js';

// Professor, coordenação e admin usam as avaliações. O professor só vê as turmas dele e não exclui avaliações.
const eu = await exigirLogin();
montarShell({ ativo: 'avaliacoes', perfil: eu });
const ehProfessor = eu.papel === PAPEIS.PROFESSOR;

const estado = {
  turmas: [],
  turmaId: '',
  curso: null, // curso da turma escolhida: só sugere a forma de avaliar ao criar uma avaliação
  matriculas: [], // da turma escolhida
  avaliacoes: [], // da turma escolhida, em ordem de data
  abertaId: null, // avaliação aberta no painel de lançamento
  pessoas: [], // matrículas que entram na lista de lançamento
  valores: {}, // alunoId → texto digitado (avaliação por nota) ou true/false (Apto / Não apto); ausente = sem resultado
  sujo: false, // há resultados não salvos
  editandoId: null, // avaliação aberta no formulário (null = nova)
};

const $turma = $('#a-turma');
const dialogo = $('#dlg-avaliacao');
const virgula = (n) => String(n).replace('.', ',');
const turmaAtual = () => estado.turmas.find((t) => t.id === estado.turmaId);
const avaliacaoAberta = () => estado.avaliacoes.find((a) => a.id === estado.abertaId);
const ehApto = (avaliacao) => avaliacao.modo === MODO_AVALIACAO.APTO;

function mostrar(elemento, texto) {
  elemento.textContent = texto;
  elemento.hidden = !texto;
}

function tratarErro(erro) {
  if (erro instanceof ErroDeNegocio) return toast(erro.message, 'erro');
  console.error(erro);
  toast('Não foi possível concluir agora. Verifique a conexão e tente de novo.', 'erro');
}

/** Se há resultados não salvos, pergunta antes de largá-los. */
async function podeDescartar() {
  if (!estado.sujo) return true;
  return confirmar({
    titulo: 'Descartar alterações?',
    mensagem: 'Os resultados desta avaliação ainda não foram salvos.',
    rotulo: 'Descartar',
    perigo: true,
  });
}

// ---------------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------------
async function iniciar() {
  $turma.innerHTML = '<option value="">Carregando…</option>';
  try {
    estado.turmas = await listarTurmasDeTrabalho({ professorId: ehProfessor ? eu.uid : null });
  } catch (erro) {
    console.error(erro);
    return mostrar($('#a-aviso'), 'Não foi possível carregar as turmas. Confira a configuração do Firebase e as regras do Firestore.');
  }

  if (!estado.turmas.length) {
    $turma.innerHTML = '<option value="">Nenhuma turma</option>';
    $turma.disabled = true;
    return mostrar(
      $('#a-aviso'),
      ehProfessor
        ? 'Você ainda não tem turmas atribuídas. A coordenação define o professor de cada turma na tela Turmas.'
        : 'Nenhuma turma cadastrada ainda. Crie uma na tela Turmas.',
    );
  }

  $turma.innerHTML = estado.turmas
    .map((t) => `<option value="${escapar(t.id)}">${escapar(t.nome)} (${ROTULO_STATUS_TURMA[t.status].toLowerCase()})</option>`)
    .join('');
  const pedida = new URLSearchParams(location.search).get('turma');
  await trocarTurma(estado.turmas.find((t) => t.id === pedida)?.id ?? estado.turmas[0].id);
}

async function recarregar() {
  [estado.matriculas, estado.avaliacoes] = await Promise.all([listarMatriculasDaTurma(estado.turmaId), listarAvaliacoesDaTurma(estado.turmaId)]);
}

async function trocarTurma(id) {
  estado.turmaId = id;
  $turma.value = id;
  mostrar($('#a-aviso'), '');
  try {
    [estado.curso] = await Promise.all([cursosRepo.obter(turmaAtual().cursoId), recarregar()]);
  } catch (erro) {
    console.error(erro);
    return mostrar($('#a-aviso'), 'Não foi possível carregar a turma. Tente de novo.');
  }
  fecharLancamento();
  const media = estado.curso?.mediaAprovacao;
  mostrar(
    $('#a-modo'),
    `Ao criar uma avaliação você escolhe se ela vale nota ou Apto / Não apto; o curso sugere ${ROTULO_MODO_AVALIACAO[modoDoCurso(estado.curso)]}.` +
      (typeof media === 'number' ? ` Média de aprovação do curso (avaliações por nota): ${virgula(media)}.` : ''),
  );
  $('#btn-nova').disabled = false;
  renderizarLista();
}

// ---------------------------------------------------------------------------
// Lista de avaliações
// ---------------------------------------------------------------------------
function renderizarLista() {
  $('#avaliacoes').innerHTML = estado.avaliacoes.length
    ? estado.avaliacoes.map(avaliacaoHtml).join('')
    : '<p class="estado-vazio">Nenhuma avaliação nesta turma ainda. Clique em "Nova avaliação" para criar a primeira.</p>';
}

function avaliacaoHtml(a) {
  const total = pessoasDaAvaliacao({ matriculas: estado.matriculas, avaliacao: a }).length;
  const e = estatisticasDaAvaliacao(a, total);
  const detalhes = [
    ROTULO_MODO_AVALIACAO[a.modo],
    a.data ? formatarData(a.data) : 'Sem data',
    ehApto(a) ? null : `peso ${virgula(a.peso)} · nota máxima ${virgula(a.notaMaxima)}`,
  ].filter(Boolean);
  const resultado = ehApto(a)
    ? e.lancadas ? ` · Apto ${e.aptas} · Não apto ${e.naoAptas}` : ''
    : e.media === null ? '' : ` · Média da turma ${virgula(e.media)}`;
  const aberta = a.id === estado.abertaId;
  return `
    <article class="cartao item" data-id="${escapar(a.id)}">
      <div class="item__principal">
        <h2 class="item__titulo">${escapar(a.titulo)} <span class="selo selo--neutro">${ROTULO_TIPO_AVALIACAO[a.tipo] ?? escapar(a.tipo)}</span>${aberta ? ' <span class="selo selo--info">Em lançamento</span>' : ''}</h2>
        <p class="item__meta">${detalhes.join(' · ')}</p>
        <p class="item__meta">${e.lancadas ? `Avaliados ${e.lancadas} de ${e.total}` : 'Nenhum resultado lançado'}${resultado}</p>
      </div>
      <div class="item__acoes">
        <button class="botao ${aberta ? 'botao--fantasma' : ''}" type="button" data-acao="lancar">${aberta ? 'Aberta' : 'Lançar resultados'}</button>
        <button class="botao botao--fantasma" type="button" data-acao="editar">Editar</button>
        ${ehProfessor ? '' : '<button class="botao botao--fantasma" type="button" data-acao="excluir">Excluir</button>'}
      </div>
    </article>`;
}

$('#avaliacoes').addEventListener('click', async (evento) => {
  const botao = evento.target.closest('button[data-acao]');
  if (!botao) return;
  const avaliacao = estado.avaliacoes.find((a) => a.id === botao.closest('[data-id]').dataset.id);

  if (botao.dataset.acao === 'lancar') {
    if (avaliacao.id === estado.abertaId || !(await podeDescartar())) return;
    abrirLancamento(avaliacao.id);
    return $('#lancamento').scrollIntoView({ block: 'start' });
  }
  if (!(await podeDescartar())) return;
  if (botao.dataset.acao === 'editar') return abrirFormulario(avaliacao);

  const ok = await confirmar({
    titulo: `Excluir "${avaliacao.titulo}"?`,
    mensagem: 'A avaliação e todos os resultados lançados nela são apagados, e as médias da turma são recalculadas sem ela.',
    rotulo: 'Excluir avaliação',
    perigo: true,
  });
  if (!ok) return;
  try {
    await excluirAvaliacao(avaliacao.id);
    toast(`Avaliação "${avaliacao.titulo}" excluída. Médias recalculadas.`, 'sucesso');
    if (estado.abertaId === avaliacao.id) fecharLancamento();
  } catch (erro) {
    tratarErro(erro);
  }
  await recarregar().catch(console.error);
  renderizarLista();
});

// ---------------------------------------------------------------------------
// Lançamento de resultados
// ---------------------------------------------------------------------------
function abrirLancamento(id) {
  const avaliacao = estado.avaliacoes.find((a) => a.id === id);
  const resultados = resultadosDa(avaliacao);
  estado.abertaId = id;
  estado.pessoas = pessoasDaAvaliacao({ matriculas: estado.matriculas, avaliacao }).sort((a, b) => a.alunoNome.localeCompare(b.alunoNome, 'pt-BR'));
  estado.valores = Object.fromEntries(
    estado.pessoas
      .filter((p) => Object.hasOwn(resultados, p.alunoId))
      .map((p) => [p.alunoId, ehApto(avaliacao) ? resultados[p.alunoId] : virgula(resultados[p.alunoId])]),
  );
  estado.sujo = false;
  renderizarLancamento();
  renderizarLista();
}

function fecharLancamento() {
  estado.abertaId = null;
  estado.sujo = false;
  $('#lancamento').hidden = true;
  renderizarLista();
}

function renderizarLancamento() {
  const a = avaliacaoAberta();
  mostrar($('#lanc-erro'), '');
  $('#lancamento').hidden = false;
  $('#lanc-titulo').textContent = a.titulo;
  $('#lanc-sub').textContent = ehApto(a)
    ? 'Marque Apto ou Não apto. Quem ficar sem marcação ainda não foi avaliado; tocar de novo desmarca.'
    : `Notas de 0 a ${virgula(a.notaMaxima)}. Deixe em branco quem ainda não foi avaliado.`;
  $('#btn-todos-aptos').hidden = !ehApto(a);
  $('#btn-limpar').disabled = $('#btn-todos-aptos').disabled = $('#btn-salvar').disabled = !estado.pessoas.length;
  $('#lanc-lista').innerHTML = estado.pessoas.length
    ? estado.pessoas.map((p) => linhaHtml(p, a)).join('')
    : '<li class="estado-vazio">Não há ninguém matriculado nesta turma.</li>';
  $$('.entrada-pequena', $('#lanc-lista')).forEach((entrada) => marcarInvalida(entrada));
  atualizarTotais();
}

function linhaHtml(p, a) {
  const desempenho = textoDesempenho(p) || 'Sem resultados ainda';
  const situacao = p.status !== STATUS_MATRICULA.ATIVA ? `<span class="selo selo--neutro">${ROTULO_STATUS_MATRICULA[p.status]} hoje</span>` : '';
  const valor = estado.valores[p.alunoId];
  const controle = ehApto(a)
    ? `<div class="marcas" role="group" aria-label="Resultado de ${escapar(p.alunoNome)}">
         <button type="button" class="marca marca--texto marca--p" data-marca="true" aria-pressed="${valor === true}" aria-label="Apto: ${escapar(p.alunoNome)}">Apto</button>
         <button type="button" class="marca marca--texto marca--f" data-marca="false" aria-pressed="${valor === false}" aria-label="Não apto: ${escapar(p.alunoNome)}">Não apto</button>
       </div>`
    : `<div class="nota-campo">
         <input class="entrada-pequena" inputmode="decimal" autocomplete="off" value="${escapar(valor ?? '')}" aria-label="Nota de ${escapar(p.alunoNome)}" />
         <span class="item__meta">de ${virgula(a.notaMaxima)}</span>
       </div>`;
  return `
    <li class="chamada__linha" data-aluno="${escapar(p.alunoId)}">
      <div class="chamada__pessoa">
        <strong>${escapar(p.alunoNome)}</strong>
        <span class="item__meta">${desempenho} ${situacao}</span>
      </div>
      ${controle}
    </li>`;
}

/** Texto digitado que não é nota válida (letras, negativo, acima do máximo) fica com a borda de erro. */
function marcarInvalida(entrada) {
  const nota = lerNota(entrada.value);
  entrada.setAttribute('aria-invalid', String(Number.isNaN(nota) || (nota !== null && nota > avaliacaoAberta().notaMaxima)));
}

function atualizarTotais() {
  const total = estado.pessoas.length;
  const valores = Object.values(estado.valores);
  if (ehApto(avaliacaoAberta())) {
    const aptas = valores.filter((v) => v === true).length;
    const naoAptas = valores.filter((v) => v === false).length;
    $('#lanc-totais').textContent = total ? `Apto ${aptas} · Não apto ${naoAptas} · Sem resultado ${total - aptas - naoAptas}` : '';
    return;
  }
  const notas = valores.map((v) => lerNota(v)).filter(Number.isFinite);
  const media = notas.length ? Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 100) / 100 : null;
  $('#lanc-totais').textContent = total ? `Notas lançadas ${notas.length} de ${total}${media === null ? '' : ` · Média da turma ${virgula(media)}`}` : '';
}

// toque em Apto / Não apto: grava no estado e atualiza só aquela linha (o foco do teclado não se perde)
$('#lanc-lista').addEventListener('click', (evento) => {
  const botao = evento.target.closest('.marca');
  if (!botao) return;
  const linha = botao.closest('[data-aluno]');
  const alunoId = linha.dataset.aluno;
  const escolhido = botao.dataset.marca === 'true';
  if (estado.valores[alunoId] === escolhido) delete estado.valores[alunoId]; // tocar de novo desmarca
  else estado.valores[alunoId] = escolhido;
  estado.sujo = true;
  $$('.marca', linha).forEach((b) => b.setAttribute('aria-pressed', String(estado.valores[alunoId] === (b.dataset.marca === 'true'))));
  atualizarTotais();
});

// digitação de uma nota
$('#lanc-lista').addEventListener('input', (evento) => {
  const entrada = evento.target.closest('.entrada-pequena');
  if (!entrada) return;
  const alunoId = entrada.closest('[data-aluno]').dataset.aluno;
  if (entrada.value.trim()) estado.valores[alunoId] = entrada.value;
  else delete estado.valores[alunoId];
  estado.sujo = true;
  marcarInvalida(entrada);
  atualizarTotais();
});

// Enter passa para a nota da próxima pessoa, como numa planilha
$('#lanc-lista').addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter' || !evento.target.matches('.entrada-pequena')) return;
  evento.preventDefault();
  const entradas = $$('.entrada-pequena', $('#lanc-lista'));
  entradas[entradas.indexOf(evento.target) + 1]?.focus();
});

$('#btn-todos-aptos').addEventListener('click', () => {
  estado.pessoas.forEach((p) => (estado.valores[p.alunoId] = true));
  estado.sujo = true;
  renderizarLancamento();
});
$('#btn-limpar').addEventListener('click', () => {
  estado.valores = {};
  estado.sujo = true;
  renderizarLancamento();
});
$('#btn-fechar').addEventListener('click', async () => {
  if (await podeDescartar()) fecharLancamento();
});

$('#btn-salvar').addEventListener('click', async () => {
  const a = avaliacaoAberta();
  mostrar($('#lanc-erro'), '');

  const resultados = {};
  if (ehApto(a)) {
    Object.assign(resultados, estado.valores);
  } else {
    const invalidas = estado.pessoas.filter((p) => {
      const nota = lerNota(estado.valores[p.alunoId]);
      if (nota !== null && !Number.isNaN(nota) && nota <= a.notaMaxima) resultados[p.alunoId] = nota;
      return Number.isNaN(nota) || (nota !== null && nota > a.notaMaxima);
    });
    if (invalidas.length) {
      $(`[data-aluno="${CSS.escape(invalidas[0].alunoId)}"] .entrada-pequena`)?.scrollIntoView({ block: 'center' });
      return mostrar($('#lanc-erro'), `Confira ${invalidas.length} nota(s): use números de 0 a ${virgula(a.notaMaxima)}, com vírgula ou ponto.`);
    }
  }

  const botao = $('#btn-salvar');
  botao.disabled = true;
  try {
    await lancarResultados(a.id, resultados);
    toast(`Resultados de "${a.titulo}" salvos. Médias recalculadas.`, 'sucesso');
    await recarregar();
    abrirLancamento(a.id);
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) mostrar($('#lanc-erro'), erro.message);
    else {
      console.error(erro);
      mostrar($('#lanc-erro'), 'Não foi possível salvar agora. Verifique a conexão e tente de novo.');
    }
    botao.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Formulário da avaliação: é aqui que se escolhe a forma de avaliar (nota ou Apto / Não apto)
// ---------------------------------------------------------------------------
$('#av-tipo').innerHTML = Object.values(TIPO_AVALIACAO)
  .map((tipo) => `<option value="${tipo}">${escapar(ROTULO_TIPO_AVALIACAO[tipo])}</option>`)
  .join('');
$('#av-modos').innerHTML = Object.values(MODO_AVALIACAO)
  .map((modo) => `<label class="check"><input type="radio" name="av-modo" value="${modo}" /> ${escapar(ROTULO_MODO_AVALIACAO[modo])}</label>`)
  .join('');

const mostrarErroForm = (texto) => mostrar($('#av-erro'), texto);
const modoEscolhido = () => $('input[name="av-modo"]:checked', dialogo).value;

/** Mostra a ajuda da forma escolhida e só pede peso e nota máxima quando a avaliação vale nota. */
function atualizarCamposDoModo() {
  const modo = modoEscolhido();
  $('#av-modo-ajuda').textContent = AJUDA_MODO_AVALIACAO[modo];
  $('#av-campos-nota').hidden = modo !== MODO_AVALIACAO.NOTA;
}
$$('input[name="av-modo"]', dialogo).forEach((radio) => radio.addEventListener('change', atualizarCamposDoModo));

function abrirFormulario(avaliacao = null) {
  estado.editandoId = avaliacao?.id ?? null;
  mostrarErroForm('');
  $('#av-titulo-dlg').textContent = avaliacao ? 'Editar avaliação' : 'Nova avaliação';
  $('#av-modo-info').textContent = turmaAtual().nome;
  $('#av-titulo').value = avaliacao?.titulo ?? '';
  $('#av-tipo').value = avaliacao?.tipo ?? TIPO_AVALIACAO.PROVA;
  $('#av-data').value = avaliacao?.data ?? '';
  $('#av-peso').value = avaliacao?.peso ?? 1;
  $('#av-max').value = avaliacao?.notaMaxima ?? 10;

  // uma avaliação nova começa na forma que o curso sugere; com resultados lançados, a forma não troca
  const modo = avaliacao?.modo ?? modoDoCurso(estado.curso);
  $$('input[name="av-modo"]', dialogo).forEach((radio) => {
    radio.checked = radio.value === modo;
    radio.disabled = Boolean(avaliacao && temResultados(avaliacao));
  });
  atualizarCamposDoModo();
  if (avaliacao && temResultados(avaliacao)) {
    $('#av-modo-ajuda').textContent += ' Há resultados lançados: limpe-os antes de trocar a forma de avaliar.';
  }

  dialogo.showModal();
  $('#av-titulo').focus();
}

$('#btn-nova').addEventListener('click', async () => {
  if (await podeDescartar()) abrirFormulario();
});
$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('#form-avaliacao').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = $('#av-salvar');
  mostrarErroForm('');
  botao.disabled = true;
  const entrada = {
    modo: modoEscolhido(),
    titulo: $('#av-titulo').value,
    tipo: $('#av-tipo').value,
    data: $('#av-data').value,
    peso: $('#av-peso').value,
    notaMaxima: $('#av-max').value,
  };
  try {
    const id = estado.editandoId
      ? await editarAvaliacao(estado.editandoId, entrada)
      : await criarAvaliacao({ turmaId: estado.turmaId, ...entrada });
    dialogo.close();
    toast('Avaliação salva.', 'sucesso');
    estado.sujo = false;
    await recarregar();
    abrirLancamento(id); // depois de criar ou editar, já abre a lista para lançar os resultados
    $('#lancamento').scrollIntoView({ block: 'start' });
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) mostrarErroForm(erro.message);
    else {
      console.error(erro);
      mostrarErroForm('Não foi possível salvar agora. Verifique a conexão e tente de novo.');
    }
  } finally {
    botao.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Turma
// ---------------------------------------------------------------------------
$turma.addEventListener('change', async () => {
  if (!(await podeDescartar())) return ($turma.value = estado.turmaId);
  await trocarTurma($turma.value);
});

// avisa antes de fechar a aba com resultados não salvos
window.addEventListener('beforeunload', (evento) => {
  if (estado.sujo) evento.preventDefault();
});

iniciar();
