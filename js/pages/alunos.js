import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { $, $$, confirmar, escapar, toast } from '../core/ui.js';
import { formatarData, hojeISO } from '../core/datas.js';
import { ErroDeNegocio } from '../core/erros.js';
import { idadeEm } from '../domain/cadastros.js';
import { transicoesPossiveis } from '../domain/matricula.js';
import { nomeExibicao, temNomeSocial } from '../domain/pessoa.js';
import { GENEROS, PAPEIS, STATUS_MATRICULA as M } from '../models/schema.js';
import { ROTULO_ACAO_MATRICULA, ROTULO_GENERO, ROTULO_STATUS_ALUNO, ROTULO_STATUS_MATRICULA, textoDesempenho } from '../models/rotulos.js';
import { anexarDocumento, listarAlunos, removerDocumento, salvarAluno } from '../services/alunos.service.js';
import { alterarSituacaoMatricula, listarMatriculas, matricularDireto } from '../services/matriculas.service.js';
import { aceitaMatricula, turmasRepo, vagasLivres } from '../services/turmas.service.js';

const eu = await exigirLogin({ papeis: [PAPEIS.ADMIN, PAPEIS.COORDENADOR] });
montarShell({ ativo: 'alunos', perfil: eu });

const SELO_ALUNO = { ativo: 'selo--sucesso', inativo: 'selo--neutro', evadido: 'selo--erro' };
const SELO_MATRICULA = { ativa: 'selo--sucesso', trancada: 'selo--atencao', evadida: 'selo--erro', concluida: 'selo--info', cancelada: 'selo--neutro' };

const estado = {
  alunos: [],
  matriculas: [],
  turmas: [],
  busca: '',
  filtroStatus: 'todos',
  filtroTurma: '',
  alunoId: null, // aluno aberto na ficha (null = novo)
  alvo: null, // { matricula, novoStatus } aguardando o motivo
};

const lista = $('#lista');
const dlgFicha = $('#dlg-ficha');
const dlgSituacao = $('#dlg-situacao');

const mostrar = (elemento, texto) => {
  elemento.textContent = texto;
  elemento.hidden = !texto;
};
const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mascaraCpf = (d) => (/^\d{11}$/.test(d) ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d);
const matriculasDe = (alunoId) => estado.matriculas.filter((m) => m.alunoId === alunoId);
const alunoAberto = () => estado.alunos.find((a) => a.id === estado.alunoId);

function tratarErro(erro) {
  if (erro instanceof ErroDeNegocio) return toast(erro.message, 'erro');
  console.error(erro);
  toast('Não foi possível concluir agora. Verifique a conexão e tente de novo.', 'erro');
}

// ---------------------------------------------------------------------------
// Carregamento e lista
// ---------------------------------------------------------------------------
async function carregar() {
  [estado.alunos, estado.matriculas, estado.turmas] = await Promise.all([listarAlunos(), listarMatriculas(), turmasRepo.listar()]);
}

async function iniciar() {
  lista.innerHTML = '<div class="cartao item item--carregando"></div>'.repeat(3);
  try {
    await carregar();
  } catch (erro) {
    console.error(erro);
    lista.innerHTML = `
      <div class="aviso" role="alert">
        Não foi possível carregar os alunos. Confira a configuração do Firebase e as regras do Firestore.
        <button class="link-botao" type="button" data-acao="recarregar">Tentar de novo</button>
      </div>`;
    return;
  }
  montarFiltros();
  renderizarLista();
}

function montarFiltros() {
  $('#f-status').innerHTML =
    '<option value="todos">Todas</option>' + Object.entries(ROTULO_STATUS_ALUNO).map(([v, r]) => `<option value="${v}">${r}</option>`).join('');
  const turmas = [...estado.turmas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  $('#f-turma').innerHTML = '<option value="">Todas as turmas</option>' + turmas.map((t) => `<option value="${escapar(t.id)}">${escapar(t.nome)}</option>`).join('');
}

function alunosVisiveis() {
  const termo = normalizar(estado.busca).trim();
  const digitos = termo.replace(/\D/g, '');
  return estado.alunos.filter((a) => {
    if (estado.filtroStatus !== 'todos' && a.status !== estado.filtroStatus) return false;
    if (estado.filtroTurma && !matriculasDe(a.id).some((m) => m.turmaId === estado.filtroTurma)) return false;
    if (!termo) return true;
    return (
      normalizar(a.nome).includes(termo) ||
      normalizar(a.nomeSocial).includes(termo) || // acha pelo nome social e pelo civil
      normalizar(a.email).includes(termo) ||
      (digitos.length >= 3 && (a.cpf ?? '').includes(digitos)) ||
      matriculasDe(a.id).some((m) => normalizar(m.numeroInscricao).includes(termo)) // número de inscrição, ex.: QM05075
    );
  });
}

function renderizarLista() {
  const alunos = alunosVisiveis();
  $('#contagem').textContent = `${alunos.length} de ${estado.alunos.length} aluno(s)`;
  lista.innerHTML = alunos.length
    ? alunos.map(alunoHtml).join('')
    : `<p class="estado-vazio">${estado.alunos.length ? 'Nenhum aluno com estes filtros.' : 'Nenhum aluno ainda. Importe a listagem do sistema oficial em "Importar dados", ou clique em "Novo aluno".'}</p>`;
}

function alunoHtml(a) {
  const matriculas = matriculasDe(a.id);
  const chips = matriculas.length
    ? matriculas.map((m) => `<span class="selo ${SELO_MATRICULA[m.status]}" title="${escapar(m.cursoNome)}">${escapar(m.turmaNome)} · ${ROTULO_STATUS_MATRICULA[m.status]}</span>`).join(' ')
    : '<span class="item__meta">Sem matrícula</span>';
  return `
    <article class="cartao item" data-id="${escapar(a.id)}">
      <div class="item__principal">
        <h2 class="item__titulo">${escapar(nomeExibicao(a))} <span class="selo ${SELO_ALUNO[a.status]}">${ROTULO_STATUS_ALUNO[a.status]}</span></h2>
        ${temNomeSocial(a) ? `<p class="item__meta">Nome civil: ${escapar(a.nome)}</p>` : ''}
        <p class="item__meta">${a.email ? `<a href="mailto:${escapar(a.email)}">${escapar(a.email)}</a>` : 'Sem e-mail'}${a.telefone ? ` · ${escapar(a.telefone)}` : ''}</p>
        <p class="item__meta">${chips}</p>
      </div>
      <div class="item__acoes">
        <button class="botao botao--fantasma" type="button" data-acao="ficha">Abrir ficha</button>
      </div>
    </article>`;
}

lista.addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-acao]');
  if (!botao) return;
  if (botao.dataset.acao === 'recarregar') return iniciar();
  if (botao.dataset.acao === 'ficha') abrirFicha(botao.closest('[data-id]').dataset.id);
});

$('#f-busca').addEventListener('input', (e) => {
  estado.busca = e.target.value;
  renderizarLista();
});
$('#f-status').addEventListener('change', (e) => {
  estado.filtroStatus = e.target.value;
  renderizarLista();
});
$('#f-turma').addEventListener('change', (e) => {
  estado.filtroTurma = e.target.value;
  renderizarLista();
});

/** Relê tudo após uma ação e redesenha a lista e a ficha aberta. */
async function atualizar() {
  await carregar();
  renderizarLista();
  if (dlgFicha.open) renderizarFicha();
}

// ---------------------------------------------------------------------------
// Ficha do aluno
// ---------------------------------------------------------------------------
$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$('#btn-novo').addEventListener('click', () => abrirFicha(null));

function abrirFicha(alunoId) {
  estado.alunoId = alunoId;
  const a = alunoId ? alunoAberto() : null;
  mostrar($('#aluno-erro'), '');

  $('#ficha-titulo').textContent = a ? nomeExibicao(a) : 'Novo aluno';
  $('#al-nome').value = a?.nome ?? '';
  $('#al-nome-social').value = a?.nomeSocial ?? '';
  $('#al-genero').value = a?.genero ?? '';
  $('#al-genero-outro').value = a?.generoOutro ?? '';
  sinalizarGenero();
  $('#al-email').value = a?.email ?? '';
  $('#al-telefone').value = a?.telefone ?? '';
  $('#al-cpf').value = mascaraCpf(a?.cpf ?? '');
  $('#al-nascimento').value = a?.dataNascimento ?? '';
  $('#al-resp-nome').value = a?.responsavel?.nome ?? '';
  $('#al-resp-telefone').value = a?.responsavel?.telefone ?? '';
  $('#al-resp-parentesco').value = a?.responsavel?.parentesco ?? '';
  $('#al-cidade').value = a?.endereco?.cidade ?? '';
  $('#al-bairro').value = a?.endereco?.bairro ?? '';
  $('#al-observacoes').value = a?.observacoes ?? '';
  sinalizarMenor();

  renderizarFicha();
  if (!dlgFicha.open) dlgFicha.showModal();
  $('#al-nome').focus();
}

// Gênero: lista de opções + campo de texto livre que só aparece em "Outro"
$('#al-genero').innerHTML =
  '<option value="">Não informado</option>' + GENEROS.map((g) => `<option value="${g}">${ROTULO_GENERO[g]}</option>`).join('');

function sinalizarGenero() {
  $('#campo-al-genero-outro').hidden = $('#al-genero').value !== 'outro';
}
$('#al-genero').addEventListener('change', () => {
  sinalizarGenero();
  if ($('#al-genero').value === 'outro') $('#al-genero-outro').focus();
});

/** Avisa na hora, pela data de nascimento, que o responsável é obrigatório. */
function sinalizarMenor() {
  const nascimento = $('#al-nascimento').value;
  $('#al-aviso-menor').hidden = !(nascimento && idadeEm(nascimento, hojeISO()) < 18);
}
$('#al-nascimento').addEventListener('input', sinalizarMenor);

function renderizarFicha() {
  const a = alunoAberto();
  const salvo = Boolean(a && estado.alunoId);
  $('#ficha-matriculas').hidden = !salvo;
  $('#ficha-documentos').hidden = !salvo;
  renderizarDadosOficiais(salvo ? a : null);
  $('#ficha-sub').textContent = salvo ? `Situação: ${ROTULO_STATUS_ALUNO[a.status]}. A situação do aluno é calculada a partir das matrículas.` : 'Depois de salvar o cadastro, você poderá matricular o aluno e anexar documentos.';
  if (!salvo) return;
  $('#ficha-titulo').textContent = nomeExibicao(a);
  renderizarMatriculas(a);
  renderizarDocumentos(a);
}

/** "Sim · Bolsa Família", "Não", ou vazio quando a planilha não disse nada. */
const opcaoComDetalhe = (opcao) => (opcao ? `${opcao.possui ? 'Sim' : 'Não'}${opcao.qual ? ` · ${opcao.qual}` : ''}` : '');

/** O que veio da importação e a ficha não edita: identificação, perfil e o endereço completo. Some se não há nada. */
function renderizarDadosOficiais(a) {
  const e = a?.endereco ?? {};
  const linhas = [
    ['Id do candidato', a?.idExterno],
    ['Raça ou cor', a?.raca],
    ['Possui deficiência', opcaoComDetalhe(a?.deficiencia)],
    ['Programa social', opcaoComDetalhe(a?.programaSocial)],
    ['Reside em MCMV', opcaoComDetalhe(a?.mcmv)],
    ['WhatsApp', a?.whatsapp],
    ['Endereço', [e.rua, e.bairro, e.cidade && e.estado ? `${e.cidade}/${e.estado}` : e.cidade || e.estado, e.cep].filter(Boolean).join(', ')],
  ].filter(([, valor]) => valor);
  $('#ficha-oficial').hidden = !linhas.length;
  $('#dados-oficiais').innerHTML = linhas.map(([rotulo, valor]) => `<dt>${rotulo}</dt><dd>${escapar(valor)}</dd>`).join('');
}

// --- cadastro ---
$('#form-aluno').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = $('#aluno-salvar');
  mostrar($('#aluno-erro'), '');
  botao.disabled = true;
  try {
    const eraNovo = !estado.alunoId;
    const id = await salvarAluno(estado.alunoId, {
      nome: $('#al-nome').value,
      nomeSocial: $('#al-nome-social').value,
      genero: $('#al-genero').value,
      generoOutro: $('#al-genero-outro').value,
      email: $('#al-email').value,
      telefone: $('#al-telefone').value,
      cpf: $('#al-cpf').value,
      dataNascimento: $('#al-nascimento').value,
      responsavel: { nome: $('#al-resp-nome').value, telefone: $('#al-resp-telefone').value, parentesco: $('#al-resp-parentesco').value },
      endereco: { cidade: $('#al-cidade').value, bairro: $('#al-bairro').value },
      observacoes: $('#al-observacoes').value,
    });
    await carregar();
    renderizarLista();
    toast(eraNovo ? 'Cadastro criado. Agora é possível matricular o aluno e anexar documentos.' : 'Cadastro salvo.', 'sucesso');
    if (eraNovo) abrirFicha(id); // reabre já no modo de edição, com matrículas e documentos
    else renderizarFicha();
  } catch (erro) {
    if (erro instanceof ErroDeNegocio) mostrar($('#aluno-erro'), erro.message);
    else {
      console.error(erro);
      mostrar($('#aluno-erro'), 'Não foi possível salvar agora. Verifique a conexão e tente de novo.');
    }
  } finally {
    botao.disabled = false;
  }
});

// --- matrículas ---
function renderizarMatriculas(a) {
  const matriculas = matriculasDe(a.id).sort((x, y) => (y.dataMatricula ?? '').localeCompare(x.dataMatricula ?? ''));
  $('#lista-matriculas').innerHTML = matriculas.length
    ? matriculas.map(matriculaHtml).join('')
    : '<p class="item__meta">Este aluno ainda não tem matrículas.</p>';

  const turmasPossiveis = estado.turmas
    .filter((t) => aceitaMatricula(t) && vagasLivres(t) > 0 && !matriculas.some((m) => m.turmaId === t.id))
    .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  $('#mat-turma').innerHTML = turmasPossiveis.length
    ? turmasPossiveis.map((t) => `<option value="${escapar(t.id)}">${escapar(t.nome)} — ${vagasLivres(t)} vaga(s)</option>`).join('')
    : '<option value="">Nenhuma turma disponível</option>';
  $('#mat-adicionar').disabled = !turmasPossiveis.length;
  $('#mat-turma').disabled = !turmasPossiveis.length;
}

function matriculaHtml(m) {
  const freq = m.frequencia?.aulas ? `Frequência ${String(m.frequencia.percentual).replace('.', ',')}% em ${m.frequencia.aulas} aula(s)` : 'Sem aulas registradas';
  const desempenho = textoDesempenho(m) ? ` · ${textoDesempenho(m)}` : '';
  const acoes = transicoesPossiveis(m.status)
    .map((para) => `<button class="botao botao--pequeno ${para === M.ATIVA ? '' : 'botao--fantasma'}" type="button" data-matricula="${escapar(m.id)}" data-para="${para}">${ROTULO_ACAO_MATRICULA[para]}</button>`)
    .join('');
  return `
    <div class="subitem">
      <div class="subitem__texto">
        <strong>${escapar(m.turmaNome)} <span class="selo ${SELO_MATRICULA[m.status]}">${ROTULO_STATUS_MATRICULA[m.status]}</span>${m.riscoEvasao && m.status === M.ATIVA ? ' <span class="selo selo--atencao">Risco de evasão</span>' : ''}</strong>
        <span class="item__meta">${escapar(m.cursoNome)} · matriculado em ${formatarData(m.dataMatricula)}${m.numeroInscricao ? ` · inscrição ${escapar(m.numeroInscricao)}` : ''}${m.statusExterno ? ` · no sistema oficial: ${escapar(m.statusExterno)}` : ''}</span>
        <span class="item__meta">${freq}${desempenho}</span>
        ${m.motivoSituacao ? `<span class="item__meta">Motivo: ${escapar(m.motivoSituacao)}</span>` : ''}
      </div>
      <div class="subitem__acoes">${acoes}</div>
    </div>`;
}

$('#lista-matriculas').addEventListener('click', async (evento) => {
  const botao = evento.target.closest('button[data-para]');
  if (!botao) return;
  const matricula = estado.matriculas.find((m) => m.id === botao.dataset.matricula);
  const novoStatus = botao.dataset.para;

  if (novoStatus === M.ATIVA || novoStatus === M.CONCLUIDA) {
    const ok = await confirmar({
      titulo: ROTULO_ACAO_MATRICULA[novoStatus],
      mensagem:
        novoStatus === M.ATIVA
          ? `A matrícula em "${matricula.turmaNome}" volta a ocupar uma vaga da turma.`
          : `A matrícula em "${matricula.turmaNome}" será concluída e libera a vaga da turma.`,
      rotulo: ROTULO_ACAO_MATRICULA[novoStatus],
    });
    if (ok) await aplicarSituacao(matricula, novoStatus, '', botao);
  } else {
    abrirSituacao(matricula, novoStatus);
  }
});

async function aplicarSituacao(matricula, novoStatus, motivo, botao) {
  if (botao) botao.disabled = true;
  try {
    await alterarSituacaoMatricula({ matriculaId: matricula.id, novoStatus, motivo });
    toast(`Matrícula em ${matricula.turmaNome}: ${ROTULO_STATUS_MATRICULA[novoStatus].toLowerCase()}.`, 'sucesso');
  } catch (erro) {
    tratarErro(erro);
  }
  await atualizar().catch(console.error);
}

$('#mat-adicionar').addEventListener('click', async () => {
  const a = alunoAberto();
  const turmaId = $('#mat-turma').value;
  if (!a || !turmaId) return;
  $('#mat-adicionar').disabled = true;
  try {
    const r = await matricularDireto({ alunoId: a.id, turmaId });
    toast(`Matrícula efetivada: ${nomeExibicao(a)} na turma ${r.turmaNome}.`, 'sucesso');
  } catch (erro) {
    tratarErro(erro);
  }
  await atualizar().catch(console.error);
});

// --- diálogo de motivo (trancar, evadir, cancelar) ---
const TEXTO_SITUACAO = {
  [M.TRANCADA]: { titulo: 'Trancar matrícula', nota: 'A vaga é liberada, e o aluno pode voltar depois se houver vaga.' },
  [M.EVADIDA]: { titulo: 'Marcar como evadida', nota: 'A vaga é liberada. O aluno pode voltar depois se houver vaga.' },
  [M.CANCELADA]: { titulo: 'Cancelar matrícula', nota: 'A vaga é liberada. Se foi um engano, dá para reativar depois.' },
};

function abrirSituacao(matricula, novoStatus) {
  estado.alvo = { matricula, novoStatus };
  $('#situacao-titulo').textContent = TEXTO_SITUACAO[novoStatus].titulo;
  $('#situacao-resumo').textContent = `${matricula.alunoNome} · ${matricula.turmaNome}. ${TEXTO_SITUACAO[novoStatus].nota}`;
  $('#situacao-confirmar').textContent = ROTULO_ACAO_MATRICULA[novoStatus];
  $('#situacao-confirmar').disabled = false;
  $('#situacao-motivo').value = '';
  mostrar($('#situacao-erro'), '');
  dlgSituacao.showModal();
  $('#situacao-motivo').focus();
}

$('#form-situacao').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const { matricula, novoStatus } = estado.alvo;
  $('#situacao-confirmar').disabled = true;
  dlgSituacao.close();
  await aplicarSituacao(matricula, novoStatus, $('#situacao-motivo').value);
});

// --- documentos ---
const tamanho = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function renderizarDocumentos(a) {
  const docs = a.documentos ?? [];
  $('#lista-docs').innerHTML = docs.length
    ? docs
        .map(
          (d) => `<li class="subitem">
            <div class="subitem__texto"><strong>${escapar(d.nome)}</strong><span class="item__meta">${d.tipo === 'image' ? 'Imagem' : 'Arquivo'} · ${tamanho(d.bytes)}</span></div>
            <div class="subitem__acoes">
              <button class="botao botao--pequeno botao--fantasma" type="button" data-abrir="${escapar(d.publicId)}">Abrir</button>
              <button class="botao botao--pequeno botao--fantasma" type="button" data-remover="${escapar(d.publicId)}">Remover</button>
            </div></li>`,
        )
        .join('')
    : '<li class="item__meta">Nenhum documento anexado.</li>';
}

/** Abre o documento. Arquivos simulados (data URL) viram um Blob: navegadores bloqueiam abrir data URL direto. */
function abrirDocumento(d) {
  let destino = d.url;
  if (d.url.startsWith('data:')) {
    const [cabecalho, base64] = d.url.split(',');
    const tipo = cabecalho.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream';
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    destino = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  }
  window.open(destino, '_blank', 'noopener');
}

$('#lista-docs').addEventListener('click', async (evento) => {
  const a = alunoAberto();
  const abrir = evento.target.closest('[data-abrir]');
  const remover = evento.target.closest('[data-remover]');
  if (abrir) return abrirDocumento(a.documentos.find((d) => d.publicId === abrir.dataset.abrir));
  if (remover) {
    const doc = a.documentos.find((d) => d.publicId === remover.dataset.remover);
    const ok = await confirmar({ titulo: 'Remover documento', mensagem: `"${doc.nome}" deixará de aparecer na ficha do aluno.`, rotulo: 'Remover', perigo: true });
    if (!ok) return;
    try {
      await removerDocumento(a.id, doc.publicId);
      toast('Documento removido.', 'sucesso');
    } catch (erro) {
      tratarErro(erro);
    }
    await atualizar().catch(console.error);
  }
});

$('#doc-enviar').addEventListener('click', async () => {
  const a = alunoAberto();
  const arquivo = $('#doc-arquivo').files[0];
  mostrar($('#doc-erro'), '');
  if (!arquivo) return mostrar($('#doc-erro'), 'Escolha um arquivo (PDF ou imagem).');
  $('#doc-enviar').disabled = true;
  try {
    await anexarDocumento(a.id, arquivo);
    $('#doc-arquivo').value = '';
    toast('Documento anexado.', 'sucesso');
    await atualizar();
  } catch (erro) {
    // falha de envio (ex.: arquivo grande demais no modo dev) vem como Error comum, com mensagem já legível
    mostrar($('#doc-erro'), erro instanceof Error ? erro.message : 'Não foi possível enviar o documento.');
    if (!(erro instanceof ErroDeNegocio) && !(erro instanceof Error)) console.error(erro);
  } finally {
    $('#doc-enviar').disabled = false;
  }
});

iniciar();
