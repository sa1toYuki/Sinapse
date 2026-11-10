export type Letter = 'A' | 'B' | 'C' | 'D' | 'E';
export type Question = { id: number; level: 1 | 2 | 3 | 4; category: string; text: string; options: Record<Letter, string> };

function make(id: number, level: Question['level'], category: string, text: string, [A, B, C, D, E]: [string, string, string, string, string]): Question {
  return { id, level, category, text, options: { A, B, C, D, E } };
}

export const questions = [
  make(1,1,'Geografia','Qual é a capital do Brasil?',['Rio de Janeiro','Brasília','São Paulo','Salvador','Belo Horizonte']),
  make(2,1,'Ciência','Qual planeta é conhecido como Planeta Vermelho?',['Vênus','Júpiter','Mercúrio','Marte','Netuno']),
  make(3,1,'Rádio e TV','Em um rádio, o que as letras FM significam?',['Frequência modulada','Faixa musical','Frequência média','Formato musical','Faixa multiplex']),
  make(4,1,'Arte','Quem pintou a Mona Lisa?',['Vincent van Gogh','Tarsila do Amaral','Pablo Picasso','Claude Monet','Leonardo da Vinci']),
  make(5,1,'Esportes','Quantos jogadores de cada equipe ficam em quadra no voleibol de quadra?',['Cinco','Sete','Seis','Onze','Quatro']),
  make(6,2,'História','Em que ano foi proclamada a República no Brasil?',['1822','1889','1500','1922','1964']),
  make(7,2,'Rádio e TV','Qual aparelho era usado para reproduzir fitas VHS?',['Videocassete','Vitrola','Projetor de slides','Toca-discos','Rádio de pilha']),
  make(8,2,'Ciência','Qual gás as plantas absorvem da atmosfera na fotossíntese?',['Oxigênio','Hélio','Hidrogênio','Gás carbônico','Neônio']),
  make(9,2,'Cultura','Qual destes instrumentos possui teclas, pedais e cordas percutidas por martelos?',['Flauta','Violino','Tamborim','Trompete','Piano']),
  make(10,2,'Tecnologia','Qual mídia óptica era usada para ouvir álbuns de música nos anos 1990?',['Disquete','Fita cassete','CD','Cartucho','Fita VHS']),
  make(11,3,'Geografia','Qual linha imaginária divide a Terra em hemisférios Norte e Sul?',['Trópico de Capricórnio','Linha do Equador','Meridiano de Greenwich','Círculo Polar Ártico','Trópico de Câncer']),
  make(12,3,'Tecnologia','Quem propôs a World Wide Web no CERN em 1989?',['Tim Berners-Lee','Alan Turing','Ada Lovelace','Steve Jobs','Bill Gates']),
  make(13,3,'Literatura','Quem escreveu o romance Dom Casmurro?',['Clarice Lispector','José de Alencar','Graciliano Ramos','Machado de Assis','Jorge Amado']),
  make(14,3,'Ciência','Qual é o símbolo químico do elemento ouro?',['Ag','Fe','O','Hg','Au']),
  make(15,4,'Rádio e TV','Em uma transmissão analógica de TV em cores, o que a crominância representa?',['O volume do som','A nitidez do áudio','A informação de cor','A velocidade da fita','A duração do programa']),
  make(16,4,'História','Qual civilização construiu a cidade de Machu Picchu?',['Romana','Inca','Egípcia','Grega','Fenícia']),
  make(17,4,'Ciência','Qual camada da atmosfera contém a maior parte da camada de ozônio?',['Estratosfera','Troposfera','Termosfera','Exosfera','Mesosfera']),
];
