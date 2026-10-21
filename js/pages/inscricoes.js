import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { $, $$, escapar, toast } from '../core/ui.js';
import { formatarData, formatarDataHora, hojeISO } from '../core/datas.js';
import { ErroDeNegocio } from '../core/erros.js';
import { MODALIDADE_SELECAO as M, PAPEIS, STATUS_EDITAL as E, STATUS_INSCRICAO as S } from '../models/schema.js';
import { ROTULO_MODALIDADE, ROTULO_STATUS_INSCRICAO } from '../models/rotulos.js';
import { temSelecaoAutomatica, verificarSorteio } from '../domain/selecao.js';
import { editaisRepo, listarEditais } from '../services/editais.service.js';
import {
  convocarInscricao,
  convocarProximoRemanescente,
  desistirDaVaga,
  efetivarMatricula,
  indeferirInscricao,
  listarInscricoesDoEdital,
  marcarRequisito,
  registrarNota,
} from '../services/inscricoes.service.js';
import { executarSelecao, obterSelecao } from '../services/selecao.service.js';
import { turmasRepo, vagasLivres } from '../services/turmas.service.js';

// Convocar, matricular e liberar vagas mexem em contadores: só gestão (as regras do Firestore também exigem).
const eu = await exigirLogin({ papeis: [PAPEIS.ADMIN, PAPEIS.COORDENADOR] });
montarShell({ ativo: 'inscricoes', perfil: eu });

const ABAS = [
  { id: 'inscrita', rotulo: 'Inscritas', status: [S.INSCRITA], vazio: 'Nenhuma inscrição aguardando seleção.' },
  { id: 'convocada', rotulo: 'Convocadas', status: [S.CONVOCADA], vazio: 'Ninguém convocado aguardando matrícula.' },
  { id: 'remanescente', rotulo: 'Remanescentes', status: [S.REMANESCENTE], vazio: 'Lista de remanescentes vazia.' },
  { id: 'matriculada', rotulo: 'Matriculadas', status: [S.MATRICULADA], vazio: 'Nenhuma matrícula efetivada ainda.' },
  { id: 'encerrada', rotulo: 'Encerradas', status: [S.NAO_SELECIONADA, S.INDEFERIDA, S.DESISTENTE], vazio: 'Nada por aqui.' },
];

const ROTULO_EXECUTAR = {
  [M.SORTEIO]: 'Executar sorteio',
  [M.PROVA]: 'Classificar por nota',
  [M.ORDEM_CHEGADA]: 'Aplicar ordem de inscrição',
};

const estado = {
  editais: [], // todos, exceto rascunhos
  edital: null,
  itens: [], // inscrições do edital
  turmas: new Map(), // id → turma (com vagas atuais)
  registros: new Map(), // turmaId → registro da seleção (ou null)
  turmaId: '', // filtro; '' = todas
  aba: 'inscrita',
  alvo: null, // inscrição aberta num diálogo
};

const $lista = $('#lista');
const $selEdital = $('#sel-edital');
const $selTurma = $('#sel-turma');

const somenteConsulta = () => estado.edital?.status === E.ENCERRADO;
const nomeTurma = (id) => estado.edital.turmas.find((t) => t.id === id)?.nome ?? 'Turma removida';
const mostrar = (elemento, texto) => {
  elemento.textContent = texto;
  elemento.hidden = !texto;
};
const instante = (valor) => valor?.toMillis?.() ?? 0;

// ---------------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------------
async function iniciar() {
  $lista.innerHTML = '<div class="cartao item item--carregando"></div>'.repeat(3);
  try {
    estado.editais = (await listarEditais()).filter((e) => e.status !== E.RASCUNHO);
  } catch (erro) {
    console.error(erro);
    return mostrarFalha();
  }

  if (!estado.editais.length) {
    $selEdital.innerHTML = '<option value="">Nenhum edital</option>';
    $selEdital.disabled = $selTurma.disabled = true;
    $lista.innerHTML = '<p class="estado-vazio">Nenhum edital com inscrições ainda. Abra as inscrições de um edital na página <a href="editais.html">Editais</a>.</p>';
    return;
  }

  $selEdital.innerHTML = estado.editais.map((e) => `<option value="${escapar(e.id)}">${escapar(e.titulo)}</option>`).join('');
  const pedido = new URLSearchParams(location.search).get('edital');
  const inicial =
    estado.editais.find((e) => e.id === pedido) ?? estado.editais.find((e) => e.status !== E.ENCERRADO) ?? estado.editais[0];
  await selecionarEdital(inicial.id);
}

function mostrarFalha() {
  $lista.innerHTML = `
    <div class="aviso" role="alert">
      Não foi possível carregar as inscrições. Confira a configuração do Firebase e as regras do Firestore.
      <button class="link-botao" type="button" data-acao="recarregar">Tentar de novo</button>
    </div>`;
}

async function selecionarEdital(id) {
  estado.edital = estado.editais.find((e) => e.id === id);
  $selEdital.value = id;
  estado.turmaId = '';
  $selTurma.innerHTML =
    '<option value="">Todas as turmas</option>' +
    estado.edital.turmas.map((t) => `<option value="${escapar(t.id)}">${escapar(t.nome)}</option>`).join('');
  await recarregar();
  estado.aba = ABAS.find((a) => contar(a) > 0)?.id ?? 'inscrita'; // abre na primeira aba com algo para fazer
  renderizar();
}

/** Relê edital, inscrições, vagas das turmas e registros de seleção (após qualquer ação). */
async function recarregar() {
  const ed = estado.edital;
  try {
    const [atual, itens, turmas, registros] = await Promise.all([
      editaisRepo.obter(ed.id),
      listarInscricoesDoEdital(ed.id),
      Promise.all(ed.turmaIds.map((id) => turmasRepo.obter(id))),
      Promise.all(ed.turmaIds.map((id) => obterSelecao(ed.id, id))),
    ]);
    estado.edital = atual ?? ed;
    estado.editais = estado.editais.map((e) => (e.id === ed.id ? estado.edital : e));
    estado.itens = itens;
    estado.turmas = new Map(turmas.filter(Boolean).map((t) => [t.id, t]));
    estado.registros = new Map(ed.turmaIds.map((id, i) => [id, registros[i]]));
  } catch (erro) {
    console.error(erro);
    mostrarFalha();
    throw erro;
  }
}

function tratarErro(erro) {
  if (erro instanceof ErroDeNegocio) return toast(erro.message, 'erro');
  console.error(erro);
  toast('Não foi possível concluir agora. Verifique a conexão e tente de novo.', 'erro');
}

/** Executa uma ação, avisa o resultado e relê os dados (inclusive após erro, pois o estado pode ter mudado). */
async function executar(acao, botao) {
  if (botao) botao.disabled = true;
  try {
    return await acao();
  } catch (erro) {
    tratarErro(erro);
  } finally {
    await recarregar().then(renderizar, () => {});
  }
}

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------
const visiveis = () => estado.itens.filter((i) => !estado.turmaId || i.turmaId === estado.turmaId);
const contar = (aba) => visiveis().filter((i) => aba.status.includes(i.status)).length;

function renderizar() {
  $('#sub').textContent = `${ROTULO_MODALIDADE[estado.edital.modalidade]} · ${estado.itens.length} inscrição(ões) no edital`;
  renderizarPainel();
  renderizarAbas();
  renderizarLista();
}

function renderizarAbas() {
  $('#abas').innerHTML = ABAS.map((a) => {
    const n = contar(a);
    return `<button class="aba" role="tab" type="button" data-aba="${a.id}" aria-selected="${a.id === estado.aba}" aria-controls="lista">
      ${a.rotulo} ${n ? `<span class="aba__contagem">${n}</span>` : ''}</button>`;
  }).join('');
}

function renderizarPainel() {
  const painel = $('#painel-turma');
  const ed = estado.edital;
  const automatica = temSelecaoAutomatica(ed.modalidade);

  const avisos = [];
  if (ed.status === E.INSCRICOES) {
    avisos.push('As inscrições ainda estão abertas. Para executar a seleção, encerre-as na página <a href="editais.html">Editais</a>.');
  }
  if (somenteConsulta()) avisos.push('Edital encerrado: esta tela está somente para consulta.');

  if (!estado.turmaId) {
    if (automatica && ed.status === E.SELECAO) avisos.push('Escolha uma turma para executar a seleção.');
    painel.hidden = !avisos.length;
    painel.innerHTML = avisos.map((a) => `<p class="item__meta">${a}</p>`).join('');
    return;
  }

  const turma = estado.turmas.get(estado.turmaId);
  if (!turma) {
    painel.hidden = false;
    painel.innerHTML = '<p class="item__meta">Esta turma não foi encontrada.</p>';
    return;
  }
  const livres = vagasLivres(turma);
  const registro = estado.registros.get(estado.turmaId);
  const daTurma = estado.itens.filter((i) => i.turmaId === estado.turmaId);
  const remanescentes = daTurma.filter((i) => i.status === S.REMANESCENTE).length;
  const semNota = daTurma.filter((i) => i.status === S.INSCRITA && typeof i.nota !== 'number').length;

  const botoes = [];
  if (automatica && ed.status === E.SELECAO && !registro) {
    botoes.push(`<button class="botao" type="button" data-acao="selecionar">${ROTULO_EXECUTAR[ed.modalidade]}</button>`);
  }
  if (registro) {
    botoes.push('<button class="botao botao--fantasma" type="button" data-acao="registro">Ver registro da seleção</button>');
  }
  if (!somenteConsulta() && remanescentes > 0 && livres > 0 && [E.SELECAO, E.MATRICULAS].includes(ed.status)) {
    botoes.push('<button class="botao botao--fantasma" type="button" data-acao="proximo-remanescente">Convocar próximo remanescente</button>');
  }
  if (ed.modalidade === M.PROVA && ed.status !== E.ENCERRADO && !registro && semNota > 0) {
    avisos.push(`${semNota} inscrito(s) sem nota: ficarão fora da classificação.`);
  }
  if (registro) avisos.push(`Seleção executada em ${formatarDataHora(registro.executadaEm)}.`);

  painel.hidden = false;
  painel.innerHTML = `
    <div class="painel-turma__vagas">
      <span>Vagas <strong>${turma.vagas}</strong></span>
      <span>Matriculados <strong>${turma.vagasOcupadas}</strong></span>
      <span>Convocados reservando vaga <strong>${turma.vagasReservadas ?? 0}</strong></span>
      <span>Livres <strong>${livres}</strong></span>
    </div>
    ${avisos.map((a) => `<p class="item__meta">${a}</p>`).join('')}
    ${botoes.length ? `<div class="item__acoes">${botoes.join('')}</div>` : ''}`;
}

/** Ordem de cada aba: por turma e, dentro dela, pelo critério que faz sentido para a etapa. */
function ordenar(aba, itens) {
  const chave = {
    inscrita: (i) => instante(i.criadoEm),
    convocada: (i) => i.selecao?.posicao ?? instante(i.convocadaEm),
    remanescente: (i) => i.posicaoRemanescente ?? 0,
    matriculada: (i) => -instante(i.matriculadaEm),
    encerrada: (i) => -instante(i.encerradaEm || i.criadoEm),
  }[aba.id];
  return [...itens].sort((a, b) => nomeTurma(a.turmaId).localeCompare(nomeTurma(b.turmaId), 'pt-BR') || chave(a) - chave(b));
}

function renderizarLista() {
  const aba = ABAS.find((a) => a.id === estado.aba);
  const itens = ordenar(aba, visiveis().filter((i) => aba.status.includes(i.status)));
  $lista.innerHTML = itens.length ? itens.map(itemHtml).join('') : `<p class="estado-vazio">${aba.vazio}</p>`;
}

function itemHtml(i) {
  const { extra, acoes } = detalhes(i);
  const meta = [
    !estado.turmaId ? `<strong>${escapar(nomeTurma(i.turmaId))}</strong>` : '',
    `recebida em ${formatarDataHora(i.criadoEm)}`,
  ].filter(Boolean);

  return `
    <article class="cartao item" data-id="${escapar(i.id)}">
      <div class="item__principal">
        <h2 class="item__titulo">${escapar(i.nome)}</h2>
        <p class="item__meta"><a href="mailto:${escapar(i.email)}">${escapar(i.email)}</a>${i.telefone ? ` · ${escapar(i.telefone)}` : ''}</p>
        <p class="item__meta">${meta.join(' · ')}</p>
        ${i.mensagem ? `<p class="item__mensagem">${escapar(i.mensagem)}</p>` : ''}
        ${extra}
      </div>
      <div class="item__acoes">${acoes}</div>
    </article>`;
}

/** Informações e botões de cada situação da inscrição. */
function detalhes(i) {
  const ed = estado.edital;
  const consulta = somenteConsulta();
  const botao = (acao, rotulo, classe = 'botao--fantasma', atributos = '') =>
    consulta ? '' : `<button class="botao ${classe}" type="button" data-acao="${acao}" ${atributos}>${rotulo}</button>`;

  switch (i.status) {
    case S.INSCRITA: {
      const nota =
        ed.modalidade === M.PROVA && !consulta
          ? `<label class="item__meta">Nota <input class="entrada-pequena" type="number" step="0.1" min="0" max="${ed.config.notaMaxima}"
               value="${i.nota ?? ''}" data-acao="nota" aria-label="Nota de ${escapar(i.nome)}" /></label>`
          : ed.modalidade === M.PROVA
            ? `<span class="item__meta">Nota: ${i.nota ?? '—'}</span>`
            : '';
      return {
        extra: '',
        acoes: `${nota}${ed.modalidade === M.ANALISE ? botao('convocar', 'Convocar', 'botao') : ''}${botao('indeferir', 'Indeferir')}`,
      };
    }

    case S.REMANESCENTE:
      return {
        extra: '',
        acoes: `<span class="selo selo--neutro">Remanescente nº ${i.posicaoRemanescente}</span>${botao('indeferir', 'Indeferir')}`,
      };

    case S.CONVOCADA: {
      const requisitos = Object.entries(i.requisitos ?? {});
      const completo = requisitos.every(([, r]) => r.cumprido);
      const vencido = i.prazoMatricula < hojeISO();
      const posicao = i.selecao?.posicao ? ` · ${i.selecao.posicao}º na seleção` : '';
      const lista = requisitos.length
        ? `<ul class="checklist">${requisitos
            .map(
              ([id, r]) => `<li><label><input type="checkbox" data-acao="requisito" data-req="${escapar(id)}" ${r.cumprido ? 'checked' : ''} ${consulta ? 'disabled' : ''} />
                ${escapar(r.rotulo)}</label></li>`,
            )
            .join('')}</ul>`
        : '<p class="item__meta">Este edital não exige requisitos além da confirmação da matrícula.</p>';
      return {
        extra: `<p class="item__meta">Matricular até <strong>${formatarData(i.prazoMatricula)}</strong>
            ${vencido ? '<span class="selo selo--erro">Prazo vencido</span>' : ''}${posicao}</p>${lista}`,
        acoes: `${botao('matricular', 'Matricular', 'botao', completo ? '' : 'disabled title="Marque todos os requisitos"')}${botao('desistir', vencido ? 'Liberar vaga' : 'Desistência')}`,
      };
    }

    case S.MATRICULADA:
      return {
        extra: '',
        acoes: `<span class="selo selo--sucesso">Matriculada</span><span class="item__meta">${formatarDataHora(i.matriculadaEm)}</span>`,
      };

    default: // não selecionada, indeferida, desistente
      return {
        extra: '',
        acoes: `<span class="selo selo--neutro">${ROTULO_STATUS_INSCRICAO[i.status]}</span><span class="item__meta">${i.motivo ? escapar(i.motivo) : 'Sem motivo informado'}</span>`,
      };
  }
}

// ---------------------------------------------------------------------------
// Filtros e abas
// ---------------------------------------------------------------------------
// falhas de carregamento já são mostradas na tela por recarregar(); aqui só evitamos o erro "solto"
$selEdital.addEventListener('change', () => selecionarEdital($selEdital.value).catch(() => {}));
$selTurma.addEventListener('change', () => {
  estado.turmaId = $selTurma.value;
  renderizar();
});
$('#abas').addEventListener('click', (evento) => {
  const aba = evento.target.closest('[data-aba]');
  if (!aba) return;
  estado.aba = aba.dataset.aba;
  renderizar();
});

// ---------------------------------------------------------------------------
// Ações na lista (delegação: a lista é redesenhada o tempo todo)
// ---------------------------------------------------------------------------
const inscricaoDe = (elemento) => estado.itens.find((i) => i.id === elemento.closest('[data-id]')?.dataset.id);

$lista.addEventListener('click', async (evento) => {
  const botao = evento.target.closest('button[data-acao]');
  if (!botao) return;
  if (botao.dataset.acao === 'recarregar') return iniciar().catch(() => {});

  const i = inscricaoDe(botao);
  switch (botao.dataset.acao) {
    case 'convocar':
      return executar(async () => {
        await convocarInscricao(i.id);
        toast(`${i.nome} convocado(a). A vaga ficou reservada.`, 'sucesso');
      }, botao);

    case 'matricular':
      return executar(async () => {
        const r = await efetivarMatricula(i.id);
        toast(`Matrícula efetivada: ${i.nome} na turma ${r.turmaNome}. ${r.alunoNovo ? 'Cadastro criado.' : 'Cadastro existente reaproveitado.'}`, 'sucesso');
      }, botao);

    case 'indeferir':
    case 'desistir':
      return abrirMotivo(botao.dataset.acao, i);
  }
});

// campos que salvam ao mudar: nota (prova) e requisitos de matrícula
$lista.addEventListener('change', async (evento) => {
  const campo = evento.target.closest('[data-acao]');
  if (!campo) return;
  const i = inscricaoDe(campo);

  if (campo.dataset.acao === 'nota') {
    try {
      const nota = campo.value === '' ? null : Number(campo.value);
      await registrarNota(i.id, nota);
      i.nota = nota; // atualiza a cópia local sem redesenhar a lista (o foco continua no campo)
    } catch (erro) {
      tratarErro(erro);
      campo.value = i.nota ?? '';
    }
  }

  if (campo.dataset.acao === 'requisito') {
    const id = campo.dataset.req;
    try {
      await marcarRequisito(i.id, id, campo.checked);
      i.requisitos[id].cumprido = campo.checked;
      renderizarLista(); // habilita/desabilita o botão "Matricular"
    } catch (erro) {
      tratarErro(erro);
      campo.checked = !campo.checked;
    }
  }
});

// ---------------------------------------------------------------------------
// Painel da turma: seleção, próximo remanescente, registro
// ---------------------------------------------------------------------------
$('#painel-turma').addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-acao]');
  if (!botao) return;

  if (botao.dataset.acao === 'selecionar') return abrirSelecao();
  if (botao.dataset.acao === 'registro') return abrirRegistro(estado.turmaId);
  if (botao.dataset.acao === 'proximo-remanescente') {
    return executar(async () => {
      const remanescente = await convocarProximoRemanescente({ editalId: estado.edital.id, turmaId: estado.turmaId });
      toast(`${remanescente.nome} (remanescente nº ${remanescente.posicaoRemanescente}) foi convocado(a).`, 'sucesso');
    }, botao);
  }
});

// ---------------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------------
$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// --- motivo: indeferir / desistência ---
const dlgMotivo = $('#dlg-motivo');
const MOTIVO = {
  indeferir: { titulo: 'Indeferir inscrição', botao: 'Indeferir', nota: '' },
  desistir: { titulo: 'Desistência ou prazo vencido', botao: 'Liberar vaga', nota: ' A vaga reservada volta para a turma.' },
};

function abrirMotivo(modo, inscricao) {
  estado.alvo = { modo, inscricao };
  $('#motivo-titulo').textContent = MOTIVO[modo].titulo;
  $('#motivo-resumo').textContent = `${inscricao.nome} · ${nomeTurma(inscricao.turmaId)}.${MOTIVO[modo].nota}`;
  $('#motivo-confirmar').textContent = MOTIVO[modo].botao;
  $('#motivo-confirmar').disabled = false;
  $('#motivo-texto').value = '';
  mostrar($('#motivo-erro'), '');
  dlgMotivo.showModal();
  $('#motivo-texto').focus();
}

$('#form-motivo').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const { modo, inscricao } = estado.alvo;
  const motivo = $('#motivo-texto').value;
  $('#motivo-confirmar').disabled = true;
  try {
    if (modo === 'indeferir') await indeferirInscricao(inscricao.id, motivo);
    else await desistirDaVaga(inscricao.id, motivo);
    dlgMotivo.close();
    toast(modo === 'indeferir' ? `Inscrição de ${inscricao.nome} indeferida.` : 'Vaga liberada na turma.', 'sucesso');
    await recarregar().then(renderizar, () => {});
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) {
      dlgMotivo.close(); // a situação mudou (outra pessoa agiu): mostra o aviso e atualiza
      tratarErro(erro);
      await recarregar().then(renderizar, () => {});
    } else {
      console.error(erro);
      mostrar($('#motivo-erro'), 'Não foi possível concluir agora. Verifique a conexão e tente de novo.');
      $('#motivo-confirmar').disabled = false;
    }
  }
});

// --- executar seleção ---
const dlgSelecao = $('#dlg-selecao');

function abrirSelecao() {
  const ed = estado.edital;
  const turma = estado.turmas.get(estado.turmaId);
  const candidatos = estado.itens.filter((i) => i.turmaId === estado.turmaId && i.status === S.INSCRITA);
  const livres = Math.max(0, vagasLivres(turma));
  const lista = ed.config.listaRemanescentes
    ? 'As demais formarão a lista de remanescentes, na ordem do resultado.'
    : 'As demais ficarão como não selecionadas.';

  const descricao = {
    [M.SORTEIO]: `${candidatos.length} inscrição(ões) concorrem a ${livres} vaga(s). ${lista}`,
    [M.ORDEM_CHEGADA]: `${candidatos.length} inscrição(ões) para ${livres} vaga(s). As primeiras a se inscrever serão convocadas. ${lista}`,
    [M.PROVA]: `${candidatos.length} inscrição(ões) para ${livres} vaga(s), por maior nota (mínima: ${ed.config.notaMinima}). ${
      candidatos.filter((c) => typeof c.nota !== 'number').length
    } sem nota ficarão de fora. ${lista}`,
  }[ed.modalidade];

  $('#selecao-titulo').textContent = `${ROTULO_EXECUTAR[ed.modalidade]} — ${turma.nome}`;
  $('#selecao-resumo').textContent = ed.titulo;
  $('#selecao-info').textContent = descricao;
  $('#selecao-campo-semente').hidden = ed.modalidade !== M.SORTEIO;
  $('#selecao-semente').value = '';
  $('#selecao-confirmar').textContent = ROTULO_EXECUTAR[ed.modalidade];
  $('#selecao-confirmar').disabled = false;
  mostrar($('#selecao-erro'), '');
  dlgSelecao.showModal();
}

$('#form-selecao').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = $('#selecao-confirmar');
  botao.disabled = true;
  mostrar($('#selecao-erro'), '');
  const turmaId = estado.turmaId;
  try {
    const r = await executarSelecao({ editalId: estado.edital.id, turmaId, semente: $('#selecao-semente').value });
    dlgSelecao.close();
    toast(`Seleção concluída: ${r.convocados} convocado(s), ${r.remanescentes} remanescente(s), ${r.naoSelecionados} não selecionado(s).`, 'sucesso');
    await recarregar().then(renderizar, () => {});
    abrirRegistro(turmaId); // mostra a semente e o resultado logo após a execução
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) mostrar($('#selecao-erro'), erro.message);
    else {
      console.error(erro);
      mostrar($('#selecao-erro'), 'Não foi possível executar agora. Verifique a conexão e tente de novo.');
    }
    botao.disabled = false;
  }
});

// --- registro auditável ---
function abrirRegistro(turmaId) {
  const registro = estado.registros.get(turmaId);
  if (!registro) return;

  const nome = (id) => {
    const i = estado.itens.find((x) => x.id === id);
    return i ? `${escapar(i.nome)} <span class="item__meta">(${escapar(i.email)})</span>` : escapar(id);
  };
  const grupo = (titulo, ids) =>
    ids.length
      ? `<details ${titulo === 'Convocados' ? 'open' : ''}><summary>${titulo} (${ids.length})</summary><ol>${ids.map((id) => `<li>${nome(id)}</li>`).join('')}</ol></details>`
      : '';

  let verificacao = '';
  if (registro.modalidade === M.SORTEIO) {
    let confere = false;
    try {
      confere = verificarSorteio(registro);
    } catch (erro) {
      console.error(erro);
    }
    verificacao = confere
      ? '<span class="selo selo--sucesso">Conferido</span> refazendo o sorteio com esta semente e esta lista, o resultado é idêntico.'
      : '<span class="selo selo--erro">Não confere</span> o resultado não pôde ser reproduzido a partir do registro.';
  }

  $('#registro-titulo').textContent = `Registro da seleção — ${nomeTurma(turmaId)}`;
  $('#registro-corpo').innerHTML = `
    <dl class="dados">
      <dt>Modalidade</dt><dd>${ROTULO_MODALIDADE[registro.modalidade]}</dd>
      <dt>Executada em</dt><dd>${formatarDataHora(registro.executadaEm)}</dd>
      <dt>Vagas disponíveis</dt><dd>${registro.vagasLivres}</dd>
      <dt>Candidatos</dt><dd>${registro.candidatos.length}</dd>
      ${registro.semente ? `<dt>Semente</dt><dd><code>${escapar(registro.semente)}</code></dd>` : ''}
      ${registro.modalidade === M.SORTEIO ? `<dt>Algoritmo</dt><dd>${escapar(registro.algoritmo)}</dd>` : ''}
      ${registro.notaMinima !== null ? `<dt>Nota mínima</dt><dd>${registro.notaMinima}</dd>` : ''}
    </dl>
    ${verificacao ? `<p>${verificacao}</p>` : ''}
    ${grupo('Convocados', registro.convocados)}
    ${grupo('Remanescentes (em ordem)', registro.remanescentes)}
    ${grupo('Não selecionados', registro.naoSelecionados)}`;
  $('#dlg-registro').showModal();
}

iniciar().catch(() => {});
