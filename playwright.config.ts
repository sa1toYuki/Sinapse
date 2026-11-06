import { defineConfig } from "@playwright/test";

const sizes = [
  [1920, 1080],
  [1366, 768],
  [1280, 720],
  [1024, 768],
  [820, 1180],
  [390, 844],
  [844, 390],
  [360, 640],
  [320, 640],
];

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 5000 },
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
  },
  projects: sizes.map(([width, height]) => ({
    name: `${width}x${height}`,
    use: {
      viewport: { width, height },
      hasTouch: width < 1280,
      isMobile: width < 1280,
    },
  })),
});
