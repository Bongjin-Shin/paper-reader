import { expect, test } from '@playwright/test';
import { installBackend, open, select } from './helpers';

test('ChatGPT login, cancel, completion, logout and provider choice persist', async ({ page }) => {
  await installBackend(page); await page.goto('/');
  await page.getByRole('button', { name: '번역 연결 설정' }).click();
  await page.getByLabel('번역 방식').selectOption('chatgpt');
  await expect(page.getByRole('button', { name: 'API 예상 잔액 설정' })).toHaveCount(0);
  await page.getByRole('button', { name: 'ChatGPT 로그인', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '번역 연결 설정' }).getByRole('status')).toContainText('브라우저');
  await page.getByRole('button', { name: '로그인 취소' }).click();
  await expect(page.getByRole('dialog', { name: '번역 연결 설정' }).getByRole('status')).toContainText('로그인이 필요');
  await page.getByRole('button', { name: 'ChatGPT 로그인', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('test-chatgpt-connected', 'true'));
  await expect(page.getByRole('dialog', { name: '번역 연결 설정' }).getByRole('status')).toContainText('연결됨');
  await page.reload();
  await expect(page.getByRole('button', { name: '번역 연결 설정' })).toContainText('ChatGPT');
  await page.getByRole('button', { name: '번역 연결 설정' }).click();
  await expect(page.getByRole('dialog', { name: '번역 연결 설정' }).getByRole('status')).toContainText('연결됨');
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.getByRole('dialog', { name: '번역 연결 설정' }).getByRole('status')).toContainText('로그인이 필요');
  await page.getByLabel('번역 방식').selectOption('api');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('button', { name: 'API 예상 잔액 설정' })).toBeVisible();
});

test('subscription lookup saves and restores vocabulary and highlights without API costs; cache crosses providers', async ({ page }) => {
  await installBackend(page);
  await page.addInitScript(() => { localStorage.setItem('test-provider', 'chatgpt'); localStorage.setItem('test-chatgpt-connected', 'true'); localStorage.setItem('test-credit', '5'); });
  await open(page); await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('점근적인', { exact: true })).toBeVisible();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  expect(await page.evaluate(() => ({ api: (window as any).__apiCalls, chat: (window as any).__chatgptCalls, cost: localStorage.getItem('test-cost') })))
    .toEqual({ api: 0, chat: 1, cost: null });
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await expect(page.locator('.vocabulary-page')).toContainText('점근적인');
  await page.getByRole('button', { name: 'PDF Reader', exact: true }).click();
  await page.getByRole('button', { name: '번역 연결 설정' }).click();
  await page.getByLabel('번역 방식').selectOption('api');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'asymptotic 단어 도구' })).toContainText('점근적인');
  await page.getByRole('button', { name: '말풍선 닫기' }).click();
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('점근적인', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
  await expect(page.getByRole('button', { name: 'API 예상 잔액 설정' })).toContainText('$5.00');
});

test('subscription limits never call API or save failed results', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => { localStorage.setItem('test-chatgpt-connected', 'true'); (window as any).__chatgptLimit = true; });
  await page.getByRole('button', { name: '번역 연결 설정' }).click();
  await page.getByLabel('번역 방식').selectOption('chatgpt');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('ChatGPT 구독 사용 한도에 도달했습니다. API로 자동 전환하지 않습니다.')).toBeVisible();
  await expect(page.locator('.word-highlight')).toHaveCount(0);
  expect(await page.evaluate(() => ({ api: (window as any).__apiCalls, words: localStorage.getItem('test-lookups'), cost: localStorage.getItem('test-cost') })))
    .toEqual({ api: 0, words: null, cost: null });
});

test('missing runtime is actionable and connection panel fits a narrow window', async ({ page }) => {
  await installBackend(page); await page.goto('/');
  await page.evaluate(() => { (window as any).__codexMissing = true; });
  await page.setViewportSize({ width: 640, height: 650 });
  await page.getByRole('button', { name: '번역 연결 설정' }).click();
  await page.getByLabel('번역 방식').selectOption('chatgpt');
  await expect(page.getByText('Codex 연결 도구가 없습니다.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ChatGPT 로그인', exact: true })).toBeDisabled();
  const box = await page.getByRole('dialog', { name: '번역 연결 설정' }).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(640);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '번역 연결 설정' })).toHaveCount(0);
});
