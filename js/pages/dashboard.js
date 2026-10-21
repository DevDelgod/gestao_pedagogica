import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { carregarResumo } from '../services/dashboard.service.js';
import { $, escapar } from '../core/ui.js';
import { PAPEIS } from '../models/schema.js';

const eu = await exigirLogin(); // qualquer membro da equipe
montarShell({ ativo: 'dashboard', perfil: eu });
const ehProfessor = eu.papel === PAPEIS.PROFESSOR;

const primeiroNome = (eu.nome || eu.email).split(/[ @]/)[0];
$('#saudacao').textContent = `Olá, ${primeiroNome}. Aqui está o resumo de hoje.`;

// chave: campo devolvido por carregarResumo(); tom: classe extra de destaque (opcional)
const METRICAS = [
  { chave: 'alunosAtivos', rotulo: 'Alunos ativos', href: 'alunos.html' },
  { chave: 'turmasEmAndamento', rotulo: 'Turmas em andamento', href: 'turmas.html' },
  { chave: 'matriculasAtivas', rotulo: 'Matrículas ativas', href: 'alunos.html' },
  {
    chave: 'aguardandoSelecao',
    rotulo: 'Inscrições aguardando seleção',
    dica: 'ainda não passaram pela seleção',
    href: 'inscricoes.html',
  },
  {
    chave: 'aMatricular',
    rotulo: 'Convocados a matricular',
    dica: 'com vaga reservada',
    href: 'inscricoes.html',
    tom: (n) => (n > 0 ? 'atencao' : ''),
  },
  {
    chave: 'emRisco',
    rotulo: 'Alunos em risco de evasão',
    dica: 'faltas seguidas ou frequência baixa',
    tom: (n) => (n > 0 ? 'atencao' : ''),
  },
  {
    chave: 'taxaEvasao',
    rotulo: 'Taxa de evasão',
    formato: (n) => `${n.toLocaleString('pt-BR')}%`,
  },
];

// O professor não lê inscrições (firestore.rules) nem acessa as telas de gestão: para ele, o painel
// mostra só os números que pode ver, sem links, e um atalho para o Diário de classe.
const exibidas = ehProfessor
  ? METRICAS.filter((m) => !['aguardandoSelecao', 'aMatricular'].includes(m.chave)).map(({ href, ...resto }) => resto)
  : METRICAS;
$('#atalho-professor').hidden = !ehProfessor;

const painel = $('#metricas');

const cartao = ({ rotulo, dica, href }, valor, tom = '') => {
  const carregando = valor === null;
  const classes = `cartao metrica ${tom ? `metrica--${tom}` : ''} ${carregando ? 'metrica--carregando' : ''}`;
  const conteudo = `
    <span class="metrica__rotulo">${escapar(rotulo)}</span>
    <span class="metrica__valor">${carregando ? '0' : escapar(valor)}</span>
    ${dica ? `<span class="metrica__dica">${escapar(dica)}</span>` : ''}`;
  // Com href o cartão inteiro vira link para a tela do assunto.
  return href && !carregando
    ? `<a class="${classes} metrica--link" href="${escapar(href)}">${conteudo}</a>`
    : `<article class="${classes}">${conteudo}</article>`;
};

async function carregar() {
  painel.innerHTML = exibidas.map((m) => cartao(m, null)).join('');
  try {
    const resumo = await carregarResumo({ incluirInscricoes: !ehProfessor });
    painel.innerHTML = exibidas.map((m) => {
      const n = resumo[m.chave];
      return cartao(m, m.formato ? m.formato(n) : n, m.tom?.(n));
    }).join('');
  } catch (erro) {
    console.error(erro);
    painel.innerHTML = `
      <div class="aviso" role="alert" style="grid-column: 1 / -1">
        Não foi possível carregar o resumo. Confira a configuração do Firebase e as regras do Firestore.
        <button class="link-botao" id="btn-tentar">Tentar de novo</button>
      </div>`;
    $('#btn-tentar').addEventListener('click', carregar);
  }
}

carregar();
