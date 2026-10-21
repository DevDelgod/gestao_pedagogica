import { entrar, irParaPainel, mensagemDeErro, recuperarSenha, redirecionarSeLogado } from '../core/auth.js';
import { $ } from '../core/ui.js';

const form = $('#form-login');
const botao = $('#btn-entrar');
const caixaMensagem = $('#mensagem');

function mostrarMensagem(texto, tipo = 'erro') {
  caixaMensagem.textContent = texto;
  caixaMensagem.classList.toggle('aviso--info', tipo === 'info');
  caixaMensagem.hidden = false;
}

function ocupado(sim) {
  botao.disabled = sim;
  botao.textContent = sim ? 'Entrando…' : 'Entrar';
}

redirecionarSeLogado();

if (new URLSearchParams(location.search).get('erro') === 'sem-acesso') {
  mostrarMensagem('Sua conta ainda não tem acesso ao sistema. Fale com a coordenação.');
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  caixaMensagem.hidden = true;

  const email = form.email.value.trim();
  const senha = form.senha.value;
  if (!email || !senha) return mostrarMensagem('Informe e-mail e senha.');

  ocupado(true);
  try {
    await entrar(email, senha);
    irParaPainel();
  } catch (erro) {
    mostrarMensagem(mensagemDeErro(erro));
    ocupado(false);
  }
});

$('#btn-esqueci').addEventListener('click', async () => {
  const email = form.email.value.trim();
  if (!email) return mostrarMensagem('Digite seu e-mail acima e clique em "Esqueci minha senha".');
  try {
    await recuperarSenha(email);
  } catch (erro) {
    // Para não revelar quais e-mails existem, só erros de rede/configuração são mostrados.
    if (erro?.code !== 'auth/user-not-found') return mostrarMensagem(mensagemDeErro(erro));
  }
  mostrarMensagem('Se este e-mail tiver cadastro, enviamos um link para redefinir a senha.', 'info');
});
