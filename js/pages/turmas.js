import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { $, $$, escapar, toast } from '../core/ui.js';
import { formatarData } from '../core/datas.js';
import { ErroDeNegocio } from '../core/erros.js';
import { DIAS_SEMANA, PAPEIS, STATUS_TURMA } from '../models/schema.js';
import { ROTULO_DIA, ROTULO_STATUS_TURMA } from '../models/rotulos.js';
import { listarCursos } from '../services/cursos.service.js';
import { listarTurmas, salvarTurma, vagasLivres } from '../services/turmas.service.js';
import { listarEquipeAtiva } from '../services/usuarios.service.js';

const eu = await exigirLogin({ papeis: [PAPEIS.ADMIN, PAPEIS.COORDENADOR] });
montarShell({ ativo: 'turmas', perfil: eu });

const EM_USO = [STATUS_TURMA.PLANEJADA, STATUS_TURMA.ABERTA, STATUS_TURMA.EM_ANDAMENTO];

const SELO_STATUS = {
  planejada: 'selo--neutro',
  aberta: 'selo--info',
  em_andamento: 'selo--sucesso',
  encerrada: 'selo--neutro',
  cancelada: 'selo--erro',
};

const estado = {
  turmas: [],
  cursos: [],
  equipe: [],
  filtroCurso: new URLSearchParams(location.search).get('curso') ?? '',
  filtroStatus: 'em-uso',
  editando: null, // turma aberta no formulário (null = nova)
};

const lista = $('#lista');
const dialogo = $('#dlg-turma');
const caixaErro = $('#turma-erro');
const mostrarErro = (texto) => {
  caixaErro.textContent = texto;
  caixaErro.hidden = !texto;
};

// ---------------------------------------------------------------------------
// Carregamento e lista
// ---------------------------------------------------------------------------
async function carregar() {
  lista.innerHTML = '<div class="cartao item item--carregando"></div>'.repeat(3);
  try {
    [estado.turmas, estado.cursos] = await Promise.all([listarTurmas(), listarCursos()]);
    estado.equipe = await listarEquipeAtiva().catch((erro) => {
      console.error(erro); // sem a lista de professores o formulário ainda funciona, só sem escolher professor
      return [];
    });
    montarFiltros();
    renderizar();
  } catch (erro) {
    console.error(erro);
    lista.innerHTML = `
      <div class="aviso" role="alert">
        Não foi possível carregar as turmas. Confira a configuração do Firebase e as regras do Firestore.
        <button class="link-botao" type="button" data-acao="recarregar">Tentar de novo</button>
      </div>`;
  }
}

function montarFiltros() {
  $('#f-curso').innerHTML =
    '<option value="">Todos os cursos</option>' +
    estado.cursos.map((c) => `<option value="${escapar(c.id)}">${escapar(c.nome)}${c.ativo ? '' : ' (inativo)'}</option>`).join('');
  $('#f-curso').value = estado.filtroCurso;
  if ($('#f-curso').value !== estado.filtroCurso) estado.filtroCurso = ''; // ?curso= de um curso que não existe

  $('#f-status').innerHTML =
    '<option value="em-uso">Em uso (planejadas, abertas e em andamento)</option><option value="todas">Todas</option>' +
    Object.entries(ROTULO_STATUS_TURMA).map(([valor, rotulo]) => `<option value="${valor}">${rotulo}</option>`).join('');
  $('#f-status').value = estado.filtroStatus;
}

$('#f-curso').addEventListener('change', () => {
  estado.filtroCurso = $('#f-curso').value;
  renderizar();
});
$('#f-status').addEventListener('change', () => {
  estado.filtroStatus = $('#f-status').value;
  renderizar();
});

function visiveis() {
  return estado.turmas.filter((t) => {
    if (estado.filtroCurso && t.cursoId !== estado.filtroCurso) return false;
    if (estado.filtroStatus === 'todas') return true;
    if (estado.filtroStatus === 'em-uso') return EM_USO.includes(t.status);
    return t.status === estado.filtroStatus;
  });
}

function renderizar() {
  const turmas = visiveis();
  if (!turmas.length) {
    lista.innerHTML = estado.turmas.length
      ? '<p class="estado-vazio">Nenhuma turma com estes filtros.</p>'
      : '<p class="estado-vazio">Nenhuma turma ainda. Clique em "Nova turma" para começar (é preciso ter um curso ativo).</p>';
    return;
  }
  lista.innerHTML = turmas.map(turmaHtml).join('');
}

function turmaHtml(t) {
  const dias = (t.diasSemana ?? []).map((d) => ROTULO_DIA[d].slice(0, 3)).join(', ');
  const horario = t.horarioInicio ? `${t.horarioInicio}–${t.horarioFim}` : '';
  const periodo = t.dataInicio || t.dataFim ? `${t.dataInicio ? formatarData(t.dataInicio) : '…'} a ${t.dataFim ? formatarData(t.dataFim) : '…'}` : '';
  const agenda = [dias, horario, periodo].filter(Boolean).join(' · ') || 'Dias e horário ainda não definidos';
  const livres = Math.max(0, vagasLivres(t));

  return `
    <article class="cartao item" data-id="${escapar(t.id)}">
      <div class="item__principal">
        <h2 class="item__titulo">${escapar(t.nome)} <span class="selo ${SELO_STATUS[t.status]}">${ROTULO_STATUS_TURMA[t.status]}</span></h2>
        <p class="item__meta"><strong>${escapar(t.cursoNome)}</strong> · ${t.professorNome ? `Professor: ${escapar(t.professorNome)}` : 'Sem professor definido'}</p>
        <p class="item__meta">${escapar(agenda)}</p>
        <p class="item__meta">Vagas: <strong>${t.vagas}</strong> · ${t.vagasOcupadas} matriculado(s) · ${t.vagasReservadas ?? 0} convocado(s) · ${livres} livre(s)</p>
      </div>
      <div class="item__acoes">
        <button class="botao botao--fantasma" type="button" data-acao="editar">Editar</button>
      </div>
    </article>`;
}

lista.addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-acao]');
  if (!botao) return;
  if (botao.dataset.acao === 'recarregar') return carregar();
  if (botao.dataset.acao === 'editar') {
    abrirFormulario(estado.turmas.find((t) => t.id === botao.closest('[data-id]').dataset.id));
  }
});

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------
const selCurso = $('#tm-curso');
const selProfessor = $('#tm-professor');

$('#tm-dias').innerHTML = DIAS_SEMANA.map(
  (d) => `<label class="check"><input type="checkbox" name="dia" value="${d}" /> ${ROTULO_DIA[d]}</label>`,
).join('');
$('#tm-status').innerHTML = Object.entries(ROTULO_STATUS_TURMA)
  .map(([valor, rotulo]) => `<option value="${valor}">${rotulo}</option>`)
  .join('');

function abrirFormulario(turma = null) {
  estado.editando = turma;
  mostrarErro('');
  $('#turma-titulo-dlg').textContent = turma ? 'Editar turma' : 'Nova turma';

  // curso: só ativos (mais o da própria turma, se estiver desativado)
  const opcoesDeCurso = estado.cursos.filter((c) => c.ativo || c.id === turma?.cursoId);
  selCurso.innerHTML =
    (turma ? '' : '<option value="">Escolha o curso…</option>') +
    opcoesDeCurso.map((c) => `<option value="${escapar(c.id)}">${escapar(c.nome)}${c.ativo ? '' : ' (inativo)'}</option>`).join('');
  selCurso.value = turma?.cursoId ?? (estado.filtroCurso && opcoesDeCurso.some((c) => c.id === estado.filtroCurso) ? estado.filtroCurso : '');

  // professor: equipe ativa (mais o atual, se saiu da equipe)
  const equipe = estado.equipe.map((u) => ({ id: u.id, rotulo: `${u.nome ?? u.email} (${u.papel})` }));
  if (turma?.professorId && !equipe.some((u) => u.id === turma.professorId)) {
    equipe.push({ id: turma.professorId, rotulo: `${turma.professorNome ?? 'Professor'} (fora da equipe ativa)` });
  }
  selProfessor.innerHTML =
    '<option value="">Sem professor definido</option>' + equipe.map((u) => `<option value="${escapar(u.id)}">${escapar(u.rotulo)}</option>`).join('');
  selProfessor.value = turma?.professorId ?? '';

  $('#tm-nome').value = turma?.nome ?? '';
  $('#tm-vagas').value = turma?.vagas ?? 20;
  $$('input[name="dia"]').forEach((c) => (c.checked = (turma?.diasSemana ?? []).includes(c.value)));
  $('#tm-hini').value = turma?.horarioInicio ?? '';
  $('#tm-hfim').value = turma?.horarioFim ?? '';
  $('#tm-dini').value = turma?.dataInicio ?? '';
  $('#tm-dfim').value = turma?.dataFim ?? '';
  $('#tm-status').value = turma?.status ?? STATUS_TURMA.PLANEJADA;

  // proteções: explica de antemão o que o sistema vai recusar
  const ocupadas = turma?.vagasOcupadas ?? 0;
  const reservadas = turma?.vagasReservadas ?? 0;
  const comprometidas = ocupadas + reservadas;
  const aviso = $('#turma-aviso');
  aviso.textContent = comprometidas
    ? `Esta turma já tem ${ocupadas} matriculado(s) e ${reservadas} convocado(s): o curso não pode mudar e o total de vagas não pode ser menor que ${comprometidas}.`
    : '';
  aviso.hidden = !comprometidas;
  selCurso.disabled = comprometidas > 0;
  $('#tm-vagas').min = String(Math.max(1, comprometidas));

  dialogo.showModal();
  $('#tm-nome').focus();
}

$('#btn-novo').addEventListener('click', () => abrirFormulario());
$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('#form-turma').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = $('#turma-salvar');
  mostrarErro('');
  botao.disabled = true;
  try {
    await salvarTurma(estado.editando?.id ?? null, {
      cursoId: selCurso.value,
      nome: $('#tm-nome').value,
      professorId: selProfessor.value,
      vagas: $('#tm-vagas').value,
      diasSemana: $$('input[name="dia"]:checked').map((c) => c.value),
      horarioInicio: $('#tm-hini').value,
      horarioFim: $('#tm-hfim').value,
      dataInicio: $('#tm-dini').value,
      dataFim: $('#tm-dfim').value,
      status: $('#tm-status').value,
    });
    dialogo.close();
    toast('Turma salva.', 'sucesso');
    carregar();
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) mostrarErro(erro.message);
    else {
      console.error(erro);
      mostrarErro('Não foi possível salvar agora. Verifique a conexão e tente de novo.');
    }
  } finally {
    botao.disabled = false;
  }
});

carregar();
