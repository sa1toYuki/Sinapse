# Sinapse

Quiz para apresentação escolar, feito com Vite, React e TypeScript. O Worker implementa o protocolo de salas em tempo real descrito no [SPEC.md](SPEC.md), com um Durable Object SQLite por PIN e ranking final no D1. O áudio é sintetizado no navegador e começa desligado.

## Rodar localmente

Use Node.js 22 ou 24 LTS e npm:

```bash
npm install
npm run dev
```

O comando aplica as migrações do D1 local, inicia o Worker e abre o servidor Vite com recarregamento automático. Abra a URL do **Vite** (normalmente `http://localhost:5173`). As chamadas da sala, os WebSockets e o ranking passam pelo Worker na mesma origem que a página. Para testar com um celular na mesma rede, abra a URL **Network** do Vite no computador antes de gerar o QR code.

Para testar o Worker sozinho com o frontend compilado:

```bash
npx wrangler d1 migrations apply DB --local
npm run dev:worker
```

`POST /api/rooms` com corpo vazio retorna `{ pin, masterToken }`. Abra `GET /api/rooms/<pin>/ws` com upgrade WebSocket e `Origin` da aplicação. Envie `master.resume` com o segredo do MASTER ou `player.join` com PIN e nome. `player.resume` usa o `playerId` e o `reconnectToken` retornados na entrada. O [protocolo JSON](SPEC.md#6-protocolo-json-v1) detalha as mensagens.

Abra **Sala ao vivo** no menu ou acesse `/?master=1` para controlar a partida no telão. No celular, escaneie o QR code para abrir a tela PLAYER com o PIN preenchido (`/?pin=<pin>`) ou use **Entrar na sala** (`/?player=1`). O navegador guarda o token da última sala em `localStorage` para retomar a sessão. Os modos solo e de dois jogadores usam a correção de prática do Vite e também funcionam com `npm run build` e `npm run preview`.

O MASTER mostra a classificação completa quando o D1 confirma a gravação. `/ranking` exibe a última partida concluída e o link **Ranking público** no pódio abre o resultado daquela partida. A classificação mostra o tempo acumulado em `MM:SS` e usa milissegundos no desempate.

## Layout responsivo e validação

O layout respeita o zoom do navegador e usa `min-height: 100dvh`, tokens em `rem` e espaços fluidos. No Multi touch, cada jogador tem suas próprias alternativas, identificadas pelo nome e pelas cores dourada/azul.

Execute `npm test` para a matriz de telas e `npm run test:zoom` para zoom real de 100% a 400% em perfis temporários do Edge. Consulte o [relatório de responsividade](docs/responsividade.md) para os breakpoints, regras removidas, resultados e instruções de reprodução.

`npm run test:worker` compila o projeto e roda os testes de regras e integração no Workerd, com Durable Objects, WebSockets e D1 locais. O pool precisa de acesso à rede de loopback.

`npm run test:master` testa o MASTER em dois tamanhos de tela e o fluxo PLAYER no celular, com entrada, remoção, resposta e reconexão pelo Worker local.

`npm run test:smoke` usa `npm run dev` com um banco local novo. No navegador, cria uma sala pelo menu, entra como PLAYER pelo link do QR code e inicia a primeira pergunta. Também consulta o ranking para confirmar que as migrações foram aplicadas.

### Carga de sala

Com o Worker local rodando (`npm run dev:worker`), execute `npm run test:load -- 150`. Use `50`, `100` ou `150` bots. O script cria uma sala própria. As opções `--url`, `--source-ip`, `--seed` e `--rounds` ajustam o alvo, o IP local, a sequência aleatória e a quantidade de rodadas antes da rajada.

O relatório JSON inclui p50/p95 em milissegundos, colisões de nome, reconexões, rejeições e o IP TCP observado no upgrade. A latência de confirmação mede do envio até o ACK. A abertura também é medida do comando do MASTER até o recebimento por cada bot. A entrega por evento usa `serverNow` e exige relógios alinhados para comparação entre hosts.

Na rajada, o script valida o intervalo entre a primeira e a última resposta tanto no envio quanto no aceite pelo servidor. Também verifica a cadência dos lotes regulares de `answer_count` e a contagem final. O envio final é imediato quando a pergunta fecha. O script sai com erro se detectar bloqueio, perda de respostas ou falha nesses critérios.

Consulte as [medições e a comparação antes/depois](docs/carga.md).

## Editar o conteúdo

- `src/data/questions.ts` contém o conteúdo público das 17 perguntas. `worker/questions.server.ts` contém respostas, explicações e fontes. Preserve os IDs e a ordem correspondente, e atualize `questionSetVersion` ao mudar o banco. O build do navegador rejeita módulos do Worker e desativa source maps.
- `src/data/scoring.ts`: valores de cada degrau. No modo solo, ao errar ou esgotar o tempo, vale o último degrau acertado; sem nenhum acerto, zero. Ao concluir todas, vale o último degrau.
- No modo multi cada acerto soma o valor da pergunta mais 10 pontos por segundo restante, arredondado para cima, até 300 pontos. Quem erra fica bloqueado na rodada. O relógio mede tempo real; ambos erram ou o tempo esgota: ninguém pontua. Empates são declarados.
- `src/styles/tokens.css`: cores e tokens. `src/audio/sound.ts`: efeitos sintetizados. `src/useGame.ts`: estado, regras e controles.

## Configurar o Worker para publicação

1. Crie o banco com `npx wrangler d1 create sinapse`.
2. Copie o `database_id` retornado para o binding `DB` em `wrangler.jsonc`, no lugar do placeholder `00000000-0000-0000-0000-000000000000`.
3. Aplique as migrações com `npx wrangler d1 migrations apply DB --remote`.
4. Publique com `npm run deploy`. O `predeploy` valida a configuração antes do build e de `wrangler deploy`. Use esse comando também na integração com a Cloudflare para executar a validação.

O upgrade aceita a origem do próprio Worker. Para upgrades iniciados em outro domínio, configure `ALLOWED_ORIGINS` com as origens exatas separadas por vírgula.

## Salvar e retomar

Durante uma partida, o navegador grava o progresso no `localStorage`, separadamente para os modos solo e multi. Ao selecionar um modo que tenha partida salva, escolha **Continuar** ou **Novo jogo**. O tempo fechado não é descontado do cronômetro. Ao terminar uma partida, o save desse modo é apagado. Se o armazenamento estiver indisponível, o jogo funciona sem salvar.

As chaves são `sinapse:save:solo` e `sinapse:save:multi`. Cada registro inclui a versão do esquema, assinatura do banco de perguntas, modo, nomes, índice da pergunta, pontuações, marco 5/10 alcançado no solo, fase, alternativa selecionada, bloqueios, feedback e tempo restante em milissegundos. O marco salvo é informativo: no solo, a pontuação final continua sendo a do último degrau acertado. Saves inválidos ou incompatíveis são descartados.
