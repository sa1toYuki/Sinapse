import { questions, type Letter } from '../data/questions';

export type GameMode = 'solo' | 'multi';
export type SavedFeedback = { winner: number | null; selected: Letter | null; message: string; correct?: Letter; explanation?: string };
export type ProgressState = {
  mode: GameMode;
  names: [string, string];
  questionIndex: number;
  scores: [number, number];
  safetyReached: 0 | 5 | 10;
  phase: 'answering' | 'feedback';
  selection: Letter | null;
  locked: [boolean, boolean];
  feedback: SavedFeedback | null;
  remainingMs: number;
};
type SaveFile = ProgressState & { version: number; questionBank: string };
const VERSION = 1;
const key = (mode: GameMode) => `sinapse:save:${mode}`;
// The signature follows the public question set.
function signature(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export const QUESTION_BANK = signature(JSON.stringify(questions));
const isLetter = (x: unknown): x is Letter | null => x === null || (typeof x === 'string' && ['A','B','C','D','E'].includes(x));
function valid(value: unknown, mode: GameMode): value is SaveFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  if (s.version !== VERSION || s.questionBank !== QUESTION_BANK || s.mode !== mode) return false;
  if (!Array.isArray(s.names) || s.names.length !== 2 || !s.names.every(n => typeof n === 'string' && n.length > 0 && n.length <= 20)) return false;
  if (!Number.isInteger(s.questionIndex) || (s.questionIndex as number) < 0 || (s.questionIndex as number) >= questions.length) return false;
  if (!Array.isArray(s.scores) || s.scores.length !== 2 || !s.scores.every(n => Number.isSafeInteger(n) && n >= 0)) return false;
  if (![0,5,10].includes(s.safetyReached as number) || !Array.isArray(s.locked) || s.locked.length !== 2 || !s.locked.every(n => typeof n === 'boolean')) return false;
  if (!isLetter(s.selection) || typeof s.remainingMs !== 'number' || !Number.isFinite(s.remainingMs) || s.remainingMs < 0 || s.remainingMs > 30000) return false;
  if (s.phase === 'answering') return s.feedback === null && !(mode === 'multi' && s.locked.every(Boolean));
  if (s.phase !== 'feedback' || !s.feedback || typeof s.feedback !== 'object' || Array.isArray(s.feedback)) return false;
  const f = s.feedback as Record<string, unknown>;
  return (f.winner === null || f.winner === 0 || (mode === 'multi' && f.winner === 1)) && isLetter(f.selected) && typeof f.message === 'string' && f.message.length > 0 && f.message.length <= 100 &&
    (f.correct === undefined || (f.correct !== null && isLetter(f.correct))) &&
    (f.explanation === undefined || (typeof f.explanation === 'string' && f.explanation.length <= 500));
}
export function saveProgress(mode: GameMode, state: ProgressState): void {
  try { const data: SaveFile = { ...state, version: VERSION, questionBank: QUESTION_BANK }; if (valid(data, mode)) localStorage.setItem(key(mode), JSON.stringify(data)); } catch { /* Storage is optional. */ }
}
export function loadProgress(mode: GameMode): ProgressState | null {
  try { const raw = localStorage.getItem(key(mode)); if (raw === null) return null; let value: unknown; try { value = JSON.parse(raw); } catch { clearProgress(mode); return null; } if (!valid(value, mode)) { clearProgress(mode); return null; } const { version: _version, questionBank: _questionBank, ...state } = value; return state; } catch { return null; }
}
export function clearProgress(mode: GameMode): void { try { localStorage.removeItem(key(mode)); } catch { /* Storage is optional. */ } }
export function hasProgress(mode: GameMode): boolean { return loadProgress(mode) !== null; }
