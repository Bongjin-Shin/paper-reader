import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, select, wordBox } from './helpers';
import { makeScrollPdf } from '../performance/fixture';

async function visit(page: Page, number: number) {
  const target = page.locator(`.pdf-page[data-page-number="${number}"]`);
  await target.evaluate(el => {
    const reader = document.querySelector('.reader')!;
    reader.scrollTop += el.getBoundingClientRect().top - reader.getBoundingClientRect().top - 30;
  });
  await expect(target).toHaveAttribute('data-rendered-scale', '1.25');
  await expect(page.locator('.page-message')).toHaveCount(0);
}

async function fling(page: Page, numbers: number[]) {
  await page.evaluate(async numbers => {
    const reader = document.querySelector<HTMLElement>('.reader')!;
    for (const number of numbers) {
      reader.scrollTop = document.querySelector<HTMLElement>(`.pdf-page[data-page-number="${number}"]`)!.offsetTop;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }, numbers);
}

test('fast flings and reversals leave the destination selectable with aligned highlights and bubble', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installBackend(page, undefined, makeScrollPdf()); await open(page);
  await fling(page, [3, 7, 12, 18, 24, 20, 11, 4, 16]);
  const target = page.locator('.pdf-page[data-page-number="16"]');
  await expect(target).toHaveAttribute('data-rendered-scale', '1.25');
  await select(page, 'decision-making', 0, 16);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(target.locator('.word-highlight')).toHaveCount(1);
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(target).toHaveAttribute('data-rendered-scale', '1.5');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('decision-making');
  const word = await wordBox(page, 'decision-making', 0, 16);
  const highlight = (await target.locator('.word-highlight').boundingBox())!;
  const bubble = (await page.getByRole('dialog').boundingBox())!;
  expect(Math.abs(highlight.x - word.x)).toBeLessThan(1);
  expect(Math.abs(highlight.y - word.y)).toBeLessThan(1);
  // Edge-clamped bubbles still stay next to the selected line.
  expect(Math.min(Math.abs(bubble.y + bubble.height - word.y), Math.abs(bubble.y - word.y - word.height))).toBeLessThan(20);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await fling(page, [1, 6, 24, 16]);
  await expect(target).toHaveAttribute('data-rendered-scale', '1.5');
  await expect(target.locator('.word-highlight')).toHaveCount(1);
  await expect(page.locator('.page-message')).toHaveCount(0);
  await expect.poll(() => page.locator('.canvas-layer canvas').count()).toBeLessThanOrEqual(8);
  expect(errors).toEqual([]);
});

test('zoom and PDF drop interrupt a fast traversal without stuck loading or stale layers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installBackend(page, undefined, makeScrollPdf()); await open(page);
  await fling(page, [5, 12, 24]);
  await page.getByRole('button', { name: '페이지 너비 맞춤' }).click();
  await expect(page.locator('.pdf-page[data-page-number="24"]')).toHaveAttribute('data-rendered-scale');
  await expect.poll(() => page.locator('.reader').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await fling(page, [18, 8, 3]);
  await page.evaluate(() => (window as any).__emitFileDrag({ type: 'drop', paths: ['/papers/fast-drop.pdf'] }));
  await expect(page.locator('.document-title')).toHaveText('fast-drop.pdf');
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale');
  await expect(page.locator('.page-message')).toHaveCount(0);
  await select(page);
  expect(errors).toEqual([]);
});

test('nearby revisits reuse the same canvas/text nodes and preserve saved highlights and selection', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf()); await open(page);
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).__firstCanvas = document.querySelector('.canvas-layer canvas');
    (window as any).__firstText = document.querySelector('.textLayer');
  });
  await visit(page, 4); await visit(page, 1);
  expect(await page.evaluate(() => (window as any).__firstCanvas === document.querySelector('.canvas-layer canvas') &&
    (window as any).__firstText === document.querySelector('.textLayer'))).toBe(true);
  await select(page);
  const word = await wordBox(page);
  const highlight = await page.locator('.word-highlight').boundingBox();
  expect(Math.abs(highlight!.x - word.x)).toBeLessThan(1);
  expect(Math.abs(highlight!.y - word.y)).toBeLessThan(1);
});

test('long scrolling evicts old surfaces, then restores text and highlights on return', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf()); await open(page);
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.getSelection()?.removeAllRanges(); (window as any).__old = document.querySelector('canvas'); });
  for (const number of [4, 8, 12, 16, 20, 24]) {
    await visit(page, number);
    await expect.poll(() => page.locator('.canvas-layer canvas').count()).toBeLessThanOrEqual(8);
  }
  expect(await page.evaluate(() => [(window as any).__old.isConnected, (window as any).__old.width])).toEqual([false, 0]);
  await visit(page, 1);
  await expect(page.locator('.pdf-page').first().locator('.word-highlight')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__old === document.querySelector('canvas'))).toBe(false);
  await select(page, 'decision-making');
  await expect(page.getByRole('dialog', { name: 'decision-making 단어 도구' })).toBeVisible();
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.5');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('decision-making');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('multi-page drag selection remains selectable through zoom and gives a phrase result', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf()); await open(page);
  for (let n = 0; n < 3; n++) await page.getByRole('button', { name: '축소', exact: true }).click();
  const pages = page.locator('.pdf-page');
  await expect(pages.nth(1)).toHaveAttribute('data-rendered-scale', '0.5');
  const first = pages.first().locator('.textLayer span').last();
  const last = pages.nth(1).locator('.textLayer span').first();
  const selected = `${await first.innerText()}\n${await last.innerText()}`;
  const a = (await first.boundingBox())!, b = (await last.boundingBox())!;
  await page.mouse.move(a.x + .1, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width - .1, b.y + b.height / 2, { steps: 15 }); await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '선택 텍스트 도구' })).toBeVisible();
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(pages.nth(1)).toHaveAttribute('data-rendered-scale', '0.75');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('선택한 전체 문장의 번역입니다.')).toBeVisible();
  const text = await page.evaluate(() => (window as any).__calls.find((c: any) => c.command === 'lookup_text').args.request.selectedText);
  expect(text).toBe(selected);
  await expect(page.locator('.word-highlight')).toHaveCount(0);
});

test('replacing a deeply scrolled PDF cancels stale page work and uses a fresh cache', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installBackend(page, undefined, makeScrollPdf()); await open(page);
  await visit(page, 12);
  await page.evaluate(() => {
    (window as any).__renderErrors = [];
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('.page-message[role="alert"]')) (window as any).__renderErrors.push(el.textContent);
    }).observe(document.querySelector('.reader')!, { subtree: true, childList: true, attributes: true });
  });
  // Both mocked drops share paper-b: a new loading task must never reuse its predecessor's page proxies.
  for (const name of ['replacement.pdf', 'again.pdf']) {
    await page.evaluate(name => { (window as any).__emitFileDrag({ type: 'drop', paths: [`/papers/${name}`] }); }, name);
    await expect(page.locator('.document-title')).toHaveText(name);
    await expect(page.locator('.pdf-page').first().locator('.textLayer span').first()).toBeVisible();
  }
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
  await expect(page.locator('.page-message')).toHaveCount(0);
  await expect.poll(() => page.locator('.canvas-layer canvas').count()).toBeLessThanOrEqual(8);
  await select(page);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as any).__renderErrors)).toEqual([]);
});

test.describe('high DPI backing-store limits', () => {
  test.use({ deviceScaleFactor: 3 });
  test('caps canvas pixels while preserving PDF coordinates and word highlights', async ({ page }) => {
    await installBackend(page, { delay: 0, fail: false, rotation: 0, userUnit: 3 }); await open(page);
    const sizes = await page.locator('.canvas-layer canvas').first().evaluate((c: HTMLCanvasElement) => ({ pixels: c.width * c.height,
      cssWidth: parseFloat(c.style.width), pageWidth: c.parentElement!.parentElement!.getBoundingClientRect().width }));
    expect(sizes.pixels).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(sizes.cssWidth).toBeCloseTo(sizes.pageWidth, 1);
    await select(page, 'The');
    await page.getByRole('button', { name: '번역', exact: true }).click();
    await expect(page.locator('.word-highlight')).toHaveCount(1);
    const word = await wordBox(page, 'The');
    const highlight = (await page.locator('.word-highlight').boundingBox())!;
    expect(Math.abs(highlight.x - word.x)).toBeLessThan(1);
    expect(Math.abs(highlight.y - word.y)).toBeLessThan(1);
  });
});
