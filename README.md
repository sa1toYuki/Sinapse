# Sinapse

Quiz para apresentação escolar, feito com Vite, React e TypeScript. O Worker implementa o protocolo de salas em tempo real descrito no [SPEC.md](SPEC.md), com um Durable Object SQLite por PIN e ranking final no D1. O áudio é sintetizado no navegador e começa desligado.

## Rodar localmente

Use Node.js 22 ou 24 LTS e npm:

```bash
npm install
npm run dev
```

Abra o endereço exibido pelo Vite para jogar os modos solo e dois jogadores no mesmo dispositivo. Esses modos usam a correção do servidor Vite, inclusive com `npm run build` e `npm run preview`.

Para rodar a API das salas com D1 local:

```bash
npx wrangler d1 migrations apply DB --local
npm run dev:worker
```

`POST /api/rooms` com corpo vazio retorna `{ pin, masterToken }`. Abra `GET /api/rooms/<pin>/ws` com upgrade WebSocket e `Origin` da aplicação. Envie `master.resume` com o segredo do MASTER ou `player.join` com PIN e nome. `player.resume` usa o `playerId` e o `reconnectToken` retornados na entrada. O [protocolo JSON](SPEC.md#6-protocolo-json-v1) detalha as mensagens.

Abra **Sala ao vivo** no menu servido pelo Worker, ou acesse `/?master=1`, para controlar a partida no telão. O QR code aponta para `/?pin=<pin>`, o endereço reservado para a futura tela PLAYER. Os modos locais funcionam no Vite dev/preview. A correção de prática fica no Vite para preservar o gabarito das salas públicas.

## Layout responsivo e validação

O layout respeita o zoom do navegador e usa `min-height: 100dvh`, tokens em `rem` e espaços fluidos. No Multi touch, cada jogador tem suas próprias alternativas, identificadas pelo nome e pelas cores dourada/azul.

Execute `npm test` para a matriz de telas e `npm run test:zoom` para zoom real de 100% a 400% em perfis temporários do Edge. Consulte o [relatório de responsividade](docs/responsividade.md) para os breakpoints, regras removidas, resultados e instruções de reprodução.

`npm run test:worker` compila o projeto e roda os testes de regras e integração no Workerd, com Durable Objects, WebSockets e D1 locais. O pool precisa de acesso à rede de loopback.

`npm run test:master` percorre uma partida pelo navegador, com jogadores simulados conectados ao Worker local, em dois tamanhos de tela.

## Editar o conteúdo

- `src/data/questions.ts` contém o conteúdo público das 17 perguntas. `worker/questions.server.ts` contém respostas, explicações e fontes. Preserve os IDs e a ordem correspondente, e atualize `questionSetVersion` ao mudar o banco. O build do navegador rejeita módulos do Worker e desativa source maps.
- `src/data/scoring.ts`: valores de cada degrau. No modo solo, ao errar ou esgotar o tempo, vale o último degrau acertado; sem nenhum acerto, zero. Ao concluir todas, vale o último degrau.
- No modo multi cada acerto soma o valor da pergunta mais 10 pontos por segundo restante, arredondado para cima, até 300 pontos. Quem erra fica bloqueado na rodada. O relógio mede tempo real; ambos erram ou o tempo esgota: ninguém pontua. Empates são declarados.
- `src/styles/tokens.css`: cores e tokens. `src/audio/sound.ts`: efeitos sintetizados. `src/useGame.ts`: estado, regras e controles.

## Configurar o Worker para publicação

Crie o banco `sinapse` no D1 e substitua o `database_id` de exemplo em `wrangler.jsonc` pelo ID do banco. Aplique `npx wrangler d1 migrations apply DB --remote`, faça `npm run build` e publique com `npx wrangler deploy`. O upgrade aceita a origem do próprio Worker. Para upgrades iniciados em outro domínio, configure `ALLOWED_ORIGINS` com as origens exatas separadas por vírgula.

## Salvar e retomar

Durante uma partida, o navegador grava o progresso no `localStorage`, separadamente para os modos solo e multi. Ao selecionar um modo que tenha partida salva, escolha **Continuar** ou **Novo jogo**. O tempo fechado não é descontado do cronômetro. Ao terminar uma partida, o save desse modo é apagado. Se o armazenamento estiver indisponível, o jogo funciona sem salvar.

As chaves são `sinapse:save:solo` e `sinapse:save:multi`. Cada registro inclui a versão do esquema, assinatura do banco de perguntas, modo, nomes, índice da pergunta, pontuações, marco 5/10 alcançado no solo, fase, alternativa selecionada, bloqueios, feedback e tempo restante em milissegundos. O marco salvo é informativo: no solo, a pontuação final continua sendo a do último degrau acertado. Saves inválidos ou incompatíveis são descartados.
