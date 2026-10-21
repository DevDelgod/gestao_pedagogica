/**
 * Página pública de inscrição (sem login). Fluxo: lista os editais com inscrições abertas →
 * a pessoa escolhe a turma e preenche os dados → grava uma inscrição "inscrita".
 * As regras do Firestore conferem tudo de novo no servidor (edital aberto, janela de datas, turma
 * ofertada, campos permitidos e tamanhos): a validação daqui é só para avisar a pessoa com clareza.
 */
import { $, escapar } from '../core/ui.js';
import { formatarData, formatarDataHora } from '../core/datas.js';
import { validarGenero, validarNomeSocial } from '../domain/pessoa.js';
import { GENEROS } from '../models/schema.js';
import { ROTULO_GENERO, ROTULO_MODALIDADE } from '../models/rotulos.js';
import { listarEditaisAbertos } from '../services/editais.service.js';
import { enviarInscricaoPublica } from '../services/inscricoes.service.js';

const form = $('#form-inscricao');
const selEdital = $('#in-edital');
const selTurma = $('#in-turma');
const caixaErro = $('#erro');

const estado = { editais: [] };

const mostrarErro = (texto, campo) => {
  caixaErro.textContent = texto;
  caixaErro.hidden = !texto;
  if (texto && campo) campo.focus();
};

function mensagemGeral(html) {
  const caixa = $('#mensagem-geral');
  caixa.innerHTML = html;
  caixa.hidden = !html;
}

// ---------------------------------------------------------------------------
// Editais abertos
// ---------------------------------------------------------------------------
async function iniciar() {
  let editais;
  try {
    editais = await listarEditaisAbertos();
  } catch (erro) {
    console.error(erro);
    $('#sub').textContent = 'Não foi possível carregar as inscrições.';
    return mensagemGeral('<p class="aviso" role="alert">Tente de novo em alguns instantes. Se o problema continuar, fale com a coordenação.</p>');
  }

  const agora = Date.now();
  const noPrazo = (e) => e.inscricoesInicio.toMillis() <= agora && agora <= e.inscricoesFim.toMillis();
  estado.editais = editais.filter(noPrazo).sort((a, b) => a.inscricoesFim.toMillis() - b.inscricoesFim.toMillis());

  if (!estado.editais.length) {
    const proximo = editais.filter((e) => e.inscricoesInicio.toMillis() > agora).sort((a, b) => a.inscricoesInicio.toMillis() - b.inscricoesInicio.toMillis())[0];
    $('#sub').textContent = 'Não há inscrições abertas no momento.';
    return mensagemGeral(
      proximo ? `<p class="item__meta">As inscrições de <strong>${escapar(proximo.titulo)}</strong> abrem em ${formatarDataHora(proximo.inscricoesInicio)}.</p>` : '',
    );
  }

  const pedido = new URLSearchParams(location.search).get('edital');
  selEdital.innerHTML = estado.editais.map((e) => `<option value="${escapar(e.id)}">${escapar(e.titulo)}</option>`).join('');
  if (estado.editais.some((e) => e.id === pedido)) selEdital.value = pedido;
  $('#campo-edital').hidden = estado.editais.length === 1;

  form.hidden = false;
  mostrarEdital();
}

function mostrarEdital() {
  const edital = estado.editais.find((e) => e.id === selEdital.value);
  $('#sub').textContent = 'Preencha os dados abaixo para se inscrever.';

  const requisitos = edital.requisitosMatricula.map((r) => escapar(r.rotulo)).join(', ');
  $('#info-edital').innerHTML = `
    <h2>${escapar(edital.titulo)}</h2>
    ${edital.descricao ? `<p>${escapar(edital.descricao)}</p>` : ''}
    <p>Forma de seleção: <strong>${ROTULO_MODALIDADE[edital.modalidade]}</strong></p>
    <p>Inscrições até <strong>${formatarDataHora(edital.inscricoesFim)}</strong>${edital.dataResultado ? ` · Resultado em <strong>${formatarData(edital.dataResultado)}</strong>` : ''}</p>
    ${requisitos ? `<p>Para a matrícula, quem for selecionado precisará de: ${requisitos}.</p>` : ''}`;

  selTurma.innerHTML =
    (edital.turmas.length > 1 ? '<option value="">Escolha a turma…</option>' : '') +
    edital.turmas
      .map((t) => `<option value="${escapar(t.id)}">${escapar(t.nome)}${t.cursoNome ? ` — ${escapar(t.cursoNome)}` : ''}</option>`)
      .join('');
  mostrarErro('');
}

selEdital.addEventListener('change', mostrarEdital);

// Gênero: lista de opções + campo de texto livre que só aparece em "Outro"
$('#in-genero').innerHTML =
  '<option value="">Selecione (opcional)</option>' + GENEROS.map((g) => `<option value="${g}">${ROTULO_GENERO[g]}</option>`).join('');

function sincronizarGenero() {
  const outro = $('#in-genero').value === 'outro';
  $('#campo-genero-outro').hidden = !outro;
  if (outro) $('#in-genero-outro').focus();
}
$('#in-genero').addEventListener('change', sincronizarGenero);

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const edital = estado.editais.find((e) => e.id === selEdital.value);
  const nome = $('#in-nome').value.trim();
  const email = $('#in-email').value.trim();

  if (!selTurma.value) return mostrarErro('Escolha a turma em que deseja se inscrever.', selTurma);
  if (nome.length < 2) return mostrarErro('Informe seu nome completo.', $('#in-nome'));
  if (!EMAIL.test(email) || email.length < 5) return mostrarErro('Informe um e-mail válido.', $('#in-email'));

  const social = validarNomeSocial($('#in-nome-social').value);
  if (social.erro) return mostrarErro(social.erro, $('#in-nome-social'));
  const genero = validarGenero({ genero: $('#in-genero').value, generoOutro: $('#in-genero-outro').value });
  if (genero.erro) return mostrarErro(genero.erro, $('#in-genero').value === 'outro' ? $('#in-genero-outro') : $('#in-genero'));

  const botao = $('#btn-enviar');
  botao.disabled = true;
  botao.textContent = 'Enviando…';
  mostrarErro('');

  try {
    // campo-armadilha preenchido = robô: finge sucesso e não grava nada
    if (!$('#in-site').value) {
      await enviarInscricaoPublica({
        editalId: edital.id,
        turmaId: selTurma.value,
        nome,
        nomeSocial: social.dados,
        genero: genero.dados.genero,
        generoOutro: genero.dados.generoOutro,
        email,
        telefone: $('#in-telefone').value.trim(),
        mensagem: $('#in-mensagem').value.trim(),
      });
    }
    mostrarSucesso(edital, email, $('#in-telefone').value.trim());
  } catch (erro) {
    console.error(erro);
    mostrarErro(
      erro?.code === 'permission-denied'
        ? 'Não foi possível enviar: as inscrições deste edital podem ter sido encerradas, ou a turma não está mais disponível. Atualize a página e tente de novo.'
        : 'Não foi possível enviar agora. Verifique sua conexão e tente de novo.',
    );
    botao.disabled = false;
    botao.textContent = 'Enviar inscrição';
  }
});

function mostrarSucesso(edital, email, telefone) {
  form.hidden = true;
  $('#sub').textContent = 'Inscrição recebida!';
  $('#sucesso').innerHTML = `
    <p>Recebemos a sua inscrição em <strong>${escapar(edital.titulo)}</strong>.</p>
    <p class="item__meta">A coordenação entrará em contato pelo e-mail <strong>${escapar(email)}</strong>${
      telefone ? ' ou pelo telefone informado' : ''
    }.${edital.dataResultado ? ` O resultado será divulgado em ${formatarData(edital.dataResultado)}.` : ''}</p>
    <button class="botao botao--fantasma botao--bloco" type="button" id="btn-outra">Fazer outra inscrição</button>`;
  $('#sucesso').hidden = false;
  $('#btn-outra').addEventListener('click', () => {
    $('#sucesso').hidden = true;
    form.reset();
    $('#campo-genero-outro').hidden = true; // reset() limpa o campo, mas não o esconde
    $('#btn-enviar').disabled = false;
    $('#btn-enviar').textContent = 'Enviar inscrição';
    form.hidden = false;
    mostrarEdital();
  });
}

iniciar();
