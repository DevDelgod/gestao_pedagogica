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
} from '../services/importacao.service.js';

const eu = await exigirLogin({ papeis: [PAPEIS.ADMIN, PAPEIS.COORDENADOR] });
montarShell({ ativo: 'importar', perfil: eu });

const estado = {
  lido: null, // o que há no arquivo escolhido
  existentes: null, // o que já está no sistema
  mapa: {}, // chave da situação da planilha → situação nossa, escolhida pela pessoa
  periodo: '', // período das turmas, quando o nome do curso não traz
  plano: null, // o plano atual (listagem ou frequência)
  aplicando: false,
};

const $previa = $('#previa');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
/** Só a palavra, no singular ou no plural (o número já aparece em destaque). */
const palavra = (n, um, varios) => (n === 1 ? um : varios);

function mostrarErro(texto) {
  $('#erro-arquivo').textContent = texto;
  $('#erro-arquivo').hidden = !texto;
}

function tratarErro(erro) {
  if (erro instanceof ErroDeNegocio) return mostrarErro(erro.message);
  console.error(erro);
  mostrarErro('Não foi possível ler ou gravar agora. Confira o arquivo e tente de novo.');
}

function fecharPrevia() {
  estado.lido = estado.plano = null;
  $previa.hidden = true;
  $previa.innerHTML = '';
}

const numero = (valor, rotulo) => `<div class="numero"><strong>${valor}</strong><span>${rotulo}</span></div>`;

// ---------------------------------------------------------------------------
// Dados guardados neste navegador (só no modo local)
// ---------------------------------------------------------------------------
async function mostrarDados() {
  if (!dev) return; // com o Firebase de verdade, backup e limpeza são feitos pelo console do Firebase
  $('#cartao-dados').hidden = false;
  const exemplo = dev.origem() === 'exemplo';
  $('#dados-texto').textContent = exemplo
    ? 'Este navegador está com dados de exemplo (fictícios). Limpe-os antes da primeira importação real, para não misturar com as pessoas de verdade.'
    : 'Os dados ficam guardados só neste navegador, neste computador, e nunca saem dele. Baixe um backup de vez em quando: se o navegador for limpo ou trocado, os dados somem.';
  $('#btn-limpar').textContent = exemplo ? 'Limpar dados de exemplo' : 'Apagar todos os dados';
  const e = await carregarExistentes();
  $('#dados-contagem').textContent = `Guardados agora: ${plural(e.alunos.length, 'pessoa', 'pessoas')}, ${plural(e.matriculas.length, 'matrícula', 'matrículas')}, ${plural(e.turmas.length, 'turma', 'turmas')}, ${plural(e.cursos.length, 'curso', 'cursos')}.`;
}

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
    await Promise.all([mostrarDados(), mostrarHistorico()]);
  } catch (erro) {
    mostrarErro(erro.message);
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
  await Promise.all([mostrarDados(), mostrarHistorico()]);
  return true;
}

$('#btn-limpar')?.addEventListener('click', async () => {
  if (await limparDados()) fecharPrevia();
});

// ---------------------------------------------------------------------------
// Escolher o arquivo
// ---------------------------------------------------------------------------
async function escolherArquivo(arquivo) {
  if (!arquivo || estado.aplicando) return;
  mostrarErro('');
  fecharPrevia();
  $('#area-arquivo').firstElementChild.textContent = 'Lendo a planilha…';
  try {
    estado.lido = await lerArquivoDeImportacao(arquivo);
    estado.existentes = await carregarExistentes();
    if (estado.lido.tipo === 'listagem') {
      estado.mapa = await obterMapaDeSituacoes();
      estado.periodo = estado.lido.periodoSugerido;
      montarPreviaListagem();
    } else {
      await montarPreviaFrequencia();
    }
    $previa.scrollIntoView({ block: 'start' });
  } catch (erro) {
    fecharPrevia();
    tratarErro(erro);
  } finally {
    $('#area-arquivo').firstElementChild.textContent = 'Escolha o arquivo';
    $('#arquivo').value = '';
  }
}

$('#arquivo').addEventListener('change', (evento) => escolherArquivo(evento.target.files[0]));
const area = $('#area-arquivo');
area.addEventListener('dragover', (evento) => {
  evento.preventDefault();
  area.classList.add('area-arquivo--sobre');
});
area.addEventListener('dragleave', () => area.classList.remove('area-arquivo--sobre'));
area.addEventListener('drop', (evento) => {
  evento.preventDefault();
  area.classList.remove('area-arquivo--sobre');
  escolherArquivo(evento.dataTransfer.files[0]);
});

// ---------------------------------------------------------------------------
// Pré-visualização da listagem
// ---------------------------------------------------------------------------
function montarPreviaListagem() {
  const { lido } = estado;
  const situacoesDoArquivo = planejarListagem(lido.registros, estado.existentes, { periodoPadrao: estado.periodo, mapaStatus: estado.mapa, hoje: hojeISO() }).situacoes;

  $previa.hidden = false;
  $previa.innerHTML = `
    <article class="cartao bloco">
      <div>
        <h2>Listagem de candidatos</h2>
        <p class="item__meta">${escapar(lido.nomeArquivo)} · ${plural(lido.registros.length, 'linha lida', 'linhas lidas')}. Nada foi gravado ainda.</p>
      </div>

      <div id="prev-exemplo" class="aviso" hidden>
        Este navegador ainda tem os dados de exemplo. Limpe-os antes de importar, para não misturar com as pessoas de verdade.
        <button class="link-botao" type="button" id="prev-limpar">Limpar dados de exemplo</button>
      </div>

      <div class="numeros" id="prev-numeros"></div>

      <div class="campo">
        <label for="prev-periodo">Período das turmas</label>
        <input id="prev-periodo" maxlength="20" value="${escapar(estado.periodo)}" autocomplete="off" />
        <span class="campo__ajuda">Vale quando o nome do curso não começa com o período (por exemplo "2026.1 - Audiovisual…"). Sugerido pelas datas de inscrição.</span>
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
        <button class="botao" type="button" id="btn-importar">Importar</button>
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
    mostrarConcluido('Listagem importada', [
      numero(resumo.alunosNovos, `${palavra(resumo.alunosNovos, 'pessoa nova', 'pessoas novas')} (${resumo.alunosAtualizados} atualizadas)`),
      numero(resumo.matriculasNovas, `${palavra(resumo.matriculasNovas, 'matrícula nova', 'matrículas novas')} (${resumo.matriculasAtualizadas} atualizadas)`),
      numero(resumo.turmasNovas, `${palavra(resumo.turmasNovas, 'turma nova', 'turmas novas')} (${resumo.turmasAtualizadas} atualizadas)`),
      numero(resumo.cursosNovos, palavra(resumo.cursosNovos, 'curso novo', 'cursos novos')),
    ]);
  } catch (erro) {
    estado.aplicando = false;
    $('#prev-progresso').hidden = true;
    replanejar();
    tratarErro(erro);
    return;
  }
  await Promise.all([mostrarDados(), mostrarHistorico()]);
}

function mostrarConcluido(titulo, numeros) {
  $previa.innerHTML = `
    <article class="cartao bloco">
      <h2>${escapar(titulo)}</h2>
      <div class="numeros">${numeros.join('')}</div>
      <div class="item__acoes">
        <a class="botao" href="turmas.html">Ver turmas</a>
        <a class="botao botao--fantasma" href="analises.html">Ver análises</a>
        <button class="botao botao--fantasma" type="button" id="btn-outro">Importar outro arquivo</button>
      </div>
    </article>`;
  $('#btn-outro').addEventListener('click', () => {
    fecharPrevia();
    $('#area-arquivo').scrollIntoView({ block: 'center' });
  });
  toast(titulo + '.', 'sucesso');
}

// ---------------------------------------------------------------------------
// Pré-visualização da frequência
// ---------------------------------------------------------------------------
async function montarPreviaFrequencia() {
  const { resolucao, plano } = await prepararFrequencia(estado.lido.leitura);
  estado.plano = plano;
  const r = plano.resumo;
  const primeira = plano.datas[0];
  const ultima = plano.datas.at(-1);

  $previa.hidden = false;
  $previa.innerHTML = `
    <article class="cartao bloco">
      <div>
        <h2>Lista de frequência</h2>
        <p class="item__meta">${escapar(estado.lido.nomeArquivo)}. Nada foi gravado ainda.</p>
      </div>
      <p><strong>Turma:</strong> ${escapar(plano.turmaNome)}
        <span class="item__meta">(${resolucao.pelaLista ? 'achada pelos números de inscrição' : 'achada pelo nome da turma'})</span></p>
      <div class="numeros">
        ${numero(`${r.casadas} de ${r.pessoas}`, 'pessoas da planilha são matrículas desta turma')}
        ${numero(r.aulas, `aulas (${r.aulasNovas} novas)`)}
        ${numero(r.marcacoes, 'presenças e faltas')}
      </div>
      <p class="item__meta">Aulas de ${escapar(formatarData(primeira))} a ${escapar(formatarData(ultima))}. Aulas que já existem recebem as marcações da planilha e mantêm o conteúdo; a frequência e o risco de evasão de toda a turma são recalculados.</p>
      <ul class="avisos">${plano.avisos.map((a) => `<li class="${a.nivel === 'info' ? 'info' : ''}">${escapar(a.texto)}</li>`).join('')}</ul>
      <div id="prev-progresso" hidden>
        <progress id="prog" max="1" value="0"></progress>
        <p class="item__meta" id="prog-texto"></p>
      </div>
      <div class="item__acoes">
        <button class="botao" type="button" id="btn-importar" ${r.aulas ? '' : 'disabled'}>Importar</button>
        <button class="botao botao--fantasma" type="button" id="btn-cancelar">Cancelar</button>
      </div>
    </article>`;
  $('#btn-cancelar').addEventListener('click', fecharPrevia);
  $('#btn-importar').addEventListener('click', importarFrequencia);
}

async function importarFrequencia() {
  const plano = estado.plano;
  estado.aplicando = true;
  $('#btn-importar').disabled = true;
  $('#prev-progresso').hidden = false;
  try {
    const resumo = await aplicarFrequencia(plano, {
      arquivo: estado.lido.nomeArquivo,
      aoProgresso: (feito, total) => {
        $('#prog').value = total ? feito / total : 1;
        $('#prog-texto').textContent = `Gravando… ${feito} de ${total}`;
      },
    });
    estado.aplicando = false;
    mostrarConcluido('Frequência importada', [
      numero(resumo.aulas, `aulas (${resumo.aulasNovas} novas)`),
      numero(resumo.marcacoes, 'presenças e faltas'),
      numero(resumo.casadas, 'pessoas com a frequência recalculada'),
    ]);
  } catch (erro) {
    estado.aplicando = false;
    $('#prev-progresso').hidden = true;
    $('#btn-importar').disabled = false;
    tratarErro(erro);
    return;
  }
  await Promise.all([mostrarDados(), mostrarHistorico()]);
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
            <h3 class="item__titulo">${escapar(i.arquivo)} <span class="selo selo--neutro">${i.tipo === 'frequencia' ? 'Frequência' : 'Listagem'}</span></h3>
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

mostrarDados();
mostrarHistorico();
