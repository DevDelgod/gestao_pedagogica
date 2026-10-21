/** Utilitários de interface compartilhados por todas as páginas. */

export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
export const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

/** Escapa texto antes de colocar em innerHTML — use SEMPRE com dados vindos do banco. */
export const escapar = (texto) =>
  String(texto ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/**
 * Pergunta de confirmação (substitui window.confirm, com o visual do sistema).
 * Resolve true se a pessoa confirmar; Esc ou "Cancelar" resolvem false.
 */
export function confirmar({ titulo, mensagem, rotulo = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    const dialogo = document.createElement('dialog');
    dialogo.className = 'dialogo';
    dialogo.innerHTML = `
      <h2>${escapar(titulo)}</h2>
      <p class="dialogo__sub">${escapar(mensagem)}</p>
      <div class="dialogo__acoes">
        <button type="button" class="botao botao--fantasma" data-resposta="nao">Cancelar</button>
        <button type="button" class="botao ${perigo ? 'botao--perigo' : ''}" data-resposta="sim">${escapar(rotulo)}</button>
      </div>`;
    // Resolve já no clique (sem esperar o evento "close", que o navegador dispara depois);
    // "close" fica só para o Esc. Resolver duas vezes é inofensivo: vale a primeira.
    const encerrar = (confirmado) => {
      resolve(confirmado);
      if (dialogo.open) dialogo.close();
      dialogo.remove();
    };
    dialogo.addEventListener('click', (evento) => {
      const botao = evento.target.closest('[data-resposta]');
      if (botao) encerrar(botao.dataset.resposta === 'sim');
    });
    dialogo.addEventListener('close', () => encerrar(false));
    document.body.append(dialogo);
    dialogo.showModal();
  });
}

/** Aviso rápido no canto da tela. tipo: 'info' | 'sucesso' | 'erro'. */
export function toast(mensagem, tipo = 'info') {
  let pilha = $('#toasts');
  if (!pilha) {
    pilha = document.createElement('div');
    pilha.id = 'toasts';
    pilha.setAttribute('role', 'status');
    pilha.setAttribute('aria-live', 'polite');
    document.body.append(pilha);
  }
  const item = document.createElement('div');
  item.className = `toast toast--${tipo}`;
  item.textContent = mensagem;
  pilha.append(item);
  setTimeout(() => item.remove(), 4000);
}
