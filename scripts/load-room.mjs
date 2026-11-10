import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:8787' },
    'source-ip': { type: 'string' },
    seed: { type: 'string', default: '42' },
    rounds: { type: 'string', default: '2' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log('node scripts/load-room.mjs <50|100|150> [--url http://127.0.0.1:8787] [--source-ip IP] [--seed 42] [--rounds 2]');
  process.exit(0);
}
assert(positionals.length === 1 && /^(50|100|150)$/.test(positionals[0]), 'Informe 50, 100 ou 150 bots.');
assert(/^\d{1,2}$/.test(values.rounds) && Number(values.rounds) >= 1 && Number(values.rounds) <= 16, 'Use de 1 a 16 rodadas aleatórias.');
assert(/^\d{1,10}$/.test(values.seed) && Number(values.seed) <= 0xffffffff, 'Seed fora do intervalo uint32.');
const base = new URL(values.url);
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password, 'Use uma URL HTTP(S) sem credenciais.');
assert(!values['source-ip'] || isIP(values['source-ip']), 'IP de origem inválido.');
const total = Number(positionals[0]);
const randomRounds = Number(values.rounds);
const timeoutMs = 15_000;
const metrics = new Map();
const sockets = new Set();
const sourceAddresses = new Set();
const rejected = { http429: 0, wsRateLimited: 0, nameTaken: 0 };
let sourceIp = values['source-ip'];
let upgrades = 0;
let lobbyUpdates = 0;
let reconnects = 0;
let joinedCount = 0;
let seed = Number(values.seed);

function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

function sample(metric, value) {
  if (!metrics.has(metric)) metrics.set(metric, []);
  metrics.get(metric).push(value);
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(2));
  return { n: sorted.length, p50: percentile(0.5), p95: percentile(0.95) };
}

class Client {
  constructor(pin, role) {
    const url = new URL(`/api/rooms/${pin}/ws`, base);
    url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    this.history = [];
    this.waiters = new Set();
    this.startedAt = performance.now();
    const socket = new WebSocket(url, {
      origin: base.origin, localAddress: sourceIp, handshakeTimeout: timeoutMs, closeTimeout: 3000, perMessageDeflate: false,
    });
    this.socket = socket;
    sockets.add(socket);
    this.ready = new Promise((resolve, reject) => {
      socket.once('upgrade', ({ socket: transport }) => {
        const address = transport.localAddress;
        if (address) sourceAddresses.add(address);
        // The first connection chooses the route. Every later upgrade binds that IP.
        sourceIp ??= address;
        upgrades++;
      });
      socket.once('open', resolve);
      socket.once('unexpected-response', (request, response) => {
        if (response.statusCode === 429) rejected.http429++;
        response.resume();
        request.destroy();
        reject(new Error(`Upgrade HTTP ${response.statusCode}`));
      });
      socket.on('error', reject);
      socket.once('close', code => {
        sockets.delete(socket);
        const error = new Error(`Socket ${role} fechado (${code})`);
        reject(error);
        for (const waiter of this.waiters) waiter.fail(error);
      });
    });
    socket.on('message', raw => {
      const received = performance.now();
      const epoch = Date.now();
      const message = JSON.parse(raw.toString());
      if (message.code === 'RATE_LIMITED') rejected.wsRateLimited++;
      if (message.code === 'NAME_TAKEN') rejected.nameTaken++;
      if (message.type === 'lobby_update') lobbyUpdates++;
      const state = message.snapshot ?? message;
      if (typeof state.serverNow === 'number' && (message.snapshot || [
        'question_open', 'question_reveal', 'leaderboard', 'answer_count', 'lobby_update',
      ].includes(message.type))) {
        sample(`${role} ${message.type}: entrega`, epoch - state.serverNow);
      }
      const frame = { message, received };
      // Keep only the recent event history needed to cover send/receive races.
      this.history.push(frame);
      if (this.history.length > 64) this.history.shift();
      for (const waiter of this.waiters) {
        if (waiter.matches(frame)) waiter.done(frame);
      }
    });
  }

  wait(type, predicate = () => true) {
    const matches = ({ message }) => (type === null || message.type === type) && predicate(message);
    const existing = this.history.find(matches);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const finish = callback => value => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        callback(value);
      };
      const waiter = { matches, done: finish(resolve), fail: finish(reject) };
      const timer = setTimeout(() => waiter.fail(new Error(`Timeout aguardando ${type ?? 'resposta correlacionada'}.`)), timeoutMs);
      this.waiters.add(waiter);
    });
  }

  async request(type, fields = {}) {
    const requestId = randomUUID();
    const waiting = this.wait(null, message => message.requestId === requestId || (message.code === 'RATE_LIMITED' && !message.requestId));
    const sent = performance.now();
    this.socket.send(JSON.stringify({ v: 1, type, requestId, ...fields }));
    return { ...await waiting, sent };
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise(resolve => this.socket.once('close', resolve));
    this.socket.close(1000);
    await closed;
  }
}

function expectType(frame, type) {
  assert.equal(frame.message.type, type, `Esperado ${type}, recebido ${frame.message.code ?? frame.message.type}.`);
  return frame.message;
}

async function open(pin, role) {
  const client = new Client(pin, role);
  await client.ready;
  return client;
}

async function command(host, type) {
  const frame = await host.request(type, { commandId: randomUUID() });
  expectType(frame, 'command_ack');
  return frame.sent;
}

async function run() {
  const start = performance.now();
  const response = await fetch(new URL('/api/rooms', base), {
    method: 'POST', headers: { Origin: base.origin }, signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 429) rejected.http429++;
  assert.equal(response.status, 201, 'Falha na criação da sala.');
  const { pin, masterToken } = await response.json();
  const host = await open(pin, 'MASTER');
  expectType(await host.request('master.resume', { pin, masterToken }), 'resumed');
  assert(sourceIp, 'Não foi possível identificar o IP TCP do cliente.');

  const collisionPairs = Math.floor(total / 8);
  const joinStart = performance.now();
  const bots = await Promise.all(Array.from({ length: total }, async (_, index) => {
    const client = await open(pin, 'PLAYER');
    const group = Math.floor(index / 2);
    const name = group < collisionPairs ? `${index % 2 ? 'eQUIPE' : 'Equipe'} ${group}` : `Aluno ${index}`;
    expectType(await client.request('player.check_name', { pin, name }), 'name_status');
    const first = await client.request('player.join', { pin, name });
    const frame = first.message.code === 'NAME_TAKEN'
      ? await client.request('player.join', { pin, name: `Aluno ${index}` }) : first;
    const { playerId, reconnectToken } = expectType(frame, 'joined');
    sample('Entrada: upgrade até joined', frame.received - client.startedAt);
    sample('Entrada: join até joined', frame.received - frame.sent);
    joinedCount++;
    return { client, playerId, reconnectToken };
  }));
  const joinSpanMs = performance.now() - joinStart;
  assert.equal(new Set(bots.map(bot => bot.playerId)).size, total);
  assert.equal(rejected.nameTaken, collisionPairs, 'Colisões esperadas de nomes.');
  const lobbyReady = await host.wait('lobby_update', message => message.playerCount === total && message.players.every(player => player.connected));

  async function resume(bot, questionId, choice, offlineMs) {
    await bot.client.close();
    await sleep(offlineMs);
    bot.client = await open(pin, 'PLAYER');
    const frame = await bot.client.request('player.resume', { pin, playerId: bot.playerId, reconnectToken: bot.reconnectToken });
    const { snapshot } = expectType(frame, 'resumed');
    assert.equal(snapshot.questionId ?? questionId, questionId);
    assert.equal(snapshot.myAnswer, choice, 'A reconexão perdeu a resposta confirmada.');
    sample('Reconexão: resume até snapshot', frame.received - frame.sent);
    reconnects++;
  }

  async function answer(bot, questionId, choice, burst) {
    const frame = await bot.client.request('player.answer', { questionId, choice });
    const message = expectType(frame, 'answer_ack');
    assert.equal(message.status, 'accepted');
    assert.equal(message.choice, choice);
    sample(burst ? 'Rajada: resposta até ACK' : 'Aleatório: resposta até ACK', frame.received - frame.sent);
    return { sent: frame.sent, acceptedAt: message.acceptedAt };
  }

  let burstReport;
  for (let index = 1; index <= randomRounds + 1; index++) {
    const burst = index === randomRounds + 1;
    const opened = bots.map(bot => bot.client.wait('question_open', message => message.questionIndex === index));
    const sent = await command(host, index === 1 ? 'master.start' : 'master.next');
    const delivered = await Promise.all(opened);
    const { questionId } = delivered[0].message;
    for (const frame of delivered) sample(burst ? 'Rajada: MASTER start/next até abertura' : 'Aleatório: MASTER start/next até abertura', frame.received - sent);
    const reconnecting = new Set(burst ? [] : bots.map(bot => ({ bot, order: random() }))
      .sort((a, b) => a.order - b.order).slice(0, Math.floor(total / 10)).map(({ bot }) => bot));
    const closing = host.wait('question_reveal', message => message.questionId === questionId);
    const replies = await Promise.all(bots.map(async (bot, botIndex) => {
      const delays = [0, 110, 290, 480, 690];
      const delay = burst ? delays[Math.floor(botIndex * delays.length / total)] : 50 + Math.floor(random() * 1150);
      const choice = 'ABCDE'[Math.floor(random() * 5)];
      const offlineMs = reconnecting.has(bot) ? 40 + Math.floor(random() * 140) : 0;
      await sleep(delay);
      const result = await answer(bot, questionId, choice, burst);
      if (offlineMs) await resume(bot, questionId, choice, offlineMs);
      return result;
    }));
    const reveal = await closing;
    const frames = host.history.filter(({ message, received }) => message.type === 'answer_count' && message.questionId === questionId && received <= reveal.received);
    if (burst) {
      assert.equal(frames.at(-1)?.message.answeredCount, total, 'Contagem final ausente ou incorreta.');
      const regular = frames.slice(0, -1);
      const spacing = regular.slice(1).map(({ message }, i) => message.serverNow - regular[i].message.serverNow);
      const arrivalSpacing = regular.slice(1).map(({ received }, i) => Number((received - regular[i].received).toFixed(2)));
      const span = (items, key) => Math.max(...items.map(item => item[key])) - Math.min(...items.map(item => item[key]));
      const firstAnswerAt = Math.min(...replies.map(reply => reply.acceptedAt));
      burstReport = {
        respostas: replies.length, envioEmMs: Number(span(replies, 'sent').toFixed(2)), aceitasEmMs: span(replies, 'acceptedAt'),
        lotesRegulares: regular.map(({ message }) => ({ aposPrimeiraRespostaMs: message.serverNow - firstAnswerAt, total: message.answeredCount })),
        intervalosServidorMs: spacing, intervalosRecepcaoMs: arrivalSpacing,
        contagemFinal: frames.at(-1).message.answeredCount,
        intervaloUltimoLoteAteFlushFinalMs: frames.at(-1).message.serverNow - regular.at(-1)?.message.serverNow,
      };
    }
    await command(host, 'master.show_leaderboard');
  }

  return { joinSpanMs: Number(joinSpanMs.toFixed(2)), lobbyReadyMs: Number((lobbyReady.received - joinStart).toFixed(2)),
    duracaoMs: Number((performance.now() - start).toFixed(2)), rajada: burstReport };
}

let result;
try {
  result = await run();
  assert.equal(sourceAddresses.size, 1, 'As conexões saíram de mais de um IP TCP.');
  assert.equal(rejected.http429 + rejected.wsRateLimited, 0, 'Houve limitação de tráfego.');
  const burst = result.rajada;
  assert(burst.envioEmMs < 1000 && burst.aceitasEmMs < 1000, 'A rajada não coube em um segundo.');
  assert(burst.intervalosServidorMs.length > 0 && burst.intervalosServidorMs.every(ms => ms >= 245 && ms <= 400),
    'O answer_count saiu da tolerância de 245–400 ms durante a rajada.');
  assert(burst.lotesRegulares.every((batch, i, list) => i === 0 || batch.total > list[i - 1].total), 'Contagem da rajada não cresceu entre lotes.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify({
    bots: total, seed: Number(values.seed), rodadasAleatorias: randomRounds, origem: [...sourceAddresses],
    entradas: joinedCount, upgrades, reconexoes: reconnects, lobbyUpdates, rejeicoes: rejected,
    ...result, latenciaMs: Object.fromEntries([...metrics].map(([metric, values]) => [metric, summarize(values)])),
  }, null, 2));
  for (const socket of sockets) socket.terminate();
}
