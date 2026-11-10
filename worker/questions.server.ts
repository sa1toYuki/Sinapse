import { questions, type Letter } from '../src/data/questions';

const answers: readonly (readonly [Letter, string, string])[] = [
  ['B','Brasília é a capital federal do Brasil desde 1960.','https://science.nasa.gov/photojournal/brasilia-brazil/'],
  ['D','Marte tem aparência avermelhada devido a minerais ricos em ferro em sua superfície.','https://science.nasa.gov/mars/facts/'],
  ['A','FM significa frequência modulada: a informação é transmitida pela variação da frequência da onda.','https://www.britannica.com/technology/frequency-modulation'],
  ['E','A Mona Lisa é uma pintura de Leonardo da Vinci.','https://collections.louvre.fr/en/ark:/53355/cl010062370'],
  ['C','No voleibol de quadra, cada equipe joga com seis pessoas em quadra.','https://www.fivb.com/volleyball/the-game/'],
  ['B','A República foi proclamada em 15 de novembro de 1889.','https://atom-museurepublica.museus.gov.br/index.php/proclamacao-da-republica'],
  ['A','O videocassete reproduzia e também podia gravar vídeo em fitas VHS.','https://www.britannica.com/technology/videocassette-recorder'],
  ['D','Na fotossíntese, plantas usam gás carbônico e água para produzir açúcares.','https://www.britannica.com/science/photosynthesis'],
  ['E','No piano acústico, martelos acionados pelas teclas percutem as cordas.','https://www.britannica.com/art/piano'],
  ['C','O CD é um disco óptico usado para armazenar áudio digital.','https://www.britannica.com/technology/compact-disc'],
  ['B','A Linha do Equador está na latitude zero e separa os hemisférios Norte e Sul.','https://www.britannica.com/place/Equator'],
  ['A','Tim Berners-Lee apresentou a proposta da Web no CERN em 1989.','https://home.cern/science/computing/birth-web/short-history-web'],
  ['D','Dom Casmurro é um romance de Machado de Assis, publicado em 1899.','https://www.britannica.com/topic/Dom-Casmurro'],
  ['E','Au vem de aurum, nome latino do ouro.','https://www.britannica.com/science/gold-chemical-element'],
  ['C','Crominância é a parte do sinal de vídeo que carrega informação de cor.','https://www.keysight.com/used/gr/en/knowledge/glossary/oscilloscopes/what-is-a-composite-video-signal'],
  ['B','Machu Picchu foi construída pelos incas nos Andes.','https://whc.unesco.org/en/list/274/'],
  ['A','A maior parte do ozônio atmosférico se concentra na estratosfera.','https://www.epa.gov/ozone-layer-protection/basic-ozone-layer-science'],
];

export const questionSetVersion = 'sinapse-1';
export const serverQuestions = questions.map((question, index) => {
  const [correct, explanation, source] = answers[index];
  return { ...question, correct, explanation, source };
});
