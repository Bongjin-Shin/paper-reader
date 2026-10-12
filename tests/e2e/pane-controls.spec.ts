import { expect, test, type Locator } from '@playwright/test';
import { installBackend, open, select, startPageTranslation } from './helpers';

const font = (locator: Locator) => locator.evaluate(el => parseFloat(getComputedStyle(el).fontSize));

test('word translation and explanation send the sentence for the selected occurrence', async ({ page }) => {
  await installBackend(page); await open(page); await select(page, 'asymptotic', 0);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await page.getByRole('button', { name: '말풍선 닫기' }).click();
  await select(page, 'asymptotic', 1);
  await page.getByRole('button', { name: '설명', exact: true }).click();
  const requests = await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'lookup_word').map((c: any) => c.args.request));
  expect(requests.map((r: any) => [r.word, r.originalSentence, r.action])).toEqual([
    ['asymptotic', 'The model maintains an asymptotic linear complexity.', 'translation'],
    ['asymptotic', 'Another asymptotic result appears here.', 'explanation'],
  ]);
});

test('chat width persists, preserves drafts and manual PDF scale, and clamps to the window', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await page.getByLabel('논문 질문').fill('입력 중인 질문');
  const handle = page.getByRole('separator', { name: '논문 채팅창 너비 조절' });
  const before = (await page.locator('.chat-container').boundingBox())!.width;
  const scale = await page.locator('.reader').getAttribute('data-display-scale');
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 130); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 150, b.y + 130, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await page.locator('.chat-container').boundingBox())!.width).toBeCloseTo(before + 150, 0);
  await expect(page.locator('.reader')).toHaveAttribute('data-display-scale', scale!);
  await expect(page.getByLabel('논문 질문')).toHaveValue('입력 중인 질문');
  await expect(page.getByRole('button', { name: '페이지 너비 맞춤' })).toHaveAttribute('aria-pressed', 'false');
  await handle.focus(); await page.keyboard.press('ArrowRight');
  const resized = (await page.locator('.chat-container').boundingBox())!.width;
  await page.getByRole('button', { name: '논문 채팅 닫기' }).click();
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.getByLabel('논문 질문')).toHaveValue('입력 중인 질문');
  await page.reload(); await open(page); await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  expect((await page.locator('.chat-container').boundingBox())!.width).toBeCloseTo(resized, 0);
  await page.setViewportSize({ width: 700, height: 900 });
  await expect.poll(async () => (await page.locator('.reader').boundingBox())!.width).toBeGreaterThanOrEqual(320);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(async () => (await page.locator('.chat-container').boundingBox())!.width).toBeCloseTo(resized, 0);
});

test('translation and chat zoom independently with buttons, wheel and keyboard and remember sizes', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await installBackend(page); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  await page.evaluate(() => { (window as any).__chatMarkdown = '수식입니다. $r_i^s = x^2$\n\n자세한 설명입니다.'; });
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await page.getByLabel('논문 질문').fill('수식을 설명해줘'); await page.getByRole('button', { name: '질문 보내기' }).click();
  const answer = page.locator('.chat-answer'); await expect(answer.locator('.katex')).toHaveCount(1);
  const paragraph = page.locator('.translation-paragraph').first();
  const scale = await page.locator('.reader').getAttribute('data-display-scale');
  await page.getByRole('button', { name: '번역 확대', exact: true }).click();
  expect(await font(paragraph)).toBeCloseTo(16.5);
  expect(await font(answer)).toBe(13);
  await paragraph.hover(); await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: '번역 글자 크기 초기화' })).toHaveText('120%');
  await expect(page.locator('.reader')).toHaveAttribute('data-display-scale', scale!);
  await answer.hover(); await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: '채팅 글자 크기 초기화' })).toHaveText('110%');
  expect(await font(answer)).toBeCloseTo(14.3);
  expect(await font(answer.locator('.katex'))).toBeCloseTo(14.3 * 1.08, 1);
  await page.getByLabel('논문 질문').fill('보존되는 질문'); await page.keyboard.press('Control+-');
  await expect(page.getByRole('button', { name: '채팅 글자 크기 초기화' })).toHaveText('100%');
  await expect(page.getByLabel('논문 질문')).toHaveValue('보존되는 질문');
  await page.getByRole('button', { name: '채팅 확대', exact: true }).click();
  await page.screenshot({ path: 'test-results/pane-controls.png' });
  await page.reload(); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  await expect(page.getByRole('button', { name: '번역 글자 크기 초기화' })).toHaveText('120%');
  await expect(page.getByRole('button', { name: '채팅 글자 크기 초기화' })).toHaveText('110%');
  await page.getByRole('button', { name: '번역 글자 크기 초기화' }).click();
  await expect(page.getByRole('button', { name: '번역 글자 크기 초기화' })).toHaveText('100%');
  await expect(page.locator('.reader')).toHaveAttribute('data-display-scale', scale!);
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => ['ask_paper', 'translate_page'].includes(c.command)))).toHaveLength(0);
});

test('quota shows actual time remaining and refreshes it after returning to the app', async ({ page }) => {
  await installBackend(page); await open(page);
  const now = Date.parse('2026-10-12T12:00:00+09:00');
  await page.clock.setFixedTime(now);
  await page.evaluate(now => { (window as any).__subscriptionUsage = { updatedAt: now / 1000, buckets: [{ id: 'codex', name: 'Codex', primary: null,
    secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: now / 1000 + 2 * 86400 + 3 * 3600 } }] }; }, now);
  await page.getByRole('button', { name: '논문 채팅', exact: true }).click();
  const quota = page.getByLabel('구독 잔여 사용량');
  await expect(quota).toContainText('주간 60% 남음');
  await expect(quota).toContainText('2일 3시간 후 초기화');
  await page.clock.setFixedTime(now + 86400000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(quota).toContainText('1일 3시간 후 초기화');
  await page.clock.setFixedTime(now + 3 * 86400000);
  await page.evaluate(() => { (window as any).__subscriptionUsageError = true; window.dispatchEvent(new Event('focus')); });
  await expect(quota).toContainText('초기화 시각 경과');
  await expect(quota).toContainText('갱신 실패 · 이전 조회값');
  await expect(quota).toContainText('60% 남음');
  await page.evaluate(() => { (window as any).__subscriptionUsageError = false; const usage = (window as any).__subscriptionUsage;
    usage.buckets[0].secondary = { usedPercent: 0, windowDurationMins: 10080, resetsAt: Date.now() / 1000 + 7 * 86400 }; });
  await quota.getByRole('button', { name: '구독 사용량 새로고침' }).click();
  await expect(quota).toContainText('100% 남음'); await expect(quota).toContainText('7일 후 초기화');
  await expect(quota).not.toContainText('갱신 실패');
});
