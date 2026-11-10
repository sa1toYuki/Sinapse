import { applyD1Migrations, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../worker';
import type { Round } from '../worker/rules';

const bindings = env as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
const worker = exports.default as Fetcher;
const origin = 'https://sinapse.test';
const sockets = new Set<WebSocket>();
type Payload = Record<string, unknown> & { type: string; requestId?: string; code?: string };
type Credentials = { pin: string; masterToken: string };

beforeAll(() => applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS));
afterEach(() => {
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.close(1000);
  sockets.clear();
});

async function create() {
  const response = await worker.fetch(`${origin}/api/rooms`, { method: 'POST' });
  expect(response.status).toBe(201);
  const credentials = await response.json<Credentials>();
  expect(credentials.pin).toMatch(/^\d{6}$/);
  expect(credentials.masterToken).toMatch(/^[a-f0-9]{64}$/);
  return { ...credentials, stub: bindings.ROOMS.get(bindings.ROOMS.idFromName(credentials.pin)) };
}

async function connect(pin: string) {
  const response = await worker.fetch(`${origin}/api/rooms/${pin}/ws`, { headers: { Upgrade: 'websocket', Origin: origin } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  sockets.add(socket);
  const frames: Payload[] = [];
  socket.addEventListener('message', event => { frames.push(JSON.parse(String(event.data))); });
  socket.accept();
  async function find(predicate: (frame: Payload) => boolean, start = 0) {
    const existing = frames.slice(start).find(predicate);
    if (existing) return existing;
    return new Promise<Payload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeEventListener('message', listener);
        reject(new Error(`Frame not received. Recent frames: ${JSON.stringify(frames.slice(-5))}`));
      }, 4000);
      function listener(event: MessageEvent) {
        const frame = JSON.parse(String(event.data)) as Payload;
        if (!predicate(frame)) return;
        clearTimeout(timeout);
        socket.removeEventListener('message', listener);
        resolve(frame);
      }
      socket.addEventListener('message', listener);
    });
  }
  function request(type: string, fields: Record<string, unknown> = {}) {
    const requestId = crypto.randomUUID();
    socket.send(JSON.stringify({ v: 1, type, requestId, ...fields }));
    return find(frame => frame.requestId === requestId, frames.length);
  }
  return { socket, frames, find, request, command: (type: string, fields = {}) => request(type, { commandId: crypto.randomUUID(), ...fields }) };
}

async function join(pin: string, name: string) {
  const client = await connect(pin);
  const reply = await client.request('player.join', { pin, name });
  return { ...client, reply, playerId: reply.playerId as string, reconnectToken: reply.reconnectToken as string };
}

async function master({ pin, masterToken }: Credentials) {
  const client = await connect(pin);
  const reply = await client.request('master.resume', { pin, masterToken });
  expect(reply.type).toBe('resumed');
  return client;
}

function requireNoCorrect(value: unknown) {
  if (!value || typeof value !== 'object') return;
  expect(Object.hasOwn(value, 'correct')).toBe(false);
  for (const field of Object.values(value)) requireNoCorrect(field);
}

describe('sala no runtime Workers', () => {
  it('não expõe a correção de prática no Worker público', async () => {
    const response = await worker.fetch(`${origin}/api/local/grade`, { method: 'POST' });
    expect(response.status).toBe(404);
    requireNoCorrect(await response.json());
  });

  it('rejeita Origin ausente ou de terceiros no upgrade', async () => {
    const { pin } = await create();
    for (const Origin of ['', 'https://third-party.test']) {
      const response = await worker.fetch(`${origin}/api/rooms/${pin}/ws`, { headers: { Upgrade: 'websocket', Origin } });
      expect(response.status).toBe(403);
    }
  });

  it('resolve de forma atômica duas entradas simultâneas com variação de caixa e NFC', async () => {
    const { pin } = await create();
    const [first, second] = await Promise.all([join(pin, ' Élise '), join(pin, 'E\u0301LISE')]);
    expect([first.reply.type, second.reply.type].sort()).toEqual(['error', 'joined']);
    expect([first.reply, second.reply].find(frame => frame.type === 'error')?.code).toBe('NAME_TAKEN');
  });

  it('retorna ROOM_FULL com 150 conectados e reserva a vaga após desconexão', async () => {
    const { pin } = await create();
    const players: WebSocket[] = [];
    for (let index = 0; index < 150; index++) {
      const player = await join(pin, `Player ${index}`);
      expect(player.reply.type).toBe('joined');
      players.push(player.socket);
    }
    expect((await join(pin, 'Player extra')).reply).toMatchObject({ type: 'error', code: 'ROOM_FULL' });
    players[0].close(1000);
    expect((await join(pin, 'Player extra')).reply).toMatchObject({ type: 'error', code: 'ROOM_FULL' });
  });

  it('preserva primeira escolha e timestamp, rejeita resposta tardia e varre payloads dos dois papéis', async () => {
    const room = await create();
    const host = await master(room);
    const first = await join(room.pin, 'Primeira');
    const second = await join(room.pin, 'Segunda');
    expect(await host.command('master.start')).toMatchObject({ type: 'command_ack' });
    const opened = await host.find(frame => frame.type === 'question_open');
    expect(Number(opened.deadlineAt) - Number(opened.openedAt)).toBe(30_000);
    expect(await first.find(frame => frame.type === 'question_open')).not.toHaveProperty('options');
    const answer = await first.request('player.answer', { questionId: 1, choice: 'B' });
    const duplicate = await first.request('player.answer', { questionId: 1, choice: 'D' });
    expect(answer).toMatchObject({ type: 'answer_ack', status: 'accepted', choice: 'B' });
    expect(Number(answer.acceptedAt)).toBeGreaterThanOrEqual(Number(opened.openedAt));
    expect(duplicate).toMatchObject({ type: 'answer_ack', status: 'already_answered', choice: 'B', acceptedAt: answer.acceptedAt });
    expect(await first.request('room.sync')).toMatchObject({ type: 'snapshot', phase: 'QUESTION_OPEN', myAnswer: 'B', myScore: 0 });
    await host.request('room.sync');
    await host.command('master.end_question');
    await host.find(frame => frame.type === 'question_reveal');
    expect(await first.find(frame => frame.type === 'question_reveal')).toMatchObject({ correct: 'B', myChoice: 'B' });
    expect(await first.request('player.answer', { questionId: 1, choice: 'D' })).toMatchObject({ status: 'already_answered', choice: 'B', acceptedAt: answer.acceptedAt });
    expect(await second.request('player.answer', { questionId: 1, choice: 'E' })).toMatchObject({ code: 'QUESTION_CLOSED' });
    const reconnected = await connect(room.pin);
    await reconnected.request('player.resume', { pin: room.pin, playerId: first.playerId, reconnectToken: first.reconnectToken });
    await reconnected.find(frame => frame.type === 'question_reveal');
    for (const client of [host, first, second, reconnected]) {
      const revealAt = client.frames.findIndex(frame => frame.type === 'question_reveal');
      expect(revealAt).toBeGreaterThan(0);
      for (const frame of client.frames) if (frame.type !== 'question_reveal') requireNoCorrect(frame);
    }
  });

  it('recupera identidade e resposta após hibernação e reassocia o socket', async () => {
    const room = await create();
    const host = await master(room);
    const player = await join(room.pin, 'Jogador');
    await join(room.pin, 'Ainda esperando');
    await host.command('master.start');
    const answer = await player.request('player.answer', { questionId: 1, choice: 'A' });
    expect(answer.status).toBe('accepted');

    await evictDurableObject(room.stub);
    expect(await player.request('room.sync')).toMatchObject({ phase: 'QUESTION_OPEN', myAnswer: 'A' });
    const reconnected = await connect(room.pin);
    const resume = await reconnected.request('player.resume', { pin: room.pin, playerId: player.playerId, reconnectToken: player.reconnectToken });
    expect(resume).toMatchObject({ type: 'resumed', snapshot: { phase: 'QUESTION_OPEN', myAnswer: 'A' } });
    expect(await reconnected.request('player.answer', { questionId: 1, choice: 'B' })).toMatchObject({ status: 'already_answered', choice: 'A', acceptedAt: answer.acceptedAt });
  });

  it('rejeita a resposta depois de deadlineAt mesmo com o alarm pendente', async () => {
    const room = await create();
    const host = await master(room);
    const player = await join(room.pin, 'Chegou tarde');
    await host.command('master.start');
    await runInDurableObject(room.stub, async (_instance, { storage }) => {
      const state = storage.kv.get<Round>('room')!;
      storage.kv.put('room', { ...state, openedAt: Date.now() - 30_010, deadlineAt: Date.now() - 10 });
      await storage.setAlarm(Date.now() + 60_000);
    });
    expect(await player.request('player.answer', { questionId: 1, choice: 'B' })).toMatchObject({ code: 'QUESTION_CLOSED' });
    expect(await player.find(frame => frame.type === 'question_reveal')).toMatchObject({ myChoice: null, myPoints: 0 });
    expect(await runInDurableObject(room.stub, (_instance, { storage }) => storage.sql.exec('SELECT * FROM answers').toArray())).toEqual([]);
  });

  it('mantém prazo e retry D1 na mesma fila e agenda sempre o mais próximo', async () => {
    const room = await create();
    const host = await master(room);
    await join(room.pin, 'Jogador');
    await host.command('master.start');
    const { retry, deadline } = await runInDurableObject(room.stub, async (_instance, { storage }) => {
      const state = storage.kv.get<Round>('room')!;
      const retry = Date.now() + 60_000;
      const deadline = state.deadlineAt!;
      storage.sql.exec("INSERT INTO jobs VALUES ('d1', ?, 1)", retry);
      return { retry, deadline };
    });
    // An early invocation must not erase either job.
    expect(await runDurableObjectAlarm(room.stub)).toBe(true);
    expect(await runInDurableObject(room.stub, (_instance, { storage }) => storage.getAlarm())).toBe(deadline);
    await runInDurableObject(room.stub, async (_instance, { storage }) => {
      const state = storage.kv.get<Round>('room')!;
      const past = Date.now() - 1;
      storage.kv.put('room', { ...state, deadlineAt: past });
      storage.sql.exec("UPDATE jobs SET due = ? WHERE kind = 'deadline'", past);
    });
    expect(await runDurableObjectAlarm(room.stub)).toBe(true);
    await host.find(frame => frame.type === 'question_reveal');
    expect(await runInDurableObject(room.stub, (_instance, { storage }) => storage.getAlarm())).toBe(retry);
  });

  it('expulsa, libera nome e invalida o token antigo', async () => {
    const room = await create();
    const host = await master(room);
    const player = await join(room.pin, 'Pessoa');
    expect(await host.command('master.kick', { playerId: player.playerId })).toMatchObject({ type: 'command_ack' });
    await player.find(frame => frame.type === 'player_kicked');
    const duplicate = await join(room.pin, 'PESSOA');
    expect(duplicate.reply.type).toBe('joined');
    const connection = await connect(room.pin);
    expect(await connection.request('player.resume', { pin: room.pin, playerId: player.playerId, reconnectToken: player.reconnectToken })).toMatchObject({ code: 'BAD_TOKEN' });
  });

  it('reutiliza o PIN após limpeza e recusa credenciais de outra partida', async () => {
    const room = await create();
    const player = await join(room.pin, 'Participante');
    const url = `https://room.internal/create?pin=${room.pin}`;
    expect((await room.stub.fetch(url, { method: 'POST' })).status).toBe(409);
    await runInDurableObject(room.stub, (_instance, { storage }) => {
      storage.sql.exec("UPDATE jobs SET due = ? WHERE kind = 'cleanup'", Date.now() - 1);
    });
    expect(await runDurableObjectAlarm(room.stub)).toBe(true);
    expect((await room.stub.fetch(url, { method: 'POST' })).status).toBe(201);
    const connection = await connect(room.pin);
    expect(await connection.request('player.resume', { pin: room.pin, playerId: player.playerId, reconnectToken: player.reconnectToken })).toMatchObject({ code: 'BAD_TOKEN' });
    expect(await connection.request('master.resume', { pin: room.pin, masterToken: room.masterToken })).toMatchObject({ code: 'BAD_TOKEN' });
  });

  it('agrega respostas em janelas de 250 ms e revela após todos responderem', async () => {
    const room = await create();
    const host = await master(room);
    const players = await Promise.all(Array.from({ length: 5 }, (_, i) => join(room.pin, `Equipe ${i}`)));
    const commandId = crypto.randomUUID();
    expect(await host.request('master.start', { commandId })).toMatchObject({ type: 'command_ack', revision: 1 });
    expect(await host.request('master.start', { commandId })).toMatchObject({ type: 'command_ack', revision: 1 });
    await Promise.all(players.slice(0, -1).map(player => player.request('player.answer', { questionId: 1, choice: 'B' })));
    const trailing = await host.find(frame => frame.type === 'answer_count' && frame.answeredCount === 4);
    expect(trailing.eligibleCount).toBe(5);
    const counts = host.frames.filter(frame => frame.type === 'answer_count');
    expect(counts[0].answeredCount).toBe(1);
    for (let i = 1; i < counts.length; i++) {
      expect(Number(counts[i].serverNow) - Number(counts[i - 1].serverNow)).toBeGreaterThanOrEqual(245);
    }
    expect(host.frames.filter(frame => frame.type === 'question_open')).toHaveLength(1);
    await players[4].request('player.answer', { questionId: 1, choice: 'B' });
    await host.find(frame => frame.type === 'question_reveal');
    expect(host.frames.filter(frame => frame.type === 'answer_count').at(-1)?.answeredCount).toBe(5);
  });

  it('limita a conexão mesmo quando as mensagens são inválidas', async () => {
    const { pin } = await create();
    const client = await connect(pin);
    for (let index = 0; index < 25; index++) client.socket.send('x'.repeat(2049));
    expect(await client.find(frame => frame.code === 'INVALID_PAYLOAD')).toBeDefined();
    expect(await client.find(frame => frame.code === 'RATE_LIMITED')).toBeDefined();
  });

  it('mostra top 5 entre perguntas e persiste o pódio completo no D1 após uma falha', async () => {
    const room = await create();
    const host = await master(room);
    const players = await Promise.all(Array.from({ length: 6 }, (_, index) => join(room.pin, `Pessoa ${index}`)));
    await host.command('master.start');
    for (let index = 1; index <= 17; index++) {
      expect(await host.command('master.end_question')).toMatchObject({ type: 'command_ack' });
      expect(await host.command('master.show_leaderboard')).toMatchObject({ type: 'command_ack' });
      if (index < 17) expect(await host.command('master.next')).toMatchObject({ type: 'command_ack' });
    }
    const leaderboard = await host.find(frame => frame.type === 'leaderboard');
    expect(leaderboard.entries).toHaveLength(5);
    let rankingId: unknown;
    await bindings.DB.prepare('ALTER TABLE game_results RENAME TO temporarily_unavailable').run();
    try {
      expect(await host.command('master.next')).toMatchObject({ type: 'command_ack' });
      const podium = await host.find(frame => frame.type === 'final_podium');
      rankingId = podium.rankingId;
      expect(podium.entries).toHaveLength(6);
      expect(podium.persisted).toBe(false);
      expect(await players[0].find(frame => frame.type === 'final_podium')).not.toHaveProperty('entries');
      await host.find(frame => frame.type === 'persistence_status' && frame.persisted === false);
      expect((await bindings.DB.prepare('SELECT count(*) AS count FROM games WHERE pin = ?').bind(room.pin).first()).count).toBe(0);
      expect((await worker.fetch(`${origin}/api/ranking?game=${rankingId}`)).status).toBe(404);
    } finally {
      await bindings.DB.prepare('ALTER TABLE temporarily_unavailable RENAME TO game_results').run();
    }
    await runInDurableObject(room.stub, (_instance, { storage }) => {
      storage.sql.exec("UPDATE jobs SET due = ? WHERE kind = 'd1'", Date.now() - 1);
    });
    await runDurableObjectAlarm(room.stub);
    await host.find(frame => frame.type === 'persistence_status' && frame.persisted === true);
    const response = await worker.fetch(`${origin}/api/ranking?game=${rankingId}`);
    expect(response.status).toBe(200);
    const final = await response.json<{ gameId: string; entries: { name: string; rank: number; score: number; responseTimeMs: number }[] }>();
    expect(final.gameId).toBe(rankingId);
    expect(final.entries.map(({ name, ...result }) => result)).toEqual(Array.from({ length: 6 }, (_, index) => ({ rank: index + 1, score: 0, responseTimeMs: 510_000 })));
  });

  it('consulta a última partida ou um resultado específico e ordena por pontos e tempo no D1', async () => {
    const older = crypto.randomUUID();
    const latest = crypto.randomUUID();
    const finish = Date.now() + 10_000;
    const game = (id: string, at: number, count: number) => bindings.DB.prepare("INSERT INTO games VALUES (?, '123456', ?, ?, 'test', ?, 'finished')")
      .bind(id, at - 1000, at, count);
    const row = (id: string, name: string, rank: number, score: number, elapsed: number) => bindings.DB.prepare('INSERT INTO game_results VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, crypto.randomUUID(), name, rank, score, elapsed);
    await bindings.DB.batch([
      game(older, finish - 5000, 1), game(latest, finish, 3),
      row(older, 'Jogo anterior', 1, 1100, 1000),
      row(latest, 'Rápida, menos pontos', 3, 300, 3000),
      row(latest, 'Empatou, levou mais tempo', 2, 800, 20000),
      row(latest, 'Empatou, foi mais rápida', 1, 800, 10000),
    ]);
    const response = await worker.fetch(`${origin}/api/ranking`);
    expect(await response.json()).toEqual({ gameId: latest, entries: [
      { name: 'Empatou, foi mais rápida', rank: 1, score: 800, responseTimeMs: 10000 },
      { name: 'Empatou, levou mais tempo', rank: 2, score: 800, responseTimeMs: 20000 },
      { name: 'Rápida, menos pontos', rank: 3, score: 300, responseTimeMs: 3000 },
    ] });
    const selected = await worker.fetch(`${origin}/api/ranking?game=${older}`);
    expect(await selected.json()).toEqual({ gameId: older, entries: [{ name: 'Jogo anterior', rank: 1, score: 1100, responseTimeMs: 1000 }] });
    expect((await worker.fetch(`${origin}/api/ranking?game=123456`)).status).toBe(400);
  });
});
