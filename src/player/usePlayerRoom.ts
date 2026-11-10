import { useEffect, useRef, useState } from 'react';
import type { Letter } from '../data/questions';
import { validPin } from '../rooms/identity';
import { messageId, openRoomSocket } from '../rooms/socket';

type Session = { pin: string; playerId: string; reconnectToken: string };
type Target = Session | { pin: string; name: string };
type Connection = 'idle' | 'joining' | 'ready' | 'reconnecting' | 'replaced';
type Meta = { revision: number; serverNow: number };
type Open = { questionId: number; deadlineAt: number };
type Result = { outcome: 'Acertou' | 'Errou' | 'Sem resposta'; points: number; rank: number };
type Placement = { myRank: number; myScore: number };
type Snapshot = Meta & (
  | { phase: 'LOBBY' | 'QUESTION_REVEAL' }
  | ({ phase: 'QUESTION_OPEN'; myAnswer: Letter | null } & Open)
  | ({ phase: 'LEADERBOARD' | 'FINAL_PODIUM' } & Placement)
);
type Frame = { v: 1 } & (
  | { type: 'joined'; requestId: string; playerId: string; reconnectToken: string; snapshot: Snapshot }
  | { type: 'resumed'; requestId: string; snapshot: Snapshot }
  | ({ type: 'snapshot' } & Snapshot)
  | ({ type: 'question_open' } & Open & Meta)
  | { type: 'answer_ack'; requestId: string; questionId: number; status: 'accepted' | 'already_answered' }
  | (Meta & { type: 'question_reveal'; correct: Letter; myChoice: Letter | null; myPoints: number; myRank: number })
  | (Meta & Placement & { type: 'leaderboard' | 'final_podium' })
  | { type: 'player_kicked' }
  | { type: 'error'; code: string; requestId?: string }
);
type View = { revision: number } & (
  | { phase: 'LOBBY' }
  | { phase: 'QUESTION_OPEN'; questionId: number; expiresAt: number; answered: boolean }
  | { phase: 'QUESTION_REVEAL'; result?: Result }
  | ({ phase: 'LEADERBOARD' | 'FINAL_PODIUM' } & Placement)
);

const SESSION_KEY = 'sinapse:player';

function savedSession(pin?: string): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Partial<Session> | null;
    if (value && validPin(value.pin) && (!pin || value.pin === pin) &&
      typeof value.playerId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value.playerId) &&
      typeof value.reconnectToken === 'string' && /^[a-f0-9]{64}$/.test(value.reconnectToken)) {
      return { pin: value.pin, playerId: value.playerId, reconnectToken: value.reconnectToken };
    }
  } catch { /* A private browser may block storage. */ }
  return null;
}

function remember(session: Session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* Keep the token in memory. */ }
}

function forget(session: Session | null) {
  if (session && savedSession(session.pin)?.reconnectToken === session.reconnectToken) {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* A private browser may block storage. */ }
  }
}

function questionOpen(frame: Meta & Open, receivedAt: number, answered: boolean): View {
  return { phase: 'QUESTION_OPEN', revision: frame.revision, questionId: frame.questionId,
    expiresAt: receivedAt + Math.max(0, frame.deadlineAt - frame.serverNow), answered };
}

function snapshotView(previous: View | null, frame: Snapshot, receivedAt: number): View | null {
  if (previous && frame.revision < previous.revision) return previous;
  const { phase, revision } = frame;
  switch (phase) {
    case 'QUESTION_OPEN': return questionOpen(frame, receivedAt, frame.myAnswer != null);
    case 'QUESTION_REVEAL': return previous?.phase === phase && previous.revision === revision ? previous : { phase, revision };
    case 'LOBBY': return { phase, revision };
    default: return { phase, revision, myRank: frame.myRank, myScore: frame.myScore };
  }
}

export function usePlayerRoom(initialPin: string) {
  const [target, setTarget] = useState<Target | null>(() => savedSession(initialPin));
  const [connection, setConnection] = useState<Connection>(target ? 'reconnecting' : 'idle');
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const active = useRef<WebSocket | null>(null);
  const currentSession = useRef<Session | null>(target && 'reconnectToken' in target ? target : null);
  const submission = useRef<{ requestId: string; timer: number } | null>(null);
  const acceptedQuestion = useRef<number | null>(null);

  function clearSubmission() {
    if (submission.current) window.clearTimeout(submission.current.timer);
    submission.current = null;
    setPending(false);
  }

  function resetRoom(code = '') {
    forget(currentSession.current);
    currentSession.current = null;
    acceptedQuestion.current = null;
    clearSubmission();
    setConnection('idle');
    setView(null);
    setTarget(null);
    setError(code);
  }

  useEffect(() => {
    if (!target) return;
    const { pin } = target;
    let session = 'reconnectToken' in target ? target : null;
    let joinName = 'name' in target ? target.name : '';
    let disposed = false;
    let paused = false;
    let socket: WebSocket | undefined;
    let retryTimer: number | undefined;
    let authTimer: number | undefined;
    let retryDelay = 500;

    function leave(code: string) {
      disposed = true;
      resetRoom(code);
    }

    function connect() {
      if (disposed) return;
      const ws = openRoomSocket(pin);
      socket = ws;
      active.current = ws;
      const requestId = messageId();
      authTimer = window.setTimeout(() => ws.close(), 8000);
      ws.addEventListener('open', () => {
        if (disposed || active.current !== ws) return;
        const auth = session ? { type: 'player.resume', ...session } : { type: 'player.join', pin, name: joinName };
        ws.send(JSON.stringify({ v: 1, requestId, ...auth }));
      });
      ws.addEventListener('message', event => {
        if (disposed || active.current !== ws || typeof event.data !== 'string') return;
        let frame: Frame;
        try { frame = JSON.parse(event.data); } catch { return; }
        if (frame?.v !== 1) return;
        const now = performance.now();

        if ((frame.type === 'joined' || frame.type === 'resumed') && frame.requestId === requestId) {
          window.clearTimeout(authTimer);
          retryDelay = 500;
          if (frame.type === 'joined') {
            session = { pin, playerId: frame.playerId, reconnectToken: frame.reconnectToken };
            currentSession.current = session;
            remember(session);
            joinName = '';
          }
          clearSubmission();
          acceptedQuestion.current = frame.snapshot.phase === 'QUESTION_OPEN' && frame.snapshot.myAnswer != null ? frame.snapshot.questionId : null;
          setView(previous => snapshotView(previous, frame.snapshot, now));
          setConnection('ready');
        } else if (frame.type === 'player_kicked') {
          leave('KICKED');
        } else if (frame.type === 'error') {
          if (frame.code === 'BAD_TOKEN') leave('ROOM_EXPIRED');
          else if (frame.requestId === requestId && !session) leave(frame.code);
          else if (frame.code === 'RATE_LIMITED') ws.close();
          else if (submission.current && frame.requestId === submission.current.requestId) {
            ws.send(JSON.stringify({ v: 1, type: 'room.sync', requestId: messageId() }));
          }
        } else if (frame.type === 'answer_ack' && frame.requestId === submission.current?.requestId) {
          acceptedQuestion.current = frame.questionId;
          clearSubmission();
          setView(previous => previous?.phase === 'QUESTION_OPEN' && previous.questionId === frame.questionId
            ? { ...previous, answered: true } : previous);
        } else if (frame.type === 'snapshot') {
          clearSubmission();
          acceptedQuestion.current = frame.phase === 'QUESTION_OPEN' && frame.myAnswer != null ? frame.questionId : null;
          setView(previous => snapshotView(previous, frame, now));
        } else if (frame.type === 'question_open' || frame.type === 'question_reveal' || frame.type === 'leaderboard' || frame.type === 'final_podium') {
          clearSubmission();
          setView(previous => {
            if (previous && frame.revision < previous.revision) return previous;
            const { revision } = frame;
            if (frame.type === 'question_open') return questionOpen(frame, now, false);
            if (frame.type === 'question_reveal') {
              const outcome = frame.myChoice === null ? 'Sem resposta' : frame.myChoice === frame.correct ? 'Acertou' : 'Errou';
              return { phase: 'QUESTION_REVEAL', revision, result: { outcome, points: frame.myPoints, rank: frame.myRank } };
            }
            return { phase: frame.type === 'leaderboard' ? 'LEADERBOARD' : 'FINAL_PODIUM', revision,
              myRank: frame.myRank, myScore: frame.myScore };
          });
        }
      });

      ws.addEventListener('close', event => {
        if (disposed || active.current !== ws) return;
        window.clearTimeout(authTimer);
        active.current = null;
        clearSubmission();
        if (event.reason === 'Removed from room') return leave('KICKED');
        if (event.reason === 'Room expired') return leave('ROOM_EXPIRED');
        if (!session) return leave('CONNECTION');
        // Two tabs using the same token must not keep replacing each other.
        if (event.reason === 'Connection replaced') {
          paused = true;
          setConnection('replaced');
          return;
        }
        setConnection('reconnecting');
        if (navigator.onLine) retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 5000);
      });
    }

    function offline() {
      if (!session || paused || disposed) return;
      window.clearTimeout(retryTimer);
      window.clearTimeout(authTimer);
      const previous = socket;
      socket = undefined;
      active.current = null;
      clearSubmission();
      setConnection('reconnecting');
      previous?.close();
    }
    function online() {
      if (paused || (socket && socket.readyState !== WebSocket.CLOSED)) return;
      window.clearTimeout(retryTimer);
      connect();
    }

    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    if (navigator.onLine || !session) retryTimer = window.setTimeout(connect, 0);
    return () => {
      disposed = true;
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.clearTimeout(retryTimer);
      window.clearTimeout(authTimer);
      if (submission.current) window.clearTimeout(submission.current.timer);
      submission.current = null;
      active.current = null;
      socket?.close();
    };
  }, [target]);

  function join(pin: string, name: string) {
    if (connection !== 'idle') return;
    setError('');
    setConnection('joining');
    setTarget({ pin, name });
  }

  function resume() {
    if (!currentSession.current) return;
    setConnection('reconnecting');
    setTarget({ ...currentSession.current });
  }

  function answer(choice: Letter) {
    const ws = active.current;
    if (connection !== 'ready' || ws?.readyState !== WebSocket.OPEN || view?.phase !== 'QUESTION_OPEN' ||
      view.answered || acceptedQuestion.current === view.questionId || view.expiresAt <= performance.now() || submission.current) return;
    const requestId = messageId();
    submission.current = { requestId, timer: window.setTimeout(() => ws.close(), 8000) };
    setPending(true);
    ws.send(JSON.stringify({ v: 1, type: 'player.answer', requestId, questionId: view.questionId, choice }));
  }

  return { connection, view, error, pending, join, resume, answer, resetRoom, clearError: () => setError('') };
}
