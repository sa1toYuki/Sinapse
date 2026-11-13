export type Letter = 'A' | 'B' | 'C' | 'D' | 'E';
export type Question = { id: number; level: 1 | 2 | 3 | 4; category: string; text: string; options: Record<Letter, string> };

function make(id: number, level: Question['level'], category: string, text: string, [A, B, C, D, E]: [string, string, string, string, string]): Question {
  return { id, level, category, text, options: { A, B, C, D, E } };
}

export const questions = [
  make(1, 1, "Rádio e TV", "O famoso \"plim-plim\" é o som que identifica qual emissora de TV brasileira?", ["SBT","Record","Band","Globo","Manchete"]),
  make(2, 1, "Rádio e TV", "O \"Show do Milhão\", que inspira este jogo, foi exibido por qual emissora?", ["SBT","Globo","Record","Band","Manchete"]),
  make(3, 1, "Rádio e TV", "Qual apresentador ficou famoso pelo bordão \"Alô, alô, Terezinha!\"?", ["Silvio Santos","Flávio Cavalcanti","Chacrinha","Raul Gil","Faustão"]),
  make(4, 1, "Rádio e TV", "No rádio, o que significa a sigla FM?", ["Faixa Média","Frequência Modulada","Fonte Móvel","Frequência Mista","Faixa Mundial"]),
  make(5, 1, "Rádio e TV", "Qual foi a primeira emissora de televisão do Brasil, inaugurada em 1950?", ["TV Globo","TV Excelsior","TV Record","TV Cultura","TV Tupi"]),
  make(6, 2, "Rádio e TV", "Em que ano estreou o Jornal Nacional, da TV Globo?", ["1965","1969","1972","1975","1980"]),
  make(7, 2, "Rádio e TV", "Qual noticiário de rádio, tradicionalmente associado às 19h, é o programa radiofônico mais antigo ainda no ar no Brasil?", ["Repórter Esso","Show da Manhã","Brasil Urgente","A Voz do Brasil","Hora do Esporte"]),
  make(8, 2, "Rádio e TV", "Quem fundou a TV Globo, em 1965?", ["Roberto Marinho","Assis Chateaubriand","Silvio Santos","Adolpho Bloch","Paulo Machado de Carvalho"]),
  make(9, 2, "Rádio e TV", "Qual emissora de TV foi fundada em 1983 pelo empresário Adolpho Bloch?", ["SBT","Band","TV Manchete","Record","CNT"]),
  make(10, 2, "Rádio e TV", "Em 1938, qual transmissão de rádio de Orson Welles ficou famosa por simular uma invasão alienígena e assustar parte dos ouvintes nos EUA?", ["Os Invasores de Marte","Noite de Terror","O Dia em que a Terra Parou","Contatos Imediatos","A Guerra dos Mundos"]),
  make(11, 3, "Rádio e TV", "Qual inventor escocês fez, em 1926, a primeira demonstração pública de televisão?", ["John Logie Baird","Philo Farnsworth","Vladimir Zworykin","Nikola Tesla","Guglielmo Marconi"]),
  make(12, 3, "Rádio e TV", "Qual noticiário, estreado em 1941 na Rádio Nacional, usava o slogan \"testemunha ocular da história\"?", ["Jornal do Brasil","Repórter Esso","Telejornal Tupi","Hora do Brasil","Fantástico"]),
  make(13, 3, "Rádio e TV", "Em que ano a Festa da Uva, em Caxias do Sul, marcou a estreia das transmissões de TV em cores em rede nacional?", ["1962","1967","1972","1978","1985"]),
  make(14, 3, "Rádio e TV", "Qual é o nome do padrão de TV em cores adotado no Brasil, derivado do PAL?", ["NTSC","SECAM","ATSC","ISDB-T","PAL-M"]),
  make(15, 3, "Rádio e TV", "Qual foi a primeira telenovela diária do Brasil, exibida pela TV Excelsior em 1963?", ["2-5499 Ocupado","Beto Rockfeller","O Direito de Nascer","Irmãos Coragem","Selva de Pedra"]),
  make(16, 4, "Rádio e TV", "Quem fundou, com Henrique Morize, a Rádio Sociedade do Rio de Janeiro em 1923?", ["Assis Chateaubriand","Getúlio Vargas","Edgard Roquette-Pinto","Ary Barroso","Oswaldo Cruz"]),
  make(17, 4, "Rádio e TV", "Qual foi o primeiro telejornal da televisão brasileira, exibido pela TV Tupi em 1950?", ["Edição Extra","Repórter Esso","Jornal de Vanguarda","Telejornal Tupi","Imagens do Dia"]),
];
