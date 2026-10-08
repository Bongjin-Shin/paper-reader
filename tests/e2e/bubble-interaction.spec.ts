import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, select, wordBox } from './helpers';
import { makeScrollPdf } from '../performance/fixture';

const dialog = (page: Page) => page.getByRole('dialog');
const state = (page: Page) => page.evaluate(() => ['test-lookups', 'test-highlights', 'test-cost'].map(key => localStorage.getItem(key)));
async function translate(page: Page) {
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(dialog(page)).toContainText('점근적인');
  await expect(page.locator('.word-highlight')).toHaveCount(1);
}
async function clickHighlight(page: Page, occurrence = 0) {
  const word = await wordBox(page, 'asymptotic', occurrence);
  await page.mouse.click(word.x + word.width / 2, word.y + word.height / 2);
  await expect(dialog(page)).toContainText('점근적인');
}

test('pending and completed translations survive outside clicks; X never removes stored data or reopens on completion', async ({ page }) => {
  await installBackend(page, { delay: 650, fail: false, rotation: 0, userUnit: 1 }); await open(page);
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await page.mouse.click(20, 400); await expect(dialog(page)).toContainText('번역하는 중');
  await page.keyboard.press('Delete'); await page.keyboard.press('Escape'); await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: '말풍선 닫기' }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1); await expect(dialog(page)).toHaveCount(0);
  await clickHighlight(page); const before = await state(page);
  await page.mouse.click(20, 400); await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Delete'); await page.keyboard.press('Escape'); await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: '말풍선 닫기' }).click();
  expect(await state(page)).toEqual(before);
  await page.reload(); await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
});

for (const key of ['Escape', 'Delete']) {
  test(`one released click on a bubble followed by ${key} closes only the bubble`, async ({ page }) => {
    await installBackend(page); await open(page); await translate(page);
    await page.mouse.click(20, 400); await dialog(page).locator('strong').click();
    const before = await state(page);
    await page.keyboard.press(key); await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.word-highlight')).toHaveCount(1); expect(await state(page)).toEqual(before);
    await clickHighlight(page); await dialog(page).locator('strong').click(); await page.keyboard.press(key);
    await expect(dialog(page)).toHaveCount(0); expect(await state(page)).toEqual(before);
    expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(1);
  });
}

test('Delete removes only the clicked highlight, is undoable and leaves vocabulary/cache intact', async ({ page }) => {
  await installBackend(page); await open(page); await translate(page); await page.keyboard.press('Escape');
  await select(page, 'asymptotic', 1); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(2); await page.keyboard.press('Escape');
  const before = await state(page);
  const ids = await page.locator('.word-highlight').evaluateAll(els => els.map(el => el.getAttribute('data-highlight-id')));
  await clickHighlight(page); await page.keyboard.press('Delete');
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await expect(page.locator('.word-highlight')).toHaveAttribute('data-highlight-id', ids[1]!);
  expect((await state(page))[0]).toBe(before[0]); expect((await state(page))[2]).toBe(before[2]);
  await page.keyboard.press('Control+z'); await expect(page.locator('.word-highlight')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('.word-highlight')).toHaveCount(1);
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(2);
  await page.keyboard.press('Escape'); await select(page); await page.keyboard.press('Delete');
  await expect(page.locator('.word-highlight')).toHaveCount(1);
});

test('highlight deletion failures retain data and a new click on the bubble changes Delete to dismiss only', async ({ page }) => {
  await installBackend(page); await open(page); await translate(page); await page.keyboard.press('Escape');
  await clickHighlight(page); const before = await state(page);
  await page.evaluate(() => { (window as any).__removeFail = true; }); await page.keyboard.press('Delete');
  await expect(page.getByRole('alert')).toContainText('하이라이트를 취소하지 못했습니다.'); expect(await state(page)).toEqual(before);
  await page.evaluate(() => { (window as any).__removeFail = false; });
  await dialog(page).locator('strong').click(); await page.keyboard.press('Delete');
  await expect(dialog(page)).toHaveCount(0); expect(await state(page)).toEqual(before);
  await clickHighlight(page); await page.keyboard.press('Delete'); await expect(page.locator('.word-highlight')).toHaveCount(0);
});

test('an undragged bubble follows the word through scroll, completion and zoom without repainting Reader layers', async ({ page }) => {
  await installBackend(page, { delay: 600, fail: false, rotation: 0, userUnit: 1 }, makeScrollPdf(4)); await open(page);
  await select(page, 'asymptotic', 20); await page.getByRole('button', { name: '번역', exact: true }).click();
  await page.locator('.reader').evaluate(el => { el.scrollTop = 80; });
  await expect(dialog(page)).toContainText('점근적인');
  const aligned = async () => {
    const word = await wordBox(page, 'asymptotic', 20), box = (await dialog(page).boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - word.x - word.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height + 10 - word.y)).toBeLessThan(2);
  };
  await aligned();
  await dialog(page).locator('strong').click(); // Focus alone must not pin the bubble.
  await page.evaluate(() => {
    const host = document.querySelector('.pdf-page')!;
    (window as any).__readerMutations = 0;
    (window as any).__layerObserver = new MutationObserver(records => { (window as any).__readerMutations += records.length; });
    (window as any).__layerObserver.observe(host, { childList: true, subtree: true, attributes: true });
    (window as any).__surfaces = ['canvas', '.textLayer', '.word-highlight'].map(selector => host.querySelector(selector));
  });
  const before = (await dialog(page).boundingBox())!;
  await page.locator('.reader').evaluate(el => { el.scrollTop += 40; });
  await expect.poll(async () => (await dialog(page).boundingBox())!.y).toBeCloseTo(before.y - 40, 0);
  await aligned();
  expect(await page.evaluate(() => (window as any).__readerMutations)).toBe(0);
  expect(await page.evaluate(() => ['canvas', '.textLayer', '.word-highlight'].every((selector, index) =>
    document.querySelector(`.pdf-page ${selector}`) === (window as any).__surfaces[index]))).toBe(true);
  await page.evaluate(() => (window as any).__layerObserver.disconnect());
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.5'); await aligned();
  await page.getByRole('button', { name: '페이지 너비 맞춤' }).click();
  await expect.poll(async () => {
    const word = await wordBox(page, 'asymptotic', 20), box = (await dialog(page).boundingBox())!;
    return Math.abs(box.y + box.height + 10 - word.y);
  }).toBeLessThan(2);
});

test('dragged bubbles keep document placement through outside clicks, scroll and zoom, then new selections follow again', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(4)); await open(page);
  await select(page, 'asymptotic', 20); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(dialog(page)).toContainText('점근적인');
  const before = (await dialog(page).boundingBox())!, title = (await dialog(page).locator('strong').boundingBox())!;
  await page.mouse.move(title.x + 12, title.y + 8); await page.mouse.down();
  await page.mouse.move(title.x + 192, title.y + 128, { steps: 8 }); await page.mouse.up();
  const moved = (await dialog(page).boundingBox())!;
  expect(moved.x).toBeCloseTo(before.x + 180, 0); expect(moved.y).toBeCloseTo(before.y + 120, 0);
  const documentPoint = () => dialog(page).evaluate(el => {
    const box = el.getBoundingClientRect(), page = document.querySelector<HTMLElement>('.pdf-page')!, bounds = page.getBoundingClientRect();
    const scale = bounds.width / Number(page.dataset.pdfWidth);
    return { x: (box.x - bounds.x) / scale, y: (box.y - bounds.y) / scale };
  });
  const chosen = await documentPoint();
  await page.mouse.click(20, 400); await page.locator('.reader').evaluate(el => { el.scrollTop = 240; });
  expect((await dialog(page).boundingBox())!.y).toBeCloseTo(moved.y - 240, 0);
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.5');
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(async () => { const after = await documentPoint(); return Math.max(Math.abs(after.x - chosen.x), Math.abs(after.y - chosen.y)); }).toBeLessThan(.02);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.getByRole('button', { name: '말풍선 닫기' }).click();
  await page.locator('.reader').evaluate(el => { el.scrollTop = 0; });
  await select(page, 'asymptotic', 20);
  const fresh = (await dialog(page).boundingBox())!;
  await page.locator('.reader').evaluate(el => { el.scrollTop = 50; });
  await expect.poll(async () => (await dialog(page).boundingBox())!.y).toBeCloseTo(fresh.y - 50, 0);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(1);
});

test('error results survive outside clicks and can still be dragged, retried and closed', async ({ page }) => {
  await installBackend(page, { delay: 0, fail: true, rotation: 0, userUnit: 1 }); await open(page);
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(dialog(page)).toContainText('OpenAI 연결 실패'); await page.mouse.click(20, 400);
  await expect(dialog(page)).toBeVisible();
  const title = (await dialog(page).locator('strong').boundingBox())!;
  await page.mouse.move(title.x + 4, title.y + 4); await page.mouse.down();
  await page.mouse.move(title.x + 84, title.y + 164, { steps: 6 }); await page.mouse.up();
  const moved = (await dialog(page).boundingBox())!;
  await page.evaluate(() => { (window as any).__fail = false; });
  await page.getByRole('button', { name: '다시 시도' }).click(); await expect(dialog(page)).toContainText('점근적인');
  expect((await dialog(page).boundingBox())!.y).toBeCloseTo(moved.y, 0);
  await page.keyboard.press('Delete'); await expect(dialog(page)).toHaveCount(0); await expect(page.locator('.word-highlight')).toHaveCount(1);
});
