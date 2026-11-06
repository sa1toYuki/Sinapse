import { chromium } from "@playwright/test";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { preview } from "vite";

// Isolated browser profiles only. The user's browser preferences are never read or changed.
await mkdir("artifacts/zoom", { recursive: true });
const server = await preview({ preview: { host: "127.0.0.1", port: 5175 } });
const results = [];
async function audit(page, zoom, screen) {
  const result = await page.evaluate(() => {
    const visible = (node) =>
      node.getClientRects().length &&
      getComputedStyle(node).visibility !== "hidden";
    const width = document.documentElement.clientWidth;
    const overflow = [...document.querySelectorAll("body *")]
      .filter((node) => {
        if (!visible(node) || node.closest(".stage-decor,.stage-lights"))
          return false;
        const r = node.getBoundingClientRect();
        return r.width > 0 && (r.left < -1 || r.right > width + 1);
      })
      .map((node) => `${node.tagName}.${node.className}`);
    const clipped = [
      ...document.querySelectorAll(
        "button,h1,p,.answer-text,.score,.opening-credit",
      ),
    ]
      .filter(
        (node) =>
          visible(node) &&
          (node.scrollWidth > node.clientWidth + 1 ||
            node.scrollHeight > node.clientHeight + 1),
      )
      .map((node) => `${node.tagName}.${node.className}`);
    const header = document.querySelector("header").getBoundingClientRect();
    const content = document.querySelector(".screen").getBoundingClientRect();
    const footer = document.querySelector("footer").getBoundingClientRect();
    return {
      width,
      height: innerHeight,
      dpr: devicePixelRatio,
      scrollWidth: document.documentElement.scrollWidth,
      overflow,
      clipped,
      overlap:
        header.bottom > content.top + 1 || content.bottom > footer.top + 1,
    };
  });
  assert.equal(
    result.width,
    result.scrollWidth,
    `${zoom} ${screen}: horizontal scroll`,
  );
  assert.deepEqual(
    result.overflow,
    [],
    `${zoom} ${screen}: overflowing elements`,
  );
  assert.deepEqual(result.clipped, [], `${zoom} ${screen}: clipped text`);
  assert.equal(result.overlap, false, `${zoom} ${screen}: shell overlap`);
  results.push({ zoom, screen, ...result });
  await page.evaluate(() => window.scrollTo(0, 0));
  // Capture the native surface: Playwright's CSS-sized clip crops real browser
  // zoom captures instead of preserving the full physical viewport.
  const session = await page.context().newCDPSession(page);
  const { data } = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`artifacts/zoom/${zoom}-${screen}.png`, Buffer.from(data, 'base64'));
  await session.detach();
}
try {
  const requestedZooms = process.argv.slice(2).map(Number);
  const zooms = requestedZooms.length ? requestedZooms : [1, 1.5, 2, 3, 4];
  assert.ok(zooms.every(zoom => [1, 1.5, 2, 3, 4].includes(zoom)));
  for (const zoom of zooms) {
    const profile = await mkdtemp(join(tmpdir(), "sinapse-zoom-"));
    await mkdir(join(profile, "Default"));
    await writeFile(
      join(profile, "Default", "Preferences"),
      JSON.stringify({
        partition: {
          default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) },
        },
      }),
    );
    const context = await chromium.launchPersistentContext(profile, {
      channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
      viewport: null,
      reducedMotion: "reduce",
      args: ["--window-size=1920,1080", "--force-device-scale-factor=1"],
    });
    try {
      const page = context.pages()[0];
      const cdp = await context.newCDPSession(page);
      const { windowId, bounds } = await cdp.send("Browser.getWindowForTarget");
      const initial = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      }));
      // Calibrate the content area, excluding native window decorations, to 1920×1080
      // physical pixels. Do not override CSS viewport metrics or simulate CSS zoom.
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: {
          width: bounds.width + Math.round(1920 - initial.width * initial.dpr),
          height:
            bounds.height + Math.round(1080 - initial.height * initial.dpr),
        },
      });
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      await page.goto("http://127.0.0.1:5175");
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
        outer: outerWidth,
      }));
      console.log(zoom, metrics);
      assert.ok(
        Math.abs(metrics.dpr - zoom) < 0.01,
        "The browser must apply real page zoom",
      );
      assert.ok(
        Math.abs(metrics.width - 1920 / zoom) <= 1,
        "Calibrated content width",
      );
      await audit(page, zoom, "opening");
      await page.getByRole("button", { name: "JOGAR AGORA" }).click();
      await audit(page, zoom, "menu");
      await page.getByRole("button", { name: /COMO JOGAR/ }).click();
      await audit(page, zoom, "rules");
      await page.getByRole("button", { name: /ENTENDI/ }).click();
      await page.getByRole("button", { name: /MODO SOLO/ }).click();
      await page.getByRole("textbox").fill("WWWWWWWWWWWWWWWWWWWW");
      await audit(page, zoom, "solo-setup");
      await page.getByRole("button", { name: /COMEÇAR O JOGO/ }).click();
      await page.reload();
      await page.getByRole("button", { name: "JOGAR AGORA" }).click();
      await page.getByRole("button", { name: /MODO SOLO/ }).click();
      await audit(page, zoom, "resume");
      await page
        .getByRole("button", { name: "CONTINUAR", exact: true })
        .click();
      const correct = "BDAECBADECBADECBA";
      for (let index = 0; index < 17; index++) {
        await audit(page, zoom, `solo-question-${index + 1}`);
        await page.keyboard.press(correct[index].toLowerCase());
        await page.getByRole("button", { name: /CONFIRMAR RESPOSTA/ }).click();
        await audit(page, zoom, `solo-feedback-${index + 1}`);
        await page
          .getByRole("button", {
            name: index === 16 ? /VER RESULTADO/ : /PRÓXIMA/,
          })
          .click();
      }
      await audit(page, zoom, "solo-end");
      await page.getByRole("button", { name: /VOLTAR AO MENU/ }).click();
      await page.getByRole("button", { name: /DOIS JOGADORES/ }).click();
      await audit(page, zoom, "multi-setup");
      await page.getByRole("button", { name: /COMEÇAR O JOGO/ }).click();
      for (let index = 0; index < 17; index++) {
        await audit(page, zoom, `multi-question-${index + 1}`);
        await page.keyboard.press("QWERT"["ABCDE".indexOf(correct[index])]);
        await audit(page, zoom, `multi-feedback-${index + 1}`);
        await page
          .getByRole("button", {
            name: index === 16 ? /VER RESULTADO/ : /PRÓXIMA/,
          })
          .click();
      }
      await audit(page, zoom, "multi-end");
    } finally {
      await context.close();
      // Only remove the unique profile created above, within the temporary root.
      assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
      assert.ok(basename(profile).startsWith("sinapse-zoom-"));
      await rm(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  }
  await writeFile(
    "artifacts/zoom/results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(`${results.length} screen checks passed at real browser zoom.`);
} finally {
  await new Promise((done) => server.httpServer.close(done));
}
