import { expect, test } from '@playwright/test';
import { installBackend, open, select, wordBox } from './helpers';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test('translation stays mounted offscreen while pending; scrolling back restores it and Escape dismisses it', async ({ page }) => {
  await installBackend(page, { delay: 500, fail: false, rotation: 0, userUnit: 1 }); await open(page); await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await page.locator('.reader').evaluate(el => { el.scrollTop = 900; });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toContainText('점근적인');
  const box = (await page.getByRole('dialog').boundingBox())!;
  expect(box.y + box.height).toBeLessThan(0);
  await page.locator('.reader').evaluate(el => { el.scrollTop = 0; });
  await expect(page.getByRole('button', { name: '말풍선 닫기' })).toBeInViewport();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a real triple click opens actions and saves the complete native line selection', async ({ page }) => {
  await installBackend(page); await open(page);
  const box = await wordBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 3, delay: 100 });
  await expect(page.getByRole('dialog', { name: '선택 텍스트 도구' })).toBeVisible();
  const nativeText = await page.evaluate(() => window.getSelection()!.toString().trim());
  expect(nativeText).toContain('asymptotic'); expect(nativeText.split(/\s+/).length).toBeGreaterThan(1);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('선택한 전체 문장의 번역입니다.');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('test-lookups')!));
  expect(stored[0].word.replace(/\s+/g, ' ')).toBe(nativeText.replace(/\s+/g, ' '));
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toContainText('asymptotic');
  await expect(page.locator('.vocabulary-simple dd')).toHaveText('선택한 전체 문장의 번역입니다.');
});

test('dragged phrases are saved, searchable, restored and cached without additional cost', async ({ page }) => {
  await installBackend(page); await open(page);
  const a = await wordBox(page), b = await wordBox(page, 'complexity');
  const drag = async () => {
    await page.mouse.click(30, 300);
    await page.mouse.move(a.x + .2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width - .2, b.y + b.height / 2, { steps: 15 }); await page.mouse.up();
    await page.getByRole('button', { name: '번역', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('선택한 전체 문장의 번역입니다.');
  };
  await drag(); await page.keyboard.press('Escape'); await drag();
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(1);
  await page.reload(); await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await page.getByLabel('단어 검색').fill('전체 문장');
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveText('asymptotic linear complexity');
  await page.getByRole('button', { name: 'Detailed View' }).click();
  await expect(page.locator('.vocabulary-entry')).toContainText('조회 2회');
  await expect(page.locator('.vocabulary-context')).toContainText('The model maintains an asymptotic linear complexity.');
});

test('five colors persist and cancellation removes only the selected highlight, preserving cache and vocabulary', async ({ page }) => {
  await installBackend(page); await open(page);
  await expect(page.getByRole('group', { name: '하이라이트 색상' }).getByRole('button')).toHaveCount(5);
  await page.getByRole('button', { name: '파랑 하이라이트' }).click(); await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveAttribute('data-color', 'blue');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '분홍 하이라이트' }).click(); await select(page, 'asymptotic', 1);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(2);
  await page.reload(); await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
  await expect(page.getByRole('button', { name: '분홍 하이라이트' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.word-highlight[data-color="blue"]')).toHaveCount(1);
  await select(page); // Cancellation is also available in the action bubble.
  await expect(page.getByRole('button', { name: '하이라이트 취소' })).toBeVisible();
  await page.getByRole('button', { name: '하이라이트 취소' }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await expect(page.locator('.word-highlight')).toHaveAttribute('data-color', 'pink');
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await page.getByRole('button', { name: 'Detailed View' }).click();
  await expect(page.locator('.vocabulary-entry')).toContainText('조회 2회');
  await page.getByRole('button', { name: 'PDF Reader', exact: true }).click();
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
  await page.keyboard.press('Escape');
  const box = await wordBox(page); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toContainText('점근적인');
  await page.evaluate(() => { (window as any).__removeFail = true; });
  await page.getByRole('button', { name: '하이라이트 취소' }).click();
  await expect(page.getByRole('alert')).toContainText('하이라이트를 취소하지 못했습니다.');
  await expect(page.locator('.word-highlight')).toHaveCount(2);
  await page.evaluate(() => { (window as any).__removeFail = false; });
  await page.getByRole('button', { name: '하이라이트 취소' }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
});

test('Vocabulary zoom scales both views without changing the reader zoom or losing filters', async ({ page }) => {
  await installBackend(page); await open(page); await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click(); await expect(page.locator('.word-highlight')).toHaveCount(1);
  const readerZoom = await page.locator('.zoom-controls span').textContent();
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await page.getByLabel('단어 검색').fill('asymptotic');
  const size = await page.locator('.vocabulary-simple .vocabulary-word').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await page.getByRole('button', { name: 'Vocabulary 확대', exact: true }).click();
  expect(await page.locator('.vocabulary-simple .vocabulary-word').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(size * 1.25);
  await page.getByRole('button', { name: 'Detailed View' }).click();
  expect(await page.locator('.vocabulary-entry h2').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(23 * 1.25);
  await page.screenshot({ path: 'test-results/vocabulary-tools.png' });
  await page.getByRole('button', { name: 'PDF Reader', exact: true }).click();
  await expect(page.locator('.zoom-controls span')).toHaveText(readerZoom!);
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await expect(page.locator('.zoom-controls span')).toHaveText('125%');
  await expect(page.getByLabel('단어 검색')).toHaveValue('asymptotic');
  await page.getByRole('button', { name: 'Vocabulary 축소', exact: true }).click();
  await expect(page.locator('.zoom-controls span')).toHaveText('100%');
});

test('PDF export uses the selected view and filtered entries, handles cancel/error, and stays local', async ({ page }) => {
  await installBackend(page); await open(page); await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click(); await expect(page.locator('.word-highlight')).toHaveCount(1);
  await page.keyboard.press('Escape'); await select(page, 'context-aware');
  await page.getByRole('button', { name: '번역', exact: true }).click(); await expect(page.locator('.word-highlight')).toHaveCount(2);
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await page.getByLabel('단어 검색').fill('asymptotic');
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveCount(1);
  const before = await page.evaluate(() => (window as any).__apiCalls);
  for (const [view, mode] of [['Simple View', 'simple'], ['Detailed View', 'detailed']]) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.getByRole('button', { name: 'PDF 내보내기', exact: true }).click();
    await expect(page.getByText(`PDF 저장 완료: /exports/vocabulary_${mode}.pdf`, { exact: true })).toBeVisible();
    const exported = await page.evaluate(() => (window as any).__calls.findLast((c: any) => c.command === 'export_vocabulary_pdf').args);
    expect(exported.mode).toBe(mode);
    const task = getDocument({ data: new Uint8Array(exported.bytes) }); const document = await task.promise;
    const text = (await (await document.getPage(1)).getTextContent()).items.filter(item => 'str' in item).map(item => item.str).join(' ');
    expect(text).toContain('asymptotic'); expect(text).toContain('점근적인'); expect(text).not.toContain('context-aware');
    expect(text.includes('test-paper.pdf')).toBe(mode === 'detailed');
    await task.destroy();
  }
  await page.evaluate(() => { (window as any).__exportCancel = true; });
  await page.getByRole('button', { name: 'PDF 내보내기', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PDF 내보내기', exact: true })).toBeEnabled();
  await expect(page.getByText('PDF 저장 완료:', { exact: false })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__exportFail = true; });
  await page.getByRole('button', { name: 'PDF 내보내기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('PDF 저장 실패');
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(before);
});
