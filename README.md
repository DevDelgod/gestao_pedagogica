# Incubadora — Gestão Acadêmica (LMS)

Sistema de gestão para uma incubadora de cursos e projetos. Laboratório livre: começa pequeno e cresce módulo a módulo.

**Stack:** HTML5 + CSS3 puro + JavaScript (ES Modules, sem build) · Firebase (Auth + Firestore) · Cloudinary (documentos e imagens).

## Estrutura de pastas

```
gestao_pedagogica/
├── index.html                  Login (única página pública)
├── pages/                      Uma página .html por tela interna
│   ├── dashboard.html          Painel do administrador
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
│   │   └── selecao.js          Sorteio auditável, classificação por nota, ordem de inscrição
│   ├── services/               Acesso a dados por módulo (um arquivo por módulo)
│   │   ├── alunos.service.js         ← molde dos demais
│   │   ├── editais.service.js        criar/editar edital, avançar etapa
│   │   ├── selecao.service.js        executar sorteio/classificação (com registro auditável)
│   │   ├── inscricoes.service.js     convocar, efetivar matrícula (transação), desistência, indeferir
│   │   ├── cursos.service.js
│   │   ├── turmas.service.js
│   │   └── dashboard.service.js
│   ├── components/
│   │   └── shell.js            Menu lateral compartilhado
│   └── pages/                  Um script por página: liga HTML ↔ services
│       ├── login.js
│       ├── dashboard.js
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
2. **Inscrições abertas:** o formulário do site recebe inscrições, só dentro da janela de datas e para as turmas ofertadas.
3. **Seleção:** com as inscrições encerradas, a equipe executa o sorteio (ou a classificação) por turma. Os escolhidos são **convocados** e reservam vaga; o restante vira lista de espera. O sorteio fica registrado com a semente e pode ser conferido por qualquer pessoa.
4. **Matrículas:** a equipe marca os requisitos cumpridos de cada convocado e efetiva a matrícula. Quem desiste ou perde o prazo libera a vaga, e o próximo suplente é chamado.

Detalhes e justificativas em [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md).

## Modo desenvolvimento (testar sem Firebase)

Enquanto `js/core/config.js` estiver com `COLE_AQUI` **e** a página estiver em `localhost`, o sistema entra sozinho em modo desenvolvimento: um Firebase **simulado no navegador** (`js/dev/`) responde no lugar do real. Dá para entrar, criar editais, sortear, matricular etc. sem configurar nada.

- **Contas:** a tela de login mostra um botão por conta de desenvolvimento (Admin, Coordenação e Professor, para testar os três níveis de acesso). Os e-mails e a senha estão em [`js/dev/seed.js`](js/dev/seed.js).
- **Dados:** o cenário de exemplo (um edital em cada etapa, turmas, alunos, matrículas) fica salvo no `localStorage` do navegador e **persiste entre páginas e recargas**. O botão **Restaurar dados** na faixa laranja do rodapé volta ao cenário original. Mudou o `seed.js`? Aumente `SEED_VERSAO` para os dados salvos serem refeitos.
- **Aviso permanente:** a faixa laranja "MODO DESENVOLVIMENTO" aparece em todas as telas, para não confundir com dados reais.
- **Desliga sozinho** ao preencher o `firebaseConfig`, e nunca liga fora de `localhost`/`127.0.0.1`. A pasta `js/dev/` está no `ignore` do `firebase.json` e não vai para o hosting.
- **Limites:** o simulado **não** confere as `firestore.rules` nem exige índices compostos, e não reproduz concorrência real. Antes de usar com gente de verdade, teste no Firebase (emulador ou um projeto de teste).

## Configurar (uma vez)

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

Depois abra `http://localhost:5500`. Alternativas: a extensão **Live Server** do VS Code (a porta 5502 já está em `.vscode/settings.json`: clique com o botão direito em `index.html` → *Open with Live Server*), ou `npx serve .` / `python -m http.server 5500` se tiver Node/Python.

Para o login funcionar em `localhost`, o domínio já vem autorizado por padrão no Firebase Auth. Ao publicar, adicione seu domínio em Authentication → Configurações → Domínios autorizados.

## Próximos passos sugeridos

1. Telas de **Cursos** e **Turmas** (cadastro simples). Um edital só consegue ofertar turmas que já existem: até lá, crie curso e turma direto no console do Firestore (formato em `docs/modelo-de-dados.md`).
2. **Diário de classe**: chamada rápida (toque alterna P → F → J) e recálculo do resumo.
3. **Avaliações**: grade turma × avaliação com lançamento em lote.
4. Antes de publicar o formulário de inscrição do site: **Firebase App Check**.
