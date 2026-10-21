/**
 * Menu lateral compartilhado — escrito uma vez aqui em vez de copiado em cada .html.
 *
 * Para liberar uma tela nova: crie pages/<id>.html e troque `pronto` para true abaixo.
 * Enquanto `pronto` for false, o item aparece apagado com "em breve".
 * `papeis` (opcional) esconde o item de quem não tem acesso; a página em si também confere
 * (exigirLogin({ papeis })) e, de verdade, quem protege os dados são as firestore.rules.
 */
import { sair } from '../core/auth.js';
import { escapar } from '../core/ui.js';
import { PAPEIS } from '../models/schema.js';

const GESTAO = [PAPEIS.ADMIN, PAPEIS.COORDENADOR];

const MENU = [
  { id: 'dashboard', rotulo: 'Painel', pronto: true },
  { id: 'editais', rotulo: 'Editais', pronto: true, papeis: GESTAO },
  { id: 'inscricoes', rotulo: 'Inscrições', pronto: true, papeis: GESTAO },
  { id: 'alunos', rotulo: 'Alunos', pronto: false },
  { id: 'cursos', rotulo: 'Cursos', pronto: false },
  { id: 'turmas', rotulo: 'Turmas', pronto: false },
  { id: 'diario', rotulo: 'Diário de classe', pronto: false },
  { id: 'avaliacoes', rotulo: 'Avaliações', pronto: false },
];

/**
 * @param {{ ativo: string, perfil: { nome?: string, email: string, papel: string } }} opcoes
 * Preenche o <aside id="sidebar"> da página.
 */
export function montarShell({ ativo, perfil }) {
  const itens = MENU.filter((item) => !item.papeis || item.papeis.includes(perfil.papel))
    .map(({ id, rotulo, pronto }) =>
      pronto
        ? `<a class="nav__item" href="${id}.html" ${id === ativo ? 'aria-current="page"' : ''}>${rotulo}</a>`
        : `<span class="nav__item nav__item--desativado" title="Em breve">${rotulo}<small>em breve</small></span>`,
    )
    .join('');

  document.getElementById('sidebar').innerHTML = `
    <div class="marca">Incubadora</div>
    <nav class="nav" aria-label="Principal">${itens}</nav>
    <div class="usuario">
      <div class="usuario__nome">${escapar(perfil.nome || perfil.email)}</div>
      <div class="usuario__papel">${escapar(perfil.papel)}</div>
      <button type="button" class="botao botao--fantasma" id="btn-sair">Sair</button>
    </div>`;

  document.getElementById('btn-sair').addEventListener('click', sair);
}
