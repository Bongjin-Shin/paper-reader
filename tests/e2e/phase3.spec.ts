import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { installBackend, open } from './helpers';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const preview = (page: Page) => page.getByRole('dialog', { name: '인쇄 미리보기', exact: true });
async function seed(page: Page, count = 2) {
  await page.evaluate(count => {
    localStorage.setItem('test-papers', JSON.stringify([{ id: 'paper-a', title: 'Paper A' }, { id: 'paper-b', title: 'Paper B' }]));
    localStorage.setItem('test-lookups', JSON.stringify(Array.from({ length: count }, (_, i) => [
      { entryId: i + 1, word: `term-${String(i).padStart(3, '0')}`, paperId: 'paper-a', pageNumber: 2,
        originalSentence: `Context A for term ${i}.`, action: 'translation', text: `한국어 뜻 ${i}` },
      { entryId: i + 1, word: `term-${String(i).padStart(3, '0')}`, paperId: 'paper-a', pageNumber: 2,
        originalSentence: `Context A for term ${i}.`, action: 'explanation', text: `문맥에 맞는 설명 ${i}` },
      { entryId: i + 1, word: `term-${String(i).padStart(3, '0')}`, paperId: 'paper-b', pageNumber: 7,
        originalSentence: `Context B for term ${i}.`, action: 'translation', text: `다른 뜻 ${i}` },
    ]).flat()));
  }, count);
  await button(page, 'Vocabulary').click();
  await expect(page.getByRole('checkbox', { name: 'term-000 선택', exact: true })).toBeVisible();
}
async function setup(page: Page, count = 2) {
  await installBackend(page); await page.goto('/'); await seed(page, count);
}
async function ready(page: Page) {
  await expect(preview(page).getByRole('button', { name: '시스템 인쇄', exact: true })).toBeEnabled();
  await expect(preview(page).locator('canvas')).toBeVisible();
}
async function pdfText(bytes: number[]) {
  const task = getDocument({ data: new Uint8Array(bytes) });
  try {
    const pdf = await task.promise; const text: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), size = page.getViewport({ scale: 1 });
      expect(size.width).toBeCloseTo(595.28, 1); expect(size.height).toBeCloseTo(841.89, 1);
      text.push((await page.getTextContent()).items.filter(item => 'str' in item).map(item => item.str).join(' '));
    }
    return text.join(' ');
  } finally { await task.destroy(); }
}

test('Vocabulary has no learning state controls and retains selection, meanings and zoom in both views', async ({ page }) => {
  await setup(page);
  await page.getByRole('checkbox', { name: 'term-000 선택', exact: true }).check();
  for (const mode of ['Simple View', 'Detailed View']) {
    await button(page, mode).click();
    await expect(page.getByRole('combobox', { name: /학습 상태/ })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'term-000 선택', exact: true })).toBeChecked();
    await expect(page.getByText('다른 뜻 0', { exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 640, height: 900 });
  await button(page, 'Simple View').click();
  await button(page, 'Vocabulary 확대').click(); await button(page, 'Vocabulary 확대').click();
  expect(await page.locator('.vocabulary-page').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.tools/print-alignment-verification/vocabulary.png' });
  expect(await page.evaluate(() => (window as any).__calls.some((c: any) => c.command === 'set_vocabulary_status'))).toBe(false);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('A4 preview paginates one canvas, exports both layouts with filters/order and leaves Reader nodes intact', async ({ page }) => {
  await installBackend(page); await open(page); await seed(page, 80);
  await page.evaluate(() => { (window as any).__readerBeforePrint = { canvas: document.querySelector('.pdf-page canvas'),
    text: document.querySelector('.pdf-page .textLayer'), reads: (window as any).__calls.filter((c: any) => c.command === 'read_pdf').length }; });
  await page.getByLabel('논문', { exact: true }).selectOption('paper-a');
  await button(page, '순서 섞기').click();
  const order = await page.locator('.vocabulary-simple .vocabulary-word').allTextContents();
  await button(page, '인쇄 미리보기').click(); await ready(page);
  await expect(preview(page).getByRole('button', { name: 'Simple Print' })).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page).locator('canvas')).toHaveCount(1);
  await preview(page).getByRole('button', { name: '미리보기 다음 페이지' }).click(); await ready(page);
  await expect(preview(page).locator('footer span')).toHaveText('2 / 2페이지');
  await preview(page).getByRole('button', { name: 'PDF 저장', exact: true }).click();
  await expect(preview(page).getByRole('status')).toContainText('PDF 저장 완료');
  let exported = await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'export_vocabulary_pdf').at(-1).args);
  const simple = await pdfText(exported.bytes);
  expect(simple).toContain('한국어 뜻'); expect(simple).not.toContain('다른 뜻');
  expect(simple).not.toContain('Learning'); expect(simple).not.toContain('조회');
  for (let i = 1; i < order.length; i++) expect(simple.indexOf(order[i])).toBeGreaterThan(simple.indexOf(order[i - 1]));
  await preview(page).getByRole('button', { name: 'Detailed Print' }).click(); await ready(page);
  await expect(preview(page).locator('footer span')).toContainText('1 /');
  await preview(page).getByRole('button', { name: 'PDF 저장', exact: true }).click();
  await expect(preview(page).getByRole('status')).toContainText('vocabulary_detailed.pdf');
  exported = await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'export_vocabulary_pdf').at(-1).args);
  const detailed = await pdfText(exported.bytes);
  for (const expected of ['term-079', '한국어 뜻', '문맥에 맞는 설명', 'Context A', 'Paper A', '2페이지']) expect(detailed).toContain(expected);
  expect(detailed).not.toContain('Paper B');
  await page.screenshot({ path: '.tools/phase3-verification/detailed-preview.png' });
  await preview(page).getByRole('button', { name: 'Simple Print' }).click(); await ready(page);
  await page.setViewportSize({ width: 640, height: 900 });
  const box = (await preview(page).locator('canvas').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(640);
  expect(box.y + box.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: '.tools/phase3-verification/simple-preview.png' });
  await page.keyboard.press('Escape'); await expect(preview(page)).toHaveCount(0);
  await button(page, 'PDF Reader').click();
  expect(await page.evaluate(() => {
    const before = (window as any).__readerBeforePrint;
    return before.canvas === document.querySelector('.pdf-page canvas') && before.text === document.querySelector('.pdf-page .textLayer')
      && before.reads === (window as any).__calls.filter((c: any) => c.command === 'read_pdf').length;
  })).toBe(true);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('system print receives exactly the preview PDF, handles cancellation/errors and prevents duplicate submissions', async ({ page }) => {
  await setup(page); await button(page, 'Detailed View').click();
  await button(page, '인쇄 미리보기').click(); await ready(page);
  await expect(preview(page).getByRole('button', { name: 'Detailed Print' })).toHaveAttribute('aria-pressed', 'true');
  await preview(page).getByRole('button', { name: 'PDF 저장', exact: true }).click();
  await expect(preview(page).getByRole('status')).toContainText('PDF 저장 완료');
  const bytes = await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'export_vocabulary_pdf').at(-1).args.bytes);
  await page.evaluate(() => { (window as any).__printDelay = 500; (window as any).__printCancel = true; });
  await preview(page).getByRole('button', { name: '시스템 인쇄' }).click();
  await expect(preview(page).getByRole('button', { name: '시스템 인쇄' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(preview(page)).toBeVisible();
  await ready(page); await expect(preview(page).getByRole('status')).toHaveCount(0);
  const printed = await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'print_vocabulary_pdf'));
  expect(printed).toHaveLength(1); expect(printed[0].args).toEqual({ bytes, mode: 'detailed', pageNumber: 1 });
  await page.evaluate(() => { (window as any).__printFail = true; (window as any).__printDelay = 0; });
  await preview(page).getByRole('button', { name: '시스템 인쇄' }).click();
  await expect(preview(page).getByRole('alert')).toContainText('프린터 연결 실패');
  await page.evaluate(() => { (window as any).__printFail = false; (window as any).__printCancel = false; });
  await preview(page).getByRole('button', { name: '다시 시도' }).click(); await ready(page);
  await preview(page).getByRole('button', { name: '시스템 인쇄' }).click();
  await expect(preview(page).getByRole('status')).toContainText('시스템에 전달');
  await page.evaluate(() => { (window as any).__exportCancel = true; });
  await preview(page).getByRole('button', { name: 'PDF 저장', exact: true }).click();
  await ready(page); await expect(preview(page).getByRole('status')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('preview font errors can retry; switching formats and closing a pending load cleans up safely', async ({ page }) => {
  await setup(page);
  await page.route('**/*NanumGothic*', route => route.request().resourceType() === 'fetch' ? route.abort() : route.continue());
  await button(page, '인쇄 미리보기').click();
  await expect(preview(page).getByRole('alert')).toBeVisible();
  await expect(preview(page).getByRole('button', { name: '시스템 인쇄' })).toBeDisabled();
  await page.unroute('**/*NanumGothic*');
  await preview(page).getByRole('button', { name: '다시 시도' }).click(); await ready(page);
  await preview(page).getByRole('button', { name: 'Detailed Print' }).click();
  await preview(page).getByRole('button', { name: 'Simple Print' }).click(); await ready(page);
  await expect(preview(page).getByRole('img')).toHaveAttribute('aria-label', 'Simple Print 1페이지 미리보기');
  await preview(page).getByRole('button', { name: 'Detailed Print' }).click();
  await preview(page).getByRole('button', { name: '인쇄 미리보기 닫기' }).click();
  await expect(preview(page)).toHaveCount(0);
  await button(page, '인쇄 미리보기').click(); await ready(page);
  await preview(page).getByRole('button', { name: '인쇄 미리보기 닫기' }).click();
  await expect(button(page, '인쇄 미리보기')).toBeFocused();
});
