import type { Letter } from '../src/data/questions';

export const QUESTION_MS = 30_000;
export const REVEAL_MS = 3_000;
export const MAX_PLAYERS = 150;

export type Phase = 'LOBBY' | 'QUESTION_OPEN' | 'QUESTION_REVEAL' | 'LEADERBOARD' | 'FINAL_PODIUM';
export type MasterAction = 'master.start' | 'master.end_question' | 'master.next';
export type PhaseAction = MasterAction | 'close' | 'reveal_elapsed';
export type Round = { phase: Phase; questionIndex: number; openedAt: number | null; deadlineAt: number | null; revision: number };

export function transition(round: Round, action: PhaseAction, now: number, players: number, questions: number): Round | null {
  const revision = round.revision + 1;
  const open = (questionIndex: number): Round => ({ phase: 'QUESTION_OPEN', questionIndex, openedAt: now, deadlineAt: now + QUESTION_MS, revision });

  if (round.phase === 'LOBBY' && action === 'master.start' && players > 0) return open(1);
  if (round.phase === 'QUESTION_OPEN' && (action === 'close' || action === 'master.end_question')) {
    return { ...round, phase: 'QUESTION_REVEAL', revision };
  }
  if (round.phase === 'QUESTION_REVEAL' && action === 'reveal_elapsed') return { ...round, phase: 'LEADERBOARD', revision };
  if (round.phase === 'LEADERBOARD' && action === 'master.next') {
    return round.questionIndex === questions ? { ...round, phase: 'FINAL_PODIUM', revision } : open(round.questionIndex + 1);
  }
  return null;
}

export function shouldClose(round: Round, now: number, eligible: number, answered: number): boolean {
  return round.phase === 'QUESTION_OPEN' && (now >= round.deadlineAt! || (eligible > 0 && answered === eligible));
}

export function scoreAnswer(correct: Letter, choice: Letter | null, elapsedMs = QUESTION_MS) {
  const responseTimeMs = choice === null ? QUESTION_MS : Math.max(0, Math.min(elapsedMs, QUESTION_MS));
  const points = correct === choice ? Math.round(1000 * (1 - responseTimeMs / (2 * QUESTION_MS))) : 0;
  return { points, responseTimeMs };
}
