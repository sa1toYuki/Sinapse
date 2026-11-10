import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { serverQuestions as questions } from "../worker/questions.server";

async function audit(
  page: Page,
  name: string,
  info: TestInfo,
  screenshot = true,
) {
  const geometry = await page.evaluate(() => {
    const visible = (node: Element) =>
      node.getClientRects().length &&
      getComputedStyle(node).visibility !== "hidden";
    const width = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("body *")]
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
      .filter((node) => {
        if (!visible(node)) return false;
        const el = node as HTMLElement;
        return (
          el.scrollWidth > el.clientWidth + 1 ||
          el.scrollHeight > el.clientHeight + 1
        );
      })
      .map((node) => `${node.tagName}.${node.className}: ${node.textContent}`);
    const footer = document.querySelector("footer")!.getBoundingClientRect();
    const screen = document.querySelector(".screen")!.getBoundingClientRect();
    const header = document.querySelector("header")!.getBoundingClientRect();
    return {
      width,
      scrollWidth: document.documentElement.scrollWidth,
      offenders,
      clipped,
      headerOverlap: header.bottom > screen.top + 1,
      footerOverlap: screen.bottom > footer.top + 1,
    };
  });
  expect(geometry, name).toMatchObject({
    scrollWidth: geometry.width,
    offenders: [],
    clipped: [],
    headerOverlap: false,
    footerOverlap: false,
  });
  if (screenshot) {
    await page.evaluate(() => window.scrollTo(0, 0));
    // Keep device emulation intact: Edge can reset pointer media queries when
    // Playwright temporarily resizes a mobile viewport for a full-page capture.
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
  }
}

async function start(page: Page, mode: "solo" | "multi") {
  await page.getByRole("button", { name: /JOGAR AGORA/ }).click();
  await page
    .getByRole("button", {
      name: mode === "solo" ? /MODO SOLO/ : /DOIS JOGADORES/,
    })
    .click();
  await page.getByRole("button", { name: /COMEÇAR O JOGO/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.goto("/");
});

test("opening, menu, both modals and complete solo game reflow without clipping", async ({
  page,
}, info) => {
  await audit(page, "opening", info);
  expect(
    await page
      .locator(".start")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "JOGAR AGORA" }).click();
  await audit(page, "menu", info);
  await page.getByRole("button", { name: /COMO JOGAR/ }).click();
  await audit(page, "rules", info);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /COMO JOGAR/ })).toBeFocused();
  await page.getByRole("button", { name: /MODO SOLO/ }).click();
  await page.getByRole("textbox").fill("WWWWWWWWWWWWWWWWWWWW");
  await audit(page, "solo-setup", info);
  await page.getByRole("button", { name: /COMEÇAR O JOGO/ }).click();
  await page.reload();
  await page.getByRole("button", { name: "JOGAR AGORA" }).click();
  await page.getByRole("button", { name: /MODO SOLO/ }).click();
  await audit(page, "resume", info);
  await page.getByRole("button", { name: "CONTINUAR", exact: true }).click();
  for (const [index, question] of questions.entries()) {
    await audit(
      page,
      `solo-question-${index + 1}`,
      info,
      index === 0 || index === 14,
    );
    await expect(page.locator('.step[aria-current="step"]')).toHaveAttribute(
      "aria-label",
      new RegExp(`^${index + 1}:`),
    );
    if (page.viewportSize()!.width < 1280) {
      const areas = await page
        .locator(
          ".ladder,.game-meta,.timer,.question-panel,.answer-section,.scores",
        )
        .evaluateAll((nodes) =>
          Object.fromEntries(
            nodes.map((n) => [
              n.classList[0],
              n.getBoundingClientRect().top + window.scrollY,
            ]),
          ),
        );
      expect(areas.ladder).toBeLessThan(areas["game-meta"]);
      expect(areas["game-meta"]).toBeLessThan(areas.timer);
      expect(areas.timer).toBeLessThan(areas["question-panel"]);
      expect(areas["question-panel"]).toBeLessThan(areas["answer-section"]);
      expect(areas["answer-section"]).toBeLessThan(areas.scores);
    }
    await page
      .locator(".answer")
      .filter({
        has: page.locator(".answer-letter", { hasText: question.correct }),
      })
      .click();
    await page.getByRole("button", { name: /CONFIRMAR RESPOSTA/ }).click();
    await audit(
      page,
      `solo-feedback-${index + 1}`,
      info,
      index === 0 || index === 14,
    );
    await page
      .getByRole("button", { name: index === 16 ? /VER RESULTADO/ : /PRÓXIMA/ })
      .click();
  }
  await audit(page, "solo-end", info);
  await page.getByRole("button", { name: /JOGAR DE NOVO/ }).click();
  await page.locator(".answer").first().click();
  await page.getByRole("button", { name: /CONFIRMAR RESPOSTA/ }).click();
  await expect(page.locator(".feedback")).toContainText("Não foi dessa vez!");
  await audit(page, "solo-wrong", info);
});

test("multi supports individual touch controls, locks and a complete game", async ({
  page,
}, info) => {
  await page.getByRole("button", { name: "JOGAR AGORA" }).click();
  await page.getByRole("button", { name: /DOIS JOGADORES/ }).click();
  await page.getByRole("textbox").nth(0).fill("WWWWWWWWWWWWWWWWWWWW");
  await page.getByRole("textbox").nth(1).fill("MMMMMMMMMMMMMMMMMMMM");
  await audit(page, "multi-setup", info);
  const touch = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  expect(touch).toBe(!!info.project.use.hasTouch);
  if (touch) await expect(page.locator(".keyboard-hint").first()).toBeHidden();
  await page.getByRole("button", { name: /COMEÇAR O JOGO/ }).click();
  for (const [index, question] of questions.entries()) {
    await audit(
      page,
      `multi-question-${index + 1}`,
      info,
      index === 0 || index === 14,
    );
    const wrong = question.correct === "A" ? "B" : "A";
    if (touch) {
      const first = page.locator(".player-0.player-controls .answer");
      const second = page.locator(".player-1.player-controls .answer");
      expect(
        await first.first().evaluate((el) => el.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(44);
      await first
        .filter({ has: page.locator(".answer-letter", { hasText: wrong }) })
        .tap();
      await expect(first.first()).toBeDisabled();
      await expect(second.first()).toBeEnabled();
      await second
        .filter({
          has: page.locator(".answer-letter", { hasText: question.correct }),
        })
        .tap();
    } else {
      await page.keyboard.press("QWERT"["ABCDE".indexOf(wrong)]);
      await page.keyboard.press("YUIOP"["ABCDE".indexOf(question.correct)]);
    }
    await expect(page.locator(".feedback")).toContainText(
      "MMMMMMMMMMMMMMMMMMMM respondeu primeiro!",
    );
    await audit(page, `multi-feedback-${index + 1}`, info, index === 0);
    await page
      .getByRole("button", { name: index === 16 ? /VER RESULTADO/ : /PRÓXIMA/ })
      .click();
  }
  await expect(page.locator(".result-card h1")).toContainText(
    "MMMMMMMMMMMMMMMMMMMM venceu!",
  );
  await audit(page, "multi-end", info);
});

test("keyboard focus, reduced motion, zoom shortcuts and timeout remain available", async ({
  page,
}, info) => {
  await start(page, "solo");
  await page.keyboard.press("b");
  await expect(page.locator(".answer.selected .answer-letter")).toHaveText("B");
  const zoomBlocked = await page.evaluate(() => {
    const events = ["+", "-", "0"].map(
      (key) =>
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
    );
    events.forEach((event) => window.dispatchEvent(event));
    const wheel = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(wheel);
    return [...events, wheel].some((event) => event.defaultPrevented);
  });
  expect(zoomBlocked).toBe(false);
  await page.locator(".answer").first().focus();
  const focus = await page
    .locator(".answer")
    .first()
    .evaluate((el) => ({
      outline: getComputedStyle(el).outlineStyle,
      clip: getComputedStyle(el).clipPath,
      animation: getComputedStyle(el).animationName,
    }));
  expect(focus).toEqual({ outline: "solid", clip: "none", animation: "none" });
  await page.clock.fastForward(31_000);
  await expect(page.locator(".feedback")).toContainText("O tempo acabou!");
  await audit(page, "timeout", info);
});
