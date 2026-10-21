import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { $, $$, confirmar, escapar, toast } from '../core/ui.js';
import { formatarData, formatarDataHora, hojeISO } from '../core/datas.js';
import { ErroDeNegocio } from '../core/erros.js';
import { pessoasDaChamada, resumoDaChamada } from '../domain/diario.js';
import { DIAS_SEMANA, PAPEIS, PRESENCA, STATUS_MATRICULA, STATUS_TURMA } from '../models/schema.js';
import { ROTULO_DIA, ROTULO_STATUS_MATRICULA, ROTULO_STATUS_TURMA } from '../models/rotulos.js';
import { excluirAula, listarAulasDaTurma, listarMatriculasDaTurma, registrarAula } from '../services/diario.service.js';
import { turmasRepo } from '../services/turmas.service.js';

// Professor, coordenação e admin usam o diário. O professor só vê as turmas dele.
const eu = await exigirLogin();
montarShell({ ativo: 'diario', perfil: eu });
const ehProfessor = eu.papel === PAPEIS.PROFESSOR;

const estado = {
  turmas: [],
  turmaId: '',
  data: hojeISO(),
  matriculas: [], // da turma escolhida
  aulas: [], // da turma escolhida, da mais recente para a mais antiga
  existente: null, // aula gravada na data escolhida (ou null = aula nova)
  pessoas: [], // matrículas que entram na chamada desta data
  marcas: {}, // alunoId → 'P' | 'F' | 'J' (o que está na tela, ainda não gravado)
  conteudo: '',
  sujo: false, // há alterações não salvas
};

const $turma = $('#d-turma');
const $data = $('#d-data');
const MARCAS = [
  { valor: PRESENCA.PRESENTE, letra: 'P', nome: 'Presente', classe: 'marca--p' },
  { valor: PRESENCA.FALTA, letra: 'F', nome: 'Falta', classe: 'marca--f' },
  { valor: PRESENCA.JUSTIFICADA, letra: 'J', nome: 'Falta justificada', classe: 'marca--j' },
];

const turmaAtual = () => estado.turmas.find((t) => t.id === estado.turmaId);
const diaDaSemana = (iso) => {
  const [a, m, d] = iso.split('-').map(Number);
  return DIAS_SEMANA[new Date(a, m - 1, d).getDay()];
};
const diaCurto = (iso) => ROTULO_DIA[diaDaSemana(iso)].slice(0, 3);

function mostrar(elemento, texto) {
  elemento.textContent = texto;
  elemento.hidden = !texto;
}

function tratarErro(erro) {
  if (erro instanceof ErroDeNegocio) return toast(erro.message, 'erro');
  console.error(erro);
  toast('Não foi possível concluir agora. Verifique a conexão e tente de novo.', 'erro');
}

/** Se há alterações não salvas, pergunta antes de largá-las. */
async function podeDescartar() {
  if (!estado.sujo) return true;
  return confirmar({
    titulo: 'Descartar alterações?',
    mensagem: 'A chamada e o conteúdo desta aula ainda não foram salvos.',
    rotulo: 'Descartar',
    perigo: true,
  });
}

// ---------------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------------
const ORDEM_STATUS = { [STATUS_TURMA.EM_ANDAMENTO]: 0, [STATUS_TURMA.ABERTA]: 1, [STATUS_TURMA.PLANEJADA]: 2, [STATUS_TURMA.ENCERRADA]: 3 };

async function iniciar() {
  try {
    const todas = await turmasRepo.listar();
    estado.turmas = todas
      .filter((t) => t.status !== STATUS_TURMA.CANCELADA && (!ehProfessor || t.professorId === eu.uid))
      .sort((a, b) => (ORDEM_STATUS[a.status] ?? 9) - (ORDEM_STATUS[b.status] ?? 9) || a.nome.localeCompare(b.nome, 'pt-BR'));
  } catch (erro) {
    console.error(erro);
    return mostrar($('#d-aviso'), 'Não foi possível carregar as turmas. Confira a configuração do Firebase e as regras do Firestore.');
  }

  if (!estado.turmas.length) {
    $turma.innerHTML = '<option value="">Nenhuma turma</option>';
    $turma.disabled = $data.disabled = $('#btn-hoje').disabled = true;
    return mostrar(
      $('#d-aviso'),
      ehProfessor
        ? 'Você ainda não tem turmas atribuídas. A coordenação define o professor de cada turma na tela Turmas.'
        : 'Nenhuma turma cadastrada ainda. Crie uma na tela Turmas.',
    );
  }

  $turma.innerHTML = estado.turmas
    .map((t) => `<option value="${escapar(t.id)}">${escapar(t.nome)} (${ROTULO_STATUS_TURMA[t.status].toLowerCase()})</option>`)
    .join('');
  $data.max = hojeISO();
  $data.value = estado.data;

  const pedida = new URLSearchParams(location.search).get('turma');
  await trocarTurma(estado.turmas.find((t) => t.id === pedida)?.id ?? estado.turmas[0].id);
}

async function recarregarTurma() {
  [estado.matriculas, estado.aulas] = await Promise.all([listarMatriculasDaTurma(estado.turmaId), listarAulasDaTurma(estado.turmaId)]);
}

async function trocarTurma(id) {
  estado.turmaId = id;
  $turma.value = id;
  try {
    await recarregarTurma();
  } catch (erro) {
    console.error(erro);
    return mostrar($('#d-aviso'), 'Não foi possível carregar a turma. Tente de novo.');
  }
  carregarDia();
  renderizarAulas();
}

/** Prepara a tela para a data escolhida: aula já gravada (correção) ou aula nova. */
function carregarDia() {
  estado.existente = estado.aulas.find((a) => a.data === estado.data) ?? null;
  estado.pessoas = pessoasDaChamada({ matriculas: estado.matriculas, registro: estado.existente, data: estado.data }).sort((a, b) =>
    a.alunoNome.localeCompare(b.alunoNome, 'pt-BR'),
  );
  estado.marcas = { ...(estado.existente?.registros ?? {}) };
  estado.conteudo = estado.existente?.conteudo ?? '';
  estado.sujo = false;
  renderizarChamada();
}

// ---------------------------------------------------------------------------
// Chamada
// ---------------------------------------------------------------------------
function renderizarChamada() {
  const turma = turmaAtual();
  const { data, existente, pessoas } = estado;
  $('#chamada').hidden = false;
  mostrar($('#d-erro'), '');

  $('#chamada-titulo').textContent = `${turma.nome} · ${diaCurto(data)}, ${formatarData(data)}`;
  $('#chamada-estado').textContent = existente
    ? `Aula já registrada (última gravação em ${formatarDataHora(existente.atualizadoEm ?? existente.criadoEm)}). Você está corrigindo a chamada.`
    : 'Nova aula.';

  // dica (não bloqueia): a data não é um dia de aula da turma
  const agenda = turma.diasSemana ?? [];
  const foraDaAgenda = agenda.length && !agenda.includes(diaDaSemana(data));
  mostrar(
    $('#d-aviso'),
    foraDaAgenda ? `Esta data cai numa ${ROTULO_DIA[diaDaSemana(data)].toLowerCase()}; as aulas desta turma são ${agenda.map((d) => ROTULO_DIA[d].slice(0, 3).toLowerCase()).join(', ')}.` : '',
  );

  $('#chamada-lista').innerHTML = pessoas.length
    ? pessoas.map(linhaHtml).join('')
    : '<li class="estado-vazio">Não há ninguém matriculado nesta turma para esta data.</li>';
  $('#d-conteudo').value = estado.conteudo;
  $('#btn-salvar').disabled = !pessoas.length;
  $('#btn-todos-presentes').disabled = $('#btn-limpar').disabled = !pessoas.length;
  $('#btn-excluir').hidden = !(existente && !ehProfessor); // excluir aula é só da coordenação
  atualizarTotais();
}

function linhaHtml(m) {
  const freq = m.frequencia?.aulas ? `Frequência ${String(m.frequencia.percentual).replace('.', ',')}% em ${m.frequencia.aulas} aula(s)` : 'Sem aulas registradas';
  const risco = m.riscoEvasao && m.status === STATUS_MATRICULA.ATIVA ? '<span class="selo selo--atencao">Risco de evasão</span>' : '';
  const situacao = m.status !== STATUS_MATRICULA.ATIVA ? `<span class="selo selo--neutro">${ROTULO_STATUS_MATRICULA[m.status]} hoje</span>` : '';
  const botoes = MARCAS.map(
    (marca) => `<button type="button" class="marca ${marca.classe}" data-marca="${marca.valor}" aria-pressed="${estado.marcas[m.alunoId] === marca.valor}"
      aria-label="${marca.nome}: ${escapar(m.alunoNome)}" title="${marca.nome}">${marca.letra}</button>`,
  ).join('');
  return `
    <li class="chamada__linha" data-aluno="${escapar(m.alunoId)}">
      <div class="chamada__pessoa">
        <strong>${escapar(m.alunoNome)}</strong>
        <span class="item__meta">${freq} ${risco} ${situacao}</span>
      </div>
      <div class="marcas" role="group" aria-label="Chamada de ${escapar(m.alunoNome)}">${botoes}</div>
    </li>`;
}

function atualizarTotais() {
  const { presentes, faltas, justificadas } = resumoDaChamada(estado.marcas);
  const semMarca = estado.pessoas.filter((p) => !estado.marcas[p.alunoId]).length;
  $('#chamada-totais').textContent = estado.pessoas.length
    ? ` · Presentes ${presentes} · Faltas ${faltas} · Justificadas ${justificadas} · Sem marcação ${semMarca}`
    : '';
}

// toque numa marca: grava no estado e atualiza só aquela linha (o foco do teclado não se perde)
$('#chamada-lista').addEventListener('click', (evento) => {
  const botao = evento.target.closest('.marca');
  if (!botao) return;
  const linha = botao.closest('[data-aluno]');
  const alunoId = linha.dataset.aluno;
  if (estado.marcas[alunoId] === botao.dataset.marca) delete estado.marcas[alunoId]; // tocar de novo desmarca
  else estado.marcas[alunoId] = botao.dataset.marca;
  estado.sujo = true;
  $$('.marca', linha).forEach((b) => b.setAttribute('aria-pressed', String(estado.marcas[alunoId] === b.dataset.marca)));
  linha.classList.remove('chamada__linha--pendente');
  atualizarTotais();
});

$('#btn-todos-presentes').addEventListener('click', () => {
  estado.pessoas.forEach((p) => (estado.marcas[p.alunoId] = PRESENCA.PRESENTE));
  estado.sujo = true;
  renderizarMarcas();
});
$('#btn-limpar').addEventListener('click', () => {
  estado.marcas = {};
  estado.sujo = true;
  renderizarMarcas();
});
function renderizarMarcas() {
  $$('#chamada-lista [data-aluno]').forEach((linha) => {
    $$('.marca', linha).forEach((b) => b.setAttribute('aria-pressed', String(estado.marcas[linha.dataset.aluno] === b.dataset.marca)));
    linha.classList.remove('chamada__linha--pendente');
  });
  atualizarTotais();
}

$('#d-conteudo').addEventListener('input', (evento) => {
  estado.conteudo = evento.target.value;
  estado.sujo = true;
});

// ---------------------------------------------------------------------------
// Turma e data
// ---------------------------------------------------------------------------
$turma.addEventListener('change', async () => {
  if (!(await podeDescartar())) return ($turma.value = estado.turmaId);
  await trocarTurma($turma.value);
});

async function trocarData(nova) {
  if (!nova || nova === estado.data) return ($data.value = estado.data);
  if (nova > hojeISO()) {
    mostrar($('#d-aviso'), 'A aula não pode ser registrada numa data futura.');
    return ($data.value = estado.data);
  }
  if (!(await podeDescartar())) return ($data.value = estado.data);
  estado.data = nova;
  $data.value = nova;
  carregarDia();
  renderizarAulas();
}
$data.addEventListener('change', () => trocarData($data.value));
$('#btn-hoje').addEventListener('click', () => trocarData(hojeISO()));

// ---------------------------------------------------------------------------
// Salvar e excluir
// ---------------------------------------------------------------------------
$('#btn-salvar').addEventListener('click', async () => {
  mostrar($('#d-erro'), '');
  const pendentes = estado.pessoas.filter((p) => !estado.marcas[p.alunoId]);
  if (pendentes.length) {
    pendentes.forEach((p) => $(`[data-aluno="${CSS.escape(p.alunoId)}"]`)?.classList.add('chamada__linha--pendente'));
    $(`[data-aluno="${CSS.escape(pendentes[0].alunoId)}"]`)?.scrollIntoView({ block: 'center' });
    return mostrar($('#d-erro'), `Falta marcar ${pendentes.length} pessoa(s). Escolha P, F ou J para cada uma, ou use "Marcar todos presentes" e ajuste só as faltas.`);
  }

  const botao = $('#btn-salvar');
  botao.disabled = true;
  try {
    const registros = Object.fromEntries(estado.pessoas.map((p) => [p.alunoId, estado.marcas[p.alunoId]]));
    const r = await registrarAula({ turmaId: estado.turmaId, data: estado.data, conteudo: estado.conteudo, registros });
    toast(
      `Aula de ${formatarData(estado.data)} registrada: ${r.resumo.presentes} presente(s), ${r.resumo.faltas} falta(s), ${r.resumo.justificadas} justificada(s).${r.emRisco ? ` ${r.emRisco} pessoa(s) em risco de evasão.` : ''}`,
      'sucesso',
    );
    await recarregarTurma();
    carregarDia();
    renderizarAulas();
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) mostrar($('#d-erro'), erro.message);
    else {
      console.error(erro);
      mostrar($('#d-erro'), 'Não foi possível salvar agora. Verifique a conexão e tente de novo.');
    }
    botao.disabled = false;
  }
});

$('#btn-excluir').addEventListener('click', async () => {
  const ok = await confirmar({
    titulo: `Excluir a aula de ${formatarData(estado.data)}?`,
    mensagem: 'A chamada e o conteúdo são apagados e a frequência de todas as pessoas da turma é recalculada sem esta aula.',
    rotulo: 'Excluir aula',
    perigo: true,
  });
  if (!ok) return;
  try {
    await excluirAula({ turmaId: estado.turmaId, data: estado.data });
    toast(`Aula de ${formatarData(estado.data)} excluída. Frequências recalculadas.`, 'sucesso');
  } catch (erro) {
    tratarErro(erro);
  }
  await recarregarTurma().catch(console.error);
  carregarDia();
  renderizarAulas();
});

// ---------------------------------------------------------------------------
// Aulas já registradas
// ---------------------------------------------------------------------------
function renderizarAulas() {
  $('#titulo-aulas').hidden = false;
  $('#aulas').innerHTML = estado.aulas.length
    ? estado.aulas.map(aulaHtml).join('')
    : '<p class="estado-vazio">Nenhuma aula registrada nesta turma ainda.</p>';
}

function aulaHtml(a) {
  const { presentes, faltas, justificadas } = a.resumo ?? resumoDaChamada(a.registros);
  const atual = a.data === estado.data;
  return `
    <article class="cartao item" data-data="${escapar(a.data)}">
      <div class="item__principal">
        <h3 class="item__titulo">${diaCurto(a.data)}, ${formatarData(a.data)} ${atual ? '<span class="selo selo--info">Em edição</span>' : ''}</h3>
        <p class="item__meta">${a.conteudo ? escapar(a.conteudo) : 'Sem conteúdo registrado'}</p>
        <p class="item__meta">${presentes} presente(s) · ${faltas} falta(s) · ${justificadas} justificada(s)</p>
      </div>
      <div class="item__acoes"><button class="botao botao--fantasma" type="button" data-abrir>${atual ? 'Aberta' : 'Abrir'}</button></div>
    </article>`;
}

$('#aulas').addEventListener('click', async (evento) => {
  const botao = evento.target.closest('[data-abrir]');
  if (!botao) return;
  await trocarData(botao.closest('[data-data]').dataset.data);
  $('#chamada').scrollIntoView({ block: 'start' });
});

// avisa antes de fechar a aba com chamada não salva
window.addEventListener('beforeunload', (evento) => {
  if (estado.sujo) evento.preventDefault();
});

iniciar();
