import { expect, test } from '@playwright/test';
import { serverQuestions } from '../worker/questions.server';

test('entra pelo QR, valida o nome, responde uma vez e recupera a sessão', async ({ page, browser, baseURL }, info) => {
  test.skip(info.project.name !== 'estreito', 'O fluxo PLAYER usa a tela de celular.');
  const mobile = { baseURL, viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true };
  const firstContext = await browser.newContext(mobile);
  const secondContext = await browser.newContext(mobile);
  try {
    await page.goto('/?master=1');
    await page.getByRole('button', { name: 'Criar sala' }).click();
    const pinDisplay = page.locator('.master-pin');
    await expect(pinDisplay).toHaveText(/^\d{6}$/);
    const pin = (await pinDisplay.textContent())!;
    const invite = (await page.getByRole('img', { name: /QR code da sala/ }).getAttribute('data-url'))!;

    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    const sentAnswers: string[] = [];
    const questionFrames: Record<string, unknown>[] = [];
    first.on('websocket', socket => {
      socket.on('framesent', ({ payload }) => {
        const frame = JSON.parse(String(payload));
        if (frame.type === 'player.answer') sentAnswers.push(frame.choice);
      });
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(String(payload));
        if (frame.type === 'question_open') questionFrames.push(frame);
      });
    });

    await first.goto(invite);
    await expect(first.getByLabel('PIN', { exact: true })).toHaveValue(pin);
    await first.getByLabel('Nome').fill('Érica');
    await first.getByRole('button', { name: 'Entrar', exact: true }).tap();
    await expect(first.getByText('Aguardando início')).toBeVisible();
    await expect.poll(() => first.evaluate(() => Boolean(localStorage.getItem('sinapse:player')))).toBe(true);

    await second.goto('/?player=1');
    await second.getByLabel('PIN', { exact: true }).fill(pin);
    await second.getByLabel('Nome').fill('ÉRICA');
    await expect(second.getByRole('alert')).toHaveText('Nome em uso.');
    await second.getByRole('button', { name: 'Entrar', exact: true }).tap();
    await expect(second.getByRole('alert')).toHaveText('Nome em uso.');
    await second.getByLabel('Nome').fill('Renato');
    await second.getByRole('button', { name: 'Entrar', exact: true }).tap();
    await expect(second.getByText('Aguardando início')).toBeVisible();

    await page.getByRole('button', { name: 'Remover Renato' }).click();
    await expect(page.getByRole('button', { name: 'Remover Renato' })).toHaveCount(0);
    await expect(second.getByRole('alert')).toHaveText('Removido da sala.');
    expect(await second.evaluate(() => localStorage.getItem('sinapse:player') === null)).toBe(true);
    await second.getByRole('button', { name: 'Entrar', exact: true }).tap();
    await expect(second.getByText('Aguardando início')).toBeVisible();

    await page.getByRole('button', { name: 'Iniciar partida' }).click();
    await expect(page.getByRole('button', { name: 'Encerrar pergunta' })).toBeVisible();
    const alternatives = first.getByRole('group', { name: 'Alternativas' });
    await expect(alternatives.getByRole('button')).toHaveText(['A', 'B', 'C', 'D', 'E']);
    await expect(alternatives.getByRole('button', { name: 'A', exact: true })).toBeEnabled();
    const question = serverQuestions[0];
    await expect(first.getByText(question.text)).toHaveCount(0);
    await expect(first.getByText(question.options[question.correct], { exact: true })).toHaveCount(0);
    expect(questionFrames).toHaveLength(1);
    for (const key of ['text', 'options', 'correct']) expect(key in questionFrames[0]).toBe(false);
    expect(await alternatives.getByRole('button').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 44))).toBe(true);
    expect(await first.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await first.screenshot({ path: info.outputPath('player-alternativas.png') });

    await alternatives.evaluate((group, correct) => {
      const buttons = Array.from(group.querySelectorAll('button'));
      buttons.find(button => button.textContent === correct)!.click();
      buttons.find(button => button.textContent !== correct)!.click();
    }, question.correct);
    await expect(first.getByRole('main')).toHaveText('Enviado');
    expect(sentAnswers).toEqual([question.correct]);

    await firstContext.setOffline(true);
    const reconnecting = first.getByRole('status', { name: 'Reconectando' });
    await expect(reconnecting).toBeVisible();
    await expect(first.getByRole('main')).toHaveText('Enviado');
    await firstContext.setOffline(false);
    await expect(reconnecting).toHaveCount(0);
    await first.reload();
    await expect(first.getByRole('main')).toHaveText('Enviado');
    expect(sentAnswers).toEqual([question.correct]);

    const wrong = question.correct === 'A' ? 'B' : 'A';
    await second.getByRole('button', { name: wrong, exact: true }).tap();
    await expect(first.getByRole('heading', { name: 'Acertou' })).toBeVisible();
    await expect(first.getByText('1º lugar')).toBeVisible();
    await expect(first.getByText(/^\+[1-9][\d.]* pts$/)).toBeVisible();
    await first.screenshot({ path: info.outputPath('player-revelacao.png') });
    await expect(second.getByRole('heading', { name: 'Errou' })).toBeVisible();
    await expect(second.getByText('2º lugar')).toBeVisible();
    await expect(second.getByText('+0 pts')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top 5' })).toBeVisible();
    await first.reload();
    await expect(first.getByText('1º lugar')).toBeVisible();
    await expect(first.getByText('1º lugar')).toBeVisible();
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
