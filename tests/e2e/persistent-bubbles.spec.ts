import { expect, test, type Page, type Locator } from '@playwright/test';
import { installBackend, open, wordBox } from './helpers';
import { makeScrollPdf } from '../performance/fixture';
const bubbles = (page: Page) => page.locator('.word-bubble');
async function selectWord(page: Page, word: string, occurrence: number) {
  const box = await wordBox(page, word, occurrence);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const bubble = page.getByRole('dialog', { name: `${word} 단어 도구`, exact: true });
  await expect(bubble).toBeVisible(); return bubble;
}
async function move(bubble: Locator, page: Page, dx: number, dy: number) {
  const box = (await bubble.boundingBox())!;
  await page.mouse.move(box.x + 15, box.y + 15); await page.mouse.down();
  await page.mouse.move(box.x + 15 + dx, box.y + 15 + dy, { steps: 8 }); await page.mouse.up();
}
async function selection(page: Page) { return page.evaluate(() => window.getSelection()?.toString()); }

test('unrequested menus dismiss on outside clicks, are replaced by new selections and never survive navigation', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(6)); await open(page);
  const first = await selectWord(page, 'asymptotic', 20);
  await page.mouse.click(20, 600); await expect(first).toHaveCount(0);
  await selectWord(page, 'asymptotic', 20);
  const second = await selectWord(page, 'decision-making', 30);
  await expect(bubbles(page)).toHaveCount(1); await expect(first).toHaveCount(0);
  await second.click({ position: { x: 3, y: 3 } });
  expect(await selection(page)).toBe('decision-making');
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Reader', exact: true }).click();
  await expect(bubbles(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('clicking a retained result dismisses only the temporary menu; retry promotes its own menu safely', async ({ page }) => {
  await installBackend(page, { delay: 0, fail: true, rotation: 0, userUnit: 1 }, makeScrollPdf(6)); await open(page);
  const result = await selectWord(page, 'asymptotic', 20);
  await result.getByRole('button', { name: '번역', exact: true }).click();
  await expect(result).toContainText('OpenAI 연결 실패');
  const menu = await selectWord(page, 'decision-making', 32);
  await expect(bubbles(page)).toHaveCount(2);
  await result.locator('strong').click();
  await expect(menu).toHaveCount(0); await expect(result).toContainText('OpenAI 연결 실패');
  expect(await selection(page)).toBe('asymptotic');
  await selectWord(page, 'decision-making', 32);
  await page.evaluate(() => { (window as any).__fail = false; });
  await result.getByRole('button', { name: '다시 시도' }).click();
  await expect(menu).toHaveCount(0); await expect(result).toContainText('점근적인');
  await page.mouse.click(20, 600); await expect(result).toBeVisible();
});

test('pending results survive other lookups, navigation and highlight deletion until explicitly closed', async ({ page }) => {
  await installBackend(page, { delay: 700, fail: false, rotation: 0, userUnit: 1 }, makeScrollPdf(6)); await open(page);
  const first = await selectWord(page, 'asymptotic', 20);
  await first.getByRole('button', { name: '번역', exact: true }).click();
  const second = await selectWord(page, 'decision-making', 32);
  await second.getByRole('button', { name: '설명', exact: true }).click();
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.vocabulary-word')).toHaveText('asymptotic');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
  await page.getByRole('button', { name: '뒤로가기', exact: true }).click();
  await expect(first).toContainText('점근적인'); await expect(second).toContainText('극한에서');
  await expect(bubbles(page)).toHaveCount(2);
  const marked = await wordBox(page, 'asymptotic', 20);
  await page.mouse.click(marked.x + marked.width / 2, marked.y + marked.height / 2);
  const saved = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '하이라이트 취소' }) });
  await saved.getByRole('button', { name: '하이라이트 취소' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: '말풍선 닫기' }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(0); await expect(first).toContainText('점근적인');
  await page.keyboard.press('Control+z'); await expect(page.locator('.word-highlight')).toHaveCount(1);
  await expect(first).toBeVisible(); await expect(second).toBeVisible();
  await second.locator('strong').click(); expect(await selection(page)).toBe('decision-making');
  await first.locator('strong').click(); expect(await selection(page)).toBe('asymptotic');
  await page.keyboard.press('Delete'); await expect(first).toHaveCount(0); await expect(second).toBeVisible();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
});

test('dragged bubbles stay at a PDF location through both-axis scrolling, zoom and resize', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(6)); await open(page);
  const bubble = await selectWord(page, 'asymptotic', 20);
  await bubble.getByRole('button', { name: '번역', exact: true }).click(); await expect(bubble).toContainText('점근적인');
  await move(bubble, page, 200, 120);
  const point = () => bubble.evaluate(el => {
    const b = el.getBoundingClientRect(), p = document.querySelector<HTMLElement>('.pdf-page')!, r = p.getBoundingClientRect(), scale = r.width / Number(p.dataset.pdfWidth);
    return { x: (b.x - r.x) / scale, y: (b.y - r.y) / scale };
  });
  const original = await point();
  const motion = await bubble.evaluate(el => {
    const r = document.querySelector('.reader')!, b = el.getBoundingClientRect(), style = el.getAttribute('style'); r.scrollTop += 350;
    return { dy: el.getBoundingClientRect().y - b.y, sameStyle: style === el.getAttribute('style') };
  });
  expect(motion.dy).toBeCloseTo(-350, 0); expect(motion.sameStyle).toBe(true);
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.5');
  await page.setViewportSize({ width: 800, height: 650 });
  await page.locator('.reader').evaluate(el => { el.scrollLeft = 120; el.scrollTop += 1000; });
  await expect.poll(async () => { const p = await point(); return Math.max(Math.abs(p.x - original.x), Math.abs(p.y - original.y)); }).toBeLessThan(.02);
  expect((await bubble.boundingBox())!.y).toBeLessThan(0);
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Reader', exact: true }).click();
  await expect.poll(async () => { const p = await point(); return Math.max(Math.abs(p.x - original.x), Math.abs(p.y - original.y)); }).toBeLessThan(.02);
  await page.locator('.reader').evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
  await expect(bubble).toBeInViewport();
});

for (const mode of ['drag', 'triple'] as const) test(`clicking a ${mode} sentence bubble restores precisely its original selection after zoom`, async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(6)); await open(page);
  const a = await wordBox(page, 'The model', 15), b = await wordBox(page, 'decision-making.', 17);
  if (mode === 'triple') await page.mouse.click(a.x + 10, a.y + a.height / 2, { clickCount: 3 });
  else {
    await page.mouse.move(a.x + .2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width - .2, b.y + b.height / 2, { steps: 10 }); await page.mouse.up();
  }
  const selected = await selection(page); expect(selected?.length).toBeGreaterThan(30);
  const bubble = page.getByRole('dialog', { name: '선택 텍스트 도구' });
  await expect(bubbles(page)).toHaveCount(1);
  await bubble.getByRole('button', { name: '설명', exact: true }).click(); await expect(bubble).toContainText('선택한 문맥 전체에 대한 설명');
  await move(bubble, page, 200, 150);
  await page.mouse.click(20, 700); expect(await selection(page)).toBe('');
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.5');
  await bubble.locator('strong').click(); expect(await selection(page)).toBe(selected);
  await page.mouse.click(20, 700); await page.locator('.reader').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.locator('.reader').evaluate(el => { el.scrollTop = 0; });
  await bubble.locator('strong').click(); await expect.poll(() => selection(page)).toBe(selected);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-lookups') ?? '[]').length)).toBe(0);
});

test('opening another PDF hides its previous bubbles and returning restores them without a new request', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(6)); await open(page);
  const bubble = await selectWord(page, 'asymptotic', 20);
  await bubble.getByRole('button', { name: '번역', exact: true }).click(); await expect(bubble).toContainText('점근적인');
  await move(bubble, page, 180, 100); const before = (await bubble.boundingBox())!;
  await page.evaluate(() => (window as any).__emitFileDrag({ type: 'drop', paths: ['/papers/second.pdf'] }));
  await expect(page.locator('.document-title')).toHaveText('second.pdf'); await expect(bubbles(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'test-paper.pdf', exact: true }).dblclick();
  await expect(bubble).toContainText('점근적인');
  const after = (await bubble.boundingBox())!; expect(after.x).toBeCloseTo(before.x, 0); expect(after.y).toBeCloseTo(before.y, 0);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(1);
});

test('identical words restore the correct occurrence and survive evicted PDF text layers', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(24)); await open(page);
  let box = await wordBox(page, 'asymptotic', 20);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const firstId = await bubbles(page).getAttribute('data-bubble-id');
  const first = page.locator(`[data-bubble-id="${firstId}"]`);
  await first.getByRole('button', { name: '설명', exact: true }).click(); await expect(first).toContainText('극한에서');
  box = await wordBox(page, 'asymptotic', 32);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const secondId = await page.locator('.word-bubble.action-bubble').getAttribute('data-bubble-id');
  const second = page.locator(`[data-bubble-id="${secondId}"]`);
  await second.getByRole('button', { name: '설명', exact: true }).click(); await expect(second).toContainText('극한에서');
  await expect(bubbles(page)).toHaveCount(2);
  await page.mouse.click(20, 700);
  await page.evaluate(() => { window.getSelection()?.removeAllRanges(); (window as any).__oldText = document.querySelector('.textLayer'); });
  for (const number of [4, 8, 12, 16, 20, 24]) {
    await page.locator(`.pdf-page[data-page-number="${number}"]`).evaluate(el => {
      const reader = document.querySelector('.reader')!;
      reader.scrollTop += el.getBoundingClientRect().top - reader.getBoundingClientRect().top - 30;
    });
    await expect(page.locator(`.pdf-page[data-page-number="${number}"]`)).toHaveAttribute('data-rendered-scale', '1.25');
    await expect(page.locator('.page-message')).toHaveCount(0);
  }
  await expect.poll(() => page.evaluate(() => (window as any).__oldText.isConnected)).toBe(false);
  await page.locator('.reader').evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
  for (const [bubble, occurrence] of [[first, 20], [second, 32]] as const) {
    await bubble.click({ position: { x: 3, y: 3 } });
    expect(await selection(page)).toBe('asymptotic');
    const range = await page.evaluate(() => { const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect(); return { x: r.x, y: r.y }; });
    const expected = await wordBox(page, 'asymptotic', occurrence);
    expect(range.x).toBeCloseTo(expected.x, 0); expect(range.y).toBeCloseTo(expected.y, 0);
  }
});
