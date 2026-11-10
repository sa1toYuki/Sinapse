import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';
import { serverQuestions } from '../worker/questions.server';

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test('conduz a partida pelo Worker até o pódio e retoma a sala após recarregar', async ({ page, context }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jogar agora' }).click();
  await page.getByRole('link', { name: 'Sala ao vivo' }).click();
  await page.getByRole('button', { name: 'Criar sala' }).click();
  const pinDisplay = page.locator('.master-pin');
  await expect(pinDisplay).toHaveText(/^\d{6}$/);
  const pin = (await pinDisplay.textContent())!;
  const qr = page.getByRole('img', { name: `QR code da sala ${pin}` });
  await expect(qr).toHaveAttribute('data-url', new URL(`/?pin=${pin}`, page.url()).href);
  expect(await qr.locator('path').getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
  await expect(page.getByRole('button', { name: 'Iniciar partida' })).toBeDisabled();

  const players = await context.newPage();
  await players.goto('/');
  const names = ['MMMMMMMMMMMMMMMMMMMM', 'Beatriz', 'Caio', 'Duda', 'Elisa', 'Filipe'];
  await players.evaluate(async ({ pin, names }) => {
    const url = new URL(`/api/rooms/${pin}/ws`, location.href);
    url.protocol = 'ws:';
    const sockets = await Promise.all(names.map(name => new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => socket.send(JSON.stringify({ v: 1, type: 'player.join', requestId: crypto.randomUUID(), name, pin })));
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.type === 'joined') resolve(socket);
        if (message.type === 'error') reject(new Error(message.code));
      });
      socket.addEventListener('error', () => reject(new Error('WebSocket failed')));
    })));
    Object.assign(window, { testPlayers: sockets });
  }, { pin, names });
  await expect(page.locator('.master-players li')).toHaveCount(6);
  await expect(page.getByText(names[0], { exact: true })).toBeVisible();
  await fits(page);
  await page.screenshot({ path: info.outputPath('lobby.png'), fullPage: true });

  await page.getByRole('button', { name: 'Iniciar partida' }).click();
  await expect(page.getByRole('heading', { name: serverQuestions[0].text })).toBeVisible();
  await expect(page.locator('.master-answers .correct')).toHaveCount(0);
  await expect(page.getByRole('timer').locator('strong')).toHaveText(/^(30|29)$/);
  await expect(page.getByRole('timer').locator('strong')).not.toHaveText('30');
  await players.evaluate(({ questionId, choice }) => {
    const { testPlayers } = window as Window & { testPlayers?: WebSocket[] };
    testPlayers![0].send(JSON.stringify({ v: 1, type: 'player.answer', requestId: crypto.randomUUID(), questionId, choice }));
  }, { questionId: serverQuestions[0].id, choice: serverQuestions[0].correct });
  await expect(page.locator('.master-count strong')).toHaveText('1 / 6');
  await fits(page);
  await page.screenshot({ path: info.outputPath('pergunta.png'), fullPage: true });

  await page.getByRole('button', { name: 'Encerrar pergunta' }).click();
  const correct = page.locator('.master-answers .correct');
  await expect(correct).toContainText(serverQuestions[0].options[serverQuestions[0].correct]);
  await page.reload();
  await expect(correct).toContainText(serverQuestions[0].options[serverQuestions[0].correct]);
  await fits(page);

  await page.getByRole('button', { name: 'Ver ranking' }).click();
  await expect(page.getByRole('heading', { name: 'Top 5' })).toBeVisible();
  await expect(page.locator('.master-ranking li')).toHaveCount(5);
  await expect(page.locator('.master-ranking li').first()).toContainText(names[0]);
  await fits(page);

  for (const question of serverQuestions.slice(1)) {
    await page.getByRole('button', { name: 'Próxima pergunta' }).click();
    await expect(page.getByRole('heading', { name: question.text })).toBeVisible();
    await page.getByRole('button', { name: 'Encerrar pergunta' }).click();
    await page.getByRole('button', { name: 'Ver ranking' }).click();
  }
  await page.getByRole('button', { name: 'Ver pódio' }).click();
  await expect(page.getByRole('heading', { name: 'Pódio final' })).toBeVisible();
  await expect(page.locator('.master-podium li')).toHaveCount(3);
  await expect(page.locator('.master-podium [data-rank="1"]')).toContainText(names[0]);
  const ranking = page.getByRole('table', { name: 'Ranking final' });
  await expect(ranking.locator('tbody tr')).toHaveCount(6);
  await expect(ranking.locator('tbody tr').first().getByRole('rowheader')).toHaveText(names[0]);
  await expect(ranking.getByRole('cell', { name: '08:30', exact: true })).toHaveCount(5);
  await fits(page);
  await page.screenshot({ path: info.outputPath('podio.png'), fullPage: true });
  const publicPath = await page.getByRole('link', { name: 'Ranking público' }).getAttribute('href');
  expect(publicPath).toMatch(/^\/ranking\?game=[a-f0-9-]{36}$/);
  await page.reload();
  await expect(ranking.locator('tbody tr')).toHaveCount(6);
  const expectedRows = await ranking.locator('tbody tr').allTextContents();
  await players.goto(publicPath!);
  await expect(players.getByRole('heading', { name: 'Ranking final' })).toBeVisible();
  await expect(players.getByRole('table', { name: 'Ranking final' }).locator('tbody tr')).toHaveText(expectedRows);
  await fits(players);
  await players.close();
});

test('mantém PIN, QR e controles acessíveis com zoom de navegador a 400%', async ({ baseURL, channel }, info) => {
  test.skip(info.project.name !== 'telão', 'O zoom usa um perfil de navegador separado.');
  const profile = info.outputPath('edge-profile');
  const defaults = join(profile, 'Default');
  await mkdir(defaults, { recursive: true });
  await writeFile(join(defaults, 'Preferences'), JSON.stringify({
    partition: { default_zoom_level: { x: Math.log(4) / Math.log(1.2) } },
  }));
  const browser = await chromium.launchPersistentContext(profile, {
    channel,
    viewport: null,
    args: ['--window-size=1366,768', '--force-device-scale-factor=1'],
  });
  try {
    const page = browser.pages()[0];
    await page.goto(new URL('/?master=1', baseURL).href);
    expect(await page.evaluate(() => devicePixelRatio)).toBeCloseTo(4, 2);
    await page.getByRole('button', { name: 'Criar sala' }).click();
    await expect(page.locator('.master-pin')).toHaveText(/^\d{6}$/);
    await expect(page.getByRole('img', { name: /QR code da sala/ })).toBeVisible();
    const start = page.getByRole('button', { name: 'Iniciar partida' });
    await start.scrollIntoViewIfNeeded();
    await expect(start).toBeInViewport();
    await fits(page);
  } finally {
    await browser.close();
  }
});
