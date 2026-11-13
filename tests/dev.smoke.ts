import { expect, test } from '@playwright/test';

test('npm run dev abre uma sala pelo menu e inicia uma pergunta com um jogador', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jogar agora' }).click();
  await page.getByRole('link', { name: 'Sala ao vivo' }).click();

  const created = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/rooms' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar sala' }).click();
  expect((await created).status()).toBe(201);
  const pin = page.locator('.master-pin');
  await expect(pin).toHaveText(/^\d{6}$/);

  const phone = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const player = await phone.newPage();
    const invite = await page.getByRole('img', { name: /QR code da sala/ }).getAttribute('data-url');
    await player.goto(invite!);
    await expect(player.getByLabel('PIN', { exact: true })).toHaveValue((await pin.textContent())!);
    await player.getByLabel('Nome').fill('Jogador de teste');
    await player.getByRole('button', { name: 'Entrar', exact: true }).tap();
    await expect(player.getByText('Aguardando início')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remover Jogador de teste' })).toBeVisible();

    await page.getByRole('button', { name: 'Iniciar partida' }).click();
    await expect(page.getByRole('button', { name: 'Encerrar pergunta' })).toBeVisible();
    await expect(player.getByRole('group', { name: 'Alternativas' }).getByRole('button')).toHaveText(['A', 'B', 'C', 'D', 'E']);
    await player.getByRole('button', { name: 'B', exact: true }).tap();
    await expect(player.getByRole('heading', { name: /^(Acertou|Errou)$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top 5' })).toBeVisible();
    await page.getByRole('button', { name: 'Próxima pergunta' }).click();
    await expect(player.getByRole('group', { name: 'Alternativas' })).toBeVisible();

    const ranking = await page.request.get('/api/ranking');
    expect(ranking.status()).toBe(200);
    expect(await ranking.json()).toEqual({ rankingId: null, entries: [] });
  } finally {
    await phone.close();
  }
});
