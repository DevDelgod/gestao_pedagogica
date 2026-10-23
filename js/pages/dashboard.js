import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { carregarResumo } from '../services/dashboard.service.js';
import { contarPessoasParaAvisar } from '../services/faltas.service.js';
import { $, escapar } from '../core/ui.js';
import { dev } from '../core/firebase.js';
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
    chave: 'emRisco',
    rotulo: 'Alunos em risco de evasão',
    dica: 'faltas seguidas ou frequência baixa',
    href: 'analises.html#frequencia',
    tom: (n) => (n > 0 ? 'atencao' : ''),
  },
  {
    chave: 'avisosDeFalta',
    rotulo: 'E-mails de falta a enviar',
    dica: 'a cada 3 faltas, 3, 6, 9…',
    href: 'diario.html',
    tom: (n) => (n > 0 ? 'atencao' : ''),
    soGestao: true, // marcar o envio é da coordenação; o professor vê a lista das próprias turmas no Diário
  },
  {
    chave: 'taxaEvasao',
    rotulo: 'Taxa de evasão',
    formato: (n) => `${n.toLocaleString('pt-BR')}%`,
  },
];

// As inscrições e a seleção acontecem no sistema oficial (as telas de edital ficam fora do menu), então o painel
// não conta mais inscrições. O professor não acessa as telas de gestão: para ele, o painel mostra os números sem
// links, e um atalho para o Diário de classe.
const exibidas = ehProfessor ? METRICAS.filter((m) => !m.soGestao).map(({ href, ...resto }) => resto) : METRICAS;
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

/**
 * Primeiros passos: com dados de exemplo ou sem nenhum dado, o painel aponta para o upload das planilhas do sistema
 * oficial (é por lá que o sistema recebe os dados). Só para quem importa: admin e coordenação.
 */
function mostrarPrimeirosPassos(resumo) {
  const exemplo = dev?.origem() === 'exemplo';
  const vazio = resumo.matriculasAtivas === 0 && resumo.alunosAtivos === 0 && resumo.turmasEmAndamento === 0;
  $('#primeiros-passos').hidden = ehProfessor || !(exemplo || vazio);
  $('#pp-titulo').textContent = exemplo ? 'Você está vendo dados de exemplo.' : 'Ainda não há dados aqui.';
  $('#pp-texto').textContent =
    'Para usar os seus, suba as planilhas (.xlsx) exportadas do sistema oficial: primeiro a Listagem de candidatos (as matrículas) e depois a lista de frequência de cada turma. Depois é só abrir as Análises.';
}

async function carregar() {
  painel.innerHTML = exibidas.map((m) => cartao(m, null)).join('');
  try {
    const [resumo, avisosDeFalta] = await Promise.all([carregarResumo({ incluirInscricoes: false }), ehProfessor ? 0 : contarPessoasParaAvisar()]);
    resumo.avisosDeFalta = avisosDeFalta;
    mostrarPrimeirosPassos(resumo);
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
