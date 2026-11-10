import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const wrangler = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
const port = process.env.SINAPSE_DEV_WORKER_PORT || '8787';
const workerUrl = `http://127.0.0.1:${port}`;
const persistence = process.env.SINAPSE_DEV_PERSIST_TO;
const local = ['--local', ...(persistence ? ['--persist-to', persistence] : [])];
const running = new Set();
const stopping = new AbortController();

function start(cli, args, { env = process.env, stdin = 'inherit' } = {}) {
  const child = spawn(process.execPath, [cli, ...args], { stdio: [stdin, 'inherit', 'inherit'], env });
  running.add(child);
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('close', (code) => {
      running.delete(child);
      if (stopping.signal.aborted) return resolveExit();
      if (code === 0) return resolveExit();
      rejectExit(new Error(`${cli} ${args.join(' ')} saiu com código ${code ?? 'desconhecido'}.`));
    });
  });
}

function stop() {
  stopping.abort();
  for (const child of running) child.kill();
}

async function waitForWorker() {
  const deadline = Date.now() + 45_000;
  while (!stopping.signal.aborted && Date.now() < deadline) {
    const signal = AbortSignal.any([stopping.signal, AbortSignal.timeout(1_000)]);
    const response = await fetch(`${workerUrl}/api/ranking`, { signal }).catch(() => null);
    await response?.body?.cancel();
    if (response?.ok) return;
    await delay(200, undefined, { signal: stopping.signal });
  }
  throw new Error(`O Worker ou o D1 local não ficou disponível em ${workerUrl}.`);
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  await start(wrangler, ['d1', 'migrations', 'apply', 'DB', ...local], { stdin: 'ignore' });
  if (!stopping.signal.aborted) await start(vite, ['build']);
  if (!stopping.signal.aborted) {
    const worker = start(wrangler, ['dev', ...local, '--ip', '127.0.0.1', '--port', port, '--show-interactive-dev-session=false']);
    await Promise.race([
      worker,
      (async () => {
        await waitForWorker();
        await start(vite, ['--host', '0.0.0.0', ...process.argv.slice(2)], {
          env: { ...process.env, SINAPSE_DEV_WORKER_URL: workerUrl },
        });
      })(),
    ]);
  }
} catch (error) {
  if (!stopping.signal.aborted) {
    console.error(error.message);
    process.exitCode = 1;
  }
} finally {
  stop();
}
