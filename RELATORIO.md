# Relatório de funcionalidades e evolução do Sinapse

**Data:** 10 de novembro de 2026  
**Base da comparação:** commit `5626bf9` — última versão antes da inclusão da sala MASTER, conforme o histórico Git disponível.  
**Estado analisado:** código atual do repositório, incluindo o Worker, as telas MASTER/PLAYER, ranking persistido e teste de carga.

## Visão geral

Sinapse é um quiz em português com 17 perguntas e cinco alternativas. Hoje oferece partidas locais em modo solo e dois jogadores, além de partidas ao vivo por sala: uma tela MASTER controla a sessão, celulares PLAYER enviam respostas, e a classificação final fica disponível para consulta pública. A aplicação usa Vite, React e TypeScript; um Cloudflare Worker serve os arquivos estáticos e a API. Cada PIN encaminha para um Durable Object SQLite, e D1 armazena os resultados concluídos.

## Funcionalidades atuais

### Jogo local

- **Solo:** uma pessoa responde às 17 perguntas, com cronômetro, escada de pontuação e resultado final. A pontuação local segue os degraus: ao errar ou esgotar o tempo, conserva o último degrau acertado; sem acertos, fica com zero.
- **Dois jogadores no mesmo dispositivo:** cada jogador tem seu próprio grupo de alternativas, identificado por nome e cor. Erro bloqueia aquele jogador naquela rodada; acerto pontua segundo as regras do modo e encerra a rodada. O jogo reconhece empate.
- **Retomar partida:** o estado de cada modo é salvo no `localStorage`. Ao voltar, é possível continuar ou iniciar uma nova partida. Saves inválidos ou incompatíveis são descartados; sem armazenamento disponível, ainda é possível jogar.
- **Áudio:** efeitos são sintetizados no navegador e começam desligados; o controle de áudio fica na moldura comum.

### Partida ao vivo

- **MASTER (computador/telão):** cria sala, mostra PIN grande e QR code, acompanha jogadores que entram, inicia a partida, apresenta enunciado/alternativas e cronômetro do servidor, acompanha a contagem de respostas, pode encerrar a pergunta e remover jogadores durante o lobby. Mostra a resposta correta após a revelação, o top 5 entre perguntas e o pódio e ranking completo ao fim.
- **PLAYER (celular):** entra com PIN e nome, recebe feedback de disponibilidade do nome, aguarda a partida e responde tocando em um dos cinco botões coloridos A–E. Após enviar, o controle é bloqueado e aparece “Enviado”; na revelação, vê acerto/erro, pontos e posição individual. Pode reconectar automaticamente usando credenciais guardadas no `localStorage`; o estado de reconexão é discreto.
- **Privacidade da resposta:** o cliente PLAYER não recebe enunciado ou gabarito antes da revelação. O gabarito e as explicações ficam no código do Worker, fora do bundle público. Mensagens anteriores à revelação não incluem o campo `correct`.
- **Identidade e capacidade:** PIN de seis dígitos; nome único por sala, comparação sem distinção entre maiúsculas/minúsculas; limite de 150 jogadores. A entrada e a reserva de nome são coordenadas no Durable Object da sala. Tokens autenticam MASTER e reconexão PLAYER; token de partida antiga é rejeitado.
- **Tempo e pontuação ao vivo:** o servidor é a autoridade do prazo e do instante da resposta. A pergunta dura até 30 segundos e também pode fechar quando todos os conectados responderam ou quando o MASTER a encerra. Acerto vale `1000 × (1 − (t/T)/2)`; erro/ausência vale zero. Classificação usa pontos decrescentes e tempo total de resposta crescente como desempate.
- **Tráfego de contagem:** respostas aceitas são persistidas antes do ACK. O MASTER recebe atualizações agregadas de `answer_count` com throttle leading/trailing de aproximadamente 250 ms, e não uma mensagem por toque.
- **Estados da sala:** `LOBBY → QUESTION_OPEN → QUESTION_REVEAL → LEADERBOARD`, repetidos até `FINAL_PODIUM`. O ciclo é controlado por mensagens validadas pelo Worker e por alarmes do Durable Object.

### Ranking público e persistência

- Ao concluir, o Worker grava partida e resultados em D1. A escrita pode ser repetida via retry agendado se o banco falhar temporariamente.
- O MASTER apresenta o ranking completo quando a persistência é confirmada; antes disso, informa que está salvando.
- `/ranking` mostra a última partida concluída; o link no pódio abre a partida específica. A API ordena por pontuação decrescente e tempo acumulado crescente, com desempate determinístico. O tempo é exibido em `MM:SS`.
- D1 contém `games` e `game_results`; PIN não é reservado no D1. O Durable Object é endereçado pelo PIN e guarda o identificador interno do jogo.

### Experiência, acessibilidade e layout

- Identidade visual azul-escuro e dourada, com header, footer e moldura compartilhados nas telas de palco.
- Layout adaptável a projetor, desktop, tablet, celular em retrato/paisagem e viewport estreito. A página permite rolagem vertical; não bloqueia zoom. Usa áreas de toque grandes, foco visível, diálogos nativos e suporte a preferência por movimento reduzido.
- Moldura, telas MASTER/PLAYER/ranking e jogo local compartilham tokens visuais. MASTER e PLAYER mantêm interface enxuta.

## O que a versão de referência já continha

Na versão do commit `5626bf9`, antes do MASTER, já existiam o quiz local em Vite/React/TypeScript, a abertura e o menu, os modos solo e dois jogadores no mesmo dispositivo, 17 perguntas com cinco alternativas, escada e regras locais de pontuação, sons, retomada via `localStorage`, identidade visual e adaptação responsiva. Também já havia sido feito o trabalho de layout para zoom e telas menores, com testes de interface e relatório de responsividade. Essa versão era estática: não tinha API de sala, Worker, WebSocket, Durable Object, tela de celular conectada, nem ranking persistido em D1.

## O que foi acrescentado ou alterado desde essa versão

### 1. Servidor e salas ao vivo

- A hospedagem evoluiu de build estático para um único Worker que atende assets, API e WebSocket, sem migrar para Next.js.
- Foi introduzido um Durable Object SQLite por PIN, com estados, autenticação por token, validação de mensagens, limite por conexão e proteção por IP com teto generoso para redes escolares compartilhadas.
- O MASTER cria sala por PIN; a alocação é atômica no DO. Uma sala ativa causa resposta de ocupado, levando o Worker a tentar outro PIN. Alarmes compartilham uma fila no storage e agendam o menor prazo entre deadline, limpeza e retry de D1. A limpeza remove salas encerradas/inativas.
- A validação de `Origin`, tamanhos/tipos de payload e limites de requisições foi adicionada ao fluxo de API/WebSocket.

### 2. Telas MASTER e PLAYER

- Foram adicionadas interfaces distintas para telão e celular, preservando o sistema visual já existente.
- A sala suporta ingresso ao vivo, consulta de nome, remoção pelo MASTER no lobby, resposta, encerramento antecipado, revelação, top 5 e pódio.
- PLAYER ganhou reentrada e reconexão por token, bloqueio após resposta e feedback da própria posição na revelação.
- O conteúdo público das perguntas foi separado dos dados confidenciais do servidor; source maps de produção foram desligados e há uma verificação de build para evitar incluir módulos do Worker no navegador.

### 3. Resultados duráveis e rota pública

- Foram criadas migrações D1 para `games` e `game_results`, incluindo índice de partidas concluídas e `finished_at`.
- O ranking final passou a ser obtido de D1, com rota `/api/ranking`, página pública `/ranking` e link para abrir a partida específica. A classificação integral fica reservada para o final; entre perguntas, o MASTER recebe apenas o top 5.

### 4. Carga e redução de gargalos

- Foi criado `scripts/load-room.mjs`, executável com `npm run test:load -- 50`, `100` ou `150`. Ele simula nomes em colisão, respostas em tempos aleatórios, reconexões e uma rajada de 150 respostas usando um único IP local.
- As medições locais documentadas em `docs/carga.md` mostram, para 150 bots, 150 entradas aceitas sem `RATE_LIMITED`, rajada aceita em 726 ms, intervalos regulares de `answer_count` de 263/259 ms e ACK da rajada p50/p95 de 25,14/42,06 ms.
- Para reduzir trabalho na sala, atualizações de lobby foram agrupadas em 100 ms, contagem de respostas é derivada em memória e reconstruída após hibernação/mudança de conexões, e a consulta/alarme redundantes foram removidos do caminho comum de resposta.
- No teste local documentado, `lobby_update` caiu de 11.476 para 233 mensagens e o p95 de ACK da rajada caiu de 56,60 para 42,06 ms. Os números são medições locais, não uma garantia de latência de produção.

## Validação disponível

- **Worker:** `npm run test:worker` compila e executa os testes Vitest/Workers pool para regras e integração com Durable Objects, WebSockets e D1 local. A suíte cobre concorrência de nomes, capacidade, respostas repetidas/tardias, reconexão após hibernação, deadline mesmo com alarm atrasado, alarm de prazo junto com retry D1 e ausência do gabarito antes da revelação.
- **Navegador:** `npm test` cobre os fluxos locais e responsividade; `npm run test:master` cobre interfaces e fluxo de sala pelo Worker local.
- **Zoom:** `npm run test:zoom` executa verificações de zoom real no Edge. O relatório existente registra 380 verificações aprovadas até 400%.
- **Carga:** `npm run test:load -- <50|100|150>` mede conexões/entrada, entrega, ACK, reconexão e cadência de contagem no Worker local.
- Para a validação mais recente de carga, foram registrados 18 testes Worker aprovados e 2 testes do projeto estreito MASTER aprovados; os outros resultados descritos acima são os registrados nos respectivos relatórios/testes já executados.

## Limites e pontos operacionais

- A configuração local pode rodar com D1 local após aplicar as migrações. Para publicar, `wrangler.jsonc` ainda precisa receber o `database_id` real do D1 e as migrações remotas devem ser aplicadas antes do deploy. O código e os testes não significam que o jogo esteja publicado.
- O teste de carga é local e em loopback, com bots no mesmo host; serve para comparar e detectar regressões no Worker, não para prometer latência sob condições reais de rede ou uma escola em produção.
- O projeto conserva os modos solo e dois jogadores no dispositivo; a sala ao vivo foi somada a eles, não os substituiu.

## Arquivos de referência

- `SPEC.md` — arquitetura, papéis, estados, protocolo, persistência e regras da sala.
- `src/main.tsx`, `src/useGame.ts` — menu e jogo local.
- `src/master/`, `src/player/`, `src/ranking/` — interfaces dos três papéis/superfícies.
- `worker/` e `worker-tests/` — API, protocolo, sala, ranking, regras e testes de integração.
- `migrations/` — schema D1.
- `docs/responsividade.md`, `docs/carga.md` — validações de layout/zoom e carga.
- `scripts/load-room.mjs` — simulador de bots.
