import { exigirLogin } from '../core/auth.js';
import { montarShell } from '../components/shell.js';
import { $, $$, confirmar, escapar, toast } from '../core/ui.js';
import { formatarData, formatarDataHora, hojeISO } from '../core/datas.js';
import { ErroDeNegocio } from '../core/erros.js';
import { dev } from '../core/firebase.js';
import { planejarListagem } from '../domain/importacao.js';
import { PAPEIS, STATUS_MATRICULA } from '../models/schema.js';
import { ROTULO_STATUS_MATRICULA } from '../models/rotulos.js';
import {
  aplicarFrequencia,
  aplicarListagem,
  carregarExistentes,
  lerArquivoDeImportacao,
  listarImportacoes,
  obterMapaDeSituacoes,
  prepararFrequencia,
  resumoDasTurmas,
} from '../services/importacao.service.js';

const eu = await exigirLogin({ papeis: [PAPEIS.ADMIN, PAPEIS.COORDENADOR] });
montarShell({ ativo: 'importar', perfil: eu });

const estado = {
  // matrículas (listagem)
  lido: null, // o que há na planilha escolhida
  existentes: null, // o que já está no sistema
  mapa: {}, // chave da situação da planilha → situação nossa, escolhida pela pessoa
  periodo: '', // período das turmas, quando o nome do curso não traz
  plano: null, // o plano atual da listagem
  // presenças e faltas (uma ou várias planilhas, uma por turma)
  frequencias: [], // [{ arquivo, leitura, resolucao, plano } | { arquivo, erro }]
  aplicando: false,
};

const $previa = $('#previa');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
/** Só a palavra, no singular ou no plural (o número já aparece em destaque). */
const palavra = (n, um, varios) => (n === 1 ? um : varios);
const numero = (valor, rotulo) => `<div class="numero"><strong>${valor}</strong><span>${rotulo}</span></div>`;
const listaDeAvisos = (avisos) => `<ul class="avisos">${avisos.map((a) => `<li class="${a.nivel === 'info' ? 'info' : ''}">${escapar(a.texto)}</li>`).join('')}</ul>`;

/** Cada campo de upload tem a sua mensagem de erro: 'matriculas' ou 'presencas'. */
function mostrarErro(campo, texto) {
  $(`#erro-${campo}`).textContent = texto;
  $(`#erro-${campo}`).hidden = !texto;
}

function tratarErro(campo, erro) {
  if (erro instanceof ErroDeNegocio) return mostrarErro(campo, erro.message);
  console.error(erro);
  mostrarErro(campo, 'Não foi possível ler ou gravar agora. Confira o arquivo e tente de novo.');
}

function fecharPrevia() {
  estado.lido = estado.plano = null;
  estado.frequencias = [];
  $previa.hidden = true;
  $previa.innerHTML = '';
}

/** Atualiza tudo o que mostra o que está guardado (contagem, turmas, histórico). */
const atualizarPainel = () => Promise.all([mostrarDados(), mostrarTurmas(), mostrarHistorico()]);

// ---------------------------------------------------------------------------
// Dados guardados neste navegador (só no modo local)
// ---------------------------------------------------------------------------
async function mostrarDados() {
  if (!dev) return; // com o Firebase de verdade, backup e limpeza são feitos pelo console do Firebase
  $('#cartao-dados').hidden = false;
  const exemplo = dev.origem() === 'exemplo';
  const e = await carregarExistentes();
  const vazio = !e.alunos.length && !e.matriculas.length && !e.turmas.length && !e.cursos.length;

  $('#dados-texto').textContent = exemplo
    ? 'Este navegador está com dados de exemplo (fictícios). Limpe-os antes da primeira importação real, para não misturar com as pessoas de verdade.'
    : vazio
      ? 'O sistema está vazio, pronto para receber as suas planilhas. O que você importar fica guardado só neste navegador, neste computador, e nunca sai dele.'
      : 'Os dados ficam guardados só neste navegador, neste computador, e nunca saem dele. Baixe um backup de vez em quando: se o navegador for limpo ou trocado, os dados somem.';
  $('#btn-limpar').textContent = exemplo ? 'Limpar dados de exemplo' : 'Apagar todos os dados';
  $('#btn-limpar').hidden = !exemplo && vazio; // vazio: não há o que apagar
  $('#btn-exemplos').hidden = exemplo || !vazio; // o exemplo só se oferece com o sistema vazio, para nunca misturar com dados de verdade
  // o navegador guarda os dados por endereço (origem): 127.0.0.1:5502 e localhost:5500 são "sistemas" separados
  $('#dados-endereco').textContent = `Eles ficam ligados ao endereço desta página (${location.host}). Abrir o sistema por outro endereço, como localhost em vez de 127.0.0.1 ou outra porta, mostra tudo vazio: use sempre o mesmo, ou restaure um backup.`;
  $('#dados-contagem').textContent = `Guardados agora: ${plural(e.alunos.length, 'pessoa', 'pessoas')}, ${plural(e.matriculas.length, 'matrícula', 'matrículas')}, ${plural(e.turmas.length, 'turma', 'turmas')}, ${plural(e.cursos.length, 'curso', 'cursos')}.`;
}

$('#btn-exemplos')?.addEventListener('click', async () => {
  await dev.carregarExemplos();
  toast('Dados de exemplo carregados. Para usar os seus, limpe-os antes de importar.', 'info');
  fecharPrevia();
  await atualizarPainel();
});

$('#btn-backup')?.addEventListener('click', () => dev.baixarBackup());

$('#btn-restaurar')?.addEventListener('click', () => $('#arq-backup').click());
$('#arq-backup')?.addEventListener('change', async (evento) => {
  const arquivo = evento.target.files[0];
  evento.target.value = '';
  if (!arquivo) return;
  const ok = await confirmar({
    titulo: 'Restaurar este backup?',
    mensagem: `Todos os dados deste navegador serão substituídos pelos do arquivo "${arquivo.name}".`,
    rotulo: 'Restaurar',
    perigo: true,
  });
  if (!ok) return;
  try {
    await dev.restaurarBackup(await arquivo.text());
    toast('Backup restaurado.', 'sucesso');
    fecharPrevia();
    await atualizarPainel();
  } catch (erro) {
    mostrarErro('matriculas', erro.message);
  }
});

/** Apaga os dados de exemplo (ou todos, se já forem de verdade). Devolve true se apagou. */
async function limparDados() {
  const exemplo = dev.origem() === 'exemplo';
  const ok = await confirmar({
    titulo: exemplo ? 'Limpar os dados de exemplo?' : 'Apagar TODOS os dados?',
    mensagem: exemplo
      ? 'Os cursos, turmas, alunos e avaliações de exemplo são apagados; o login continua. O que você importar depois fica guardado e nunca mais é refeito.'
      : 'Pessoas, matrículas, turmas, aulas e avaliações deste navegador serão apagadas. Um backup é baixado antes, por segurança.',
    rotulo: exemplo ? 'Limpar exemplos' : 'Apagar tudo',
    perigo: true,
  });
  if (!ok) return false;
  if (!exemplo) dev.baixarBackup();
  await dev.limparDados();
  toast(exemplo ? 'Dados de exemplo apagados.' : 'Dados apagados.', 'sucesso');
  await atualizarPainel();
  return true;
}

$('#btn-limpar')?.addEventListener('click', async () => {
  if (await limparDados()) fecharPrevia();
});

// ---------------------------------------------------------------------------
// Os dois campos de upload
// ---------------------------------------------------------------------------

/** Liga um campo: clicar ou arrastar arquivos chama `aoEscolher(arquivos)`; mostra "Lendo…" enquanto trabalha. */
function ligarCampo({ area, entrada, aoEscolher }) {
  const titulo = area.firstElementChild;
  const textoOriginal = titulo.textContent;
  const escolher = async (arquivos) => {
    if (!arquivos.length || estado.aplicando) return;
    titulo.textContent = 'Lendo…';
    try {
      await aoEscolher(arquivos);
    } finally {
      titulo.textContent = textoOriginal;
      entrada.value = '';
    }
  };
  entrada.addEventListener('change', () => escolher([...entrada.files]));
  area.addEventListener('dragover', (evento) => {
    evento.preventDefault();
    area.classList.add('area-arquivo--sobre');
  });
  area.addEventListener('dragleave', () => area.classList.remove('area-arquivo--sobre'));
  area.addEventListener('drop', (evento) => {
    evento.preventDefault();
    area.classList.remove('area-arquivo--sobre');
    escolher([...evento.dataTransfer.files]);
  });
}

ligarCampo({ area: $('#area-matriculas'), entrada: $('#arq-matriculas'), aoEscolher: escolherMatriculas });
ligarCampo({ area: $('#area-presencas'), entrada: $('#arq-presencas'), aoEscolher: escolherPresencas });

// ---------------------------------------------------------------------------
// 1. Matrículas: pré-visualização da listagem
// ---------------------------------------------------------------------------
async function escolherMatriculas(arquivos) {
  mostrarErro('matriculas', '');
  mostrarErro('presencas', '');
  fecharPrevia();
  if (arquivos.length > 1) return mostrarErro('matriculas', 'Envie uma listagem de cada vez.');
  try {
    estado.lido = await lerArquivoDeImportacao(arquivos[0], 'listagem');
    estado.existentes = await carregarExistentes();
    estado.mapa = await obterMapaDeSituacoes();
    estado.periodo = estado.lido.periodoSugerido;
    montarPreviaListagem();
    $previa.scrollIntoView({ block: 'start' });
  } catch (erro) {
    fecharPrevia();
    tratarErro('matriculas', erro);
  }
}

function montarPreviaListagem() {
  const { lido } = estado;
  const situacoesDoArquivo = planejarListagem(lido.registros, estado.existentes, { periodoPadrao: estado.periodo, mapaStatus: estado.mapa, hoje: hojeISO() }).situacoes;

  $previa.hidden = false;
  $previa.innerHTML = `
    <article class="cartao bloco">
      <div>
        <h2>Matrículas: ${escapar(lido.nomeArquivo)}</h2>
        <p class="item__meta">${plural(lido.registros.length, 'linha lida', 'linhas lidas')}. Nada foi gravado ainda.</p>
      </div>

      <div id="prev-exemplo" class="aviso" hidden>
        Este navegador ainda tem os dados de exemplo. Limpe-os antes de importar, para não misturar com as pessoas de verdade.
        <button class="link-botao" type="button" id="prev-limpar">Limpar dados de exemplo</button>
      </div>

      <div class="numeros" id="prev-numeros"></div>

      <div class="campo">
        <label for="prev-periodo">Período das turmas</label>
        <input id="prev-periodo" maxlength="20" value="${escapar(estado.periodo)}" autocomplete="off" />
        <span class="campo__ajuda">Só vale para as linhas em que nem a inscrição ("QM05075/2026.1") nem o curso ("2026.1 - Audiovisual…") dizem o período. Sugerido pelas próprias linhas.</span>
      </div>

      <div>
        <h3>Situações encontradas</h3>
        <p class="item__meta">Diga o que cada situação do sistema oficial significa aqui. Só ficam com vaga as matrículas ativas.</p>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>Na planilha</th><th class="num">Linhas</th><th>Vale como</th></tr></thead>
            <tbody>
              ${situacoesDoArquivo
                .map(
                  (s) => `<tr data-situacao="${escapar(s.chave)}">
                    <td>${escapar(s.rotulo)}</td>
                    <td class="num">${s.quantidade}</td>
                    <td><select aria-label="Situação para ${escapar(s.rotulo)}">
                      <option value="">Escolha…</option>
                      ${Object.values(STATUS_MATRICULA).map((v) => `<option value="${v}" ${s.situacao === v ? 'selected' : ''}>${ROTULO_STATUS_MATRICULA[v]}</option>`).join('')}
                    </select></td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3>Turmas</h3>
        <p class="item__meta">O sistema oficial não exporta turmas: elas são montadas juntando período, curso, polo e horário.</p>
        <div class="tabela-rolagem" id="prev-turmas"></div>
      </div>

      <ul class="avisos" id="prev-avisos"></ul>

      <div id="prev-progresso" hidden>
        <progress id="prog" max="1" value="0"></progress>
        <p class="item__meta" id="prog-texto"></p>
      </div>

      <div class="item__acoes">
        <button class="botao" type="button" id="btn-importar">Importar matrículas</button>
        <button class="botao botao--fantasma" type="button" id="btn-cancelar">Cancelar</button>
      </div>
    </article>`;

  $('#prev-periodo').addEventListener('input', (evento) => {
    estado.periodo = evento.target.value.trim();
    replanejar();
  });
  $('#prev-limpar').addEventListener('click', async () => {
    if (await limparDados()) {
      estado.existentes = await carregarExistentes();
      replanejar();
    }
  });
  $$('tr[data-situacao] select', $previa).forEach((select) =>
    select.addEventListener('change', () => {
      const chave = select.closest('tr').dataset.situacao;
      select.value ? (estado.mapa[chave] = select.value) : delete estado.mapa[chave];
      replanejar();
    }),
  );
  $('#btn-cancelar').addEventListener('click', fecharPrevia);
  $('#btn-importar').addEventListener('click', importarListagem);
  replanejar();
}

/** Recalcula o plano com o que a pessoa escolheu e atualiza só o que depende dele (sem perder o foco dos campos). */
function replanejar() {
  const { lido, existentes } = estado;
  const plano = (estado.plano = planejarListagem(lido.registros, existentes, { periodoPadrao: estado.periodo, mapaStatus: estado.mapa, hoje: hojeISO() }));
  const r = plano.resumo;

  const pessoas = r.alunosNovos + r.alunosAtualizados;
  const matriculas = r.matriculasNovas + r.matriculasAtualizadas;
  const turmas = r.turmasNovas + r.turmasAtualizadas;
  $('#prev-numeros').innerHTML = [
    numero(pessoas, `${palavra(pessoas, 'pessoa', 'pessoas')} (${r.alunosNovos} ${palavra(r.alunosNovos, 'nova', 'novas')})`),
    numero(matriculas, `${palavra(matriculas, 'matrícula', 'matrículas')} (${r.matriculasNovas} ${palavra(r.matriculasNovas, 'nova', 'novas')})`),
    numero(turmas, `${palavra(turmas, 'turma', 'turmas')} (${r.turmasNovas} ${palavra(r.turmasNovas, 'nova', 'novas')})`),
    numero(plano.cursos.length, `${palavra(plano.cursos.length, 'curso', 'cursos')} (${r.cursosNovos} ${palavra(r.cursosNovos, 'novo', 'novos')})`),
  ].join('');

  $('#prev-turmas').innerHTML = `
    <table class="tabela">
      <thead><tr><th>Turma</th><th>Polo</th><th>Horário</th><th class="num">Pessoas</th><th></th></tr></thead>
      <tbody>
        ${[...plano.turmas]
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
          .map(
            (t) => `<tr>
              <td>${escapar([t.descricao.periodo, t.descricao.curso].filter(Boolean).join(' · '))}</td>
              <td>${escapar(t.descricao.polo || '—')}</td>
              <td>${escapar(t.descricao.horario || '—')}</td>
              <td class="num">${t.quantidade}</td>
              <td><span class="selo ${t.novo ? 'selo--sucesso' : 'selo--neutro'}">${t.novo ? 'Nova' : 'Já existe'}</span></td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;

  const avisos = [...plano.avisos];
  if (lido.ignoradas.length) {
    avisos.unshift({ nivel: 'aviso', texto: `${plural(lido.ignoradas.length, 'linha sem nome ou sem curso foi ignorada', 'linhas sem nome ou sem curso foram ignoradas')} (linhas ${lido.ignoradas.slice(0, 8).join(', ')}${lido.ignoradas.length > 8 ? '…' : ''}).` });
  }
  $('#prev-avisos').innerHTML = avisos.map((a) => `<li class="${a.nivel === 'info' ? 'info' : ''}">${escapar(a.texto)}</li>`).join('');

  plano.situacoes.forEach((s) => {
    const select = $(`tr[data-situacao="${CSS.escape(s.chave)}"] select`, $previa);
    select.setAttribute('aria-invalid', String(s.situacao === null));
  });

  const exemploPendente = Boolean(dev) && dev.origem() === 'exemplo';
  $('#prev-exemplo').hidden = !exemploPendente;
  $('#btn-importar').disabled = estado.aplicando || plano.pendencias > 0 || exemploPendente || !plano.matriculas.length;
  $('#btn-importar').title = plano.pendencias ? 'Escolha o que cada situação significa' : exemploPendente ? 'Limpe os dados de exemplo antes' : '';
}

async function importarListagem() {
  const plano = estado.plano;
  estado.aplicando = true;
  $('#btn-importar').disabled = true;
  $('#prev-progresso').hidden = false;
  try {
    const mapaEfetivo = Object.fromEntries(plano.situacoes.map((s) => [s.chave, s.situacao]));
    const resumo = await aplicarListagem(plano, {
      arquivo: estado.lido.nomeArquivo,
      mapaStatus: mapaEfetivo,
      aoProgresso: (feito, total) => {
        $('#prog').value = total ? feito / total : 1;
        $('#prog-texto').textContent = `Gravando… ${feito} de ${total}`;
      },
    });
    estado.aplicando = false;
    mostrarConcluido(
      'Matrículas importadas',
      [
        numero(resumo.alunosNovos, `${palavra(resumo.alunosNovos, 'pessoa nova', 'pessoas novas')} (${resumo.alunosAtualizados} atualizadas)`),
        numero(resumo.matriculasNovas, `${palavra(resumo.matriculasNovas, 'matrícula nova', 'matrículas novas')} (${resumo.matriculasAtualizadas} atualizadas)`),
        numero(resumo.turmasNovas, `${palavra(resumo.turmasNovas, 'turma nova', 'turmas novas')} (${resumo.turmasAtualizadas} atualizadas)`),
        numero(resumo.cursosNovos, palavra(resumo.cursosNovos, 'curso novo', 'cursos novos')),
      ],
      '<p class="item__meta">Próximo passo: envie as <strong>presenças e faltas</strong> de cada turma, no campo 2.</p>',
    );
  } catch (erro) {
    estado.aplicando = false;
    $('#prev-progresso').hidden = true;
    replanejar();
    tratarErro('matriculas', erro);
    return;
  }
  await atualizarPainel();
}

function mostrarConcluido(titulo, numeros, extra = '') {
  $previa.innerHTML = `
    <article class="cartao bloco">
      <h2>${escapar(titulo)}</h2>
      <div class="numeros">${numeros.join('')}</div>
      ${extra}
      <div class="item__acoes">
        <a class="botao" href="analises.html">Ver análises</a>
        <a class="botao botao--fantasma" href="turmas.html">Ver turmas</a>
        <button class="botao botao--fantasma" type="button" id="btn-outro">Importar outro arquivo</button>
      </div>
    </article>`;
  $('#btn-outro').addEventListener('click', () => {
    fecharPrevia();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  toast(titulo + '.', 'sucesso');
}

// ---------------------------------------------------------------------------
// 2. Presenças e faltas: uma ou várias planilhas, cada uma ligada à sua turma pelo número de inscrição
// ---------------------------------------------------------------------------
async function escolherPresencas(arquivos) {
  mostrarErro('matriculas', '');
  mostrarErro('presencas', '');
  fecharPrevia();

  const itens = [];
  for (const arquivo of arquivos) {
    try {
      const lido = await lerArquivoDeImportacao(arquivo, 'frequencia');
      const { resolucao, plano } = await prepararFrequencia(lido.leitura);
      const repetida = itens.find((i) => i.plano?.turmaId === plano.turmaId);
      if (repetida) {
        itens.push({ arquivo: arquivo.name, erro: `A turma "${plano.turmaNome}" já está em "${repetida.arquivo}", nesta mesma remessa. Envie uma planilha por turma.` });
      } else {
        itens.push({ arquivo: arquivo.name, leitura: lido.leitura, resolucao, plano });
      }
    } catch (erro) {
      if (!(erro instanceof ErroDeNegocio)) console.error(erro);
      itens.push({ arquivo: arquivo.name, erro: erro instanceof ErroDeNegocio ? erro.message : 'Não foi possível ler este arquivo.' });
    }
  }

  // um arquivo só e com problema: a mensagem fica no próprio campo, sem abrir uma prévia
  if (itens.length === 1 && itens[0].erro) return mostrarErro('presencas', itens[0].erro);

  estado.frequencias = itens;
  montarPreviaFrequencias();
  $previa.scrollIntoView({ block: 'start' });
}

function itemDeFrequenciaHtml(item) {
  if (item.erro) return `<div class="bloco-item"><h3>${escapar(item.arquivo)}</h3><p class="aviso" style="margin: 0">${escapar(item.erro)}</p></div>`;
  const { plano, resolucao } = item;
  const r = plano.resumo;
  const quando = plano.datas.length ? `Aulas de ${formatarData(plano.datas[0])} a ${formatarData(plano.datas.at(-1))}.` : '';
  return `
    <div class="bloco-item">
      <h3>${escapar(item.arquivo)}</h3>
      <p><strong>Turma:</strong> ${escapar(plano.turmaNome)}
        <span class="item__meta">(${resolucao.pelaLista ? 'ligada pelos números de inscrição' : 'achada pelo nome da turma'})</span></p>
      <div class="numeros">
        ${numero(`${r.casadas} de ${r.pessoas}`, 'pessoas da planilha ligadas a uma matrícula desta turma')}
        ${numero(r.aulas, `${palavra(r.aulas, 'aula', 'aulas')} (${r.aulasNovas} ${palavra(r.aulasNovas, 'nova', 'novas')})`)}
        ${numero(r.marcacoes, 'presenças e faltas')}
      </div>
      <p class="item__meta">${escapar(quando)}</p>
      ${plano.avisos.length ? listaDeAvisos(plano.avisos) : ''}
    </div>`;
}

function montarPreviaFrequencias() {
  const prontas = estado.frequencias.filter((i) => !i.erro);
  $previa.hidden = false;
  $previa.innerHTML = `
    <article class="cartao bloco">
      <div>
        <h2>Presenças e faltas</h2>
        <p class="item__meta">${plural(prontas.length, 'planilha pronta', 'planilhas prontas')} de ${estado.frequencias.length}. Nada foi gravado ainda. Aulas que já existem recebem as marcações e mantêm o conteúdo; a frequência e o risco de evasão de toda a turma são recalculados.</p>
      </div>
      ${estado.frequencias.map(itemDeFrequenciaHtml).join('')}
      <div id="prev-progresso" hidden>
        <progress id="prog" max="1" value="0"></progress>
        <p class="item__meta" id="prog-texto"></p>
      </div>
      <div class="item__acoes">
        <button class="botao" type="button" id="btn-importar" ${prontas.length ? '' : 'disabled'}>Importar ${plural(prontas.length, 'planilha', 'planilhas')}</button>
        <button class="botao botao--fantasma" type="button" id="btn-cancelar">Cancelar</button>
      </div>
    </article>`;
  $('#btn-cancelar').addEventListener('click', fecharPrevia);
  $('#btn-importar').addEventListener('click', importarFrequencias);
}

async function importarFrequencias() {
  const prontas = estado.frequencias.filter((i) => !i.erro);
  estado.aplicando = true;
  $('#btn-importar').disabled = true;
  $('#prev-progresso').hidden = false;

  const resultados = [];
  for (const [i, item] of prontas.entries()) {
    $('#prog-texto').textContent = `Planilha ${i + 1} de ${prontas.length}: ${item.arquivo}`;
    try {
      // o plano é refeito aqui, com o que as planilhas anteriores desta remessa já gravaram
      const { plano } = await prepararFrequencia(item.leitura);
      const resumo = await aplicarFrequencia(plano, { arquivo: item.arquivo });
      resultados.push({ arquivo: item.arquivo, turma: plano.turmaNome, resumo });
    } catch (erro) {
      if (!(erro instanceof ErroDeNegocio)) console.error(erro);
      resultados.push({ arquivo: item.arquivo, erro: erro instanceof ErroDeNegocio ? erro.message : 'Não foi possível gravar este arquivo.' });
    }
    $('#prog').value = (i + 1) / prontas.length;
  }
  estado.aplicando = false;

  const certas = resultados.filter((r) => !r.erro);
  const soma = (campo) => certas.reduce((n, r) => n + r.resumo[campo], 0);
  const falhas = resultados.filter((r) => r.erro);
  mostrarConcluido(
    certas.length ? 'Presenças importadas' : 'Nada foi importado',
    [
      numero(certas.length, palavra(certas.length, 'turma com presenças', 'turmas com presenças')),
      numero(soma('aulas'), `${palavra(soma('aulas'), 'aula', 'aulas')} (${soma('aulasNovas')} ${palavra(soma('aulasNovas'), 'nova', 'novas')})`),
      numero(soma('marcacoes'), 'presenças e faltas'),
    ],
    falhas.length ? `<ul class="avisos">${falhas.map((f) => `<li>${escapar(f.arquivo)}: ${escapar(f.erro)}</li>`).join('')}</ul>` : '',
  );
  await atualizarPainel();
}

// ---------------------------------------------------------------------------
// Turmas e presenças: o que já está ligado
// ---------------------------------------------------------------------------
async function mostrarTurmas() {
  try {
    const turmas = await resumoDasTurmas();
    $('#cartao-turmas').hidden = !turmas.length;
    const comPresenca = turmas.filter((t) => t.aulas).length;
    $('#turmas-resumo').textContent = `${comPresenca} de ${turmas.length} ${palavra(turmas.length, 'turma tem', 'turmas têm')} presenças importadas. As turmas sem presença vêm primeiro: é o que ainda falta enviar no campo 2.`;
    $('#turmas-tabela').innerHTML = `
      <table class="tabela">
        <thead><tr><th>Turma</th><th>Polo</th><th class="num">Matrículas</th><th class="num">Aulas</th><th>Última aula</th><th>Presenças</th></tr></thead>
        <tbody>
          ${turmas
            .map(
              (t) => `<tr>
                <td>${escapar(t.nome)}</td>
                <td>${escapar(t.polo || '—')}</td>
                <td class="num">${t.matriculas}</td>
                <td class="num">${t.aulas}</td>
                <td>${t.ultimaAula ? escapar(formatarData(t.ultimaAula)) : '—'}</td>
                <td><span class="selo ${t.aulas ? 'selo--sucesso' : 'selo--atencao'}">${t.aulas ? 'Importadas' : 'Faltam'}</span></td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>`;
  } catch (erro) {
    console.error(erro);
  }
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------
function descreverResumo(i) {
  const r = i.resumo ?? {};
  if (i.tipo === 'frequencia') return `${plural(r.aulas ?? 0, 'aula', 'aulas')} (${r.aulasNovas ?? 0} novas) · ${r.marcacoes ?? 0} marcações · ${escapar(i.turmaNome ?? '')}`;
  return `${plural(r.alunosNovos ?? 0, 'pessoa nova', 'pessoas novas')}, ${r.alunosAtualizados ?? 0} atualizadas · ${plural(r.turmasNovas ?? 0, 'turma nova', 'turmas novas')} · ${plural(r.matriculasNovas ?? 0, 'matrícula nova', 'matrículas novas')}, ${r.matriculasAtualizadas ?? 0} atualizadas`;
}

async function mostrarHistorico() {
  try {
    const importacoes = await listarImportacoes();
    $('#historico').innerHTML = importacoes.length
      ? importacoes
          .map(
            (i) => `
        <article class="cartao item">
          <div class="item__principal">
            <h3 class="item__titulo">${escapar(i.arquivo)} <span class="selo selo--neutro">${i.tipo === 'frequencia' ? 'Presenças e faltas' : 'Matrículas'}</span></h3>
            <p class="item__meta">${escapar(formatarDataHora(i.criadoEm))} · ${descreverResumo(i)}</p>
            ${i.avisos?.length ? `<details><summary class="item__meta">${plural(i.avisos.length, 'aviso', 'avisos')}</summary><ul class="avisos">${i.avisos.map((a) => `<li>${escapar(a)}</li>`).join('')}</ul></details>` : ''}
          </div>
        </article>`,
          )
          .join('')
      : '<p class="estado-vazio">Nenhuma importação ainda.</p>';
  } catch (erro) {
    console.error(erro);
    $('#historico').innerHTML = '<p class="aviso" role="alert">Não foi possível carregar o histórico.</p>';
  }
}

atualizarPainel();
