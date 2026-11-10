# Sinapse multijogador em tempo real — especificação proposta

## 1. Escopo e estado inicial

Transformar as 17 perguntas existentes em uma partida por sala, com um MASTER no computador/telão e até 150 PLAYERs em celulares. Uma sala tem PIN decimal de seis dígitos e um Durable Object (DO) que concentra conexões, estado, relógio e pontuação.

A interface original usa **Vite + React + TypeScript** e oferece dois modos no mesmo dispositivo. O Worker das salas serve os assets compilados, a API HTTPS e o WebSocket, com um DO por PIN. O [README](README.md) descreve como rodar a API e os modos locais.

## 2. Papéis e interface

| Papel | Dispositivo e conteúdo | Permissões |
| --- | --- | --- |
| MASTER | Computador/telão: PIN e participantes no lobby; pergunta, alternativas e timer; contagem agregada de respostas; revelação; top 5 entre perguntas e pódio/ranking completo ao final. | Criar sala, iniciar partida, encerrar pergunta, expulsar jogador e avançar das telas de revelação/ranking. Um único controle MASTER autorizado por sala. |
| PLAYER | Celular: entrada por PIN e nome; durante a pergunta, **somente cinco botões A–E coloridos** e estado de envio/bloqueio. Fora da pergunta, mensagens curtas de espera, resultado individual e posição. | Entrar/reconectar e enviar uma resposta por pergunta. Não controla fases nem recebe enunciado, alternativas ou gabarito antes da revelação. |

As cores dos botões A–E devem ser estáveis e corresponder às alternativas do telão. A interface do PLAYER não deve depender apenas da cor: cada botão mostra sua letra.

## 3. Arquitetura e dados

1. O frontend acessa o mesmo Worker HTTPS que serve static assets, API e WebSocket. No upgrade WebSocket, o Worker valida o header `Origin` contra as origens permitidas antes de encaminhar a conexão. Cada PIN é encaminhado ao **único DO daquela sala** por `idFromName(pin)`; `gameId` fica somente no estado interno do DO. O PIN pode ser reutilizado após limpeza, mas token de partida antiga deve receber `BAD_TOKEN`.
2. O DO usa a **WebSocket Hibernation API** (`acceptWebSocket`, handlers de mensagem/fechamento e attachments de conexão) e **storage SQLite**. Guarda o estado canônico da partida em seu storage: `gameId`, fase, índice, prazos, participantes, nomes normalizados, respostas aceitas, pontos e tempos. Attachments guardam apenas papel/identidade da conexão para reconstrução após hibernação; não são a fonte de verdade da partida.
3. O DO é a única autoridade para aceitar resposta, medir tempo, mudar fase e calcular ranking. O navegador apenas exibe um timer aproximado usando `serverNow` e `deadlineAt` recebidos do DO. O DO persiste cada resposta em `transactionSync` **antes** de emitir `answer_ack`. A verificação do prazo também ocorre ao receber uma resposta, para que um alarm atrasado nunca aceite resposta tardia.
4. O banco completo de perguntas, inclusive `correct`, fica **somente no lado servidor**. O build entregue a PLAYER e MASTER não inclui gabarito embutido em JavaScript, HTML, mapas de origem públicos ou respostas antecipadas do protocolo. Antes da revelação, o MASTER recebe texto e alternativas; PLAYER recebe apenas `questionId`, letras/cores e prazo. O gabarito sai do servidor apenas em `question_reveal`.
5. Ao terminar, o DO grava o resultado final no D1 com chave idempotente de partida e linhas de classificação. Se a escrita falhar, conserva um registro de gravação pendente no storage e tenta novamente por alarm; o pódio pode ser mostrado com o resultado canônico do DO, mas deve indicar quando a persistência ainda não foi confirmada. **D1 contém apenas `games` e `game_results`**, sem reserva de PIN.
6. Na criação, o Worker sorteia um PIN e chama o DO `idFromName(pin)`. O DO faz a verificação/criação atomicamente: se já existe partida ativa **ou resultado final retido até a limpeza**, responde `PIN_OCCUPIED` ao Worker, que sorteia outro PIN; caso contrário, cria novo `gameId` e credenciais. Um alarm de limpeza apaga o estado da sala após encerramento ou inatividade. A validade temporal e o intervalo de retenção ainda precisam ser definidos.
7. O DO mantém no storage uma fila de tarefas pendentes: prazo da pergunta, limpeza e retry do D1. Como há **um único alarm por DO**, agenda sempre o menor instante pendente; ao disparar, processa as tarefas vencidas e agenda o próximo. O `answer_count` usa throttle **em memória, leading + trailing, janela de 250 ms**, sem alarm. O último flush ocorre antes da revelação/fechamento da pergunta.

As regras acima seguem a documentação oficial de [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [storage SQLite e `transactionSync`](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) e [static assets no Worker](https://developers.cloudflare.com/workers/static-assets/). Hibernação preserva WebSockets, mas reinicializa memória; o throttle em memória pode manter o DO ativo durante a janela de 250 ms. Uma retomada depois de hibernação reconstrói contagens a partir do storage, sem depender de throttle pendente.

## 4. Identidade, entrada e reconexão

- PIN: string de exatamente seis dígitos, inclusive zeros iniciais. O PIN identifica uma sala ativa, **não autentica o MASTER**.
- Criação: o Worker sorteia PIN e pede criação atômica ao DO desse PIN; ao receber `PIN_OCCUPIED`, tenta outro. Entrega ao criador um segredo MASTER de alta entropia, enviado apenas por canal seguro. O DO valida esse segredo em toda conexão e comando administrativo. O segredo não aparece no telão nem no link público de entrada.
- Nome: após `trim` e normalização Unicode NFC, de 2 a 20 caracteres visíveis. Comparação de unicidade case-insensitive com forma normalizada definida no servidor. A admissão e a reserva do nome ocorrem atomicamente **dentro do DO**. Nome duplicado retorna `NAME_TAKEN` sem criar participante. O mesmo participante pode recuperar seu nome com token válido.
- Limite: até 150 identidades PLAYER por sala; desconectados continuam ocupando vaga para permitir reconexão, exceto quando expulsos pelo MASTER. Tentativa adicional retorna `ROOM_FULL`. O MASTER não conta no limite.
- Ao entrar, o DO cria `playerId` opaco e token de reconexão aleatório, de alta entropia, associado ao **`gameId`** e à identidade. O cliente guarda o token localmente; o DO guarda apenas seu hash. Um token válido restabelece identidade, pontos e resposta já aceita e invalida a conexão antiga do mesmo jogador. Token inválido, de partida antiga ou de jogador expulso retorna `BAD_TOKEN`, mesmo após o PIN ser reutilizado ou a sala ser limpa.
- `master.kick` remove a identidade do jogador da sala e do ranking desta partida, libera seu nome e vaga, invalida seu token e fecha suas conexões. Durante uma pergunta, recalcula o número de jogadores conectados elegíveis para o fechamento antecipado. Para manter o resultado final imutável após gravação, o comando vale de LOBBY até LEADERBOARD e retorna `WRONG_PHASE` em FINAL_PODIUM.
- Após reconexão ou despertar do DO, o cliente recebe `snapshot` filtrado por papel, com fase, revisão e dados suficientes para reconstruir a tela. Respostas já aceitas nunca são reenviadas. Desconexão não pausa relógio nem devolve resposta.
- Admissão de novos jogadores: proposta inicial, somente no LOBBY. Reconexões com token válido são aceitas durante toda a partida, até o encerramento da sala.

## 5. Máquina de estados

```text
LOBBY --master.start--> QUESTION_OPEN
QUESTION_OPEN --deadline (30 s), todos os conectados responderam ou master.end_question--> QUESTION_REVEAL
QUESTION_REVEAL --master.show_leaderboard--> LEADERBOARD
LEADERBOARD --master.next, perguntas 1–16--> QUESTION_OPEN
LEADERBOARD --master.next, pergunta 17--> FINAL_PODIUM
```

Há exatamente 17 perguntas, na ordem definida pelo conteúdo da partida. `master.start` exige ao menos um PLAYER no lobby. Cada `QUESTION_OPEN` tem prazo máximo de 30.000 ms contados pelo servidor desde `openedAt`; `deadlineAt = openedAt + 30.000`. A pergunta fecha no primeiro destes eventos: prazo, todos os jogadores **conectados e ainda na sala** responderam, ou `master.end_question`. O fechamento por unanimidade exige ao menos um jogador conectado; com zero conectados, a pergunta permanece aberta até o prazo ou comando do MASTER. Ao fechar, o DO computa respostas ausentes, fixa resultados e entra em `QUESTION_REVEAL`. O MASTER decide quando mostrar ranking e avançar; cada comando só vale na fase correspondente. Comandos repetidos com o mesmo `commandId` são idempotentes. `FINAL_PODIUM` é terminal para a partida.

Cada mudança de fase aumenta `revision` monotônico. O servidor envia `serverNow` (epoch ms) e, quando aplicável, `deadlineAt`. Cliente ignora eventos com revisão anterior ao `snapshot` mais recente. Ao perder conexão, deixa de aceitar toque local até reconectar; a UI pode manter timer estimado apenas como indicação visual.

## 6. Protocolo JSON v1

Todas as mensagens WebSocket são objetos JSON com `v: 1` e `type`. O PIN usado na conexão encaminha ao DO; `gameId` é interno ao DO e não é um campo obrigatório do protocolo. Comandos do cliente levam `requestId` único para correlação; comandos de fase levam também `commandId` único. Eventos de estado incluem `revision` e `serverNow`. O servidor valida tipo, tamanho, papel, fase e campos; erro de protocolo gera `error`, sem alterar estado. O upgrade exige `Origin` permitido, e as credenciais de entrada nunca são incluídas em broadcast.

### Cliente → servidor

| `type` | Emissor | Campos adicionais | Efeito |
| --- | --- | --- | --- |
| `player.join` | PLAYER novo | `pin`, `name`, `requestId` | Valida PIN/nome/capacidade no DO e cria identidade no LOBBY. |
| `player.resume` | PLAYER | `pin`, `playerId`, `reconnectToken`, `requestId` | Reassocia identidade e entrega snapshot; não reabre resposta. |
| `master.resume` | MASTER | `pin`, `masterToken`, `requestId` | Autentica o controle MASTER e entrega snapshot. |
| `master.start` | MASTER | `commandId`, `requestId` | LOBBY → primeira QUESTION_OPEN. |
| `player.answer` | PLAYER | `questionId`, `choice` (`A`–`E`), `requestId` | Aceita no máximo uma resposta por jogador/pergunta, se recebida no DO antes de `deadlineAt`. Timestamp do cliente é ignorado. |
| `room.sync` | MASTER ou PLAYER autenticado | `requestId` | Solicita snapshot da sala. |
| `master.end_question` | MASTER | `commandId`, `requestId` | Encerra imediatamente QUESTION_OPEN e entra em QUESTION_REVEAL. |
| `master.kick` | MASTER | `playerId`, `commandId`, `requestId` | Remove jogador, libera nome/vaga, invalida token e fecha conexão. |
| `master.show_leaderboard` | MASTER | `commandId`, `requestId` | QUESTION_REVEAL → LEADERBOARD. |
| `master.next` | MASTER | `commandId`, `requestId` | LEADERBOARD → pergunta seguinte ou FINAL_PODIUM. |

### Servidor → cliente

| `type` | Destinatário | Campos adicionais | Quando |
| --- | --- | --- | --- |
| `joined` | Apenas PLAYER solicitante | `playerId`, `reconnectToken`, `name`, `snapshot`, `requestId` | Entrada aceita. Token é segredo; nunca é broadcast. |
| `resumed` | Apenas solicitante | `snapshot`, `requestId`; PLAYER pode receber token rotacionado | Reconexão aceita. |
| `snapshot` | Apenas solicitante | `phase`, `questionIndex`, `questionId?`, `deadlineAt?`, `myAnswer?`, `myScore?`, `revision`, `serverNow` e campos específicos do papel | Conexão, reconexão ou pedido de ressincronização após lacuna. Para MASTER inclui lista/contagem de participantes e pergunta visível na fase; para PLAYER nunca inclui gabarito antes da revelação. |
| `lobby_update` | MASTER; PLAYER recebe só contagem/estado de espera | `playerCount`; MASTER também `players` (`playerId`, `name`, `connected`) | Entradas, reconexões e expulsões no LOBBY. |
| `question_open` | MASTER e PLAYER, com payloads por papel | Ambos: `questionIndex`, `questionId`, `openedAt`, `deadlineAt`, `revision`, `serverNow`; MASTER: `text`, `options` A–E; PLAYER: `choices` A–E com cores | Início de cada pergunta. **Sem `correct` em ambos.** |
| `answer_ack` | Apenas PLAYER que respondeu | `questionId`, `choice`, `acceptedAt`, `requestId`, `status: accepted`; reenvio recebe `status: already_answered` | Confirmação individual; não informa acerto nem pontos antes da revelação. |
| `answer_count` | Apenas MASTER | `questionId`, `answeredCount`, `eligibleCount`, `revision`, `serverNow` | Throttle leading + trailing de 250 ms enquanto houver mudança, mais um envio final no fechamento. `eligibleCount` é o número de jogadores conectados na sala. É contagem agregada, nunca um evento por resposta. Não contém alternativa nem identidade de quem respondeu. |
| `question_reveal` | MASTER e PLAYER, com payloads por papel | `questionId`, `correct`, `revision`, `serverNow`; MASTER: `explanation`, contagens por alternativa; PLAYER: `myChoice`, `myPoints`, `myTotalScore` | Após encerrar a pergunta. A partir daqui o gabarito pode ser divulgado. |
| `leaderboard` | MASTER; PLAYER recebe apenas `myRank`, `myScore` | MASTER: `entries` com **top 5 apenas** (`rank`, `playerId`, `name`, `score`, `responseTimeMs`), `revision`, `serverNow` | Entrada em LEADERBOARD; snapshots MASTER nessa fase também limitam `entries` ao top 5. |
| `final_podium` | MASTER; PLAYER recebe resultado individual | MASTER: ranking completo e `persisted: boolean`; PLAYER: `myRank`, `myScore`, `revision`, `serverNow` | Fim da 17ª pergunta. |
| `persistence_status` | MASTER | `persisted`, `revision`, `serverNow` | Confirmação tardia ou falha da escrita no D1. |
| `player_kicked` | Apenas PLAYER expulso | `playerId`, `revision`, `serverNow` | Antes de fechar a conexão; o token deixa de valer imediatamente. |
| `command_ack` | Apenas MASTER solicitante | `commandId`, `requestId`, `revision`, `serverNow` | Comando administrativo aplicado ou repetição idempotente. |
| `error` | Apenas solicitante | `requestId?`, `code`, `message`, `retryable` | Comando WebSocket rejeitado. Códigos mínimos: `INVALID_PIN`, `NAME_TAKEN`, `ROOM_FULL`, `BAD_TOKEN`, `WRONG_PHASE`, `QUESTION_CLOSED`, `ALREADY_ANSWERED`, `INVALID_PAYLOAD`, `RATE_LIMITED`. `PIN_OCCUPIED` é resposta interna do DO ao Worker durante a criação, não evento WebSocket. |

O DO aplica throttle leading + trailing em memória à contagem, com janela de 250 ms; vários `player.answer` no intervalo são agregados, sem envio individual ao MASTER. O primeiro evento da janela pode disparar imediatamente; o trailing só publica a contagem consolidada se houve outra mudança desde o leading. No fechamento, cancela o trailing pendente e envia a contagem final antes de `question_reveal`. O throttle não usa alarm e não altera o instante de aceitação nem os pontos. O timer visível roda no cliente a partir do prazo do servidor; não há broadcast de tick a cada segundo. O envio de `question_reveal`, `leaderboard` e `final_podium` é atômico por fase segundo a revisão do DO.

`RATE_LIMITED` aplica limites por conexão e por PIN no caminho do DO. Na borda, limite por IP é apenas um teto generoso, pois até 150 celulares podem compartilhar o mesmo IP. Limites concretos e janelas precisam ser definidos e testados para não rejeitar a sala legítima.

## 7. Resposta, pontuação e ranking

- Primeira resposta válida recebida pelo DO durante `QUESTION_OPEN` vence e é persistida em `transactionSync` antes de `answer_ack`. Não há troca de alternativa. O tempo `t` é `acceptedAt - openedAt`, em milissegundos, limitado a `[0, 30.000]`. Mensagem recebida em ou depois de `deadlineAt`, ou após fechamento antecipado, é tardia. Latência de rede faz parte do tempo observado pelo servidor.
- Acerto: `points = 1000 × (1 - (t / T) / 2)`, com `T = 30.000 ms`. Erro ou ausência: `0`. Proposta para armazenamento/exibição: arredondar pontos para o inteiro mais próximo **uma vez por pergunta**, antes de somar; a regra de arredondamento ainda deve ser aprovada.
- `score` é a soma dos pontos das 17 perguntas. `responseTimeMs` é a soma dos tempos por pergunta para ordenar empates. **Proposta provisória:** resposta enviada, certa ou errada, soma seu `t`; ausência soma `T`. Isso evita que um jogador sem respostas vença outro por tempo zero quando ambos têm zero ponto.
- Ordenação: maior `score`, depois menor `responseTimeMs`; persistindo empate, aplicar um critério determinístico (proposta: ordem de ingresso no DO, seguida de `playerId`). `rank` exibido segue essa ordem. D1 grava pontos e tempo em inteiros, além da posição final.

## 8. Persistência final no D1

Esquema conceitual:

| Entidade | Campos mínimos |
| --- | --- |
| `games` | `gameId` (único), `pin`, `startedAt`, `finishedAt`, `questionSetVersion`, `playerCount`, `status` |
| `game_results` | `gameId`, `playerId`, `name`, `rank`, `score`, `responseTimeMs`; chave única (`gameId`, `playerId`) |

A escrita final deve ser idempotente por `gameId` e transacional para não deixar ranking parcial. O DO mantém o resultado final em storage até confirmação do D1 e reexecuta a gravação em falhas transitórias. A limpeza não apaga um resultado ainda pendente de persistência; o retry do D1 e a limpeza usam a mesma fila/alarm do DO. D1 não contém outras tabelas. Política de retenção, acesso aos rankings históricos e dados pessoais dependem de decisão de produto.

## 9. Riscos e pontos ambíguos a decidir

1. **PIN e ciclo de vida:** seis dígitos dão espaço finito. É preciso definir tempo de inatividade, intervalo entre encerramento e limpeza, limite de tentativas do Worker ao sortear PIN e política de reutilização. Um PIN com resultado pendente no D1 não pode ser limpo/reutilizado antes de resolver a persistência ou de uma política explícita de falha definitiva. PIN não substitui segredo MASTER.
3. **Critérios de nome:** definir precisamente o que conta como “caractere” (grapheme Unicode), se emoji, espaços internos e caracteres de controle são permitidos, e a política de equivalência case-insensitive para Unicode. A comparação e a mensagem de erro devem ser consistentes.
4. **Desempate e tempo:** confirmar arredondamento dos pontos, tempo atribuído a perguntas sem resposta e critério de desempate final. As escolhas da seção 7 são propostas, não decisões fornecidas pelo pedido.
5. **Revelação e ritmo:** o prazo, a unanimidade dos conectados e `master.end_question` revelam automaticamente a resposta. Falta definir se as 17 perguntas são sempre usadas na ordem atual e qual estado de espera mostrar no telão quando a pergunta fecha cedo.
6. **Reconexão:** definir prazo de validade/rotação do token, política para aparelho perdido e se novo jogador pode entrar após o início. Esta proposta restringe novos ingressos ao LOBBY.
7. **Falhas e custos:** conexões móveis caem; o DO pode hibernar/reiniciar; alarm pode atrasar; D1 pode falhar. Persistência de estado, snapshots, validação de deadline e retry precisam de testes de carga com 150 PLAYERs. O trailing em memória pode manter o DO ativo durante a janela de 250 ms. O fechamento por unanimidade depende do estado de conexão observado pelo DO e pode ocorrer ao desconectar ou expulsar o último jogador que faltava responder.
8. **Segredo do conteúdo:** `src/data/questions.ts` hoje contém `correct` no bundle do frontend. A migração precisa separar dados públicos e gabarito no build, inclusive evitando exposição por source maps ou endpoints de depuração.
9. **Privacidade:** ranking histórico com nomes exige definir prazo de retenção, acesso e eventual remoção. Exibir nomes no telão implica moderação de nomes ofensivos.
10. **Expulsão:** esta proposta permite `master.kick` até LEADERBOARD, mas não em FINAL_PODIUM, para preservar o ranking já gravado. Definir se o produto precisa de expulsão após a finalização e como registrar a remoção em auditoria. Expulsar alguém que já pontuou altera posições durante a partida.
11. **Limites de tráfego:** definir números para os limites por conexão/PIN e o teto por IP. Um limite por PIN mal dimensionado pode bloquear as respostas simultâneas de 150 celulares. `Origin` restringe navegadores conformes, mas não substitui tokens e limites contra clientes automatizados.

## 10. Critérios mínimos de aceite futuro

- Com 150 PLAYERs conectados, o 151º recebe `ROOM_FULL`; nome duplicado por diferença de maiúsculas/minúsculas recebe `NAME_TAKEN` mesmo sob entradas simultâneas.
- Inspecionando bundle e mensagens PLAYER/MASTER antes de `QUESTION_REVEAL`, não se encontra o gabarito da pergunta atual ou futura.
- Resposta repetida, atrasada ou após reconexão não muda escolha, tempo nem pontos. O prazo de 30 s independe do relógio do cliente.
- Resposta aceita sobrevive a hibernação/reinicialização do DO porque é persistida em `transactionSync` antes do `answer_ack`.
- Pergunta fecha no prazo, por resposta de todos os conectados ou por `master.end_question`; fechamento antecipado rejeita respostas posteriores.
- `master.kick` libera nome/vaga, fecha a conexão e faz o token antigo receber `BAD_TOKEN`.
- O MASTER vê contagens agregadas por throttle leading + trailing de 250 ms, sem mensagem individual por resposta; o fechamento envia contagem final. Entre perguntas vê somente o top 5; ranking completo aparece apenas no pódio final.
- Depois da 17ª pergunta, o ranking obedece pontos e desempates definidos e é gravado uma única vez no D1, inclusive após retry de falha transitória.
- O Worker rejeita upgrade WebSocket com `Origin` não permitido; limites por IP não bloqueiam uma sala legítima com 150 celulares compartilhando IP.

## 11. Padrões da implementação

- A sala expira após 30 min sem atividade de jogo. O pódio fica disponível por pelo menos 15 min. Enquanto houver gravação pendente, o DO mantém o resultado e repete a tentativa com intervalo exponencial de até 15 min. O Worker tenta até 16 PINs na criação.
- Nomes usam NFC, 2–20 grafemas e minúsculas Unicode para comparação, com equivalência entre as duas formas minúsculas do sigma grego. Respostas usam as regras provisórias de arredondamento, ausência e desempate da seção 7.
- Frames de texto têm limite de 2 KiB. A conexão permite rajada de 24 mensagens (64 para MASTER autenticado) e reposição de 8/s. O PIN permite rajada de 1.000 mensagens e reposição de 500/s. A borda aplica teto de 6.000 requisições de API por minuto por IP.
- `correct` aparece somente em `question_reveal`. Ao reconectar na fase de revelação, o DO entrega o snapshot e reenvia a revelação em um evento separado.
