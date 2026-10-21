import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { $, $$, confirmar, escapar, toast } from '../core/ui.js';
import { ErroDeNegocio } from '../core/erros.js';
import { PAPEIS } from '../models/schema.js';
import { definirCursoAtivo, listarCursos, salvarCurso } from '../services/cursos.service.js';
import { turmasRepo } from '../services/turmas.service.js';

const eu = await exigirLogin({ papeis: [PAPEIS.ADMIN, PAPEIS.COORDENADOR] });
montarShell({ ativo: 'cursos', perfil: eu });

const lista = $('#lista');
const dialogo = $('#dlg-curso');
const caixaErro = $('#curso-erro');

const estado = {
  cursos: [],
  turmasPorCurso: new Map(), // cursoId → quantidade de turmas
  editandoId: null, // null = novo curso
};

const mostrarErro = (texto) => {
  caixaErro.textContent = texto;
  caixaErro.hidden = !texto;
};

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------
async function carregar() {
  lista.innerHTML = '<div class="cartao item item--carregando"></div>'.repeat(2);
  try {
    const [cursos, turmas] = await Promise.all([listarCursos(), turmasRepo.listar()]);
    estado.cursos = cursos;
    estado.turmasPorCurso = new Map();
    turmas.forEach((t) => estado.turmasPorCurso.set(t.cursoId, (estado.turmasPorCurso.get(t.cursoId) ?? 0) + 1));
    renderizar();
  } catch (erro) {
    console.error(erro);
    lista.innerHTML = `
      <div class="aviso" role="alert">
        Não foi possível carregar os cursos. Confira a configuração do Firebase e as regras do Firestore.
        <button class="link-botao" type="button" data-acao="recarregar">Tentar de novo</button>
      </div>`;
  }
}

function renderizar() {
  lista.innerHTML = estado.cursos.length
    ? estado.cursos.map(cursoHtml).join('')
    : '<p class="estado-vazio">Nenhum curso ainda. Clique em "Novo curso" para começar.</p>';
}

function cursoHtml(c) {
  const turmas = estado.turmasPorCurso.get(c.id) ?? 0;
  const detalhes = [
    c.cargaHoraria ? `${c.cargaHoraria} h` : null,
    `frequência mínima ${c.frequenciaMinima}%`,
    `média ${String(c.mediaAprovacao).replace('.', ',')}`,
  ].filter(Boolean);

  return `
    <article class="cartao item" data-id="${escapar(c.id)}">
      <div class="item__principal">
        <h2 class="item__titulo">${escapar(c.nome)} <span class="selo ${c.ativo ? 'selo--sucesso' : 'selo--neutro'}">${c.ativo ? 'Ativo' : 'Inativo'}</span></h2>
        <p class="item__meta">${detalhes.join(' · ')}</p>
        ${c.descricao ? `<p class="item__meta">${escapar(c.descricao)}</p>` : ''}
        <p class="item__meta">${turmas ? `<a href="turmas.html?curso=${encodeURIComponent(c.id)}">${turmas} turma(s)</a>` : 'Nenhuma turma ainda'}</p>
      </div>
      <div class="item__acoes">
        <button class="botao botao--fantasma" type="button" data-acao="editar">Editar</button>
        <button class="botao botao--fantasma" type="button" data-acao="alternar">${c.ativo ? 'Desativar' : 'Reativar'}</button>
      </div>
    </article>`;
}

lista.addEventListener('click', async (evento) => {
  const botao = evento.target.closest('button[data-acao]');
  if (!botao) return;
  if (botao.dataset.acao === 'recarregar') return carregar();

  const curso = estado.cursos.find((c) => c.id === botao.closest('[data-id]').dataset.id);
  if (botao.dataset.acao === 'editar') return abrirFormulario(curso);

  if (botao.dataset.acao === 'alternar') {
    if (curso.ativo) {
      const ok = await confirmar({
        titulo: 'Desativar curso',
        mensagem: `"${curso.nome}" deixará de aparecer ao criar turmas. As turmas e matrículas existentes não mudam, e você pode reativá-lo quando quiser.`,
        rotulo: 'Desativar',
      });
      if (!ok) return;
    }
    botao.disabled = true;
    try {
      await definirCursoAtivo(curso.id, !curso.ativo);
      toast(curso.ativo ? `Curso "${curso.nome}" desativado.` : `Curso "${curso.nome}" reativado.`, 'sucesso');
    } catch (erro) {
      console.error(erro);
      toast('Não foi possível alterar o curso agora. Tente de novo.', 'erro');
    }
    carregar();
  }
});

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------
function abrirFormulario(curso = null) {
  estado.editandoId = curso?.id ?? null;
  mostrarErro('');
  $('#curso-titulo-dlg').textContent = curso ? 'Editar curso' : 'Novo curso';
  $('#cu-nome').value = curso?.nome ?? '';
  $('#cu-descricao').value = curso?.descricao ?? '';
  $('#cu-carga').value = curso?.cargaHoraria ?? '';
  $('#cu-frequencia').value = curso?.frequenciaMinima ?? 75;
  $('#cu-media').value = curso?.mediaAprovacao ?? 7;
  $('#cu-ativo').checked = curso?.ativo ?? true;

  const turmas = curso ? (estado.turmasPorCurso.get(curso.id) ?? 0) : 0;
  const aviso = $('#curso-aviso-turmas');
  aviso.textContent = turmas ? `Mudar o nome atualiza também as ${turmas} turma(s) deste curso.` : '';
  aviso.hidden = !turmas;

  dialogo.showModal();
  $('#cu-nome').focus();
}

$('#btn-novo').addEventListener('click', () => abrirFormulario());
$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('#form-curso').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = $('#curso-salvar');
  mostrarErro('');
  botao.disabled = true;
  try {
    await salvarCurso(estado.editandoId, {
      nome: $('#cu-nome').value,
      descricao: $('#cu-descricao').value,
      cargaHoraria: $('#cu-carga').value,
      frequenciaMinima: $('#cu-frequencia').value,
      mediaAprovacao: $('#cu-media').value,
      ativo: $('#cu-ativo').checked,
    });
    dialogo.close();
    toast('Curso salvo.', 'sucesso');
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
