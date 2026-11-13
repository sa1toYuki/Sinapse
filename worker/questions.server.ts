import { questions, type Letter } from '../src/data/questions';

const answers: readonly (readonly [Letter, string, string])[] = [
  ["D","O “plim-plim” é a assinatura sonora das vinhetas usadas pela Globo nos intervalos comerciais.","https://memoriaglobo.globo.com/perfil/borjalo/noticia/borjalo.ghtml"],
  ["A","O SBT exibiu o Show do Milhão, quiz de perguntas e respostas que ficou conhecido com Silvio Santos.","https://tv.sbt.com.br/programas/variedades/sbt-na-web/noticia/112965-voce-sabe-tudo-entao-descubra-quanto-voce-ganharia-no-show-do-milhao"],
  ["C","“Alô, alô, Terezinha!” era um dos bordões de Abelardo Barbosa, o Chacrinha.","https://memoriaglobo.globo.com/entretenimento/auditorio-e-variedades/cassino-do-chacrinha/noticia/producao.ghtml"],
  ["B","Em FM, a frequência da onda portadora varia de acordo com o sinal que carrega o áudio.","https://www.gov.br/anatel/pt-br/regulado/radiodifusao/servicos-de-radiodifusao"],
  ["E","A TV Tupi inaugurou a televisão brasileira em 18 de setembro de 1950, em São Paulo.","https://bndigital.bn.gov.br/artigos/memoria-na-era-das-lives-brasil-celebrara-70-anos-da-primeira-transmissao-de-tv/"],
  ["B","O Jornal Nacional estreou em 1º de setembro de 1969.","https://memoriaglobo.globo.com/jornalismo/jornalismo-e-telejornais/jornal-nacional/noticia/concepcao-e-estreia.ghtml"],
  ["D","O noticiário nasceu em 1935 e ficou associado às 19h. As emissoras podem retransmiti-lo na faixa das 19h às 22h.","https://www.ebc.com.br/imprensa/2018/ebc-disponibiliza-para-radios-download-de-a-voz-do-brasil"],
  ["A","Roberto Marinho inaugurou a TV Globo em 26 de abril de 1965, no Rio de Janeiro.","https://memoriaglobo.globo.com/perfil/roberto-marinho/noticia/roberto-marinho.ghtml"],
  ["C","A Rede Manchete, do empresário Adolpho Bloch, entrou no ar em 1983.","https://bndigital.bn.gov.br/artigos/manchete/"],
  ["E","Em 30 de outubro de 1938, Orson Welles dirigiu e narrou uma adaptação do romance de H. G. Wells que simulava boletins sobre uma invasão marciana.","https://www.loc.gov/lcm/pdf/LCM_2016_0708.pdf"],
  ["A","Em janeiro de 1926, John Logie Baird demonstrou seu sistema de televisão mecânica em Londres.","https://blog.scienceandmediamuseum.org.uk/history-of-british-television-timeline/"],
  ["B","O Repórter Esso estreou em 1941 na Rádio Nacional e ficou conhecido pelo lema “testemunha ocular da história”.","https://www.ebc.com.br/imprensa/2021/no-rio-de-janeiro-fabio-faria-inaugura-museu-da-radio-nacional"],
  ["C","Em 19 de fevereiro de 1972, o desfile de abertura da Festa da Uva foi transmitido em cores para todo o país.","https://www.blumenau.sc.gov.br/secao/noticias/44457"],
  ["E","O Brasil adotou o PAL-M como padrão de transmissão analógica de TV em cores.","https://bndigital.bn.gov.br/artigos/memoria-na-era-das-lives-brasil-celebrara-70-anos-da-primeira-transmissao-de-tv/"],
  ["A","A TV Excelsior exibiu 2-5499 Ocupado em 1963. A trama inaugurou o formato diário de telenovelas no Brasil.","https://www.gov.br/cultura/pt-br/centrais-de-conteudo/sala-de-imprensa/notas-do-ministerio-da-cultura/nota-de-pesar-gloria-menezes"],
  ["C","Edgard Roquette-Pinto e Henrique Morize criaram a Rádio Sociedade em 1923. A emissora deu origem à Rádio MEC.","https://radiomec.ebc.com.br/sobre"],
  ["E","A TV Tupi lançou Imagens do Dia em 1950, na estreia do telejornalismo na televisão brasileira.","https://pjbr.eca.usp.br/arquivos/dossie14e.htm"],
];

export const questionSetVersion = 'sinapse-2';
export const serverQuestions = questions.map((question, index) => {
  const [correct, explanation, source] = answers[index];
  return { ...question, correct, explanation, source };
});
