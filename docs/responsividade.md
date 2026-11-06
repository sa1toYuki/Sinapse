# Layout responsivo — relatório de validação

Implementado e verificado em 6 de novembro de 2026. O `StageShell` permanece compartilhado entre todas as telas; o layout agora usa o espaço disponível, respeita o zoom e permite rolagem vertical.

## Tela → comportamento por faixa de largura

As larguras abaixo são pixels CSS, com fonte padrão de 16 px. Os breakpoints estão em `rem` para também acompanhar preferências de tamanho de fonte.

| Tela | ≥1280 | 1024–1279 | 768–1023 | 480–767 | 320–479 |
|---|---|---|---|---|---|
| Moldura/header/footer | Composição desktop; som no canto direito; crédito centralizado | Margens fluidas; crédito pode quebrar | Igual à faixa anterior | Crédito em linhas centralizadas, sem separador | Moldura mais fina/próxima da borda; som só com ícone abaixo de 400; crédito completo |
| Abertura | Logo limitado a 144 px e botão de 360 px, limitado pela largura disponível | Logo e espaços fluidos | Centralizada | Centralizada | Logo cabe em 320 px; botão com pelo menos 44 px de altura |
| Menu | Logo e painel em duas colunas | Duas colunas; logo usa o tamanho do próprio contêiner | Logo sobre o painel | Uma coluna | Uma coluna; textos podem quebrar |
| Como jogar/retomar | Dialog centralizado, largura máxima em `rem` limitada à tela | Mesma regra | Mesma regra | Rolagem interna quando necessário | Botões de retomar empilhados; rolagem interna |
| Configuração Solo/Multi | Cartão centralizado | Cartão fluido | Cartão fluido | Campos e ações ocupam a largura disponível | Campos e ações ocupam a largura disponível |
| Pergunta | Alternativas em duas colunas; tempo, placar e escada à direita | Escada → pergunta/dificuldade → tempo → enunciado → alternativas em coluna → placar | Mesma sequência | Mesma sequência | Mesma sequência; todos os 17 degraus continuam visíveis |
| Escada | Vertical, 17 degraus com valores | Faixa de 17 posições no topo; valor atual no cabeçalho | Mesma regra | Mesma regra | Mesma regra; números auxiliares compactos, sem arraste horizontal |
| Multi touch | Dois grupos de alternativas, um por jogador | Dois grupos lado a lado | Dois grupos lado a lado | Grupos empilhados | Grupos empilhados |
| Feedback/fim | Feedback em linha; placares lado a lado; ações abaixo | Feedback em coluna; placares lado a lado | Mesma regra | Placar final e ações em coluna | Placar final e ações em coluna |

Em alturas de até 500 px, os espaços verticais diminuem e a decoração interna é simplificada. A página cresce e rola; os dialogs mantêm rolagem interna. A moldura acompanha a altura real da página para não atravessar controles durante a rolagem.

## Multi em telas touch

O jogador 1 tem bordas e identificação douradas; o jogador 2, azuis. O nome identifica cada grupo, portanto a distinção não depende somente da cor. Cada grupo contém suas próprias alternativas A–E com o texto completo. As alternativas têm altura mínima de 56 px. Em telas a partir de 768 px, o jogador 1 fica à esquerda e o jogador 2 à direita; abaixo disso, os grupos aparecem nessa ordem verticalmente.

O toque chama a mesma lógica de resposta usada pelo teclado: errar bloqueia somente aquele jogador; acertar pontua e encerra a rodada. As dicas de teclas ficam ocultas com `pointer: coarse`, incluindo a instrução correspondente no modal. Nenhuma nova frase foi acrescentada à interface. Os textos dos nomes, alternativas e valores foram reutilizados.

## Regras de trava removidas

- `.app.is-stage` fixo em 1920×1080, centralização por transformação, `transform: scale(var(--stage-scale))` e o espaço vazio resultante da escala.
- Estado React `stageScale`, cálculo baseado em `innerWidth/1920` e `innerHeight/1080`, listener de resize e propriedade inline `--stage-scale`.
- Alturas fixas do palco/frame e `min-height: 100vh`; substituídas por fluxo normal e `min-height: 100dvh`.
- `overflow: hidden` do contêiner principal. Somente decoração e brilho do botão usam recorte local; nenhum conteúdo da página é escondido para disfarçar overflow.
- `white-space: nowrap` de logo, subtítulo, ações, notas, rodapé e resumo de progresso.
- Larguras fixas em pixels e colunas rígidas que forçavam o layout desktop; limites de leitura agora usam `min(100%, token em rem)` ou grids flexíveis.
- Antigas regras de escala do logo do menu e blocos CSS acumulados que anulavam os breakpoints.
- Decoração de estrelas nos cantos da moldura, inclusive regras antigas depois sobrescritas.

Não existiam `--u`, `calc(var(--u) * N)`, `user-scalable=no`, `maximum-scale`, bloqueios por `touch-action`, nem interceptadores de Ctrl +/−, roda ou gestos de zoom no código original. Nenhum foi introduzido. O listener do jogo continua ignorando Ctrl/Meta/Alt, preservando atalhos do navegador.

## Base e acessibilidade

- Viewport: `width=device-width, initial-scale=1, viewport-fit=cover`.
- Tipografia, espaços, dimensões, bordas, raios, glow e tempos de animação centralizados em `src/styles/tokens.css`.
- Texto corrente e rótulos em celular têm pelo menos 1 rem; os números auxiliares da escada são compactos. Não há redução da fonte raiz.
- `env(safe-area-inset-*)` nos limites da página, moldura e dialogs.
- Foco visível, inclusive nas alternativas com recorte decorativo desktop.
- Dialog nativo: fundo inerte, foco contido, Escape e devolução do foco ao botão que o abriu.
- Som com nome acessível e `aria-pressed`; degrau atual com `aria-current="step"`.
- Animações decorativas somente em desktop sem preferência por redução de movimento. `prefers-reduced-motion` desativa animações/transições; glow mais leve em telas menores.

## Resultados dos testes

`npm run build`: aprovado. `npm test`: **27 testes aprovados** no Edge/Chromium, com emulação de dispositivo nos perfis touch. As partidas percorrem as 17 perguntas em ambos os modos, incluindo nomes de 20 caracteres sem espaços, acerto, erro, bloqueio individual, timeout, resultado, retomada, modais, foco e movimento reduzido.

| Viewport | Resultado |
|---|---|
| 1920×1080 | Aprovado; composição comparada com a versão anterior |
| 1366×768 | Aprovado |
| 1280×720 | Aprovado |
| 1024×768 | Aprovado; menu em duas colunas e pergunta empilhada |
| 820×1180 | Aprovado; menu em uma coluna e Multi touch em dois grupos laterais |
| 390×844 | Aprovado; som só com ícone e grupos touch empilhados |
| 844×390 | Aprovado; página e modais rolam quando necessário |
| 360×640 | Aprovado |
| 320×640, adicional | Aprovado |

`npm run test:zoom`: **380 verificações aprovadas** em zoom real do navegador, em perfis temporários isolados. A área física de conteúdo foi calibrada para 1920×1080, descontando a moldura nativa do navegador. O teste confirma `devicePixelRatio` e as dimensões CSS reais; não usa `zoom` CSS, `transform` ou apenas redução artificial do viewport como substituto de zoom.

| Zoom | Viewport CSS medido | Layout |
|---|---|---|
| 100% | 1920×1080 | Desktop |
| 150% | 1280×720 | Desktop compacto |
| 200% | 960×540 | Tablet; menu e pergunta em coluna |
| 300% | 640×360 | Celular grande e baixa altura |
| 400% | 480×270 | Celular e baixa altura |

Em todas as verificações, `scrollWidth` da página coincidiu com sua largura útil. Também foram conferidos elementos fora dos limites horizontais, texto maior que sua caixa e sobreposição do conteúdo com header/footer. As capturas foram inspecionadas em desktop, projetor 4:3, celular, paisagem e zoom. A matriz cobre emulação no Edge, não execução em aparelhos físicos ou outros motores de navegador.

O zoom é configurado pela preferência de perfil utilizada pelo [Chromium](https://chromium.googlesource.com/chromium/src/+/caa5e0d1c9d58de7bbcf686857034253d0a26ac8/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc), sempre em perfis temporários exclusivos dos testes. As capturas de zoom usam a superfície nativa do navegador para evitar recortes incorretos do Playwright em zoom alto.

## Comparação desktop

A referência disponível foi o próprio repositório antes da refatoração. Foram capturados abertura, menu, configuração Solo e pergunta em 1920×1080, com movimento reduzido para estabilizar a comparação.

Os blocos medidos de menu, configuração e pergunta mantiveram posição e dimensões; na abertura, a maior diferença foi **0,03125 px CSS**. A tipografia principal permanece em 144 px no logo de abertura, 120 px no menu, 44 px nos títulos e 35 px na pergunta. Isso preserva a composição desktop; não se trata de igualdade de cada pixel, pois foco, áreas de interação e detalhes decorativos foram ajustados.

Evidências locais (ignoradas pelo Git):

- `artifacts/baseline/`: capturas e medidas anteriores à refatoração.
- `artifacts/desktop/`: capturas e medidas finais em 1920×1080.
- `artifacts/zoom/results.json`: resultados das 380 verificações.
- `artifacts/zoom/*.png`: capturas com zoom real.
- `test-results/` e `playwright-report/`: capturas por tela e relatório dos 27 testes.

Para repetir: `npm ci`, `npm test` e `npm run test:zoom`. O padrão é usar o Edge instalado; `PLAYWRIGHT_CHANNEL` permite escolher outro canal Chromium instalado. `node scripts/capture-desktop.mjs` registra a composição desktop após `npm run build`. Nenhuma publicação ou envio ao GitHub foi realizado.
