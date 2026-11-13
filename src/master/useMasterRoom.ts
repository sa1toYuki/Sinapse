import { useEffect, useRef, useState } from 'react';
import type { Letter } from '../data/questions';
import { messageId, openRoomSocket } from '../rooms/socket';

type Credentials = { pin: string; masterToken: string };
type Meta = { revision: number; serverNow: number };
type Player = { playerId: string; name: string; connected: boolean };
export type Entry = { playerId: string; name: string; rank: number; score: number };
type Count = { answeredCount: number; eligibleCount: number };
type Question = { questionId: number; text: string; options: Record<Letter, string> };
type Open = Question & Count & { deadlineAt: number };
type Reveal = { questionId: number; correct: Letter; counts: Record<Letter, number> };

type Snapshot = Meta & { questionIndex: number } & (
  | { phase: 'LOBBY'; players: Player[] }
  | ({ phase: 'QUESTION_OPEN' } & Open)
  | { phase: 'QUESTION_REVEAL'; questionId: number }
  | { phase: 'LEADERBOARD'; entries: Entry[] }
  | { phase: 'FINAL_PODIUM'; rankingId: string; persisted: boolean }
);

type Frame = { v: 1 } & (
  | { type: 'resumed'; requestId: string; snapshot: Snapshot }
  | ({ type: 'snapshot' } & Snapshot)
  | (Meta & { type: 'lobby_update'; players: Player[] })
  | (Meta & Open & { type: 'question_open'; questionIndex: number })
  | (Meta & Count & { type: 'answer_count'; questionId: number })
  | (Meta & Reveal & { type: 'question_reveal' })
  | (Meta & { type: 'leaderboard'; entries: Entry[] })
  | (Meta & { type: 'final_podium'; rankingId: string; persisted: boolean })
  | (Meta & { type: 'persistence_status'; persisted: boolean })
  | { type: 'command_ack'; requestId: string }
  | { type: 'error'; requestId?: string; code: string }
);

type View = { revision: number; questionIndex: number } & (
  | { phase: 'LOBBY'; players: Player[] }
  | ({ phase: 'QUESTION_OPEN'; expiresAt: number } & Question & Count)
  | { phase: 'QUESTION_REVEAL'; questionId: number; reveal?: Reveal; question?: Question }
  | { phase: 'LEADERBOARD'; entries: Entry[] }
  | { phase: 'FINAL_PODIUM'; rankingId: string; persisted: boolean }
);

export type MasterCommand = 'master.start' | 'master.end_question' | 'master.next';
const STORAGE_KEY = 'sinapse:master';

function validCredentials(value: unknown): value is Credentials {
  if (!value || typeof value !== 'object') return false;
  const { pin, masterToken } = value as Partial<Credentials>;
  return typeof pin === 'string' && /^[0-9]{6}$/.test(pin) && typeof masterToken === 'string' && /^[a-f0-9]{64}$/.test(masterToken);
}

function loadCredentials(): Credentials | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    return validCredentials(value) ? value : null;
  } catch { return null; }
}

function storeCredentials(credentials: Credentials | null) {
  try {
    if (credentials) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* The room also works without browser storage. */ }
}

function openQuestion(message: Meta & Open & { questionIndex: number }, receivedAt: number): View {
  const { revision, questionIndex, questionId, text, options, deadlineAt, serverNow, answeredCount, eligibleCount } = message;
  return { phase: 'QUESTION_OPEN', revision, questionIndex, questionId, text, options, answeredCount, eligibleCount,
    expiresAt: receivedAt + Math.max(0, deadlineAt - serverNow) };
}

function applySnapshot(previous: View | null, snapshot: Snapshot, receivedAt: number): View | null {
  if (previous && snapshot.revision < previous.revision) return previous;
  const { phase, revision, questionIndex } = snapshot;
  switch (phase) {
    case 'QUESTION_OPEN': return openQuestion(snapshot, receivedAt);
    case 'LOBBY': return { phase, revision, questionIndex, players: snapshot.players };
    case 'QUESTION_REVEAL':
      if (previous?.phase === phase && previous.revision === revision) return previous;
      return { phase, revision, questionIndex, questionId: snapshot.questionId,
        question: previous?.phase === 'QUESTION_OPEN' && previous.questionId === snapshot.questionId ? previous : undefined };
    case 'LEADERBOARD': return { phase, revision, questionIndex, entries: snapshot.entries };
    case 'FINAL_PODIUM': return { phase, revision, questionIndex, rankingId: snapshot.rankingId, persisted: snapshot.persisted };
  }
}

function applyEvent(view: View | null, message: Exclude<Frame, { type: 'resumed' | 'snapshot' | 'error' | 'command_ack' }>, receivedAt: number): View | null {
  if (!view || message.revision < view.revision) return view;
  const { revision } = message;
  const questionIndex = view.questionIndex;
  switch (message.type) {
    case 'lobby_update': return view.phase === 'LOBBY' ? { ...view, players: message.players } : view;
    case 'question_open': return openQuestion(message, receivedAt);
    case 'answer_count':
      return view.phase === 'QUESTION_OPEN' && view.revision === revision && view.questionId === message.questionId
        ? { ...view, answeredCount: message.answeredCount, eligibleCount: message.eligibleCount } : view;
    case 'question_reveal': {
      const { questionId, correct, counts } = message;
      const question = view.questionIndex > 0 && 'questionId' in view && view.questionId === questionId
        ? view.phase === 'QUESTION_OPEN' ? view : view.question : undefined;
      return { phase: 'QUESTION_REVEAL', revision, questionIndex, questionId, question, reveal: { questionId, correct, counts } };
    }
    case 'leaderboard': return { phase: 'LEADERBOARD', revision, questionIndex, entries: message.entries };
    case 'final_podium': return { phase: 'FINAL_PODIUM', revision, questionIndex, rankingId: message.rankingId, persisted: message.persisted };
    case 'persistence_status':
      return view.phase === 'FINAL_PODIUM' && view.revision === revision && message.persisted ? { ...view, persisted: true } : view;
    default: return view;
  }
}

export function useMasterRoom() {
  const [credentials, setCredentials] = useState(loadCredentials);
  const [view, setView] = useState<View | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'ready' | 'reconnecting' | 'paused'>('connecting');
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<WebSocket | null>(null);
  const command = useRef<{ requestId: string; timer: number } | null>(null);

  function clearCommand() {
    if (command.current) window.clearTimeout(command.current.timer);
    command.current = null;
    setPending(false);
  }

  useEffect(() => {
    if (!credentials) return;
    const { pin, masterToken } = credentials;
    let disposed = false;
    let reconnectTimer: number;
    let connectTimer: number;
    let delay = 500;
    let socket: WebSocket;

    function forgetRoom() {
      storeCredentials(null);
      setCredentials(null);
      setView(null);
      setError('Sala encerrada.');
    }

    function connect() {
      if (disposed) return;
      const ws = openRoomSocket(pin);
      socket = ws;
      active.current = ws;
      const requestId = messageId();
      connectTimer = window.setTimeout(() => ws.close(), 8000);
      ws.addEventListener('open', () => {
        if (!disposed) ws.send(JSON.stringify({ v: 1, type: 'master.resume', requestId, pin, masterToken }));
      });
      ws.addEventListener('message', (event) => {
        if (disposed || active.current !== ws || typeof event.data !== 'string') return;
        let message: Frame;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message?.v !== 1) return;
        const receivedAt = performance.now();

        if (message.type === 'resumed' && message.requestId === requestId) {
          window.clearTimeout(connectTimer);
          delay = 500;
          setConnection('ready');
          setError('');
          setView(previous => applySnapshot(previous, message.snapshot, receivedAt));
        } else if (message.type === 'error') {
          if (message.requestId === requestId && message.code === 'BAD_TOKEN') {
            forgetRoom();
          } else if (message.requestId === command.current?.requestId && command.current) {
            clearCommand();
            if (message.code === 'WRONG_PHASE') ws.send(JSON.stringify({ v: 1, type: 'room.sync', requestId: messageId() }));
            else setError('Ação indisponível.');
          }
        } else if (message.type === 'command_ack') {
          if (message.requestId === command.current?.requestId) clearCommand();
        } else if (message.type === 'snapshot') {
          setView(previous => applySnapshot(previous, message, receivedAt));
        } else if (message.type !== 'resumed') {
          setView(previous => applyEvent(previous, message, receivedAt));
        }
      });
      ws.addEventListener('close', (event) => {
        if (disposed) return;
        window.clearTimeout(connectTimer);
        active.current = null;
        clearCommand();
        if (event.reason === 'Room expired') return forgetRoom();
        if (event.reason === 'Connection replaced') {
          setConnection('paused');
          return;
        }
        setConnection('reconnecting');
        reconnectTimer = window.setTimeout(connect, delay);
        delay = Math.min(delay * 2, 5000);
      });
    }

    // Deferring the first connection avoids a duplicate upgrade in StrictMode.
    reconnectTimer = window.setTimeout(connect, 0);
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(connectTimer);
      if (command.current) window.clearTimeout(command.current.timer);
      command.current = null;
      active.current = null;
      socket?.close();
    };
  }, [credentials, attempt]);

  async function create() {
    if (creating) return;
    setCreating(true);
    setError('');
    let status: number | null = null;
    let code = 'NETWORK_ERROR';
    try {
      const response = await fetch('/api/rooms', { method: 'POST', signal: AbortSignal.timeout(8000) });
      status = response.status;
      code = response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR';
      const room: unknown = await response.json().catch(() => null);
      if (!response.ok || !validCredentials(room)) {
        if (room && typeof room === 'object' && 'code' in room && typeof room.code === 'string') code = room.code;
        throw new Error('Room creation failed');
      }
      storeCredentials(room);
      clearCommand();
      setView(null);
      setConnection('connecting');
      setCredentials(room);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'TimeoutError') code = 'TIMEOUT';
      console.error('Falha ao criar sala.', { status, code });
      setError('Falha ao criar sala.');
    }
    finally { setCreating(false); }
  }

  function send(type: MasterCommand | 'master.kick', playerId?: string) {
    const socket = active.current;
    if (connection !== 'ready' || socket?.readyState !== WebSocket.OPEN || command.current) return;
    const requestId = messageId();
    setError('');
    setPending(true);
    command.current = { requestId, timer: window.setTimeout(() => socket.close(), 8000) };
    socket.send(JSON.stringify({ v: 1, type, requestId, commandId: messageId(), playerId }));
  }

  function resume() {
    setConnection('connecting');
    setAttempt(value => value + 1);
  }

  return { pin: credentials?.pin, view, connection, creating, pending, error, create, send, resume };
}
