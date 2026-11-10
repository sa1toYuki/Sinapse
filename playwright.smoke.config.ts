import { randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';

const baseURL = 'http://localhost:5192';

export default defineConfig({
  testDir: './tests',
  testMatch: 'dev.smoke.ts',
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5192 --strictPort',
    url: baseURL,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      SINAPSE_DEV_WORKER_PORT: '8798',
      SINAPSE_DEV_PERSIST_TO: `.wrangler/dev-smoke-${randomUUID()}`,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: '.wrangler/dev-smoke.log',
    },
  },
});
