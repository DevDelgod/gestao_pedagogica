import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { $, $$, confirmar, escapar, toast } from '../core/ui.js';
import { formatarData, formatarDataHora, hojeISO } from '../core/datas.js';
import { ErroDeNegocio } from '../core/erros.js';
import { pessoasDaChamada, resumoDaChamada } from '../domain/diario.js';
import { avisosEnviados, avisosPendentes, faltasDaPessoa, linkDoEmail, proximoAviso, rascunhoDoEmail } from '../domain/faltas.js';
import { DIAS_SEMANA, PAPEIS, PRESENCA, STATUS_MATRICULA } from '../models/schema.js';
import { ROTULO_DIA, ROTULO_STATUS_MATRICULA, ROTULO_STATUS_TURMA } from '../models/rotulos.js';
import { desfazerJustificativa, excluirAula, justificarFalta, listarAulasDaTurma, registrarAula } from '../services/diario.service.js';
import { listarPessoasParaAvisar, marcarAvisosEnviados } from '../services/faltas.service.js';
import { listarMatriculasDaTurma } from '../services/matriculas.service.js';
import { listarTurmasDeTrabalho } from '../services/turmas.service.js';

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
  motivos: {}, // alunoId → motivo da justificativa desta aula (só de quem está com 'J'; ainda não gravado)
  conteudo: '',
  sujo: false, // há alterações não salvas
  detalhesAbertos: new Set(), // pessoas com a lista "Ver faltas" aberta (para ela não fechar quando a tela se refaz)
  avisos: [], // quem precisa receber e-mail de falta agora (todas as turmas que a pessoa vê)
  justificando: null, // { alunoId, data } aberto no diálogo de justificativa
};

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

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
async function iniciar() {
  try {
    estado.turmas = await listarTurmasDeTrabalho({ professorId: ehProfessor ? eu.uid : null });
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
        : 'Nenhuma turma ainda. Importe as matrículas em "Importar dados" ou crie uma na tela Turmas.',
    );
  }

  $turma.innerHTML = estado.turmas
    .map((t) => `<option value="${escapar(t.id)}">${escapar(t.nome)} (${ROTULO_STATUS_TURMA[t.status].toLowerCase()})</option>`)
    .join('');
  $data.max = hojeISO();
  $data.value = estado.data;

  const pedida = new URLSearchParams(location.search).get('turma');
  await Promise.all([trocarTurma(estado.turmas.find((t) => t.id === pedida)?.id ?? estado.turmas[0].id), carregarAvisos()]);
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

/** Quem entra na chamada da data escolhida, com os números atuais de cada matrícula. */
function recalcularPessoas() {
  estado.pessoas = pessoasDaChamada({ matriculas: estado.matriculas, registro: estado.existente, data: estado.data }).sort((a, b) =>
    a.alunoNome.localeCompare(b.alunoNome, 'pt-BR'),
  );
}

/** Prepara a tela para a data escolhida: aula já gravada (correção) ou aula nova. */
function carregarDia() {
  estado.existente = estado.aulas.find((a) => a.data === estado.data) ?? null;
  recalcularPessoas();
  estado.marcas = { ...(estado.existente?.registros ?? {}) };
  estado.motivos = { ...(estado.existente?.justificativas ?? {}) };
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

/**
 * A situação do e-mail de falta desta matrícula: "Enviar e-mail: 6 faltas" quando há aviso pendente; senão, o último
 * enviado e quando será o próximo. Só para matrícula ativa. Falta justificada não conta (ver domain/faltas.js).
 */
function emailDeFaltaHtml(m) {
  if (m.status !== STATUS_MATRICULA.ATIVA) return '';
  const faltas = m.frequencia?.faltas ?? 0;
  if (avisosPendentes(m).length) return `<span class="selo selo--atencao">Enviar e-mail: ${faltas} faltas</span>`;
  const ultimo = avisosEnviados(m).at(-1);
  const enviado = ultimo ? `<span class="selo selo--neutro" title="Marcado como enviado em ${escapar(formatarData(ultimo.em))}">E-mail de ${ultimo.limiar} faltas enviado</span> ` : '';
  return `${enviado}${faltas ? `<span class="item__meta">próximo e-mail com ${proximoAviso(faltas)} faltas</span>` : ''}`;
}

/** "Ver faltas": uma linha por falta, com o botão de justificar (ou de desfazer, se já está justificada). */
function listaDeFaltasHtml(m) {
  const faltas = faltasDaPessoa(estado.aulas, m.alunoId);
  if (!faltas.length) return '';
  const itens = faltas
    .map(
      (f) => `<li class="faltas-lista__item">
        <span>${diaCurto(f.data)}, ${formatarData(f.data)}</span>
        <span class="selo ${f.justificada ? 'selo--info' : 'selo--erro'}">${f.justificada ? 'Justificada' : 'Falta'}</span>
        ${f.motivo ? `<span class="item__meta faltas-lista__motivo">${escapar(f.motivo)}</span>` : ''}
        ${
          f.justificada
            ? `<button type="button" class="botao botao--pequeno botao--fantasma" data-desfazer="${escapar(f.data)}">Desfazer</button>`
            : `<button type="button" class="botao botao--pequeno botao--fantasma" data-justificar="${escapar(f.data)}">Justificar</button>`
        }
      </li>`,
    )
    .join('');
  return `<details class="faltas-lista" data-aluno-detalhes="${escapar(m.alunoId)}" ${estado.detalhesAbertos.has(m.alunoId) ? 'open' : ''}>
    <summary class="item__meta">Ver faltas (${faltas.length})</summary>
    <ul class="faltas-lista__itens">${itens}</ul>
  </details>`;
}

function linhaHtml(m) {
  const f = m.frequencia ?? {};
  const faltas = f.faltas ?? 0;
  const freq = f.aulas ? `Frequência ${String(f.percentual).replace('.', ',')}% em ${f.aulas} aula(s)` : 'Sem aulas registradas';
  const contagem = `<span class="selo ${faltas ? 'selo--erro' : 'selo--neutro'}" title="Faltas não justificadas, até as últimas aulas gravadas">${plural(faltas, 'falta', 'faltas')}</span>${f.justificadas ? ` <span class="selo selo--info">${plural(f.justificadas, 'justificada', 'justificadas')}</span>` : ''}`;
  const risco = m.riscoEvasao && m.status === STATUS_MATRICULA.ATIVA ? '<span class="selo selo--atencao">Risco de evasão</span>' : '';
  const situacao = m.status !== STATUS_MATRICULA.ATIVA ? `<span class="selo selo--neutro">${ROTULO_STATUS_MATRICULA[m.status]} hoje</span>` : '';
  const email = emailDeFaltaHtml(m);
  const botoes = MARCAS.map(
    (marca) => `<button type="button" class="marca ${marca.classe}" data-marca="${marca.valor}" aria-pressed="${estado.marcas[m.alunoId] === marca.valor}"
      aria-label="${marca.nome}: ${escapar(m.alunoNome)}" title="${marca.nome}">${marca.letra}</button>`,
  ).join('');
  return `
    <li class="chamada__linha" data-aluno="${escapar(m.alunoId)}">
      <div class="chamada__pessoa">
        <span class="chamada__titulo"><strong>${escapar(m.alunoNome)}</strong> ${contagem}</span>
        <span class="item__meta">${freq} ${risco} ${situacao}</span>
        ${email ? `<span class="item__meta">${email}</span>` : ''}
        ${listaDeFaltasHtml(m)}
      </div>
      <div class="marcas" role="group" aria-label="Chamada de ${escapar(m.alunoNome)}">${botoes}</div>
      <input class="entrada-larga chamada__motivo" data-motivo maxlength="300" placeholder="Motivo da justificativa (opcional)" aria-label="Motivo da justificativa de ${escapar(m.alunoNome)}"
        value="${escapar(estado.motivos[m.alunoId] ?? '')}" ${estado.marcas[m.alunoId] === PRESENCA.JUSTIFICADA ? '' : 'hidden'} />
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
  sincronizarMotivo(linha);
  atualizarTotais();
  if (estado.marcas[alunoId] === PRESENCA.JUSTIFICADA) $('[data-motivo]', linha).focus(); // quem justifica costuma querer dizer o porquê
});

/** O campo do motivo só aparece com a falta justificada ('J'); sair do 'J' apaga o motivo. */
function sincronizarMotivo(linha) {
  const campo = $('[data-motivo]', linha);
  const alunoId = linha.dataset.aluno;
  campo.hidden = estado.marcas[alunoId] !== PRESENCA.JUSTIFICADA;
  if (campo.hidden) {
    delete estado.motivos[alunoId];
    campo.value = '';
  }
}

$('#chamada-lista').addEventListener('input', (evento) => {
  const campo = evento.target.closest('[data-motivo]');
  if (!campo) return;
  estado.motivos[campo.closest('[data-aluno]').dataset.aluno] = campo.value;
  estado.sujo = true;
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
    sincronizarMotivo(linha);
  });
  atualizarTotais();
}

// ---------------------------------------------------------------------------
// Justificar cada falta (aulas já gravadas) e desfazer
// ---------------------------------------------------------------------------
// a lista "Ver faltas" lembra se estava aberta quando a tela se refaz (o evento toggle não borbulha: captura)
$('#chamada-lista').addEventListener(
  'toggle',
  (evento) => {
    const detalhes = evento.target.closest?.('details[data-aluno-detalhes]');
    if (!detalhes) return;
    const alunoId = detalhes.dataset.alunoDetalhes;
    detalhes.open ? estado.detalhesAbertos.add(alunoId) : estado.detalhesAbertos.delete(alunoId);
  },
  true,
);

$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('#chamada-lista').addEventListener('click', async (evento) => {
  const justificar = evento.target.closest('[data-justificar]');
  const desfazer = evento.target.closest('[data-desfazer]');
  if (!justificar && !desfazer) return;
  const alunoId = evento.target.closest('[data-aluno]').dataset.aluno;
  const data = (justificar ?? desfazer).dataset.justificar ?? desfazer.dataset.desfazer;
  if (!(await podeDescartar())) return; // gravar a justificativa refaz a tela, e as marcações não salvas se perderiam

  if (justificar) return abrirJustificativa(alunoId, data);
  const ok = await confirmar({
    titulo: 'Desfazer a justificativa?',
    mensagem: `A falta de ${formatarData(data)} volta a contar, e o motivo é apagado.`,
    rotulo: 'Desfazer',
  });
  if (!ok) return;
  try {
    await desfazerJustificativa({ turmaId: estado.turmaId, data, alunoId });
    toast('Justificativa desfeita: a falta volta a contar.', 'sucesso');
    estado.detalhesAbertos.add(alunoId);
    await depoisDeMudarAsFaltas();
  } catch (erro) {
    tratarErro(erro);
  }
});

function abrirJustificativa(alunoId, data) {
  const matricula = estado.matriculas.find((m) => m.alunoId === alunoId);
  estado.justificando = { alunoId, data };
  $('#jf-sub').textContent = `${matricula.alunoNome} · ${diaCurto(data)}, ${formatarData(data)}`;
  $('#jf-motivo').value = '';
  mostrar($('#jf-erro'), '');
  $('#dlg-justificar').showModal();
  $('#jf-motivo').focus();
}

$('#form-justificar').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const { alunoId, data } = estado.justificando;
  const botao = $('#jf-salvar');
  botao.disabled = true;
  try {
    await justificarFalta({ turmaId: estado.turmaId, data, alunoId, motivo: $('#jf-motivo').value });
    $('#dlg-justificar').close();
    toast(`Falta de ${formatarData(data)} justificada.`, 'sucesso');
    estado.detalhesAbertos.add(alunoId);
    await depoisDeMudarAsFaltas();
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) mostrar($('#jf-erro'), erro.message);
    else {
      console.error(erro);
      mostrar($('#jf-erro'), 'Não foi possível salvar agora. Verifique a conexão e tente de novo.');
    }
  } finally {
    botao.disabled = false;
  }
});

/** Justificar ou desfazer muda a frequência e as faltas da turma: relê e redesenha tudo (inclusive o painel de e-mails). */
async function depoisDeMudarAsFaltas() {
  await recarregarTurma();
  carregarDia();
  renderizarAulas();
  await carregarAvisos();
}

// ---------------------------------------------------------------------------
// E-mails de falta: quem precisa receber, a cada 3 faltas
// ---------------------------------------------------------------------------
async function carregarAvisos() {
  try {
    estado.avisos = await listarPessoasParaAvisar({ turmaIds: estado.turmas.map((t) => t.id) });
  } catch (erro) {
    console.error(erro);
    return;
  }
  renderizarAvisos();
}

function renderizarAvisos() {
  const n = estado.avisos.length;
  $('#avisos-faltas').hidden = false;
  $('#avisos-titulo').textContent = n ? `E-mails de falta a enviar (${n})` : 'E-mails de falta';
  $('#btn-avisos-lote').hidden = ehProfessor || !n; // marcar como enviado é da coordenação
  if (!n) {
    $('#avisos-tabela').innerHTML = '<p class="item__meta">Nenhum e-mail pendente: ninguém está numa marca de 3, 6, 9… faltas que ainda não tenha sido marcada como enviada.</p>';
    return;
  }
  const linhas = estado.avisos
    .map((a) => {
      const rascunho = rascunhoDoEmail({ pessoa: a.pessoa, nome: a.nome, faltas: a.faltas, turmaNome: a.turmaNome, cursoNome: a.cursoNome });
      const outros = a.pendentes.slice(0, -1);
      const contato = a.email
        ? `<a class="botao botao--pequeno" href="${escapar(linkDoEmail({ email: a.email, ...rascunho }))}">Escrever e-mail</a> <span class="item__meta">${escapar(a.email)}</span>`
        : `<span class="item__meta">Sem e-mail cadastrado${a.telefone ? ` · ${escapar(a.telefone)}` : ''}</span>`;
      return `<tr data-matricula="${escapar(a.matriculaId)}">
        <td><button type="button" class="link-botao" data-turma="${escapar(a.turmaId)}">${escapar(a.nome)}</button></td>
        <td title="${escapar(a.turmaNome)}">${escapar(a.turmaResumo)}</td>
        <td class="num"><strong>${a.faltas}</strong></td>
        <td>Marca de ${a.limiar}${outros.length ? ` <span class="item__meta">(e a de ${outros.join(' e ')}, ainda sem marcar)</span>` : ''}</td>
        <td>${contato}</td>
        <td>${ehProfessor ? '' : '<button type="button" class="botao botao--pequeno botao--fantasma" data-marcar>Marquei como enviado</button>'}</td>
      </tr>`;
    })
    .join('');
  $('#avisos-tabela').innerHTML = `<table class="tabela">
    <thead><tr><th>Pessoa</th><th>Turma</th><th class="num">Faltas</th><th>E-mail</th><th>Contato</th><th></th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>`;
}

$('#avisos-tabela').addEventListener('click', async (evento) => {
  const turma = evento.target.closest('[data-turma]');
  if (turma) {
    if (turma.dataset.turma !== estado.turmaId && (await podeDescartar())) await trocarTurma(turma.dataset.turma);
    return $('#chamada').scrollIntoView({ block: 'start' });
  }
  const marcar = evento.target.closest('[data-marcar]');
  if (!marcar) return;
  const matriculaId = marcar.closest('[data-matricula]').dataset.matricula;
  marcar.disabled = true;
  try {
    await marcarAvisosEnviados([matriculaId]);
    toast('E-mail marcado como enviado.', 'sucesso');
    await depoisDeMarcarEnvios();
  } catch (erro) {
    tratarErro(erro);
    marcar.disabled = false;
  }
});

$('#btn-avisos-lote').addEventListener('click', async () => {
  const n = estado.avisos.length;
  const ok = await confirmar({
    titulo: 'Marcar todos como enviados?',
    mensagem: `Isso marca como já enviados os e-mails de ${plural(n, 'pessoa', 'pessoas')} da lista. Use para começar: quem já recebeu o aviso de 3 e de 6 faltas deixa de aparecer, e daqui em diante só aparece quem alcançar uma nova marca de 3 faltas.`,
    rotulo: 'Já enviei todos',
  });
  if (!ok) return;
  try {
    const mudaram = await marcarAvisosEnviados(estado.avisos.map((a) => a.matriculaId));
    toast(`${plural(mudaram, 'pessoa marcada', 'pessoas marcadas')} como já avisada${mudaram === 1 ? '' : 's'}.`, 'sucesso');
    await depoisDeMarcarEnvios();
  } catch (erro) {
    tratarErro(erro);
  }
});

/** Marcar um envio só muda o registro da matrícula: refaz a lista e as linhas sem mexer nas marcações da chamada em andamento. */
async function depoisDeMarcarEnvios() {
  estado.matriculas = await listarMatriculasDaTurma(estado.turmaId);
  recalcularPessoas();
  renderizarChamada();
  await carregarAvisos();
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
    const r = await registrarAula({ turmaId: estado.turmaId, data: estado.data, conteudo: estado.conteudo, registros, justificativas: estado.motivos });
    toast(
      `Aula de ${formatarData(estado.data)} registrada: ${r.resumo.presentes} presente(s), ${r.resumo.faltas} falta(s), ${r.resumo.justificadas} justificada(s).${r.emRisco ? ` ${r.emRisco} pessoa(s) em risco de evasão.` : ''}`,
      'sucesso',
    );
    await recarregarTurma();
    carregarDia();
    renderizarAulas();
    await carregarAvisos(); // as novas faltas podem ter alcançado uma marca de 3
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
  await carregarAvisos();
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
