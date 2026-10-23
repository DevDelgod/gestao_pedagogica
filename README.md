# FUDEV — Gestão Acadêmica (LMS)

O **FUDEV** é um sistema de gestão acadêmica para uma incubadora de cursos e projetos. Laboratório livre: começa pequeno e cresce módulo a módulo.

> **Estado do projeto:** é um projeto de **portfólio**. O foco agora é o front-end e as funcionalidades completas, rodando no [modo desenvolvimento](#modo-desenvolvimento-testar-sem-firebase) (Firebase simulado no navegador, sem nenhuma conta externa). A conexão com Firebase e Cloudinary e o deploy ficam para quando o sistema for implantado de verdade.
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
│   ├── cursos.html             Catálogo de cursos (criar, editar, desativar)
│   ├── turmas.html             Turmas: vagas, dias, horário, professor e situação
│   ├── alunos.html             Alunos: ficha (cadastro, matrículas, documentos), busca e filtros
│   ├── diario.html             Diário de classe: chamada rápida (P/F/J) e conteúdo da aula; usado pelo professor
│   ├── avaliacoes.html         Avaliações da turma: criar (escolhendo nota ou Apto / Não apto em cada uma) e lançar os resultados; usado pelo professor
│   ├── editais.html            Processos seletivos: criar, configurar e avançar de etapa
│   └── inscricoes.html         Inscrições de um edital: seleção, convocação e matrícula
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
│   │   ├── erros.js            ErroDeNegocio (mensagem já pronta para o usuário + código)
│   │   └── ui.js               $, $$, escapar, toast
│   ├── models/
│   │   ├── schema.js           Coleções, enums e fábricas dos documentos
│   │   └── rotulos.js          Textos de tela para os valores do schema
│   ├── domain/
│   │   ├── regras.js           Frequência, risco de evasão, média (funções puras)
│   │   ├── cadastros.js        Validação de curso, turma e aluno (valores de formulário → dados limpos; CPF)
│   │   ├── avaliacoes.js       Avaliações (nota ou Apto / Não apto, por avaliação): validação dos resultados, recálculo de média e aptidão
│   │   ├── matricula.js        Ciclo da matrícula: transições permitidas, efeito nas vagas, situação do aluno
│   │   ├── diario.js           Chamada: validação, quem entra na lista, recálculo da frequência e do risco
│   │   ├── pessoa.js           Nome social como nome de exibição; gênero com "Outro" (texto livre)
│   │   └── selecao.js          Sorteio auditável, classificação por nota, ordem de inscrição
│   ├── services/               Acesso a dados por módulo (um arquivo por módulo)
│   │   ├── alunos.service.js         ← molde dos demais; cadastro, documentos
│   │   ├── matriculas.service.js     ciclo da matrícula (trancar, evadir, cancelar…) e matrícula direta
│   │   ├── diario.service.js         registrar/corrigir/excluir aula e recalcular a frequência (uma transação)
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
│       ├── cursos.js
│       ├── turmas.js
│       ├── alunos.js
│       ├── diario.js
│       ├── avaliacoes.js
│       ├── editais.js
│       └── inscricoes.js
├── tools/
│   └── serve.ps1               Servidor local (PowerShell, sem dependências)
├── js/dev/                     Modo desenvolvimento: Firebase simulado + contas e dados de exemplo
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

## Como funciona o processo de inscrição e matrícula

Tudo gira em torno do **edital**, que define como a instituição trabalha:

1. **Edital** (rascunho): título, turmas ofertadas, janela de inscrição, data do resultado, **modalidade** de seleção (sorteio, prova, ordem de inscrição ou análise individual) e **requisitos de matrícula** (documentos, pagamento…).
2. **Inscrições abertas:** o formulário público ([`inscricao.html`](inscricao.html)) recebe inscrições, só dentro da janela de datas e para as turmas ofertadas. A tela *Editais* mostra o link de cada edital aberto (`inscricao.html?edital=ID`), que pode ser divulgado ou embutido no site da instituição.
3. **Seleção:** na tela *Inscrições*, um clique em **Realizar sorteio** (ou *Classificar por nota*, conforme o edital) encerra as inscrições se ainda estiverem abertas, sorteia todas as turmas e, se você deixar marcado, já **publica o resultado e abre as matrículas**. Os escolhidos são **convocados** e reservam vaga, caindo direto na aba *Convocadas*; o restante vira lista de remanescentes. O sorteio fica registrado com a semente e pode ser conferido por qualquer pessoa. Também dá para sortear uma turma por vez.
4. **Matrículas:** a equipe marca os requisitos cumpridos de cada convocado e efetiva a matrícula. Quem desiste ou perde o prazo libera a vaga, e o próximo remanescente é chamado.

Detalhes e justificativas em [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md).

## Modo desenvolvimento (testar sem Firebase)

Enquanto `js/core/config.js` estiver com `COLE_AQUI` **e** a página estiver em `localhost`, o sistema entra sozinho em modo desenvolvimento: um Firebase **simulado no navegador** (`js/dev/`) responde no lugar do real. Dá para entrar, criar editais, sortear, matricular etc. sem configurar nada.

- **Contas:** a tela de login mostra um botão por conta de desenvolvimento (Admin, Coordenação e Professor, para testar os três níveis de acesso). Os e-mails e a senha estão em [`js/dev/seed.js`](js/dev/seed.js).
- **Dados:** o cenário de exemplo (um edital em cada etapa, turmas, alunos, matrículas, aulas e avaliações das duas formas, misturadas nas turmas de *Desenvolvimento Web* e *Fotografia*) fica salvo no `localStorage` do navegador e **persiste entre páginas e recargas**. O botão **Restaurar dados** na faixa laranja do rodapé volta ao cenário original. Mudou o `seed.js`? Aumente `SEED_VERSAO` para os dados salvos serem refeitos.
- **Integrações simuladas:** o envio de documentos (que usaria o Cloudinary) também funciona no modo desenvolvimento: o arquivo fica guardado no navegador, com limite de 600 KB.
- **Aviso permanente:** a faixa laranja "MODO DESENVOLVIMENTO" aparece em todas as telas, para não confundir com dados reais.
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

## Próximos passos

Construir, tudo no modo desenvolvimento:

1. **Resultado final e boletim**: situação final (aprovado ou não) cruzando a avaliação (média ou Apto / Não apto) com a frequência mínima do curso, e o boletim por aluno. Hoje "Concluir" é manual e não diz se a pessoa passou.
2. **Equipe**: telas para cadastrar professores e coordenadores e definir o papel de cada um (hoje a equipe só existe nos dados de exemplo).
3. **Relatórios com exportação em CSV** (matriculados, frequência, notas, e-mails dos convocados).
4. **Acabamento de portfólio**: testes que rodem no navegador, capturas de tela no README, dados de exemplo mais ricos.

Já pronto: login e painel (com visão própria do professor), cursos, turmas, editais, inscrições (com sorteio auditável), formulário público (com nome social e gênero), alunos/matrículas, **diário de classe com frequência e risco de evasão reais** e **avaliações com a forma de avaliar escolhida em cada uma, ao criá-la** (nota de 0 a 10 com média ponderada, ou Apto / Não apto; o curso só sugere a forma padrão, e as duas convivem na mesma turma).

Ao implantar (adiado por decisão):

- Conectar o Firebase (seção acima) e **testar as `firestore.rules` com os três papéis**: elas nunca rodaram fora do simulador.
- Ativar o **Firebase App Check** antes de divulgar o formulário público, tratar inscrições duplicadas e, se for preciso comprovar, registrar o consentimento (LGPD).
- Enviar **e-mail de verdade** aos convocados (exige serviço de envio e funções no servidor do Firebase).
- Para mostrar o sistema num link público de portfólio, o modo desenvolvimento hoje só liga em `localhost`; liberar numa hospedagem estática seria uma decisão à parte.
