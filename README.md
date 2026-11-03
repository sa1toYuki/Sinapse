# Sinapse

Quiz estático para apresentação escolar, feito com Vite, React e TypeScript. Não há servidor, banco de dados ou chamadas de API em tempo de execução. O áudio é sintetizado no navegador e começa desligado.

## Rodar localmente

Use Node.js 22 ou 24 LTS e npm:

```bash
npm install
npm run dev
```

Abra o endereço exibido pelo Vite. Para conferir a versão de produção localmente, execute `npm run build` e `npm run preview`.

## Editar o conteúdo

- `src/data/questions.ts`: 17 perguntas, cinco opções fixas, resposta, explicação e fonte. Preserve a ordem e os IDs; a dificuldade é definida por `level`.
- `src/data/scoring.ts`: valores de cada degrau. No modo solo, ao errar ou esgotar o tempo, vale o último degrau acertado; sem nenhum acerto, zero. Ao concluir todas, vale o último degrau.
- No modo multi cada acerto soma o valor da pergunta mais 10 pontos por segundo restante, arredondado para cima, até 300 pontos. Quem erra fica bloqueado na rodada. O relógio mede tempo real; ambos erram ou o tempo esgota: ninguém pontua. Empates são declarados.
- `src/styles/tokens.css`: cores e tokens. `src/audio/sound.ts`: efeitos sintetizados. `src/useGame.ts`: estado, regras e controles.

## Publicar no Cloudflare Pages

1. Envie este diretório a um repositório Git e conecte-o ao Cloudflare Pages, ou carregue a pasta de build pelo fluxo de upload direto do Pages.
2. No projeto Pages, selecione Node.js **22** ou **24**; por exemplo, defina `NODE_VERSION=22` nas variáveis de ambiente.
3. Comando de build: `npm run build`.
4. Diretório de saída: `dist`.
5. Publique. Todos os recursos necessários ao jogo estão no build; nenhuma chave ou serviço externo é necessário.

## Conferência das perguntas

| # | Resposta | Justificativa |
|---|---|---|
| 1 | B — Brasília | É a capital federal desde 1960. |
| 2 | D — Marte | Minerais ricos em ferro dão aparência avermelhada à superfície. |
| 3 | A — Frequência modulada | FM transmite informação pela variação da frequência. |
| 4 | E — Leonardo da Vinci | Ele pintou a Mona Lisa. |
| 5 | C — Seis | Uma equipe de voleibol de quadra tem seis jogadores em quadra. |
| 6 | B — 1889 | A República foi proclamada em 15 de novembro de 1889. |
| 7 | A — Videocassete | Aparelho que reproduz e pode gravar fitas VHS. |
| 8 | D — Gás carbônico | É consumido pelas plantas na fotossíntese. |
| 9 | E — Piano | Suas teclas acionam martelos que percutem cordas. |
| 10 | C — CD | Disco óptico que armazena áudio digital. |
| 11 | B — Linha do Equador | Latitude zero, divide Norte e Sul. |
| 12 | A — Tim Berners-Lee | Apresentou a proposta da Web no CERN em 1989. |
| 13 | D — Machado de Assis | Autor de Dom Casmurro. |
| 14 | E — Au | Símbolo químico do ouro, do latim aurum. |
| 15 | C — Informação de cor | A crominância carrega a informação de cor no sinal de vídeo. |
| 16 | B — Inca | A cidade de Machu Picchu foi construída pelos incas. |
| 17 | A — Estratosfera | Contém a maior parte do ozônio atmosférico. |

Cada entrada em `questions.ts` inclui um link de referência para consulta. As alternativas permanecem fixas na ordem do arquivo.


## Salvar e retomar

Durante uma partida, o navegador grava o progresso no `localStorage`, separadamente para os modos solo e multi. Ao selecionar um modo que tenha partida salva, escolha **Continuar** ou **Novo jogo**. O tempo fechado não é descontado do cronômetro. Ao terminar uma partida, o save desse modo é apagado. Se o armazenamento estiver indisponível, o jogo funciona sem salvar.

As chaves são `sinapse:save:solo` e `sinapse:save:multi`. Cada registro inclui a versão do esquema, assinatura do banco de perguntas, modo, nomes, índice da pergunta, pontuações, marco 5/10 alcançado no solo, fase, alternativa selecionada, bloqueios, feedback e tempo restante em milissegundos. O marco salvo é informativo: no solo, a pontuação final continua sendo a do último degrau acertado. Saves inválidos ou incompatíveis são descartados.
