import { useCallback, useEffect, useRef, useState } from 'react';
import { questions, type Letter } from './data/questions';
import { scoring } from './data/scoring';
import { sound } from './audio/sound';
import { clearProgress, saveProgress, type ProgressState, type SavedFeedback } from './storage/progress';

export type Mode = 'solo' | 'multi';
type Screen = 'opening' | 'menu' | 'setup' | 'game' | 'end';
type Grade = { type: 'answer_ack'; matched: false } | { type: 'question_reveal'; matched: boolean; correct: Letter; explanation: string };
const letters: Letter[] = ['A', 'B', 'C', 'D', 'E'];

export function useGame() {
  const [screen, setScreen] = useState<Screen>('opening');
  const [mode, setMode] = useState<Mode>('solo');
  const [names, setNames] = useState(['Jogador 1', 'Jogador 2']);
  const [index, setIndex] = useState(0);
  const [scores, setScores] = useState([0, 0]);
  const [locked, setLocked] = useState([false, false]);
  const [selection, setSelection] = useState<Letter | null>(null);
  const [feedback, setFeedback] = useState<SavedFeedback | null>(null);
  const [time, setTime] = useState(30);
  const [muted, setMuted] = useState(true);
  const [gradingError, setGradingError] = useState('');
  const deadline = useRef(0);
  const round = useRef(0);
  const finished = useRef(false);
  const lockedNow = useRef([false, false]);
  const pending = useRef(new Set<number | null>());
  const queue = useRef(Promise.resolve());
  const lastTimeoutAttempt = useRef(-Infinity);

  const resetRound = useCallback((remainingMs = 30_000, locks = [false, false], result: SavedFeedback | null = null) => {
    round.current++;
    queue.current = Promise.resolve();
    pending.current = new Set();
    deadline.current = Date.now() + remainingMs;
    lastTimeoutAttempt.current = -Infinity;
    finished.current = result !== null;
    lockedNow.current = locks;
    setLocked(locks);
    setTime(Math.ceil(remainingMs / 1000));
    setFeedback(result);
    setGradingError('');
  }, []);

  const start = useCallback(() => {
    clearProgress(mode);
    setIndex(0);
    setScores([0, 0]);
    setSelection(null);
    resetRound();
    setScreen('game');
  }, [mode, resetRound]);

  const resolve = useCallback((player: number | null, letter: Letter | null, remaining: number) => {
    if (finished.current || pending.current.has(player)) return;
    const currentRound = round.current;
    const inFlight = pending.current;
    inFlight.add(player);
    queue.current = queue.current.then(async () => {
      if (currentRound !== round.current || finished.current || (player !== null && lockedNow.current[player])) return;
      const revealOnMiss = mode === 'solo' || player === null || lockedNow.current[1 - player];
      const response = await fetch('/api/local/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: questions[index].id, choice: letter, revealOnMiss }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Grading request failed');
      const result: Grade = await response.json();
      if (currentRound !== round.current) return;
      setGradingError('');
      if (result.type === 'answer_ack' && player !== null) {
        sound('wrong', !muted);
        const next = [...lockedNow.current];
        next[player] = true;
        lockedNow.current = next;
        setLocked(next);
        return;
      }
      if (result.type !== 'question_reveal') throw new Error('Missing reveal');
      finished.current = true;
      setTime(Math.max(0, Math.ceil(remaining)));
      const won = result.matched && player !== null;
      sound(won ? 'correct' : 'wrong', !muted);
      if (won) setScores(previous => {
        const next = [...previous];
        next[player] = mode === 'solo' ? scoring[index] : next[player] + scoring[index] + Math.ceil(remaining) * 10;
        return next;
      });
      const message = won ? (mode === 'solo' ? 'Resposta certa!' : `${names[player]} respondeu primeiro!`)
        : player === null ? 'O tempo acabou!' : mode === 'solo' ? 'Não foi dessa vez!' : 'Ninguém pontuou nesta rodada.';
      setFeedback({ winner: won ? player : null, selected: letter, message, correct: result.correct, explanation: result.explanation });
    }).catch(() => {
      if (currentRound !== round.current) return;
      if (mode === 'multi') {
        setGradingError('A correção está indisponível. Tentando novamente ao fim do tempo.');
      } else if (player === null) {
        finished.current = true;
        setTime(0);
        sound('wrong', !muted);
        setFeedback({ winner: null, selected: null, message: 'O tempo acabou!' });
      }
    }).finally(() => { inFlight.delete(player); });
  }, [index, mode, muted, names]);

  useEffect(() => {
    if (screen !== 'game' || feedback) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const left = Math.max(0, Math.ceil((deadline.current - now) / 1000));
      setTime(old => {
        if (left !== old && left <= 10 && left > 0) sound('tick', !muted);
        return left;
      });
      if (left === 0 && pending.current.size === 0 && now - lastTimeoutAttempt.current >= 1000) {
        lastTimeoutAttempt.current = now;
        resolve(null, null, 0);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [screen, feedback, resolve, muted]);

  const answer = useCallback((player: number, letter: Letter) => {
    if (screen !== 'game' || finished.current || lockedNow.current[player]) return;
    const left = (deadline.current - Date.now()) / 1000;
    if (left <= 0) return;
    if (mode === 'solo') setSelection(letter);
    else resolve(player, letter, left);
  }, [screen, mode, resolve]);

  const confirm = useCallback(() => {
    const left = (deadline.current - Date.now()) / 1000;
    if (selection && left > 0) resolve(0, selection, left);
  }, [selection, resolve]);

  const next = useCallback(() => {
    if (!feedback) return;
    if ((mode === 'solo' && feedback.winner === null) || index === questions.length - 1) {
      clearProgress(mode);
      setScreen('end');
      return;
    }
    setIndex(previous => previous + 1);
    setSelection(null);
    resetRound();
  }, [feedback, index, mode, resetRound]);

  const resume = useCallback((saved: ProgressState) => {
    setMode(saved.mode);
    setNames([...saved.names]);
    setIndex(saved.questionIndex);
    setScores([...saved.scores]);
    setSelection(saved.selection);
    const result = saved.feedback && { ...saved.feedback };
    if (result && !result.correct && result.winner !== null && result.selected) result.correct = result.selected;
    resetRound(saved.remainingMs, [...saved.locked], result);
    setScreen('game');
  }, [resetRound]);

  const latest = useRef<ProgressState | null>(null);
  latest.current = screen === 'game' ? {
    mode, names: [names[0], names[1]], questionIndex: index, scores: [scores[0], scores[1]],
    safetyReached: mode === 'solo' && scores[0] >= scoring[9] ? 10 : mode === 'solo' && scores[0] >= scoring[4] ? 5 : 0,
    phase: feedback ? 'feedback' : 'answering', selection, locked: [locked[0], locked[1]], feedback,
    remainingMs: feedback ? time * 1000 : Math.max(0, Math.min(30_000, deadline.current - Date.now())),
  } : null;
  useEffect(() => {
    if (latest.current) saveProgress(mode, latest.current);
  }, [screen, mode, names, index, scores, locked, selection, feedback, time]);
  useEffect(() => {
    const flush = () => {
      const current = latest.current;
      if (!current) return;
      const remainingMs = current.phase === 'answering' ? Math.max(0, Math.min(30_000, deadline.current - Date.now())) : current.remainingMs;
      saveProgress(current.mode, { ...current, remainingMs });
    };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (screen !== 'game' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if ((event.target as HTMLElement)?.tagName === 'BUTTON' && (event.key === 'Enter' || event.key === ' ')) return;
      const key = event.key.toUpperCase();
      if (key === 'ENTER') {
        event.preventDefault();
        if (feedback) next();
        else if (mode === 'solo') confirm();
        return;
      }
      if (key.length !== 1) return;
      if (mode === 'solo') {
        const i = 'ABCDE'.includes(key) ? 'ABCDE'.indexOf(key) : '12345'.indexOf(key);
        if (i >= 0) answer(0, letters[i]);
      } else {
        const first = 'QWERT'.indexOf(key);
        const second = 'YUIOP'.indexOf(key);
        if (first >= 0) answer(0, letters[first]);
        else if (second >= 0) answer(1, letters[second]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, feedback, mode, answer, confirm, next]);

  return { screen, setScreen, mode, setMode, names, setNames, index, scores, locked, selection, feedback, time,
    muted, setMuted, gradingError, start, resume, answer, confirm, next };
}
