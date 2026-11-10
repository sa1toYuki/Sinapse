import { describe, expect, it } from 'vitest';
import { QUESTION_MS, scoreAnswer, shouldClose, transition, type Round } from '../worker/rules';

const lobby: Round = { phase: 'LOBBY', questionIndex: 0, openedAt: null, deadlineAt: null, revision: 0 };

describe('pontuação da partida', () => {
  it('premia acertos por velocidade, arredonda uma vez e limita o tempo', () => {
    expect(scoreAnswer('A', 'A', -1)).toEqual({ points: 1000, responseTimeMs: 0 });
    expect(scoreAnswer('A', 'A', 15_000)).toEqual({ points: 750, responseTimeMs: 15_000 });
    expect(scoreAnswer('A', 'A', 30_001)).toEqual({ points: 500, responseTimeMs: 30_000 });
    expect(scoreAnswer('A', 'A', 31).points).toBe(999);
  });

  it('dá zero por erro ou ausência e registra o tempo para desempate', () => {
    expect(scoreAnswer('A', 'E', 450)).toEqual({ points: 0, responseTimeMs: 450 });
    expect(scoreAnswer('A', null, 10)).toEqual({ points: 0, responseTimeMs: QUESTION_MS });
  });
});

describe('fases', () => {
  it('valida fase, mantém prazo de 30 s e termina na 17ª pergunta', () => {
    expect(transition(lobby, 'master.start', 100, 0, 17)).toBeNull();
    expect(transition(lobby, 'master.next', 100, 1, 17)).toBeNull();
    let round = transition(lobby, 'master.start', 100, 1, 17)!;
    for (let questionIndex = 1; questionIndex <= 17; questionIndex++) {
      expect(round).toMatchObject({ phase: 'QUESTION_OPEN', questionIndex, openedAt: 100, deadlineAt: 30_100, revision: questionIndex * 3 - 2 });
      expect(transition(round, 'master.next', 100, 1, 17)).toBeNull();
      round = transition(round, 'master.end_question', 100, 1, 17)!;
      expect(round.phase).toBe('QUESTION_REVEAL');
      round = transition(round, 'master.show_leaderboard', 100, 1, 17)!;
      expect(round.phase).toBe('LEADERBOARD');
      round = transition(round, 'master.next', 100, 1, 17)!;
    }
    expect(round).toMatchObject({ phase: 'FINAL_PODIUM', questionIndex: 17, revision: 52 });
    expect(transition(round, 'master.next', 100, 1, 17)).toBeNull();
  });

  it('fecha no instante limite ou quando todos os conectados responderam', () => {
    const open = transition(lobby, 'master.start', 100, 1, 17)!;
    expect(shouldClose(open, 30_099, 0, 0)).toBe(false);
    expect(shouldClose(open, 30_100, 0, 0)).toBe(true);
    expect(shouldClose(open, 101, 2, 1)).toBe(false);
    expect(shouldClose(open, 101, 1, 1)).toBe(true);
  });
});
