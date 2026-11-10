import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['master.e2e.ts', 'player.e2e.ts'],
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:8791',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'telão', use: { viewport: { width: 1366, height: 768 } } },
    { name: 'estreito', use: { viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: 'npm run build && wrangler d1 migrations apply DB --local --persist-to .wrangler/master-e2e && wrangler dev --local --ip 127.0.0.1 --port 8791 --persist-to .wrangler/master-e2e',
    url: 'http://127.0.0.1:8791',
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '.wrangler/master-e2e.log' },
  },
});
