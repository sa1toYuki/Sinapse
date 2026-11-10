# Teste de carga da sala

Execuções locais com Node 24 e Wrangler 4.160, no mesmo computador. Cada execução abriu uma sala, usou a seed `42`, fez duas rodadas com atrasos aleatórios e uma rajada em cinco ondas. Os bots abriram os WebSockets a partir de `127.0.0.1` e consultaram o nome antes de entrar. Parte deles tentou nomes que colidem por maiúsculas e minúsculas, e 10% reconectaram após o ACK em cada rodada aleatória. O script conferiu que o snapshot preservou essas respostas.

Latências em ms, no formato p50 / p95. A entrega da abertura mede do envio do comando do MASTER até o recebimento de `question_open` na rajada. O ACK mede do envio da resposta até a confirmação do servidor.

| Bots | Entrada `join → joined` | Entrega da abertura | ACK aleatório | ACK na rajada | Aceite da rajada | Colisões / reconexões |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 59,32 / 108,44 | 8,87 / 10,50 | 2,85 / 12,42 | 11,63 / 20,23 | 705 ms | 6 / 10 |
| 100 | 287,17 / 1.116,51 | 7,76 / 10,00 | 5,07 / 12,73 | 18,77 / 30,38 | 729 ms | 12 / 20 |
| 150 | 142,54 / 217,77 | 9,38 / 13,14 | 5,30 / 10,32 | 25,14 / 42,06 | 726 ms | 18 / 30 |

Com 150 bots, foram 150 entradas confirmadas e 181 upgrades, incluindo o MASTER e as reconexões, a partir do mesmo IP. Houve zero HTTP 429 e zero `RATE_LIMITED` no WebSocket com a configuração de 6.000 requisições por minuto. Uma instância local isolada com 100 requisições por minuto devolveu HTTP 429 na mesma carga. O script detectou o bloqueio e saiu com erro, o que confirma que o teste exercitou a proteção por IP.

Na rajada de 150, o cliente enviou todas as respostas em 687,15 ms e o servidor aceitou todas em 726 ms. O MASTER recebeu as contagens `1`, `60`, `120` e `150`. Os intervalos regulares no servidor foram 263 e 259 ms. A última contagem saiu 206 ms depois do lote anterior porque a pergunta fechou. A validação do script exige intervalos regulares entre 245 e 400 ms durante as ondas e trata esse último envio separadamente.

## Comparação com a linha de base de 150 bots

| Métrica | Antes | Depois |
| --- | ---: | ---: |
| Mensagens `lobby_update` entregues | 11.476 | 233 |
| Tempo até todos os `joined` | 2.000,02 ms | 1.123,39 ms |
| ACK aleatório p95 | 18,75 ms | 10,32 ms |
| ACK da rajada p95 | 56,60 ms | 42,06 ms |

O lobby passou a agrupar atualizações em janelas de 100 ms. Na rodada aberta, o DO reutiliza a contagem em memória e a reconstitui a partir das respostas persistidas quando a lista de conexões muda ou quando volta da hibernação. O caminho comum da resposta grava e retorna o ACK sem refazer a consulta de duplicidade nem reagendar o alarm a cada toque.

Os números são amostras locais, sujeitas à carga do computador. Uma execução intermediária de 50 bots levou 1.621 ms para aceitar a rajada e foi corretamente sinalizada como falha. A repetição passou em 705 ms. A tabela registra a sequência final aprovada e mede o ambiente local, incluindo o runtime do Wrangler e a rede de loopback.
