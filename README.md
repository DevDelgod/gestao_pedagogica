# FUDEV — Gestão Acadêmica (LMS)

O **FUDEV** é um sistema de gestão acadêmica para uma incubadora de cursos e projetos. Laboratório livre: começa pequeno e cresce módulo a módulo.

> **Estado do projeto:** o FUDEV é um sistema **secundário**: a inscrição, a seleção e a chamada acontecem no **sistema oficial**, e aqui entram as **exportações** dele (planilhas Excel), que viram pessoas, matrículas, turmas e frequência, para **análise de dados** (frequência e evasão, perfil de quem se inscreve, funil e comparação entre turmas). Veja [Como os dados chegam](#como-os-dados-chegam-do-sistema-oficial).
>
> Os dados ficam **só no navegador** de quem usa (no [modo local](#modo-local-e-modo-desenvolvimento)): nenhuma conta externa, nada sai do computador. A conexão com Firebase e Cloudinary e o deploy continuam adiados para quando houver necessidade de várias pessoas acessarem.
>
> **Quem usa:** só **coordenadores e professores** (e admin). **Não há login de aluno nem portal do aluno**: o aluno é um registro, não um usuário. O professor tem experiência própria (painel e Diário de classe só com as turmas dele). O sistema atende pessoas LGBTQIAPN+: nome social como nome de exibição e gênero autodeclarado com a opção "Outro" de texto livre.

**Stack:** HTML5 + CSS3 puro + JavaScript (ES Modules, sem build) · Firebase (Auth + Firestore) · Cloudinary (documentos e imagens).

## Estrutura de pastas

```
gestao_pedagogica/
├── index.html                  Login da equipe
├── inscricao.html              Formulário PÚBLICO de inscrição (sem login): editais abertos → turma → dados
├── pages/                      Uma página .html por tela interna
│   ├── dashboard.html          Painel do administrador
│   ├── importar.html           Importar as planilhas do sistema oficial (listagem e frequência), backup dos dados
│   ├── analises.html           Análises: funil, perfil, frequência e evasão, comparação (com filtros e CSV)
│   ├── cursos.html             Catálogo de cursos (criar, editar, desativar)
│   ├── turmas.html             Turmas: vagas, dias, horário, professor e situação
│   ├── alunos.html             Alunos: ficha (cadastro, dados do sistema oficial, matrículas, documentos), busca e filtros
│   ├── diario.html             Diário de classe: chamada rápida (P/F/J), faltas de cada pessoa, justificativas e e-mails a cada 3 faltas; usado pelo professor
│   ├── avaliacoes.html         Avaliações da turma: criar (escolhendo nota ou Apto / Não apto em cada uma) e lançar os resultados; usado pelo professor
│   ├── editais.html            (fora do menu) Processos seletivos: criar, configurar e avançar de etapa
│   └── inscricoes.html         (fora do menu) Inscrições de um edital: seleção, convocação e matrícula
├── css/
│   ├── tokens.css              Cores, espaços, raios — o "tema"
│   ├── base.css                Reset, tipografia, layout (menu + conteúdo)
│   └── components.css          Botões, campos, cartões, toasts, menu…
├── js/
│   ├── core/                   Infraestrutura, sem regra de negócio
│   │   ├── config.js           Chaves do Firebase e do Cloudinary  ← preencha
│   │   ├── firebase.js         Único import do SDK; exporta auth, db e funções
│   │   ├── auth.js             Login, logout e exigirLogin({ papeis })
│   │   ├── repo.js             criarRepo('colecao') → obter/listar/criar/atualizar/remover/observar
│   │   ├── cloudinary.js       enviarArquivo(file, pasta)
│   │   ├── datas.js            formatarData, formatarDataHora, hojeISO
│   │   ├── planilha.js         Lê .xlsx e .csv no navegador, sem biblioteca (zip + XML)
│   │   ├── arquivos.js         Baixar arquivo e montar CSV
│   │   ├── erros.js            ErroDeNegocio (mensagem já pronta para o usuário + código)
│   │   └── ui.js               $, $$, escapar, toast
│   ├── models/
│   │   ├── schema.js           Coleções, enums e fábricas dos documentos
│   │   └── rotulos.js          Textos de tela para os valores do schema
│   ├── domain/
│   │   ├── regras.js           Frequência, risco de evasão, média (funções puras)
│   │   ├── cadastros.js        Validação de curso, turma e aluno (valores de formulário → dados limpos; CPF)
│   │   ├── importacao.js       Planilhas do sistema oficial: ler colunas, traduzir situações, montar turmas, planejar o que criar e atualizar
│   │   ├── analises.js         Funil, perfil, frequência/evasão e comparação (funções puras sobre as matrículas)
│   │   ├── avaliacoes.js       Avaliações (nota ou Apto / Não apto, por avaliação): validação dos resultados, recálculo de média e aptidão
│   │   ├── matricula.js        Ciclo da matrícula: transições permitidas, efeito nas vagas, situação do aluno
│   │   ├── diario.js           Chamada: validação, quem entra na lista, recálculo da frequência e do risco
│   │   ├── faltas.js           A cada 3 faltas não justificadas, e-mail: quem precisa receber, avisos já enviados, justificativas
│   │   ├── pessoa.js           Nome social como nome de exibição; gênero com "Outro" (texto livre)
│   │   └── selecao.js          Sorteio auditável, classificação por nota, ordem de inscrição
│   ├── services/               Acesso a dados por módulo (um arquivo por módulo)
│   │   ├── alunos.service.js         ← molde dos demais; cadastro, documentos
│   │   ├── matriculas.service.js     ciclo da matrícula (trancar, evadir, cancelar…) e matrícula direta
│   │   ├── diario.service.js         registrar/corrigir/excluir aula e recalcular a frequência (uma transação)
│   │   ├── importacao.service.js     ler a planilha, montar o plano e gravar em lotes (reimportar não duplica); histórico
│   │   ├── analises.service.js       carrega a base inteira (pessoas, matrículas, turmas, cursos, aulas) para as análises
│   │   ├── faltas.service.js         quem precisa de e-mail de falta e o registro dos já enviados
│   │   ├── avaliacoes.service.js     criar/editar/excluir avaliação e lançar resultados, recalculando média ou aptidão (uma transação)
│   │   ├── editais.service.js        criar/editar edital, avançar etapa
│   │   ├── selecao.service.js        realizar a seleção do edital (sorteio/classificação, com registro auditável)
│   │   ├── inscricoes.service.js     convocar, efetivar matrícula (transação), desistência, indeferir
│   │   ├── cursos.service.js         criar/editar/desativar (renomear atualiza as turmas)
│   │   ├── turmas.service.js         criar/editar com proteção dos números de vagas
│   │   ├── usuarios.service.js       equipe ativa (professor da turma)
│   │   └── dashboard.service.js
│   ├── components/
│   │   └── shell.js            Menu lateral compartilhado
│   └── pages/                  Um script por página: liga HTML ↔ services
│       ├── login.js
│       ├── inscricao.js          (página pública de inscrição)
│       ├── dashboard.js
│       ├── importar.js
│       ├── analises.js
│       ├── cursos.js
│       ├── turmas.js
│       ├── alunos.js
│       ├── diario.js
│       ├── avaliacoes.js
│       ├── editais.js
│       └── inscricoes.js
├── tools/
│   └── serve.ps1               Servidor local (PowerShell, sem dependências)
├── testes/                     Testes que rodam no navegador (abra testes/index.html): planilhas, importação, análises, avaliações
├── js/dev/                     Modo local/desenvolvimento: Firebase simulado (guarda no IndexedDB) + contas e dados de exemplo
├── dados/                      (você cria; fica fora do Git) as planilhas reais exportadas do sistema oficial
├── docs/
│   └── modelo-de-dados.md      Modelo do Firestore com exemplos e decisões
├── firestore.rules             Regras de segurança por papel
├── firestore.indexes.json      Índices compostos
└── firebase.json               Deploy das regras/índices (e hosting, se quiser)
```

**Regra de dependência (só desce):** `pages/*.js → services → core + models + domain`. Páginas nunca falam direto com o Firestore; services nunca mexem no DOM.

### Adicionando um módulo novo (ex.: Turmas)

1. `pages/turmas.html` — copie `dashboard.html`, troque título e o `<script>`.
2. `js/pages/turmas.js` — `const eu = await exigirLogin(); montarShell({ ativo: 'turmas', perfil: eu });` e a lógica da tela.
3. `js/services/turmas.service.js` — `export const turmasRepo = criarRepo(COLECOES.TURMAS);` + consultas e funções de negócio.
4. Em `js/components/shell.js`, troque `pronto: false` por `true` no item do menu.

## Faltas, justificativas e e-mail a cada 3 faltas

No **Diário de classe**, cada pessoa mostra a quantidade de **faltas** (e de justificadas) e, em **Ver faltas**, cada falta com a data e o botão **Justificar**: você escreve o motivo (opcional) e a falta deixa de contar. Na própria chamada, marcar **J** abre um campo para o motivo. **Falta justificada não conta** para a frequência de risco nem para o e-mail.

No alto da página, **E-mails de falta a enviar** lista quem está **exatamente em 3, 6, 9… faltas** e ainda não foi avisado (de 3 em 3: quem tem 4 ou 5 faltas não aparece), com o total de faltas, o contato e o botão **Escrever e-mail** (abre o seu programa de e-mail com um rascunho para você editar). O sistema **não envia** e-mail sozinho: depois de enviar, clique em **Marquei como enviado** (só a coordenação) e a pessoa sai da lista até a próxima marca de 3 faltas. **O passado já está tratado:** o que a equipe mandava antes do sistema existir não volta como pendente; só entram na lista as marcas em que a pessoa está agora e as que ela alcançar daqui para a frente (inclusive quando pula uma marca, de 2 para 4 faltas numa semana). O botão **Já enviei todos até agora** marca como enviado tudo o que está na lista. O Painel mostra quantas pessoas aguardam e-mail.

## Como os dados chegam do sistema oficial

O sistema oficial exporta planilhas do Excel; o FUDEV as lê (tela **Importar dados**, um campo para cada tipo) e monta o resto. A ligação entre as duas é o **número de inscrição** (ex.: `QM05075`): ele está na linha de cada matrícula da listagem e na linha de cada pessoa da lista de frequência. Os tipos são:

1. **Listagem** (a planilha de matrículas, com número de inscrição, Id do candidato, situação, nome, e-mail, CPF, nascimento, raça, deficiência, programa social, MCMV, telefone, WhatsApp, endereço, horário, polo, curso e data de inscrição). Cada linha é uma **inscrição**. O sistema oficial a exporta com nomes técnicos de coluna (`inscricao_id`, `candidato_nome`, `polo`, `curso`…), com o **número de inscrição seguido do período** (`QM05075/2026.1`) e com sim/não como `0` e `1`; os rótulos da tela de exportação ("Nome do Candidato") também são aceitos. Dela saem as **pessoas**, as **matrículas** e as **turmas**: o sistema oficial não exporta turmas, então elas são montadas juntando **período + curso + polo + horário**. O período vem, nesta ordem, do nome do curso ("2026.1 - Audiovisual…"), da própria inscrição (`QM05075/2026.1`) ou do campo "Período" da tela. Para as análises de perfil funcionarem, a exportação precisa trazer todos os campos.
2. **Lista de frequência de uma turma** (uma linha por pessoa, uma coluna por aula, com Presente ou Faltou). É ligada à matrícula pelo **número de inscrição** (a turma é descoberta por ele, não pelo título). Importe a **listagem antes**. Vira as aulas da turma e recalcula a frequência e o risco de evasão de todos.

Como funciona por dentro:

- **Prévia antes de gravar:** a tela mostra quantas pessoas, matrículas e turmas são novas ou já existem, as turmas que serão montadas e os avisos (CPF com dígitos errados, e-mail inválido, pessoas que não estão na listagem, "Total de faltas" que não bate com as marcas…).
- **Situações:** o sistema oficial escreve a situação do jeito dele ("Inscrito", "Sorteado", "Desistente"…). A tela sugere a nossa (ativa, trancada, evadida, concluída ou cancelada), mostra a sugestão na tabela "Situações encontradas" para você confirmar ou trocar, e **pede para você escolher** quando não dá para ter certeza. A escolha fica guardada para as próximas importações. "Inscrito" e "Sorteado" descrevem a seleção, não a matrícula: por sugestão valem como **ativa**, já que quem está numa listagem de matrículas está cursando. A coluna `etapa_matricula` é guardada como veio (o significado é do sistema oficial).
- **Reimportar é seguro:** pessoas são achadas pelo **Id do candidato** (depois CPF, depois e-mail), matrículas pelo número de inscrição, aulas pela data. Importar o mesmo arquivo de novo atualiza em vez de duplicar, e o que só existe aqui (nome social, observações, documentos, o que você lançou no diário) é preservado. Se o sistema oficial e este divergirem na situação de uma matrícula, vale o sistema oficial.
- **Dados pessoais:** CPF, raça e deficiência são dados sensíveis (LGPD). Eles ficam só no navegador, e o `.gitignore` impede que planilhas (`dados/`, `*.xlsx`, `*.xls`, `*.csv`) entrem no Git: o repositório tem remoto no GitHub, nunca coloque exportações reais nele.

## Como funciona o processo de inscrição e matrícula

> Este módulo (editais, inscrições, sorteio e formulário público) está **fora do menu**: no uso atual a seleção acontece no sistema oficial. O código continua pronto, e basta tirar `oculto: true` em `js/components/shell.js` para ele voltar.

Tudo gira em torno do **edital**, que define como a instituição trabalha:

1. **Edital** (rascunho): título, turmas ofertadas, janela de inscrição, data do resultado, **modalidade** de seleção (sorteio, prova, ordem de inscrição ou análise individual) e **requisitos de matrícula** (documentos, pagamento…).
2. **Inscrições abertas:** o formulário público ([`inscricao.html`](inscricao.html)) recebe inscrições, só dentro da janela de datas e para as turmas ofertadas. A tela *Editais* mostra o link de cada edital aberto (`inscricao.html?edital=ID`), que pode ser divulgado ou embutido no site da instituição.
3. **Seleção:** na tela *Inscrições*, um clique em **Realizar sorteio** (ou *Classificar por nota*, conforme o edital) encerra as inscrições se ainda estiverem abertas, sorteia todas as turmas e, se você deixar marcado, já **publica o resultado e abre as matrículas**. Os escolhidos são **convocados** e reservam vaga, caindo direto na aba *Convocadas*; o restante vira lista de remanescentes. O sorteio fica registrado com a semente e pode ser conferido por qualquer pessoa. Também dá para sortear uma turma por vez.
4. **Matrículas:** a equipe marca os requisitos cumpridos de cada convocado e efetiva a matrícula. Quem desiste ou perde o prazo libera a vaga, e o próximo remanescente é chamado.

Detalhes e justificativas em [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md).

## Modo local e modo desenvolvimento

Enquanto `js/core/config.js` estiver com `COLE_AQUI` **e** a página estiver em `localhost`, o sistema entra sozinho no modo local: um Firebase **simulado no navegador** (`js/dev/`) responde no lugar do real, e os dados ficam no **IndexedDB** deste navegador (cabem dezenas de milhares de linhas; o `localStorage` não caberia). Dá para entrar, importar, analisar, lançar chamada etc. sem configurar nada.

- **Contas:** a tela de login mostra um botão por conta (Admin, Coordenação e Professor, para testar os três níveis de acesso). Os e-mails e a senha estão em [`js/dev/seed.js`](js/dev/seed.js). São contas de teste deste navegador, não de um servidor.
- **Abre vazio:** na primeira visita o sistema está vazio (só o login das contas de teste), pronto para receber as planilhas. O que está no navegador é tratado como **dado de verdade**: nenhuma atualização do código o refaz ou apaga.
- **Dados de exemplo (opcional):** para demonstrar o sistema, **Importar dados → Carregar dados de exemplo** traz um cenário fictício (turmas, alunos, aulas, avaliações). O botão só aparece com o sistema vazio, e a importação exige limpar os exemplos antes (**Limpar dados de exemplo**), para nunca misturar com pessoas de verdade. Os exemplos são descartáveis: se `SEED_VERSAO` mudar, o exemplo salvo some e o sistema volta a abrir vazio.
- **Começar do zero:** **Apagar todos os dados** (em Importar dados) esvazia tudo; um backup é baixado antes, por segurança.
- **Backup:** dado de verdade vive só neste navegador; se ele for limpo ou trocado, some. Use **Baixar backup** (também na faixa laranja do rodapé) de vez em quando e **Restaurar backup** para voltar ou mudar de computador. Use uma aba só: duas abas abertas ao mesmo tempo podem se sobrescrever.
- **Integrações simuladas:** o envio de documentos (que usaria o Cloudinary) também funciona: o arquivo fica guardado no navegador, com limite de 600 KB.
- **Aviso permanente:** a faixa laranja ("MODO DESENVOLVIMENTO" com os exemplos, "MODO LOCAL" com dados de verdade) aparece em todas as telas.
- **Desliga sozinho** ao preencher o `firebaseConfig`, e nunca liga fora de `localhost`/`127.0.0.1`. A pasta `js/dev/` está no `ignore` do `firebase.json` e não vai para o hosting.
- **Limites:** o simulado **não** confere as `firestore.rules` nem exige índices compostos, e não reproduz concorrência real. Antes de usar com gente de verdade, teste no Firebase (emulador ou um projeto de teste).

## Conectar de verdade (adiado: só ao implantar)

Nada desta seção é necessário para desenvolver ou demonstrar o sistema. Ela existe para o dia em que ele for implantado. O roteiro completo, com o que precisa ser **validado** (a camada real nunca rodou fora do simulador) e o que ainda falta para um produto vendável, está em [`docs/implantacao.md`](docs/implantacao.md).

1. **Firebase:** crie o projeto → ative **Authentication → E-mail/senha** → crie o **Firestore** (modo produção) → registre um **app da Web** e cole a configuração em `js/core/config.js`.
2. **Regras:** cole `firestore.rules` em Firestore → Regras → Publicar (ou `firebase deploy --only firestore`).
3. **Primeiro administrador** (precisa ser manual, pois as regras só deixam admin criar usuários):
   - Authentication → Usuários → **Adicionar usuário** (e-mail + senha) e copie o **UID**.
   - Firestore → coleção `users` → documento com id = esse UID:
     ```json
     { "nome": "Seu Nome", "email": "voce@email.com", "papel": "admin", "ativo": true }
     ```
4. **Cloudinary:** Settings → Upload → crie um *upload preset* **Unsigned**, restrinja formatos/tamanho e coloque `cloudName` e `uploadPreset` em `config.js`. Nunca use o `api_secret` no front-end.

## Rodar localmente

ES Modules não funcionam abrindo o arquivo direto (`file://`); sirva por HTTP. No Windows, sem instalar nada:

```bash
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

Depois abra `http://localhost:5500`. (`.claude/launch.json` guarda essa mesma configuração para o preview do Claude Code.) Alternativas: a extensão **Live Server** do VS Code (a porta 5502 já está em `.vscode/settings.json`: clique com o botão direito em `index.html` → *Open with Live Server*), ou `npx serve .` / `python -m http.server 5500` se tiver Node/Python.

Para o login funcionar em `localhost`, o domínio já vem autorizado por padrão no Firebase Auth. Ao publicar, adicione seu domínio em Authentication → Configurações → Domínios autorizados.

### Fluxo de uso, do clone às análises

1. Clone o repositório e abra a pasta no VS Code. Clique com o botão direito em `index.html` → **Open with Live Server** (ou rode `tools\serve.ps1`). Não precisa instalar nada.
2. Entre com a conta **Coordenação Dev** (botão na tela de login).
3. No menu, abra **Importar dados**. O sistema abre vazio; se por acaso aparecer "dados de exemplo", clique em **Limpar dados de exemplo**.
4. Exporte do sistema oficial a **Listagem** (todos os campos marcados) e a **lista de frequência** de cada turma, e salve os `.xlsx` no seu computador (o `.gitignore` já impede que planilhas entrem no Git).
5. Em **Importar dados** há dois campos. No **1. Matrículas**, escolha ou arraste a **Listagem** e confira a prévia: escolha o que cada situação significa, se a tela pedir, e clique em **Importar matrículas**. No **2. Presenças e faltas**, envie as **listas de frequência** das turmas (pode selecionar várias de uma vez). Cada campo só aceita o seu tipo de planilha e avisa se você puser o arquivo no campo errado.
6. Confira em **Turmas e presenças** (na mesma tela) quais turmas já têm presenças ligadas às matrículas, e abra **Análises**.

Os dados ficam no navegador, ligados ao **endereço** da página (`127.0.0.1:5502` e `localhost:5500` são bancos separados): use sempre o mesmo. Em outro computador (ou depois de limpar o navegador) o sistema começa vazio: reimporte as planilhas ou use **Baixar backup** / **Restaurar backup**.

### Testes

Abra `http://localhost:5500/testes/index.html` (com o servidor acima) e veja os testes rodarem no navegador, sem instalar nada. Eles usam só código puro e planilhas **fictícias** (geradas na hora, em `testes/fixtures.js`) e **nunca tocam nos dados guardados** do sistema. Rode-os depois de mexer em `js/domain/` ou em `js/core/planilha.js`.

## Próximos passos

1. **Conferir com mais planilhas reais:** o leitor foi ajustado a um arquivo real de cada tipo (uma turma, 23 matrículas, 19 pessoas na lista de presença). Falta ver com várias turmas, outros polos, outros períodos e outros tipos de situação (desistentes, concluídos). A coluna **Situação** da lista de frequência ("Ativo"…) ainda não atualiza a situação da matrícula: é o sinal mais direto de quem desistiu, e vale usá-la.
2. **Mais perguntas para as análises**, conforme a equipe for usando (cruzamentos de perfil com evasão, por exemplo).
3. **Resultado final e boletim**: situação final (aprovado ou não) cruzando a avaliação (média ou Apto / Não apto) com a frequência mínima do curso. Só faz sentido se as notas também forem lançadas aqui.
4. **Equipe**: telas para cadastrar professores e coordenadores e definir o papel de cada um (hoje a equipe só existe nas contas de teste do login).
5. **Acabamento**: capturas de tela no README e mais testes.

Já pronto: importação das duas planilhas do sistema oficial (com prévia, situações traduzidas e reimportação segura), **análises** (funil, perfil, frequência e evasão, comparação, com filtros e CSV), backup dos dados, login e painel (com visão própria do professor), cursos, turmas, alunos/matrículas, diário de classe com frequência e risco de evasão, **avaliações com a forma de avaliar escolhida em cada uma** (nota de 0 a 10 ou Apto / Não apto) e o módulo de editais, inscrições e sorteio (fora do menu).

Ao implantar (adiado por decisão):

- Conectar o Firebase (seção acima) e **testar as `firestore.rules` com os três papéis**: elas nunca rodaram fora do simulador.
- Ativar o **Firebase App Check** antes de divulgar o formulário público, tratar inscrições duplicadas e, se for preciso comprovar, registrar o consentimento (LGPD).
- Enviar **e-mail de verdade** aos convocados (exige serviço de envio e funções no servidor do Firebase).
- Para mostrar o sistema num link público de portfólio, o modo desenvolvimento hoje só liga em `localhost`; liberar numa hospedagem estática seria uma decisão à parte.
