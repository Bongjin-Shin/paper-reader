import { test, expect } from '@playwright/test';
import { installBackend, open, startPageTranslation } from './helpers';

test('long translations scroll within pages, then hand off at both boundaries without moving the PDF', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => { (window as any).__longPageTranslation = '페이지 안에서 긴 번역을 끝까지 읽습니다. '.repeat(80) + '**마지막 문장**'; });
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  const cards = page.locator('.translation-page'), pane = page.locator('.translation-content'), reader = page.locator('.reader');
  const first = page.getByRole('region', { name: '1페이지 번역 내용', exact: true });
  const second = page.getByRole('region', { name: '2페이지 번역 내용', exact: true });
  await expect(first.locator('.translated-sentence')).toHaveCount(4);
  const checkBounds = async () => {
    const bounds = await cards.evaluateAll(els => els.map(el => {
      const box = el.getBoundingClientRect(), body = el.querySelector('.translation-page-content')!;
      const content = body.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height, contentBottom: content.bottom,
        clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, overflow: getComputedStyle(el).overflow };
    }));
    expect(bounds[0].height).toBeLessThan(1200);
    expect(bounds[0].clientHeight).toBeGreaterThan(100);
    expect(bounds[0].scrollHeight).toBeGreaterThan(bounds[0].clientHeight * 3);
    expect(bounds[0].contentBottom).toBeLessThan(bounds[0].bottom);
    expect(bounds[1].top - bounds[0].bottom).toBeGreaterThanOrEqual(20);
    expect(bounds[0].overflow).toBe('hidden');
  };
  await checkBounds();
  const readerTop = await reader.evaluate(el => el.scrollTop), paneTop = await pane.evaluate(el => el.scrollTop);
  const headerTop = (await cards.first().locator('.translation-page-header').boundingBox())!.y;
  const bodyBox = (await first.boundingBox())!;
  await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2); await page.mouse.wheel(0, 400);
  await expect.poll(() => first.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  expect(await pane.evaluate(el => el.scrollTop)).toBe(paneTop);
  expect(await reader.evaluate(el => el.scrollTop)).toBe(readerTop);
  expect((await cards.first().locator('.translation-page-header').boundingBox())!.y).toBe(headerTop);
  await first.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(first.locator('strong').last()).toBeInViewport();
  const firstTop = await first.evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBeGreaterThan(paneTop + 100);
  expect(await first.evaluate(el => el.scrollTop)).toBe(firstTop);
  expect(await reader.evaluate(el => el.scrollTop)).toBe(readerTop);
  await page.getByRole('button', { name: '다음 번역 페이지' }).click();
  await second.getByRole('button', { name: '이 페이지 번역', exact: true }).click();
  await expect(second.locator('.translated-sentence').first()).toBeVisible();
  const secondPaneTop = await pane.evaluate(el => el.scrollTop);
  const secondBox = (await second.boundingBox())!;
  await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2); await page.mouse.wheel(0, 300);
  await expect.poll(() => second.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  expect(await first.evaluate(el => el.scrollTop)).toBe(firstTop);
  expect(await pane.evaluate(el => el.scrollTop)).toBe(secondPaneTop);
  expect(await reader.evaluate(el => el.scrollTop)).toBe(readerTop);
  // At the top of a page, continuing upward returns to the preceding page.
  await second.evaluate(el => { el.scrollTop = 0; });
  await page.mouse.wheel(0, -250);
  await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBeLessThan(secondPaneTop - 100);
  expect(await second.evaluate(el => el.scrollTop)).toBe(0);
  expect(await reader.evaluate(el => el.scrollTop)).toBe(readerTop);
  // At the end of the complete translation, chaining must still stop here.
  await pane.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await second.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const bottomBox = (await second.boundingBox())!, paneBox = (await pane.boundingBox())!;
  await page.mouse.move(bottomBox.x + bottomBox.width / 2, Math.min(bottomBox.y + bottomBox.height / 2, paneBox.y + paneBox.height - 20));
  const bottom = await pane.evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, 500);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await pane.evaluate(el => el.scrollTop)).toBe(bottom);
  expect(await reader.evaluate(el => el.scrollTop)).toBe(readerTop);
  await page.getByRole('button', { name: '이전 번역 페이지' }).click();
  expect(await first.evaluate(el => el.scrollTop)).toBe(firstTop);
  const handle = page.getByRole('separator', { name: '번역창 너비 조절' }); await handle.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await checkBounds();
  await first.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(first.locator('strong').last()).toBeInViewport();
  // A wide page must still fit vertically so its final line remains reachable.
  await handle.focus();
  for (let i = 0; i < 24; i++) await page.keyboard.press('ArrowLeft');
  await checkBounds();
  await first.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(first.locator('strong').last()).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: '.tools/page-scroll-qa/page-scroll.png' });
});
