import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { preview } from "vite";
const server = await preview({ preview: { host: "127.0.0.1", port: 5176 } });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: "reduce",
  });
  const output = "artifacts/desktop";
  await mkdir(output, { recursive: true });
  await page.goto("http://127.0.0.1:5176");
  const measurements = {};
  async function capture(name) {
    await page.screenshot({ path: `${output}/${name}.png` });
    measurements[name] = await page
      .locator(
        ".logo-name,.start,.opening-note,.menu-card,.setup-card,.game,.question-panel,.answers,.game-side,.sound,footer",
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          selector: node.className || node.tagName,
          rect: node.getBoundingClientRect().toJSON(),
          font: getComputedStyle(node).fontSize,
        })),
      );
  }
  await capture("opening");
  await page.getByRole("button", { name: "JOGAR AGORA" }).click();
  await capture("menu");
  await page.getByRole("button", { name: /MODO SOLO/ }).click();
  await capture("setup");
  await page.getByRole("button", { name: /COMEÇAR O JOGO/ }).click();
  await capture("game");
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify(measurements, null, 2),
  );
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
