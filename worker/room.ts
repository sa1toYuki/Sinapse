import { DurableObject } from 'cloudflare:workers';
import type { Letter } from '../src/data/questions';
import { choices, letters, newToken, parseMessage, sameHash, tokenHash, validPin, type Message } from './protocol';
import { questionSetVersion, serverQuestions } from './questions.server';
import { rankingId } from './ranking';
import { MAX_PLAYERS, scoreAnswer, shouldClose, transition, type Round } from './rules';
import type { Env } from './index';

type RoomState = Round & { gameId: string; pin: string; masterHash: string; startedAt: number | null; finishedAt: number | null; persisted: boolean };
type Player = { id: string; name: string; tokenHash: string; joined: number; score: number; responseTimeMs: number; lastPoints: number };
type Answer = { choice: Letter; acceptedAt: number };
type Peer = { pin: string; openedAt: number; gameId?: string; role?: 'MASTER' | 'PLAYER'; playerId?: string };
type AlarmKind = 'deadline' | 'cleanup' | 'd1';
type AlarmJob = { kind: AlarmKind; due: number; attempts: number };
type Bucket = { remaining: number; updatedAt: number };
type Payload = Record<string, unknown>;

const IDLE_MS = 30 * 60_000;
const RETAIN_MS = 15 * 60_000;
const AUTH_GRACE_MS = 15_000;
const COUNT_MS = 250;
const questionCount = serverQuestions.length;

function take(bucket: Bucket, now: number, capacity: number, perSecond: number) {
  bucket.remaining = Math.min(capacity, bucket.remaining + Math.max(0, now - bucket.updatedAt) * perSecond / 1000);
  bucket.updatedAt = now;
  if (bucket.remaining < 1) return false;
  bucket.remaining--;
  return true;
}

export class Room extends DurableObject<Env> {
  private readonly storage = this.ctx.storage;
  private readonly sql = this.storage.sql;
  private readonly socketRates = new WeakMap<WebSocket, Bucket>();
  private readonly roomRate: Bucket = { remaining: 1000, updatedAt: Date.now() };
  private readonly upgradeRate: Bucket = { remaining: 400, updatedAt: Date.now() };
  private countTimer?: ReturnType<typeof setTimeout>;
  private scheduledAt?: number;
  private lastCountAt = -Infinity;
  private lastCount = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        joined INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, nameKey TEXT NOT NULL UNIQUE,
        tokenHash TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0,
        responseTimeMs INTEGER NOT NULL DEFAULT 0, lastPoints INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS answers (
        questionIndex INTEGER NOT NULL, playerId TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        choice TEXT NOT NULL, acceptedAt INTEGER NOT NULL, PRIMARY KEY (questionIndex, playerId)
      );
      CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (kind TEXT PRIMARY KEY, due INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
    `);
  }

  private state() { return this.storage.kv.get<RoomState>('room'); }
  private save(state: RoomState) { this.storage.kv.put('room', state); }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pin = url.searchParams.get('pin');
    if (!validPin(pin)) return Response.json({ code: 'INVALID_PIN' }, { status: 400 });
    if (url.pathname === '/create' && request.method === 'POST') {
      if (this.state()) return Response.json({ code: 'PIN_OCCUPIED' }, { status: 409 });
      const masterToken = newToken();
      const masterHash = await tokenHash(masterToken);
      const now = Date.now();
      const created = this.storage.transactionSync(() => {
        if (this.state()) return false;
        this.save({ gameId: crypto.randomUUID(), pin, masterHash, phase: 'LOBBY', questionIndex: 0,
          openedAt: null, deadlineAt: null, startedAt: null, finishedAt: null, revision: 0, persisted: false });
        this.job('cleanup', now + IDLE_MS);
        return true;
      });
      if (!created) return Response.json({ code: 'PIN_OCCUPIED' }, { status: 409 });
      await this.schedule();
      return Response.json({ pin, masterToken }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }

    if (url.pathname !== '/socket' || request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 404 });
    }
    const now = Date.now();
    const sockets = this.ctx.getWebSockets().filter(socket => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      const peer = this.peer(socket);
      if (!peer?.role && (!peer || now - peer.openedAt >= AUTH_GRACE_MS)) {
        socket.close(1008, 'Authentication expired');
        return false;
      }
      return true;
    });
    if (!take(this.upgradeRate, now, 400, 120) || sockets.length >= 320) {
      return Response.json({ code: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '2' } });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pin, openedAt: now } satisfies Peer);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const receivedAt = Date.now();
    const peer = this.peer(socket);
    if (!peer || (!peer.role && receivedAt - peer.openedAt >= AUTH_GRACE_MS)) {
      socket.close(1008, 'Authentication expired');
      return;
    }
    const capacity = peer.role === 'MASTER' ? 64 : 24;
    const bucket = this.socketRates.get(socket) ?? { remaining: capacity, updatedAt: receivedAt };
    this.socketRates.set(socket, bucket);
    if (!take(bucket, receivedAt, capacity, 8)) {
      this.error(socket, 'RATE_LIMITED');
      socket.close(1008, 'Rate limited');
      return;
    }
    if (!take(this.roomRate, receivedAt, 1000, 500)) return this.error(socket, 'RATE_LIMITED');
    const parsed = parseMessage(raw);
    const message = parsed.message;
    if (!message) return this.error(socket, parsed.code ?? 'INVALID_PAYLOAD', parsed.requestId);

    if ('pin' in message) {
      if (peer.role) return this.error(socket, 'WRONG_PHASE', message.requestId);
      if (peer.pin !== message.pin) return this.error(socket, 'INVALID_PIN', message.requestId);
      if (message.type === 'player.check_name') {
        const state = this.state();
        if (!state) return this.error(socket, 'INVALID_PIN', message.requestId);
        if (state.phase !== 'LOBBY') return this.error(socket, 'WRONG_PHASE', message.requestId);
        this.send(socket, { type: 'name_status', available: !this.nameTaken(message.nameKey), requestId: message.requestId });
        return;
      }
      await this.authenticate(socket, peer, message);
      return;
    }

    const state = this.state();
    if (!state || !peer.role || peer.gameId !== state.gameId || (peer.role === 'PLAYER' && !this.player(peer.playerId!))) {
      return this.error(socket, 'BAD_TOKEN', message.requestId);
    }
    if (message.type === 'room.sync') {
      const closed = this.maybeClose(state, receivedAt);
      const current = this.state()!;
      this.send(socket, { type: 'snapshot', ...this.snapshot(current, peer), requestId: message.requestId });
      this.replayReveal(socket, current, peer);
      if (closed) await this.schedule();
      return;
    }
    if (message.type === 'player.answer') {
      if (peer.role !== 'PLAYER') return this.error(socket, 'FORBIDDEN', message.requestId);
      await this.answer(socket, state, peer.playerId!, message, receivedAt);
      return;
    }
    if (peer.role !== 'MASTER') return this.error(socket, 'FORBIDDEN', message.requestId);
    await this.command(socket, state, message, receivedAt);
  }

  private async authenticate(socket: WebSocket, peer: Peer, message: Extract<Message, { type: 'player.join' | 'player.resume' | 'master.resume' }>) {
    const token = message.type === 'player.join' ? newToken() : message.type === 'player.resume' ? message.reconnectToken : message.masterToken;
    const hash = await tokenHash(token);
    if (this.peer(socket)?.role || socket.readyState !== WebSocket.OPEN) return;
    const state = this.state();
    if (!state) return this.error(socket, message.type === 'player.join' ? 'INVALID_PIN' : 'BAD_TOKEN', message.requestId);
    const now = Date.now();
    let joined: Player | undefined;
    let identity: Peer;

    if (message.type === 'player.join') {
      if (state.phase !== 'LOBBY') return this.error(socket, 'WRONG_PHASE', message.requestId);
      const id = crypto.randomUUID();
      const result = this.storage.transactionSync(() => {
        if (this.nameTaken(message.nameKey)) return 'NAME_TAKEN';
        if (this.playerCount() >= MAX_PLAYERS) return 'ROOM_FULL';
        return this.sql.exec<Player>('INSERT INTO players (id, name, nameKey, tokenHash) VALUES (?, ?, ?, ?) RETURNING *', id, message.name, message.nameKey, hash).one();
      });
      if (typeof result === 'string') return this.error(socket, result, message.requestId);
      joined = result;
      identity = { ...peer, gameId: state.gameId, role: 'PLAYER', playerId: id };
    } else if (message.type === 'player.resume') {
      const player = this.player(message.playerId);
      if (!player || !sameHash(player.tokenHash, hash)) return this.error(socket, 'BAD_TOKEN', message.requestId);
      identity = { ...peer, gameId: state.gameId, role: 'PLAYER', playerId: player.id };
    } else {
      if (!sameHash(state.masterHash, hash)) return this.error(socket, 'BAD_TOKEN', message.requestId);
      identity = { ...peer, gameId: state.gameId, role: 'MASTER' };
    }

    // Resolve an expired deadline before attaching a new recipient to broadcasts.
    if (state.phase === 'QUESTION_OPEN' && now >= state.deadlineAt!) this.closeQuestion(state, now);
    for (const [old, attachment] of this.peers(state)) {
      if (attachment.role !== identity.role || attachment.playerId !== identity.playerId) continue;
      old.serializeAttachment(null);
      old.close(1000, 'Connection replaced');
    }
    socket.serializeAttachment(identity);
    if (identity.role === 'MASTER') this.socketRates.set(socket, { remaining: 64, updatedAt: now });
    const current = this.state()!;
    const snapshot = this.snapshot(current, identity);
    this.send(socket, joined
      ? { type: 'joined', playerId: joined.id, name: joined.name, reconnectToken: token, snapshot, requestId: message.requestId }
      : { type: 'resumed', snapshot, requestId: message.requestId });
    this.replayReveal(socket, current, identity);
    if (current.phase === 'LOBBY') this.lobby(current);
    if (current.phase === 'QUESTION_OPEN' && !this.maybeClose(current, now)) this.throttleCount(current, now);
    this.touch(current, now);
    await this.schedule();
  }

  private async answer(socket: WebSocket, state: RoomState, playerId: string, message: Extract<Message, { type: 'player.answer' }>, now: number) {
    const matchesQuestion = state.questionIndex > 0 && message.questionId === this.question(state).id;
    if (state.phase !== 'QUESTION_OPEN' || now >= state.deadlineAt! || !matchesQuestion) {
      const previous = matchesQuestion ? this.getAnswer(state, playerId) : undefined;
      if (previous) this.send(socket, { type: 'answer_ack', ...previous, status: 'already_answered', questionId: message.questionId, requestId: message.requestId });
      else this.error(socket, 'QUESTION_CLOSED', message.requestId);
      if (state.phase === 'QUESTION_OPEN' && now >= state.deadlineAt!) {
        this.closeQuestion(state, now);
        await this.schedule();
      }
      return;
    }
    const outcome = this.storage.transactionSync(() => {
      const previous = this.getAnswer(state, playerId);
      if (previous) return { ...previous, status: 'already_answered' };
      this.sql.exec('INSERT INTO answers VALUES (?, ?, ?, ?)', state.questionIndex, playerId, message.choice, now);
      this.touch(state, now);
      return { choice: message.choice, acceptedAt: now, status: 'accepted' };
    });
    this.send(socket, { type: 'answer_ack', ...outcome, questionId: message.questionId, requestId: message.requestId });
    if (outcome.status === 'already_answered') return;
    if (!this.maybeClose(state, now)) this.throttleCount(state, now);
    await this.schedule();
  }

  private async command(socket: WebSocket, state: RoomState, message: Extract<Message, { commandId: string }>, now: number) {
    const fingerprint = message.type === 'master.kick' ? `${message.type}:${message.playerId}` : message.type;
    const previous = this.sql.exec<{ fingerprint: string }>('SELECT fingerprint FROM commands WHERE id = ?', message.commandId).toArray()[0];
    if (previous) {
      if (previous.fingerprint !== fingerprint) return this.error(socket, 'INVALID_PAYLOAD', message.requestId);
      this.send(socket, { type: 'command_ack', requestId: message.requestId, commandId: message.commandId, ...this.meta(state) });
      return;
    }
    const remember = () => this.sql.exec('INSERT INTO commands VALUES (?, ?)', message.commandId, fingerprint);
    let expired = false;
    if (state.phase === 'QUESTION_OPEN' && now >= state.deadlineAt!) {
      this.closeQuestion(state, now);
      state = this.state()!;
      expired = true;
    }

    if (message.type === 'master.kick') {
      if (state.phase === 'FINAL_PODIUM') return this.error(socket, 'WRONG_PHASE', message.requestId);
      if (!this.player(message.playerId)) {
        if (expired) await this.schedule();
        return this.error(socket, 'PLAYER_NOT_FOUND', message.requestId);
      }
      this.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM players WHERE id = ?', message.playerId);
        remember();
        this.touch(state, now);
      });
      for (const [target, peer] of this.peers(state)) {
        if (peer.playerId !== message.playerId) continue;
        this.send(target, { type: 'player_kicked', playerId: message.playerId, ...this.meta(state) });
        target.serializeAttachment(null);
        target.close(1008, 'Removed from room');
      }
      if (state.phase === 'LOBBY') this.lobby(state);
      if (state.phase === 'QUESTION_OPEN' && !this.maybeClose(state, now)) this.throttleCount(state, now);
      if (state.phase === 'LEADERBOARD') this.publishPhase(state);
    } else {
      const next = transition(state, message.type, now, this.playerCount(), questionCount);
      if (!next) {
        await this.schedule();
        return this.error(socket, 'WRONG_PHASE', message.requestId);
      }
      if (next.phase === 'QUESTION_REVEAL') {
        this.closeQuestion(state, now, remember);
      } else {
        const updated = { ...state, ...next };
        this.storage.transactionSync(() => {
          remember();
          if (updated.phase === 'QUESTION_OPEN') {
            updated.startedAt ??= now;
            this.job('deadline', updated.deadlineAt!);
          }
          if (updated.phase === 'FINAL_PODIUM') {
            updated.finishedAt = now;
            this.job('cleanup', now + RETAIN_MS);
            this.job('d1', now);
          }
          this.touch(updated, now);
          this.save(updated);
        });
        if (updated.phase === 'QUESTION_OPEN') this.resetCount();
        this.publishPhase(updated);
      }
    }
    this.send(socket, { type: 'command_ack', requestId: message.requestId, commandId: message.commandId, ...this.meta(this.state()!) });
    await this.schedule();
  }

  private maybeClose(state: RoomState, now: number) {
    if (state.phase !== 'QUESTION_OPEN') return false;
    const { eligibleCount, answeredCount } = this.count(state);
    if (!shouldClose(state, now, eligibleCount, answeredCount)) return false;
    this.closeQuestion(state, now);
    return true;
  }

  private closeQuestion(state: RoomState, now: number, remember?: () => unknown) {
    const next = transition(state, 'close', now, 0, questionCount);
    if (!next) return;
    const updated = { ...state, ...next };
    const { correct } = this.question(state);
    this.storage.transactionSync(() => {
      const submissions = new Map(this.sql.exec<Answer & { playerId: string }>('SELECT playerId, choice, acceptedAt FROM answers WHERE questionIndex = ?', state.questionIndex).toArray().map(answer => [answer.playerId, answer]));
      for (const { id } of this.sql.exec<{ id: string }>('SELECT id FROM players').toArray()) {
        const answer = submissions.get(id);
        const { points, responseTimeMs } = scoreAnswer(correct, answer?.choice ?? null, answer ? answer.acceptedAt - state.openedAt! : undefined);
        this.sql.exec('UPDATE players SET score = score + ?, responseTimeMs = responseTimeMs + ?, lastPoints = ? WHERE id = ?', points, responseTimeMs, points, id);
      }
      remember?.();
      this.sql.exec("DELETE FROM jobs WHERE kind = 'deadline'");
      this.touch(updated, now);
      this.save(updated);
    });
    this.resetCount();
    this.emitCount(state, now, true);
    this.publishPhase(updated);
  }

  async webSocketClose(socket: WebSocket) { await this.disconnected(socket); }
  async webSocketError(socket: WebSocket) { await this.disconnected(socket); }

  private async disconnected(socket: WebSocket) {
    const peer = this.peer(socket);
    socket.serializeAttachment(null);
    // The runtime handles the close handshake on current compatibility dates.
    const state = this.state();
    if (peer?.role !== 'PLAYER' || !state || peer.gameId !== state.gameId) return;
    if (state.phase === 'LOBBY') this.lobby(state);
    if (state.phase === 'QUESTION_OPEN') {
      const now = Date.now();
      if (this.maybeClose(state, now)) await this.schedule();
      else this.throttleCount(state, now);
    }
  }

  private question(state: RoomState) { return serverQuestions[state.questionIndex - 1]; }
  private peer(socket: WebSocket) { return socket.deserializeAttachment() as Peer | null; }
  private peers(state: RoomState): [WebSocket, Peer][] {
    return this.ctx.getWebSockets().flatMap(socket => {
      if (socket.readyState !== WebSocket.OPEN) return [];
      const peer = this.peer(socket);
      return peer?.role && peer.gameId === state.gameId ? [[socket, peer]] : [];
    });
  }
  private playerCount() { return this.sql.exec<{ count: number }>('SELECT count(*) AS count FROM players').one().count; }
  private nameTaken(nameKey: string) {
    return this.sql.exec('SELECT 1 FROM players WHERE nameKey = ?', nameKey).toArray().length > 0;
  }
  private player(id: string) { return this.sql.exec<Player>('SELECT * FROM players WHERE id = ?', id).toArray()[0]; }
  private getAnswer(state: RoomState, playerId: string) {
    return this.sql.exec<Answer>('SELECT choice, acceptedAt FROM answers WHERE questionIndex = ? AND playerId = ?', state.questionIndex, playerId).toArray()[0];
  }
  private ranking() {
    return this.sql.exec<Omit<Player, 'tokenHash' | 'joined' | 'lastPoints'>>('SELECT id, name, score, responseTimeMs FROM players ORDER BY score DESC, responseTimeMs, joined, id').toArray()
      .map(({ id, ...player }, index) => ({ rank: index + 1, playerId: id, ...player }));
  }
  private meta(state: RoomState) { return { revision: state.revision, serverNow: Date.now() }; }
  private send(socket: WebSocket, data: Payload) {
    if (socket.readyState !== WebSocket.OPEN) return;
    try { socket.send(JSON.stringify({ v: 1, ...data })); } catch { /* The peer disconnected during delivery. */ }
  }
  private error(socket: WebSocket, code: string, requestId?: string) {
    this.send(socket, { type: 'error', code, message: code, retryable: code === 'RATE_LIMITED', requestId });
  }

  private roster(state: RoomState) {
    const connected = new Set(this.peers(state).map(([, peer]) => peer.playerId));
    return this.sql.exec<{ id: string; name: string }>('SELECT id, name FROM players ORDER BY joined').toArray()
      .map(({ id, name }) => ({ playerId: id, name, connected: connected.has(id) }));
  }
  private lobby(state: RoomState) {
    const players = this.roster(state);
    for (const [socket, peer] of this.peers(state)) this.send(socket, {
      type: 'lobby_update', playerCount: players.length, ...this.meta(state), ...(peer.role === 'MASTER' ? { players } : {}),
    });
  }

  private count(state: RoomState) {
    const connected = new Set(this.peers(state).flatMap(([, peer]) => peer.playerId ? [peer.playerId] : []));
    const answered = this.sql.exec<{ playerId: string }>('SELECT playerId FROM answers WHERE questionIndex = ?', state.questionIndex).toArray();
    return { eligibleCount: connected.size, answeredCount: answered.filter(answer => connected.has(answer.playerId)).length };
  }
  private resetCount() {
    if (this.countTimer !== undefined) clearTimeout(this.countTimer);
    this.countTimer = undefined;
    this.lastCountAt = -Infinity;
    this.lastCount = '';
  }
  private emitCount(state: RoomState, now: number, force = false) {
    const count = this.count(state);
    const key = `${count.answeredCount}/${count.eligibleCount}`;
    if (!force && key === this.lastCount) return;
    this.lastCount = key;
    this.lastCountAt = now;
    for (const [socket, peer] of this.peers(state)) {
      if (peer.role === 'MASTER') this.send(socket, { type: 'answer_count', questionId: this.question(state).id, ...count, ...this.meta(state) });
    }
  }
  private throttleCount(state: RoomState, now: number) {
    const wait = this.lastCountAt + COUNT_MS - now;
    if (wait <= 0) {
      if (this.countTimer !== undefined) clearTimeout(this.countTimer);
      this.countTimer = undefined;
      this.emitCount(state, now);
      return;
    }
    this.countTimer ??= setTimeout(() => {
      this.countTimer = undefined;
      const current = this.state();
      if (current?.gameId === state.gameId && current.phase === 'QUESTION_OPEN' && current.revision === state.revision) {
        this.emitCount(current, Date.now());
      }
    }, wait);
  }

  private phaseFields(state: RoomState, peer: Peer, ranking?: ReturnType<Room['ranking']>, histogram?: Record<Letter, number>): Payload {
    const master = peer.role === 'MASTER';
    switch (state.phase) {
      case 'LOBBY': return master ? { players: this.roster(state), playerCount: this.playerCount() } : { playerCount: this.playerCount() };
      case 'QUESTION_OPEN': {
        const { id, text, options } = this.question(state);
        return { questionId: id, questionIndex: state.questionIndex, openedAt: state.openedAt, deadlineAt: state.deadlineAt,
          ...(master ? { text, options, ...this.count(state) } : { choices }) };
      }
      case 'QUESTION_REVEAL': {
        const { id, explanation, correct } = this.question(state);
        if (master) return { questionId: id, correct, explanation, counts: histogram ?? this.histogram(state) };
        const player = this.player(peer.playerId!);
        const myRank = (ranking ?? this.ranking()).find(entry => entry.playerId === player.id)!.rank;
        return { questionId: id, correct, myChoice: this.getAnswer(state, peer.playerId!)?.choice ?? null,
          myPoints: player.lastPoints, myTotalScore: player.score, myRank };
      }
      case 'LEADERBOARD': case 'FINAL_PODIUM': {
        const entries = ranking ?? this.ranking();
        if (master) return state.phase === 'LEADERBOARD'
          ? { entries: entries.slice(0, 5) }
          : { entries, rankingId: rankingId(state.pin, state.finishedAt!), persisted: state.persisted };
        const entry = entries.find(entry => entry.playerId === peer.playerId)!;
        return { myRank: entry.rank, myScore: entry.score };
      }
    }
  }
  private histogram(state: RoomState) {
    const counts = Object.fromEntries(letters.map(letter => [letter, 0])) as Record<Letter, number>;
    for (const { choice, total } of this.sql.exec<{ choice: Letter; total: number }>('SELECT choice, count(*) AS total FROM answers WHERE questionIndex = ? GROUP BY choice', state.questionIndex)) counts[choice] = total;
    return counts;
  }
  private snapshot(state: RoomState, peer: Peer): Payload {
    const visible = state.phase === 'QUESTION_REVEAL' ? { questionId: this.question(state).id } : this.phaseFields(state, peer);
    const personal = peer.role === 'PLAYER' ? { myScore: this.player(peer.playerId!)?.score, myAnswer: this.getAnswer(state, peer.playerId!)?.choice ?? null } : {};
    return { phase: state.phase, questionIndex: state.questionIndex, ...this.meta(state), ...visible, ...personal };
  }
  private replayReveal(socket: WebSocket, state: RoomState, peer: Peer) {
    if (state.phase === 'QUESTION_REVEAL') this.send(socket, { type: 'question_reveal', ...this.meta(state), ...this.phaseFields(state, peer) });
  }
  private publishPhase(state: RoomState) {
    const ranking = state.phase === 'QUESTION_REVEAL' || state.phase === 'LEADERBOARD' || state.phase === 'FINAL_PODIUM' ? this.ranking() : undefined;
    const histogram = state.phase === 'QUESTION_REVEAL' ? this.histogram(state) : undefined;
    const type = state.phase.toLowerCase();
    for (const [socket, peer] of this.peers(state)) this.send(socket, { type, ...this.meta(state), ...this.phaseFields(state, peer, ranking, histogram) });
  }

  private job(kind: AlarmKind, due: number, attempts = 0) {
    this.sql.exec('INSERT OR REPLACE INTO jobs VALUES (?, ?, ?)', kind, due, attempts);
  }
  private touch(state: RoomState, now: number) {
    if (state.phase !== 'FINAL_PODIUM') this.job('cleanup', now + IDLE_MS);
  }
  private async schedule() {
    const next = this.sql.exec<{ due: number }>('SELECT due FROM jobs ORDER BY due LIMIT 1').toArray()[0];
    if (next && next.due === this.scheduledAt) return;
    this.scheduledAt = next?.due;
    try {
      if (next) await this.storage.setAlarm(next.due);
      else await this.storage.deleteAlarm();
    } catch (error) {
      this.scheduledAt = undefined;
      throw error;
    }
  }

  async alarm() {
    this.scheduledAt = undefined;
    let state = this.state();
    const now = Date.now();
    if (!state) return;
    const jobs = this.sql.exec<AlarmJob>("SELECT * FROM jobs WHERE due <= ? ORDER BY due, CASE kind WHEN 'deadline' THEN 0 WHEN 'd1' THEN 1 ELSE 2 END", now).toArray();
    for (const job of jobs) {
      // A preceding job or an event during D1 I/O may have changed the queue.
      const current = this.sql.exec<AlarmJob>('SELECT * FROM jobs WHERE kind = ?', job.kind).toArray()[0];
      state = this.state();
      if (!state || !current || current.due !== job.due || current.attempts !== job.attempts) continue;
      if (job.kind === 'deadline') {
        if (state.phase === 'QUESTION_OPEN' && now >= state.deadlineAt!) this.closeQuestion(state, now);
        else this.sql.exec("DELETE FROM jobs WHERE kind = 'deadline'");
      } else if (job.kind === 'd1') {
        if (state.phase === 'FINAL_PODIUM' && !state.persisted) await this.persist(state, job, now);
        else this.sql.exec("DELETE FROM jobs WHERE kind = 'd1'");
      } else if (state.phase === 'FINAL_PODIUM' && !state.persisted) {
        this.job('cleanup', Date.now() + RETAIN_MS);
      } else {
        this.resetCount();
        for (const socket of this.ctx.getWebSockets()) {
          socket.serializeAttachment(null);
          if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Room expired');
        }
        this.storage.transactionSync(() => {
          this.sql.exec('DELETE FROM answers; DELETE FROM players; DELETE FROM commands; DELETE FROM jobs');
          this.storage.kv.delete('room');
        });
      }
    }
    await this.schedule();
  }

  private async persist(state: RoomState, job: AlarmJob, now: number) {
    const entries = this.ranking();
    this.job('d1', now + Math.min(1000 * 2 ** Math.min(job.attempts, 10), 15 * 60_000), job.attempts + 1);
    await this.schedule();
    let persisted = false;
    try {
      const game = this.env.DB.prepare(`INSERT INTO games VALUES (?, ?, ?, ?, ?, ?, 'finished') ON CONFLICT(game_id) DO NOTHING`)
        .bind(state.gameId, state.pin, state.startedAt, state.finishedAt, questionSetVersion, entries.length);
      const results = entries.map(entry => this.env.DB.prepare('INSERT INTO game_results VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, player_id) DO NOTHING')
        .bind(state.gameId, entry.playerId, entry.name, entry.rank, entry.score, entry.responseTimeMs));
      persisted = (await this.env.DB.batch([game, ...results])).every(result => result.success);
    } catch (error) {
      console.warn('D1 ranking write failed; retry scheduled', state.gameId, String(error));
    }
    const current = this.state();
    if (current?.gameId !== state.gameId || current.persisted) return;
    if (persisted) this.storage.transactionSync(() => {
      state.persisted = true;
      this.save(state);
      this.sql.exec("DELETE FROM jobs WHERE kind = 'd1'");
    });
    for (const [socket, peer] of this.peers(state)) {
      if (peer.role === 'MASTER') this.send(socket, { type: 'persistence_status', persisted, ...this.meta(state) });
    }
  }
}
