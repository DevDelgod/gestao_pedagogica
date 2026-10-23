# Modelo de dados (Firestore)

Fonte de verdade no código: [`js/models/schema.js`](../js/models/schema.js) (nomes de coleções, enums e fábricas). Este arquivo explica o **porquê** e mostra documentos de exemplo.

## Visão geral

```
users/{uid}                         equipe (admin, coordenador, professor)
cursos/{cursoId}                    catálogo
turmas/{turmaId}                    oferta de um curso (vagas, dias, professor)
alunos/{alunoId}                    cadastro da pessoa
editais/{editalId}                  processo seletivo: modalidade, turmas, requisitos, prazos
inscricoes/{inscricaoId}            inscrição de uma pessoa num edital (vinda do site)
selecoes/{editalId_turmaId}         registro auditável do sorteio/classificação de uma turma
matriculas/{turmaId_alunoId}        aluno ↔ turma  (+ resumo de frequência e média)
aulas/{turmaId_AAAA-MM-DD}          diário de classe + chamada do dia
avaliacoes/{avaliacaoId}            avaliação da turma + notas de todos
importacoes/{importacaoId}          histórico das planilhas importadas do sistema oficial
configuracoes/importacao            como traduzir as situações das planilhas (escolha da equipe)
```

```
curso 1───n turma 1───n matrícula n───1 aluno
                 │
                 ├───n aula        (chamada: { alunoId: P|F|J })
                 └───n avaliação   (resultados: { alunoId: nota }  ou  { alunoId: true | false })

edital ──oferta──▶ turmas
   └───n inscrição ──(seleção)──▶ convocada ──(requisitos ok)──▶ matrícula (+ aluno)
                          └─────▶ remanescente · não selecionada
```

## Dados vindos do sistema oficial (importação)

Este sistema é **secundário**: as pessoas, matrículas e a chamada chegam por planilhas exportadas do sistema oficial (regras em `js/domain/importacao.js`, gravação em `js/services/importacao.service.js`). O que a importação acrescenta ao modelo:

| Onde | Campo | O que é |
|---|---|---|
| `alunos` | `idExterno` | o "Id do candidato" do sistema oficial: com ele, reimportar acha a mesma pessoa (senão, CPF e depois e-mail) |
| `alunos` | `raca`, `deficiencia`, `programaSocial`, `mcmv` | perfil, como declarado no cadastro oficial. As três últimas são `{ possui: true \| false, qual }`; ausente = a planilha não disse |
| `alunos` | `whatsapp`, `endereco { cep, rua, bairro, cidade, estado }`, `origem` | contato e endereço completos; `origem` é `importacao` ou `manual` |
| `matriculas` | `numeroInscricao` | ex.: `QM05075`; é por ele que a planilha de frequência acha a matrícula |
| `matriculas` | `statusExterno`, `dataInscricao`, `origem` | a situação como o sistema oficial escreve ("Ativo"), a data de inscrição e a origem. A nossa `status` é a tradução, escolhida na tela de importação |
| `turmas` | `polo`, `periodo`, `horarioTexto`, `origem` | onde, quando ("2026.1") e o horário como vem escrito ("Terça, Quarta e Quinta-feira - 18:00 às 21:00"); `diasSemana`, `horarioInicio` e `horarioFim` são lidos desse texto quando dá |
| `importacoes` | `tipo`, `arquivo`, `resumo`, `avisos` | uma linha por planilha importada (com os avisos) |
| `configuracoes/importacao` | `mapaStatus` | `{ "ativo": "ativa", "desistente": "evadida" }`: a tradução das situações, para as próximas importações |

**Identificadores estáveis** (é o que torna a reimportação segura): pessoa `cand{idCandidato}` (ou `cpf{cpf}`, ou um resumo do e-mail ou da inscrição, nessa ordem), matrícula `{turmaId}_{alunoId}`, aula `{turmaId}_{AAAA-MM-DD}`, e turma e curso um resumo (FNV-1a) do texto normalizado: turma = período + curso + polo + horário; curso = nome. Mudar a grafia do polo ou do horário na exportação cria **outra turma**; caixa, acento e espaços não mudam nada.

**O que a importação mexe e o que preserva:**
- Pessoa: grava o que a planilha traz **e não está em branco**; campo em branco não apaga o que já existe. Nome social, gênero, observações e documentos nunca são tocados. A situação da pessoa é recalculada pelas matrículas.
- Matrícula: grava `status`, `statusExterno`, `numeroInscricao`. Frequência, média e aptidão existentes ficam (a frequência é recalculada pela planilha de frequência).
- Turma: nova nasce `em_andamento`, com `vagas` igual ao número de matrículas que vieram (o sistema oficial não diz a capacidade: **trate como "quantas pessoas"**, e edite se quiser). Em reimportação só mexe em polo, período, horário, `vagasOcupadas` (= matrículas ativas) e em `vagas` se faltar lugar.
- Frequência: soma às aulas que já existem (quem não está na planilha continua na aula, e o conteúdo é mantido) e recalcula `frequencia` e `riscoEvasao` de **todas** as matrículas da turma.

**Em lotes:** a importação grava em lotes de 400 escritas (o Firestore aceita 500), na ordem cursos → turmas → pessoas → matrículas. Cada lote é separado: se falhar no meio, importar o mesmo arquivo de novo completa.

## O processo: inscrição → seleção → matrícula

> **Fora do menu hoje** (o sistema oficial faz a seleção); o modelo abaixo continua valendo para o módulo de editais.

Cada **edital** descreve como a instituição trabalha. O sistema não tem um fluxo fixo: o edital escolhe a **modalidade** de seleção e os **requisitos de matrícula**.

**Etapas do edital** (a equipe avança uma por vez, em *Editais*):

| Etapa | O que acontece |
|---|---|
| `rascunho` | Pode ser editado à vontade. |
| `inscricoes` | O formulário do site aceita inscrições, **só dentro da janela de datas** e **só para as turmas ofertadas** (conferido pelas regras do Firestore). |
| `selecao` | Inscrições encerradas. Aqui se executa o sorteio/classificação, uma vez por turma. |
| `matriculas` | Resultado publicado. Convocados cumprem os requisitos e são matriculados; remanescentes são chamados quando abrem vagas. |
| `encerrado` | Somente consulta. |

**Modalidades de seleção** (`editais.modalidade`):

| Modalidade | Como as vagas são preenchidas |
|---|---|
| `sorteio` | Sorteio entre os inscritos da turma, com **semente registrada** (auditável — ver abaixo). |
| `prova` | A equipe lança a nota de cada inscrito; vencem as maiores notas (nota mínima opcional; empate = quem se inscreveu antes). |
| `ordem_chegada` | Vale a ordem de inscrição. |
| `analise` | Sem execução automática: a equipe convoca pessoa a pessoa. |

**Requisitos de matrícula** (`editais.requisitosMatricula`): lista livre, ex. *Documentos pessoais* (`documento`), *Taxa de matrícula* (`pagamento`), *Termo assinado* (`termo`). Cada convocado ganha a lista em `inscricoes.requisitos`; a equipe marca cada item como cumprido e **só então** a matrícula pode ser efetivada. Um edital sem requisitos permite matricular direto.

**Situações da inscrição** (`inscricoes.status`): `inscrita` → `convocada` → `matriculada`; ou `remanescente`, `nao_selecionada`, `indeferida`, `desistente`.

**Remanescentes** são os inscritos que não ficaram nas vagas da seleção e aguardam numa lista ordenada (`posicaoRemanescente`). Quando uma vaga se libera (desistência ou prazo vencido), o primeiro remanescente é convocado. Cada edital escolhe se forma essa lista (`config.listaRemanescentes`); sem ela, quem não ficou nas vagas vira `nao_selecionada`.

Para suportar uma instituição com outro jeito de trabalhar basta criar um edital com outra modalidade e outros requisitos. Para uma modalidade realmente nova (ex.: análise de renda), acrescente um `case` em `ordenarCandidatos` (`js/domain/selecao.js`): nada mais muda.

Todas as coleções são **de primeiro nível** (sem subcoleções). Isso simplifica regras de segurança, índices e consultas do painel (`getCountFromServer` por coleção).

## Decisões de projeto

| Decisão | Por quê |
|---|---|
| **Chamada num único documento** (`aulas/{id}.registros = { alunoId: 'P' }`) | Marcar a turma toda é **1 escrita**, e a tela de chamada lê **1 documento**. É o que dá velocidade à marcação rápida. Limite do Firestore: 1 MiB por documento — comporta milhares de alunos por aula. |
| **Resultados num único documento** (`avaliacoes/{id}.notas` ou `.aptos`) | Mesma lógica: lançar a coluna de uma prova = 1 escrita. |
| **Forma de avaliar em cada avaliação** (`avaliacoes.modo`) | Quem avalia decide, prova a prova, se vale nota (0 a 10) ou Apto / Não apto. As duas convivem na mesma turma: a matrícula guarda `media` (das notas) e `aptidao` (dos Apto / Não apto) separadas, sem misturar escalas. O curso só **sugere** uma forma (`cursos.modoAvaliacao`) para já vir marcada ao criar uma avaliação. |
| **ID determinístico** em matrículas e aulas | `turmaId_alunoId` impede matrícula duplicada; `turmaId_data` impede dois diários no mesmo dia. Sem consulta prévia e sem condição de corrida. |
| **Nomes copiados** (`alunoNome`, `cursoNome`…) | Firestore não tem JOIN. Listas de matrículas/turmas aparecem sem leituras extras. Custo: se renomear um curso, as cópias antigas ficam como estavam (aceitável aqui; corrija com um script se precisar). |
| **Resumo na matrícula** (`frequencia`, `riscoEvasao`, `media` e `aptidao`) | Painel e lista de "alunos em risco" viram uma consulta simples. É **recalculado do zero** após cada chamada/avaliação (`js/domain/regras.js`, `diario.js` e `avaliacoes.js`), nunca incrementado — corrigir uma chamada ou nota antiga não desajusta contadores. |
| **Datas de calendário como `'AAAA-MM-DD'`** | Evita o bug de "a aula caiu um dia antes" por fuso horário. Só `criadoEm`/`atualizadoEm` usam Timestamp. |
| **Contagens do painel via `getCountFromServer`** | Não precisa manter contadores globais. Únicos contadores manuais: `turmas.vagasOcupadas` e `turmas.vagasReservadas`, alterados só dentro de transações. |
| **Vaga reservada na convocação** (`vagasReservadas`) | Convocar reserva a vaga; matricular a converte em ocupada; desistir/prazo a devolve. Vaga livre = `vagas − ocupadas − reservadas`. Assim a seleção nunca convoca mais gente do que há vagas, mesmo com convocados ainda reunindo documentos. |
| **Edital como unidade de configuração** | Modalidade, requisitos, prazos e lista de remanescentes ficam no edital, não no código. Outra instituição = outro edital. |
| **Sorteio auditável** | O sorteio usa uma **semente** (digitada, p. ex. da Loteria Federal, ou gerada) e é gravado em `selecoes/` com a lista de candidatos. Qualquer pessoa refaz o sorteio e confere — o sistema mostra "Conferido" no registro. |
| **Seleção só uma vez por turma** | O id `editalId_turmaId` do registro impede repetir o sorteio até obter outro resultado. |
| **Papéis em `users/{uid}`**, não em custom claims | Funciona só com o plano gratuito, sem Cloud Functions. Troca de papel vale na hora. |

### Limites conhecidos (para evoluir depois)

- **Sem portal do aluno (decisão):** o sistema é só para **coordenadores e professores**; o aluno é apenas um registro, nunca um usuário. Por isso a chamada e as notas ficam num mapa por documento (rápido de gravar e de ler) sem preocupação com privacidade entre alunos. Se um dia houver portal, será preciso um espelho individual por aluno ou documentos separados por aluno (`aulas/{id}/presencas/{alunoId}`).
- **Dados sensíveis:** gênero, nome social e CPF são dados pessoais que pedem cuidado (LGPD). O gênero é opcional e só a equipe lê; ao implantar, defina e informe a finalidade da coleta no formulário.
- **Spam no formulário público** (`inscricao.html`): a página tem um campo-armadilha contra robôs simples, e as regras limitam campos, tamanhos e janela de datas, mas nada impede volume nem a mesma pessoa se inscrever várias vezes. Ative o **Firebase App Check** (reCAPTCHA) antes de publicar o formulário. Inscrições duplicadas (mesmo e-mail no mesmo edital) ainda não são detectadas: no sorteio, cada inscrição concorre; trate duplicatas com *Indeferir* antes de encerrar as inscrições.
- **Várias instituições no mesmo projeto:** o modelo atual atende **uma instituição por projeto do Firebase**, com o processo configurado por edital. Cada instituição nova pode ter o seu próprio projeto (isolamento total e sem mudanças no código). Hospedar várias no mesmo projeto exigiria um `instituicaoId` em todos os documentos e nas regras — não está feito.
- **Resultado público:** o site ainda não consegue exibir o resultado do sorteio (as inscrições e os registros só são lidos pela equipe). Quando for preciso, publique uma lista de protocolos/ids por edital numa coleção de leitura pública.
- **Prazo de matrícula:** vale N dias a partir da convocação (`prazoMatriculaDias`). Um prazo fixo único para todos (comum em editais) não está modelado.
- **CPF e documentos** são dados pessoais (LGPD): peça só o necessário e mantenha o acesso restrito à equipe.

---

## Documentos de exemplo

### `users/{uid}` — o id é o uid do Firebase Auth
```json
{
  "nome": "Marina Souza",
  "email": "marina@fudev.org",
  "papel": "coordenador",
  "ativo": true,
  "criadoEm": "<Timestamp>"
}
```
`papel`: `admin` | `coordenador` | `professor`.

### `cursos/{cursoId}`
```json
{
  "nome": "Desenvolvimento Web Básico",
  "descricao": "HTML, CSS e JavaScript do zero.",
  "cargaHoraria": 60,
  "frequenciaMinima": 75,
  "modoAvaliacao": "nota",
  "mediaAprovacao": 7,
  "ativo": true
}
```
`modoAvaliacao` é só a **forma de avaliar sugerida** ao criar uma avaliação do curso: `nota` ou `apto`. Quem cria a avaliação pode escolher a outra, e as duas podem existir na mesma turma. `mediaAprovacao` vale para as avaliações por nota. Cursos antigos, sem o campo, sugerem `nota`.

### `turmas/{turmaId}`
```json
{
  "cursoId": "web-basico",
  "cursoNome": "Desenvolvimento Web Básico",
  "nome": "Web Básico 2026.1 — Noite",
  "professorId": "uidDoProfessor",
  "professorNome": "Carlos Lima",
  "vagas": 20,
  "vagasOcupadas": 14,
  "vagasReservadas": 3,
  "diasSemana": ["seg", "qua"],
  "horarioInicio": "19:00",
  "horarioFim": "21:00",
  "dataInicio": "2026-03-02",
  "dataFim": "2026-06-24",
  "status": "em_andamento"
}
```
`status`: `planejada` → `aberta` → `em_andamento` → `encerrada` | `cancelada`. Aceitam matrícula `planejada`, `aberta` e `em_andamento` (entrada tardia). Aqui há 14 matriculados + 3 convocados reservando vaga = 17 de 20, restam 3 livres.

**Cadastro de cursos e turmas** (telas *Cursos* e *Turmas*, validação em `js/domain/cadastros.js`):

- Cursos **não são apagados, só desativados**: o histórico (turmas, matrículas) continua fazendo sentido, e o curso inativo some da lista ao criar turmas. Renomear um curso atualiza `cursoNome` nas turmas dele; as cópias em matrículas e editais ficam como estavam.
- Os contadores da turma (`vagasOcupadas`, `vagasReservadas`) **nunca** são alterados pelo cadastro. Ao editar uma turma o sistema recusa: **vagas totais abaixo do que já está comprometido** (matriculados + convocados); **trocar o curso** se já há matriculados ou convocados; **encerrar ou cancelar** com convocados aguardando matrícula.
- Renomear uma turma não atualiza a cópia do nome guardada num edital em rascunho: reabra o edital e salve de novo.

### `alunos/{alunoId}`
```json
{
  "nome": "Beatriz Lopes",
  "nomeSocial": "Bia Lopes",
  "genero": "outro",
  "generoOutro": "Demigênero",
  "email": "bia@email.com",
  "telefone": "(11) 91234-5678",
  "cpf": "",
  "dataNascimento": "2008-05-14",
  "responsavel": { "nome": "Ana Pereira", "telefone": "(11) 98765-4321", "parentesco": "mãe" },
  "endereco": { "cidade": "São Paulo", "bairro": "Lapa" },
  "documentos": [
    {
      "nome": "rg-frente.jpg",
      "url": "https://res.cloudinary.com/<cloud>/image/upload/v1/fudev/alunos/rg-frente.jpg",
      "publicId": "fudev/alunos/rg-frente",
      "tipo": "image",
      "bytes": 183422
    }
  ],
  "observacoes": "",
  "status": "ativo"
}
```
`email` é sempre gravado em minúsculas (usado para achar duplicados). `status`: `ativo` | `inativo` | `evadido`.

**Nome social e gênero** (o sistema atende pessoas LGBTQIAPN+): `nome` é o nome civil (o do documento) e `nomeSocial`, quando existe, é o **nome usado para chamar a pessoa**: listas, chamada, avisos e a cópia `alunoNome` nas matrículas usam o social (`nomeExibicao` em `js/domain/pessoa.js`), e o civil aparece como informação secundária para a equipe. Mudar o nome social atualiza a cópia nas matrículas do aluno na mesma operação. `genero` é **opcional** e autodeclarado, um de `GENEROS` (`js/models/schema.js`): mulher cis, homem cis, mulher trans, homem trans, travesti, pessoa não binária, gênero fluido, agênero, **outro**, prefiro não informar. Com `outro`, a pessoa escreve o próprio gênero em `generoOutro` (até 60 caracteres); com qualquer outra opção o texto livre é descartado. A lista de valores está repetida em `firestore.rules`: mude nos dois lugares.

**A situação do aluno é derivada das matrículas, nunca editada à mão:** alguma matrícula `ativa` ou `trancada` → `ativo`; senão, alguma `evadida` → `evadido`; senão (só concluídas/canceladas, ou nenhuma) → `inativo`. Um aluno cadastrado à mão nasce `inativo` (sem matrícula) e vira `ativo` ao ser matriculado. **E-mail e CPF não podem repetir** entre alunos (o e-mail é a chave que liga uma inscrição a um cadastro existente); o CPF é gravado só com dígitos e conferido pelos dígitos verificadores. **Menor de 18 anos exige o nome do responsável.**

`documentos` guarda `{ nome, url, publicId, tipo, bytes }` (até 10 por aluno). Remover um documento só o **desvincula**: apagar o arquivo no Cloudinary exige a chave secreta, ou seja, um servidor. No modo desenvolvimento o envio é simulado: o arquivo vira um data URL guardado no navegador, com limite de 600 KB.

### `editais/{editalId}`
```json
{
  "titulo": "Edital 01/2026 — Cursos de Tecnologia",
  "descricao": "Inscrições para as turmas do primeiro semestre.",
  "modalidade": "sorteio",
  "status": "inscricoes",
  "inscricoesInicio": "<Timestamp>",
  "inscricoesFim": "<Timestamp>",
  "dataResultado": "2026-02-20",
  "turmaIds": ["t9x8", "t7y6"],
  "turmas": [
    { "id": "t9x8", "nome": "Web Básico 2026.1 — Noite", "cursoId": "web-basico", "cursoNome": "Desenvolvimento Web Básico" },
    { "id": "t7y6", "nome": "Design 2026.1 — Tarde", "cursoId": "design", "cursoNome": "Design Gráfico" }
  ],
  "requisitosMatricula": [
    { "id": "documentos-pessoais", "tipo": "documento", "rotulo": "Documentos pessoais" },
    { "id": "taxa-de-matricula", "tipo": "pagamento", "rotulo": "Taxa de matrícula" }
  ],
  "config": { "listaRemanescentes": true, "prazoMatriculaDias": 5, "notaMinima": 0, "notaMaxima": 10 }
}
```
`turmaIds` (usado pelas regras de segurança) e `turmas` (cópia com nomes, para o formulário do site montar as opções) andam juntos. `notaMinima`/`notaMaxima` só valem para a modalidade `prova`. O site pode listar os editais abertos com `listarEditaisAbertos()`: as regras só deixam ler os que estão em `inscricoes`.

### `inscricoes/{inscricaoId}` — criada pelo site, sem login
```json
{
  "nome": "João Pereira",
  "nomeSocial": "Joana Pereira",
  "genero": "mulher_trans",
  "email": "joao@email.com",
  "telefone": "(11) 91234-5678",
  "editalId": "ed01",
  "turmaId": "t9x8",
  "mensagem": "Tenho interesse no período da noite.",
  "origem": "site",
  "status": "inscrita",
  "criadoEm": "<Timestamp>"
}
```
`nomeSocial`, `genero` e `generoOutro` são opcionais e **só existem no documento quando preenchidos** (as regras aceitam a ausência, não valores vazios). Ao efetivar a matrícula, os três são copiados para o cadastro do aluno.
Os campos acima são os únicos aceitos na criação pública. O sistema acrescenta o resto a cada etapa:

```json
// prova: a equipe lança a nota antes da seleção
{ "nota": 8.5 }

// convocada (por sorteio, classificação ou manualmente)
{ "status": "convocada", "convocadaEm": "<Timestamp>", "prazoMatricula": "2026-02-25",
  "selecao": { "modalidade": "sorteio", "posicao": 3 },
  "requisitos": {
    "documentos-pessoais": { "rotulo": "Documentos pessoais", "tipo": "documento", "cumprido": true, "em": "<Timestamp>", "por": "<uid>" },
    "taxa-de-matricula":   { "rotulo": "Taxa de matrícula",    "tipo": "pagamento", "cumprido": false }
  } }

// remanescente
{ "status": "remanescente", "posicaoRemanescente": 2 }

// matriculada
{ "status": "matriculada", "alunoId": "a1b2", "matriculaId": "t9x8_a1b2", "matriculadaEm": "<Timestamp>", "matriculadaPor": "<uid>" }

// nao_selecionada / indeferida / desistente
{ "status": "desistente", "motivo": "Mudou de cidade", "encerradaEm": "<Timestamp>", "encerradaPor": "<uid>" }
```
Os requisitos são copiados do edital para a inscrição (com o rótulo), para a tela não precisar consultar o edital.

### `selecoes/{editalId_turmaId}` — registro auditável
```json
{
  "editalId": "ed01",
  "turmaId": "t9x8",
  "modalidade": "sorteio",
  "semente": "lotfed-12345-67890",
  "algoritmo": "ids em ordem alfabética → embaralhados por Fisher-Yates com números de mulberry32 semeado por xmur3(semente)",
  "vagasLivres": 17,
  "listaRemanescentes": true,
  "notaMinima": null,
  "candidatos": ["i001", "i002", "i003"],
  "convocados": ["i003", "i001"],
  "remanescentes": ["i002"],
  "naoSelecionados": [],
  "executadaPor": "<uid>",
  "executadaEm": "<Timestamp>"
}
```
Guarda ids, não nomes (o registro pode ser divulgado sem expor dados pessoais). Para conferir um sorteio: pegue `candidatos` (já em ordem alfabética), embaralhe com o algoritmo e a `semente`; os primeiros `vagasLivres` são os `convocados`. A tela de Inscrições faz essa conferência e mostra "Conferido" (`verificarSorteio` em `js/domain/selecao.js`).

### `matriculas/{turmaId_alunoId}`
```json
{
  "alunoId": "a1b2",
  "alunoNome": "João Pereira",
  "turmaId": "t9x8",
  "turmaNome": "Web Básico 2026.1 — Noite",
  "cursoId": "web-basico",
  "cursoNome": "Desenvolvimento Web Básico",
  "inscricaoId": "i7k3",
  "dataMatricula": "2026-02-20",
  "status": "ativa",
  "frequencia": {
    "aulas": 10,
    "presencas": 6,
    "faltas": 3,
    "justificadas": 1,
    "faltasConsecutivas": 3,
    "percentual": 70
  },
  "riscoEvasao": true,
  "media": 7.4,
  "aptidao": null
}
```
`media` vem das avaliações por nota e `aptidao` (`{ "avaliadas": 3, "aptas": 2, "naoAptas": 1 }`) das avaliações Apto / Não apto. Cada uma fica `null` enquanto a pessoa não tem resultado daquela forma (numa turma que só usa uma das formas, a outra fica sempre `null`). `status`: `ativa` | `trancada` | `evadida` | `concluida` | `cancelada`. Ao mudar de situação a matrícula ganha `motivoSituacao`, `situacaoEm` e `situacaoPor`.

**Ciclo da matrícula** (`js/domain/matricula.js`; só a matrícula **ativa** ocupa vaga):

| De | Para | Efeito em `turmas.vagasOcupadas` |
|---|---|---|
| ativa | trancada, evadida, cancelada, concluida | −1 |
| trancada | ativa | +1 (exige turma que aceite matrícula e vaga livre) |
| trancada | evadida, cancelada | 0 |
| evadida, cancelada | ativa | +1 (idem) |
| concluida | — | final |

### `aulas/{turmaId_AAAA-MM-DD}` — diário + chamada
```json
{
  "turmaId": "t9x8",
  "data": "2026-03-04",
  "conteudo": "Introdução ao HTML: tags, atributos e estrutura da página.",
  "professorId": "uidDoProfessor",
  "registros": { "a1b2": "P", "c3d4": "F", "e5f6": "J" },
  "resumo": { "presentes": 1, "faltas": 1, "justificadas": 1 }
}
```
Marcação: `P` presente · `F` falta · `J` falta justificada (conta como presença no percentual por padrão; configurável em `calcularFrequencia`). Quem entra na chamada de uma data (`pessoasDaChamada`): as matrículas **ativas feitas até aquela data** e quem já consta na chamada gravada daquele dia, mesmo que hoje esteja trancado ou tenha saído.

### `avaliacoes/{avaliacaoId}`
Modo `nota`:
```json
{
  "turmaId": "t9x8",
  "modo": "nota",
  "titulo": "Prova 1 — HTML e CSS",
  "tipo": "prova",
  "data": "2026-03-25",
  "peso": 2,
  "notaMaxima": 10,
  "notas": { "a1b2": 7.5, "c3d4": 5 },
  "aptos": {}
}
```
Modo `apto` (`peso` fixo em 1 e `notaMaxima` nula, sem efeito):
```json
{
  "turmaId": "t9x8",
  "modo": "apto",
  "titulo": "Entrega das atividades",
  "tipo": "participacao",
  "data": "2026-03-27",
  "peso": 1,
  "notaMaxima": null,
  "notas": {},
  "aptos": { "a1b2": true, "c3d4": false }
}
```
`modo` é a **forma de avaliar escolhida ao criar a avaliação**: só o mapa dele é usado (`notas` no modo `nota`, `aptos` no modo `apto`); o outro fica vazio, o que permite trocar de forma enquanto não há resultados. `tipo`: `prova` | `trabalho` | `projeto` | `participacao`. **Quem não aparece no mapa de resultados ainda não foi avaliado** (não é zero nem "não apto"): a média ignora a pessoa naquela avaliação.

A **média da matrícula** é a média ponderada das avaliações por nota, com cada nota normalizada para 0–10 pela `notaMaxima` da avaliação (`calcularMedia`). A **aptidão** conta, entre as avaliações Apto / Não apto em que a pessoa tem resultado, quantas foram Apto e quantas Não apto.

> **Resultado final (a construir):** o resultado final cruza a avaliação com a frequência mínima do curso: a pessoa precisa estar apta nas avaliações Apto / Não apto e, se a turma tiver avaliações por nota, a média precisa alcançar `mediaAprovacao`. Hoje o sistema só guarda `media` e `aptidao`; a decisão "aprovado ou não" ainda não é calculada.

---

## Regras de evasão (simples, ajustáveis em `js/domain/regras.js`)

Uma matrícula ativa fica com `riscoEvasao = true` quando:

1. tem **3 ou mais faltas consecutivas** (uma justificada ou presença zera a sequência), **ou**
2. já tem **4+ aulas** e a frequência está **abaixo do mínimo** do curso (padrão 75%).

O sistema só **sinaliza**: marcar uma matrícula como `evadida` é decisão da equipe. A taxa de evasão do painel é `evadidas ÷ total de matrículas`.

---

## Fluxos críticos

Todos os que mexem em vagas são **transações** (tudo ou nada) e seguem a mesma forma: o Firestore não permite consulta dentro de transação e exige todas as leituras antes de qualquer escrita; por isso o que precisa de consulta (candidatos, aluno por e-mail, próximo remanescente) é buscado **antes**, e a transação **releia e confirme** cada documento. Os corpos das transações (`...NaTransacao`) são exportados para serem testados com uma `tx` falsa. Cada recusa de regra de negócio é um `ErroDeNegocio` com código próprio, cuja mensagem já serve para mostrar na tela.

**Realizar a seleção do edital** — ✅ `realizarSelecao` (`js/services/selecao.service.js`), o que a tela de Inscrições aciona: num só gesto, (1) encerra as inscrições se ainda estiverem abertas, (2) executa a seleção de cada turma pendente, cada uma na sua transação e com registro próprio, e (3) se pedido, publica o resultado e abre as matrículas. Os selecionados já ficam `convocada`, que é onde a matrícula começa. Se uma turma falhar, as outras continuam valendo, a falha volta no resultado e o resultado **não** é publicado; repetir a operação sorteia só as pendentes. Uma única semente vale para todas as turmas do lote (cada registro guarda a sua e é conferido separadamente).

**Executar a seleção de uma turma** — ✅ `executarSelecao` (usada por `realizarSelecao`), uma turma por vez:
1. exige edital em `selecao`, modalidade automática, turma ofertada e que a seleção da turma ainda não tenha sido feita;
2. entram só as inscrições que continuam `inscrita`; `ordenarCandidatos` define quem está apto e em que ordem (sorteio com semente, notas, ordem de inscrição);
3. `distribuirVagas`: os primeiros N (N = vagas livres) viram `convocada` e **reservam vaga**; o resto vira `remanescente` (com `posicaoRemanescente`) ou `nao_selecionada` (se o edital não tem lista de remanescentes, ou por nota ausente/abaixo da mínima);
4. grava `selecoes/{editalId_turmaId}` e soma `turmas.vagasReservadas`. Limite de uma transação: 490 inscrições por turma.

**Convocar individualmente** — ✅ `convocarInscricao` (modalidade `analise`) e `convocarProximoRemanescente`: confirma que a inscrição é `inscrita`/`remanescente`, que a turma aceita matrícula e que há vaga livre; reserva a vaga.

**Efetivar matrícula** — ✅ `efetivarMatricula`, a partir de uma `convocada`:
1. *fora* da transação, procura aluno com o mesmo e-mail (`buscarAlunoPorEmail`); se não achar, reserva um id novo;
2. validações: inscrição `convocada` · **todos os requisitos cumpridos** · turma aceita matrícula · há vaga reservada · matrícula ainda não existe;
3. escritas: cria o aluno (ou reativa o existente se estava inativo/evadido) · cria `matriculas/{turmaId_alunoId}` · `vagasReservadas −1` e `vagasOcupadas +1` · inscrição → `matriculada`.

**Desistência / prazo vencido** — ✅ `desistirDaVaga`: `convocada` → `desistente` e `vagasReservadas −1`. A vaga volta e fica disponível para o próximo remanescente. A tela marca "Prazo vencido" mas **não encerra a convocação sozinha**: a equipe decide (não há processo agendado rodando).

**Indeferir** — ✅ `indeferirInscricao`: recusa de `inscrita`/`remanescente`; não mexe em vagas.

**Avançar etapa do edital** — ✅ `avancarEtapa`: não abre inscrições com a janela já vencida e não publica o resultado enquanto alguma turma não tiver a seleção executada (nas modalidades automáticas).

**Registrar, corrigir e excluir uma aula** — ✅ `registrarAula` / `excluirAula` (`js/services/diario.service.js`, regras puras em `js/domain/diario.js`): uma única transação que (1) grava (ou corrige, ou apaga) `aulas/{turmaId_data}` com `registros` e `resumo` e (2) **recalcula do zero**, com todas as aulas de agora, a `frequencia` e o `riscoEvasao` de **todas** as matrículas da turma. Como nada é incrementado, corrigir ou excluir uma aula antiga acerta os números sozinho, e uma aula inserida no meio respeita a **ordem das datas** (importa para faltas consecutivas). A chamada exige uma marca para cada pessoa da lista; datas futuras são recusadas; turma cancelada não recebe chamada. O professor da turma pode registrar e corrigir; **excluir é só da coordenação** (regras do Firestore e botão da tela). Se outra pessoa criar uma aula entre a consulta e a gravação, ela não entra naquele cálculo, e a gravação seguinte corrige.

**Criar, editar, lançar e excluir avaliações** — ✅ `criarAvaliacao` / `editarAvaliacao` / `lancarResultados` / `excluirAvaliacao` (`js/services/avaliacoes.service.js`, regras puras em `js/domain/avaliacoes.js`): como no diário, uma única transação que (1) grava a avaliação (ou a apaga) e (2) **recalcula do zero** `media` (modo nota) ou `aptidao` (modo apto) de **todas** as matrículas da turma, com todas as avaliações de agora. Por isso mudar o peso de uma avaliação, corrigir uma nota ou excluir uma avaliação acerta as médias sozinho. A forma de avaliar (nota ou Apto / Não apto) é escolhida ao criar a avaliação; o curso só sugere qual já vem marcada. Recusas: turma cancelada; nota fora de 0 a `notaMaxima`; resultado de quem não tem matrícula na turma; reduzir a `notaMaxima` abaixo da maior nota já lançada; **trocar a forma de avaliar com resultados já lançados** (limpe os resultados e salve antes). Entram na lista de lançamento as matrículas **ativas** e quem já tem resultado na avaliação, mesmo que hoje esteja trancado ou tenha saído. O professor da turma pode criar, editar e lançar; **excluir é só da coordenação** (regras do Firestore e botão da tela). Os resultados não precisam estar completos: quem fica de fora continua "sem resultado".

**Mudar a situação da matrícula** — ✅ `alterarSituacaoMatricula` (`js/services/matriculas.service.js`): numa transação, valida a transição, ajusta `vagasOcupadas` (nunca abaixo de zero), grava o motivo e recalcula a situação do aluno a partir de **todas** as matrículas dele (as outras são procuradas antes e relidas dentro da transação). A vaga liberada fica disponível para o próximo remanescente, que se convoca na tela de Inscrições.

**Matrícula direta** — ✅ `matricularDireto`: matricula um aluno já cadastrado numa turma com vaga livre, sem edital. Recusa turma que não aceita matrícula ou lotada e quem já tem matrícula naquela turma (se for trancada, evadida ou cancelada, a mensagem manda reativá-la na ficha).

## Índices

Consultas com filtro de igualdade + `orderBy` em outro campo exigem índice composto. Os usados nos serviços atuais estão em [`firestore.indexes.json`](../firestore.indexes.json). Se uma consulta nova falhar, o console do navegador mostra um link que cria o índice com um clique.

Enquanto os volumes são pequenos (uma incubadora), os serviços preferem **filtrar por igualdade no servidor e ordenar/filtrar o resto no cliente** — é o caso de `listarInscricoesDoEdital`, `listarRemanescentes`, `listarTurmasMatriculaveis` e `listarAvaliacoesDaTurma` (a ordem por data é no cliente), que por isso não precisam de índice (só filtros de igualdade).
