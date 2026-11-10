export { Room } from './room';

export interface Env {
  ROOMS: DurableObjectNamespace;
  DB: D1Database;
  ASSETS: Fetcher;
  IP_LIMIT?: RateLimit;
  ALLOWED_ORIGINS?: string;
}

const error = (code: string, status: number) => Response.json({ v: 1, type: 'error', code }, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '2' } : {}) } });

function randomPin() {
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= 4_294_000_000);
  return String(sample[0] % 1_000_000).padStart(6, '0');
}

function allowedOrigin(request: Request, origin: string, env: Env) {
  return request.headers.get('Origin') === origin || (env.ALLOWED_ORIGINS ?? '').split(',').some(value => value.trim() !== '' && value.trim() === request.headers.get('Origin'));
}

async function hasBody(request: Request) {
  const length = request.headers.get('Content-Length');
  if (length !== null && length !== '0') return true;
  if (!request.body) return false;

  // A browser POST with Content-Length: 0 may arrive as an empty stream.
  const reader = request.body.getReader();
  try {
    const { done } = await reader.read();
    if (!done) await reader.cancel();
    return !done;
  } finally {
    reader.releaseLock();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip && env.IP_LIMIT && !(await env.IP_LIMIT.limit({ key: ip })).success) return error('RATE_LIMITED', 429);

    if (url.pathname === '/api/rooms') {
      if (request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 405);
      if (request.headers.has('Origin') && !allowedOrigin(request, url.origin, env)) return error('FORBIDDEN_ORIGIN', 403);
      if (url.search || await hasBody(request)) return error('INVALID_PAYLOAD', 400);
      for (let attempt = 0; attempt < 16; attempt++) {
        const pin = randomPin();
        const room = env.ROOMS.get(env.ROOMS.idFromName(pin));
        const response = await room.fetch(`https://room.internal/create?pin=${pin}`, { method: 'POST' });
        if (response.status !== 409) return response;
        await response.body?.cancel();
      }
      return error('PIN_UNAVAILABLE', 503);
    }

    const match = /^\/api\/rooms\/([0-9]{6})\/ws$/.exec(url.pathname);
    if (!match) return error('NOT_FOUND', 404);
    if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 405);
    if (url.search || request.body) return error('INVALID_PAYLOAD', 400);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return error('UPGRADE_REQUIRED', 426);
    if (!allowedOrigin(request, url.origin, env)) return error('FORBIDDEN_ORIGIN', 403);
    const [, pin] = match;
    return env.ROOMS.get(env.ROOMS.idFromName(pin)).fetch(`https://room.internal/socket?pin=${pin}`, {
      headers: { Upgrade: 'websocket' },
    });
  },
} satisfies ExportedHandler<Env>;
