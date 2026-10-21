import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { $, $$, confirmar, escapar, toast } from '../core/ui.js';
import { deInputDataHora, formatarData, formatarDataHora, paraInputDataHora } from '../core/datas.js';
import { ErroDeNegocio } from '../core/erros.js';
import { MODALIDADE_SELECAO, PAPEIS, STATUS_EDITAL, TIPO_REQUISITO } from '../models/schema.js';
import {
  AJUDA_MODALIDADE,
  ROTULO_AVANCAR_EDITAL,
  ROTULO_MODALIDADE,
  ROTULO_STATUS_EDITAL,
  ROTULO_TIPO_REQUISITO,
} from '../models/rotulos.js';
import { atualizarEdital, avancarEtapa, criarEdital, listarEditais } from '../services/editais.service.js';
import { listarTurmasOfertaveis } from '../services/turmas.service.js';

const eu = await exigirLogin({ papeis: [PAPEIS.ADMIN, PAPEIS.COORDENADOR] });
montarShell({ ativo: 'editais', perfil: eu });

const lista = $('#lista');
const dialogo = $('#dlg-edital');
const form = $('#form-edital');

const estado = {
  editais: [],
  turmasOfertaveis: [],
  editandoId: null, // null = novo edital
  requisitos: [], // requisitos do formulário aberto: [{ id, tipo, rotulo }]
};

const SELO_STATUS = {
  rascunho: 'selo--neutro',
  inscricoes: 'selo--sucesso',
  selecao: 'selo--atencao',
  matriculas: 'selo--info',
  encerrado: 'selo--neutro',
};

const EXPLICACAO_AVANCAR = {
  rascunho: 'O formulário do site passará a aceitar inscrições dentro da janela de datas. Depois disso o edital não poderá mais ser editado.',
  inscricoes: 'O formulário deixa de aceitar inscrições e a seleção (sorteio, classificação…) poderá ser executada.',
  selecao: 'O resultado passa a valer e os convocados poderão se matricular. Confira se a seleção foi executada em todas as turmas.',
  matriculas: 'Encerra o processo: a tela de inscrições deste edital passa a ser somente consulta.',
};

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------
async function carregar() {
  lista.innerHTML = '<div class="cartao item item--carregando"></div>'.repeat(2);
  try {
    estado.editais = await listarEditais();
    renderizar();
  } catch (erro) {
    console.error(erro);
    lista.innerHTML = `
      <div class="aviso" role="alert">
        Não foi possível carregar os editais. Confira a configuração do Firebase e as regras do Firestore.
        <button class="link-botao" type="button" data-acao="recarregar">Tentar de novo</button>
      </div>`;
  }
}

function renderizar() {
  lista.innerHTML = estado.editais.length
    ? estado.editais.map(editalHtml).join('')
    : '<p class="estado-vazio">Nenhum edital ainda. Clique em "Novo edital" para começar.</p>';
}

function editalHtml(e) {
  const requisitos = e.requisitosMatricula.length
    ? e.requisitosMatricula.map((r) => escapar(r.rotulo)).join(', ')
    : 'nenhum';
  const proximo = ROTULO_AVANCAR_EDITAL[e.status];
  const resultado = e.dataResultado ? ` · Resultado em ${formatarData(e.dataResultado)}` : '';

  return `
    <article class="cartao item" data-id="${escapar(e.id)}">
      <div class="item__principal">
        <h2 class="item__titulo">${escapar(e.titulo)} <span class="selo ${SELO_STATUS[e.status]}">${ROTULO_STATUS_EDITAL[e.status]}</span></h2>
        <p class="item__meta"><strong>${ROTULO_MODALIDADE[e.modalidade]}</strong>${e.config.listaEspera ? ' · com lista de espera' : ' · sem lista de espera'}</p>
        <p class="item__meta">Inscrições: ${formatarDataHora(e.inscricoesInicio)} a ${formatarDataHora(e.inscricoesFim)}${resultado}</p>
        <p class="item__meta">Turmas: ${e.turmas.map((t) => escapar(t.nome)).join(', ')}</p>
        <p class="item__meta">Requisitos de matrícula: ${requisitos} · prazo de ${e.config.prazoMatriculaDias} dia(s) após a convocação</p>
      </div>
      <div class="item__acoes">
        ${e.status === STATUS_EDITAL.RASCUNHO ? '<button class="botao botao--fantasma" type="button" data-acao="editar">Editar</button>' : ''}
        ${e.status !== STATUS_EDITAL.RASCUNHO ? `<a class="botao botao--fantasma" href="inscricoes.html?edital=${encodeURIComponent(e.id)}">Ver inscrições</a>` : ''}
        ${proximo ? `<button class="botao" type="button" data-acao="avancar">${proximo}</button>` : ''}
      </div>
    </article>`;
}

lista.addEventListener('click', async (evento) => {
  const botao = evento.target.closest('[data-acao]');
  if (!botao) return;
  if (botao.dataset.acao === 'recarregar') return carregar();

  const edital = estado.editais.find((e) => e.id === botao.closest('[data-id]').dataset.id);
  if (botao.dataset.acao === 'editar') return abrirFormulario(edital);

  if (botao.dataset.acao === 'avancar') {
    const ok = await confirmar({
      titulo: ROTULO_AVANCAR_EDITAL[edital.status],
      mensagem: EXPLICACAO_AVANCAR[edital.status],
      rotulo: ROTULO_AVANCAR_EDITAL[edital.status],
    });
    if (!ok) return;
    botao.disabled = true;
    try {
      await avancarEtapa(edital.id);
      toast(`Edital "${edital.titulo}" avançou de etapa.`, 'sucesso');
    } catch (erro) {
      if (erro instanceof ErroDeNegocio) toast(erro.message, 'erro');
      else {
        console.error(erro);
        toast('Não foi possível avançar a etapa agora. Tente de novo.', 'erro');
      }
    }
    carregar();
  }
});

// ---------------------------------------------------------------------------
// Formulário (novo / editar rascunho)
// ---------------------------------------------------------------------------
const selModalidade = $('#ed-modalidade');
const caixaErro = $('#edital-erro');

selModalidade.innerHTML = Object.values(MODALIDADE_SELECAO)
  .map((m) => `<option value="${m}">${ROTULO_MODALIDADE[m]}</option>`)
  .join('');
$('#ed-req-tipo').innerHTML = Object.values(TIPO_REQUISITO)
  .map((t) => `<option value="${t}">${ROTULO_TIPO_REQUISITO[t]}</option>`)
  .join('');

function sincronizarModalidade() {
  const modalidade = selModalidade.value;
  $('#ed-modalidade-ajuda').textContent = AJUDA_MODALIDADE[modalidade];
  $$('[data-so="prova"]').forEach((el) => (el.hidden = modalidade !== MODALIDADE_SELECAO.PROVA));
  $('#ed-lista-espera').closest('.check').hidden = modalidade === MODALIDADE_SELECAO.ANALISE;
}
selModalidade.addEventListener('change', sincronizarModalidade);

const mostrarErro = (texto) => {
  caixaErro.textContent = texto;
  caixaErro.hidden = !texto;
};

/** Gera um id estável a partir do rótulo ("Taxa de matrícula" → "taxa-de-matricula"), único na lista. */
function idDoRequisito(rotulo) {
  const base =
    rotulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'requisito';
  let id = base;
  for (let n = 2; estado.requisitos.some((r) => r.id === id); n++) id = `${base}-${n}`;
  return id;
}

function renderizarRequisitos() {
  $('#ed-requisitos').innerHTML = estado.requisitos
    .map(
      (r) => `<span class="chip">${ROTULO_TIPO_REQUISITO[r.tipo]} · ${escapar(r.rotulo)}
        <button type="button" data-remover="${escapar(r.id)}" aria-label="Remover ${escapar(r.rotulo)}">×</button></span>`,
    )
    .join('');
}

$('#ed-req-add').addEventListener('click', () => {
  const campo = $('#ed-req-rotulo');
  const rotulo = campo.value.trim();
  if (!rotulo) return campo.focus();
  estado.requisitos.push({ id: idDoRequisito(rotulo), tipo: $('#ed-req-tipo').value, rotulo });
  campo.value = '';
  renderizarRequisitos();
  campo.focus();
});
$('#ed-req-rotulo').addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter') {
    evento.preventDefault(); // Enter adiciona o requisito em vez de enviar o formulário
    $('#ed-req-add').click();
  }
});
$('#ed-requisitos').addEventListener('click', (evento) => {
  const botao = evento.target.closest('[data-remover]');
  if (!botao) return;
  estado.requisitos = estado.requisitos.filter((r) => r.id !== botao.dataset.remover);
  renderizarRequisitos();
});

async function abrirFormulario(edital = null) {
  estado.editandoId = edital?.id ?? null;
  estado.requisitos = structuredClone(edital?.requisitosMatricula ?? []);
  mostrarErro('');

  $('#edital-titulo-dlg').textContent = edital ? 'Editar edital' : 'Novo edital';
  $('#ed-titulo').value = edital?.titulo ?? '';
  $('#ed-descricao').value = edital?.descricao ?? '';
  selModalidade.value = edital?.modalidade ?? MODALIDADE_SELECAO.SORTEIO;
  $('#ed-inicio').value = paraInputDataHora(edital?.inscricoesInicio);
  $('#ed-fim').value = paraInputDataHora(edital?.inscricoesFim);
  $('#ed-resultado').value = edital?.dataResultado ?? '';
  $('#ed-lista-espera').checked = edital?.config.listaEspera ?? true;
  $('#ed-prazo').value = edital?.config.prazoMatriculaDias ?? 5;
  $('#ed-nota-min').value = edital?.config.notaMinima ?? 0;
  $('#ed-nota-max').value = edital?.config.notaMaxima ?? 10;
  $('#ed-req-rotulo').value = '';
  sincronizarModalidade();
  renderizarRequisitos();

  $('#ed-turmas').innerHTML = '<p class="campo__ajuda">Carregando turmas…</p>';
  dialogo.showModal();

  try {
    estado.turmasOfertaveis = await listarTurmasOfertaveis();
  } catch (erro) {
    console.error(erro);
    estado.turmasOfertaveis = [];
  }
  // junta as turmas já escolhidas (podem ter deixado de aceitar matrícula) às disponíveis
  const todas = new Map(estado.turmasOfertaveis.map((t) => [t.id, t]));
  (edital?.turmas ?? []).forEach((t) => todas.has(t.id) || todas.set(t.id, t));
  const marcadas = new Set(edital?.turmaIds ?? []);

  $('#ed-turmas').innerHTML = todas.size
    ? [...todas.values()]
        .map(
          (t) => `<label class="check"><input type="checkbox" name="turma" value="${escapar(t.id)}" ${marcadas.has(t.id) ? 'checked' : ''} />
            ${escapar(t.nome)}${t.cursoNome ? ` <span class="item__meta">· ${escapar(t.cursoNome)}</span>` : ''}</label>`,
        )
        .join('')
    : '<p class="campo__ajuda">Nenhuma turma disponível. Cadastre uma turma antes (por enquanto, direto no console do Firestore).</p>';
}

$('#btn-novo').addEventListener('click', () => abrirFormulario());
$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = $('#edital-salvar');
  mostrarErro('');

  const turmasMarcadas = $$('input[name="turma"]:checked', form).map((c) => c.value);
  const turmasPorId = new Map(estado.turmasOfertaveis.map((t) => [t.id, t]));
  (estado.editais.find((e) => e.id === estado.editandoId)?.turmas ?? []).forEach((t) => turmasPorId.has(t.id) || turmasPorId.set(t.id, t));
  const turmas = turmasMarcadas.map((id) => {
    const t = turmasPorId.get(id);
    return { id, nome: t.nome, cursoId: t.cursoId, cursoNome: t.cursoNome };
  });

  const dados = {
    titulo: $('#ed-titulo').value,
    descricao: $('#ed-descricao').value.trim(),
    modalidade: selModalidade.value,
    inscricoesInicio: deInputDataHora($('#ed-inicio').value),
    inscricoesFim: deInputDataHora($('#ed-fim').value),
    dataResultado: $('#ed-resultado').value || null,
    turmas,
    requisitosMatricula: estado.requisitos,
    config: {
      listaEspera: selModalidade.value === MODALIDADE_SELECAO.ANALISE ? false : $('#ed-lista-espera').checked,
      prazoMatriculaDias: Number($('#ed-prazo').value),
      notaMinima: Number($('#ed-nota-min').value) || 0,
      notaMaxima: Number($('#ed-nota-max').value) || 10,
    },
  };

  botao.disabled = true;
  try {
    if (estado.editandoId) await atualizarEdital(estado.editandoId, dados);
    else await criarEdital(dados);
    dialogo.close();
    toast('Edital salvo como rascunho.', 'sucesso');
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
