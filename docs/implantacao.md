# Roteiro de implantação

Para o dia em que o FUDEV for vendido. Hoje ele roda 100% no [modo desenvolvimento](../README.md#modo-desenvolvimento-testar-sem-firebase): um Firebase simulado no navegador. Implantar é trocar o simulador pelo Firebase de verdade.

O código foi mantido pronto para essa troca, mas **a camada real nunca foi executada**: `firestore.rules`, `firestore.indexes.json` e o caminho do SDK só foram escritos, nunca rodaram contra um Firebase. Por isso o roteiro tem uma fase de **validação** (seção 3). Reserve de meio dia a um dia por instituição, e mais se a validação achar problemas, o que é normal na primeira vez.

## 1. O que muda no código

Quase nada. Ao preencher `firebaseConfig` em `js/core/config.js`, o modo desenvolvimento desliga sozinho e `js/core/firebase.js` passa a carregar o SDK do Google. Telas, serviços e regras de negócio são os mesmos.

## 2. Montagem (uma vez por instituição)

O modelo atual atende **uma instituição por projeto do Firebase**. Cada cliente novo = um projeto novo, com os dados totalmente isolados.

1. **Firebase:** criar o projeto, ligar *Authentication → E-mail/senha*, criar o *Firestore* (modo produção), registrar um app da Web e colar a configuração em `config.js`.
2. **Regras e índices:** publicar `firestore.rules` e `firestore.indexes.json` (pelo console, ou com a Firebase CLI: `firebase deploy --only firestore`, que exige Node).
3. **Primeiro administrador:** criar o usuário no Authentication e o documento `users/{uid}` com `papel: "admin"` (passo a passo no README).
4. **Cloudinary:** criar um *upload preset* **unsigned**, com formatos e tamanho restritos, e preencher `cloudName` e `uploadPreset`.
5. **Hospedagem:** publicar os arquivos estáticos (`js/dev/` e `tools/` já ficam fora, pelo `firebase.json`) e adicionar o domínio em *Authentication → Domínios autorizados*.
6. **App Check (reCAPTCHA):** ligar antes de divulgar o link do formulário público.

## 3. Validação antes de entregar

O que só foi testado no simulador, e portanto precisa ser conferido de verdade:

| O quê | Por que importa | Como conferir |
|---|---|---|
| **`firestore.rules`** | Nunca rodaram. O erro típico é `permission-denied` numa tela que parecia certa. | Entrar com os **três papéis** (admin, coordenador, professor) e percorrer todas as telas. Usar o *Simulador de regras* do console nos casos de borda: professor lendo inscrições, anônimo lendo `users`, anônimo gravando fora de um edital aberto. |
| **Professor no Diário de classe** | É o papel com menos permissão e o que mais usa o sistema no dia a dia. A gravação de uma aula escreve em `aulas` e atualiza `frequencia` e `riscoEvasao` de cada matrícula; as regras só deixam o professor da turma fazer isso e só nesses campos. | Entrar como professor: registrar e corrigir uma aula **da própria turma** (deve passar) e tentar uma turma de outro professor, excluir uma aula e alterar outro campo da matrícula (devem ser recusados). Conferir também que o painel dele não dá erro de permissão. |
| **Formulário público (anônimo)** | É a única escrita sem login. As regras conferem edital aberto, janela de datas, turma ofertada e, para nome social e gênero, os valores permitidos. | Enviar inscrição para edital aberto (deve passar), fechado, fora da janela e com turma de outro edital (devem ser recusadas). Enviar com gênero "outro" e texto livre, e com um valor de gênero inventado (deve ser recusado). |
| **Transações** (sorteio, matrícula, ciclo da matrícula) | Só rodaram no simulador, que não reproduz concorrência real. | Refazer o caminho completo e conferir `vagasOcupadas` e `vagasReservadas`. Dois navegadores efetivando a última vaga ao mesmo tempo: só um deve passar. |
| **Índices** | As consultas foram escritas só com filtros de igualdade, mas o Firestore é quem confirma. | Se uma consulta falhar, o console do navegador mostra um link que cria o índice. |
| **Cloudinary** | O envio de documentos é simulado no modo dev. | Enviar PDF e imagem de verdade, conferir restrições do preset e o link do arquivo. |
| **Limite de 490 inscrições por turma** | Teto de uma transação do Firestore (500 escritas). | Se alguma turma passar disso, será preciso dividir a seleção. |

## 4. O que ainda não existe (para um produto vendável)

- **Gestão da equipe:** não há tela para cadastrar professores e coordenadores nem trocar papéis. Hoje isso é manual no console. Criar o usuário de **outra pessoa** a partir do navegador não é possível com o login por e-mail do Firebase: exige uma função no servidor.
- **E-mail automático** (convocação, resultado): exige um serviço de envio e funções no servidor. Hoje a equipe avisa as pessoas por fora.
- **Inscrições duplicadas, consentimento LGPD registrado e resultado público no site:** descritos em [`modelo-de-dados.md`](modelo-de-dados.md#limites-conhecidos-para-evoluir-depois).
- **Várias instituições no mesmo projeto:** exigiria um `instituicaoId` em todos os documentos e regras.
- **Avaliações, resultado final e boletim:** ainda a construir. A forma de avaliar será configurável por curso (Apto/Não apto ou nota numérica).
- **Portal do aluno:** não existe e **não está nos planos**. O sistema é só para coordenadores e professores.
