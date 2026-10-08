import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { installBackend, open, select } from './helpers';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const folder = (page: Page, name: string) => page.getByRole('navigation', { name: 'Library 폴더', exact: true }).getByRole('button', { name, exact: true });
const check = (page: Page, n: number) => page.getByRole('checkbox', { name: `Paper ${n} 선택`, exact: true });
const row = (page: Page, n: number) => page.locator(`[data-paper-id="p${n}"]`);
async function seed(page: Page, count = 6) {
  await installBackend(page); await page.goto('/');
  await page.evaluate(count => {
    localStorage.setItem('test-library-folders', JSON.stringify([{ id: 1, parentId: null, name: 'Research' }, { id: 2, parentId: 1, name: 'Child' }]));
    localStorage.setItem('test-papers', JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: `p${i}`, fileName: `${i}.pdf`, title: `Paper ${i}`, authors: `Author ${i}`, importance: i % 5 + 1, memo: '' }))));
    localStorage.setItem('test-library-memberships', JSON.stringify(Array.from({ length: count }, (_, i) => ({ paperId: `p${i}`, folderId: null }))));
  }, count);
  await button(page, 'Library').click(); await expect(check(page, 0)).toBeVisible();
}
async function fixture(title: string, author: string) {
  const pdf = await PDFDocument.create(); pdf.setTitle(title); pdf.setAuthor(author);
  const page = pdf.addPage([612, 792]), font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(title, { x: 72, y: 710, size: 24, font });
  page.drawText('Published online: September 20, 2023', { x: 72, y: 635, size: 12, font });
  page.drawText('The model maintains asymptotic complexity.', { x: 72, y: 580, size: 12, font });
  return Array.from(await pdf.save());
}

test('plain paper row clicks toggle selection, while dragging an unselected paper still moves it', async ({ page }) => {
  await seed(page);
  await row(page, 0).locator('.library-authors').click(); await expect(check(page, 0)).toBeChecked();
  await row(page, 0).locator('.library-authors').click(); await expect(check(page, 0)).not.toBeChecked();
  await check(page, 0).check(); await check(page, 1).check();
  await row(page, 1).locator('.library-authors').click(); await expect(check(page, 1)).not.toBeChecked(); await expect(check(page, 0)).toBeChecked();
  const source = (await button(page, 'Paper 2').boundingBox())!, target = (await folder(page, 'Research').boundingBox())!;
  await page.mouse.move(source.x + 8, source.y + 5); await page.mouse.down();
  await page.mouse.move(target.x + 20, target.y + 10, { steps: 10 });
  await expect(check(page, 2)).toBeChecked(); await expect(check(page, 0)).not.toBeChecked();
  await page.mouse.up(); await expect(row(page, 2)).toHaveCount(0);
  await folder(page, 'Research').click(); await expect(row(page, 2)).toBeVisible();
  await button(page, 'Paper 2').click(); await expect(page.locator('.document-title')).toHaveText('Paper 2');
});

test('multi-file picker and mixed drops import every valid file and extract each paper metadata without replacing Reader', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => { (window as any).__readerCanvas = document.querySelector('.pdf-page canvas'); });
  await button(page, 'Library').click(); await folder(page, '기본 폴더').click();
  const a = await fixture('Batch Alpha', 'Alice Smith'), b = await fixture('Batch Beta', 'Bob Lee');
  await page.evaluate(({ a, b }) => {
    (window as any).__importPaths = ['/a.pdf', '/b.PDF', '/bad.pdf', '/a.pdf'];
    (window as any).__importFailNames = ['bad.pdf'];
    (window as any).__pdfBytesById = { 'batch-a.pdf': a, 'batch-b.PDF': b };
  }, { a, b });
  await button(page, 'PDF 추가').click();
  await expect(button(page, 'Batch Alpha')).toBeVisible(); await expect(button(page, 'Batch Beta')).toBeVisible();
  await expect(page.locator('.library-papers > li')).toHaveCount(2);
  await expect(page.getByRole('alert')).toContainText('bad.pdf');
  await expect(page.locator('.library-papers')).toContainText('Alice Smith');
  await expect(page.locator('.library-papers')).toContainText('Bob Lee');
  await expect(page.locator('.library-published').first()).toHaveText('2023-09-20');
  await page.evaluate(() => (window as any).__emitFileDrag({ type: 'drop', paths: ['/c.pdf', '/not-pdf.txt', '/d.pdf'] }));
  await expect(button(page, 'c.pdf')).toBeVisible(); await expect(button(page, 'd.pdf')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('not-pdf.txt');
  await expect(page.locator('.library-papers > li')).toHaveCount(4);
  await button(page, 'PDF Reader').click();
  expect(await page.evaluate(() => (window as any).__readerCanvas === document.querySelector('.pdf-page canvas'))).toBe(true);
  await expect(page.locator('.document-title')).toHaveText('test-paper.pdf');
  await page.reload(); await button(page, 'Library').click(); await folder(page, '기본 폴더').click();
  await expect(page.locator('.library-papers > li')).toHaveCount(4);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('Reader accepts multiple PDFs, opens the first readable one and keeps the rest in Library', async ({ page }) => {
  await installBackend(page); await page.goto('/');
  await page.evaluate(() => {
    (window as any).__importPaths = ['/broken.pdf', '/first.pdf', '/second.pdf'];
    (window as any).__readFailIds = ['batch-broken.pdf'];
  });
  await button(page, 'PDF 열기').click();
  await expect(page.locator('.document-title')).toHaveText('first.pdf');
  await expect(button(page, 'PDF 열기')).toBeEnabled();
  await button(page, 'Library').click(); await expect(page.locator('.library-papers > li')).toHaveCount(3);
  await page.evaluate(() => (window as any).__emitFileDrag({ type: 'drop', paths: ['/third.pdf', '/fourth.pdf'] }));
  await expect(button(page, 'third.pdf')).toBeVisible();
  await expect(page.locator('.library-papers > li')).toHaveCount(5);
});

test('Ctrl toggles papers, Shift uses displayed sort order, checkbox and select all work without opening a PDF', async ({ page }) => {
  await seed(page);
  await button(page, 'Paper 1').click({ modifiers: ['Control'] });
  await button(page, 'Paper 3').click({ modifiers: ['Control'] });
  await expect(check(page, 1)).toBeChecked(); await expect(check(page, 3)).toBeChecked();
  await button(page, 'Paper 1').click({ modifiers: ['Control'] }); await expect(check(page, 1)).not.toBeChecked();
  await button(page, 'Paper 4').click({ modifiers: ['Shift'] });
  for (const n of [1, 2, 3, 4]) await expect(check(page, n)).toBeChecked();
  await expect(check(page, 0)).not.toBeChecked(); await expect(check(page, 5)).not.toBeChecked();
  await button(page, '논문 제목 정렬').click();
  await button(page, 'Paper 5').click({ modifiers: ['Shift'] });
  for (const n of [1, 2, 3, 4, 5]) await expect(check(page, n)).toBeChecked();
  await page.getByRole('checkbox', { name: '전체 선택', exact: true }).check();
  await expect(page.locator('.library-paper-select:checked')).toHaveCount(6);
  await check(page, 2).uncheck();
  expect(await page.getByRole('checkbox', { name: '전체 선택', exact: true }).evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
  await folder(page, 'Research').click(); await expect(button(page, '선택 이동')).toBeDisabled();
  await folder(page, 'Library 홈').click(); await expect(page.locator('.library-paper-select:checked')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'read_pdf'))).toHaveLength(0);
});

test('marquee selection supports both directions, Ctrl addition, cancellation and does not hijack memo input', async ({ page }) => {
  await seed(page, 6);
  const main = (await page.locator('.library-main').boundingBox())!;
  const first = (await row(page, 0).boundingBox())!, third = (await row(page, 2).boundingBox())!;
  const start = { x: main.x + 8, y: first.y + 3 }, end = { x: first.x + 100, y: third.y + third.height - 3 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.locator('.library-selection-box')).toBeVisible();
  await expect(page.locator('.library-paper-select:checked')).toHaveCount(3);
  await page.mouse.up(); await expect(page.locator('.library-selection-box')).toHaveCount(0);
  await page.screenshot({ path: '.tools/library-batch-verification/multi-selection.png' });
  await check(page, 5).check();
  await page.locator('.library-main').evaluate(el => { el.scrollTop = 0; });
  await page.keyboard.down('Control');
  await page.mouse.move(main.x + 8, third.y + third.height - 3); await page.mouse.down();
  await page.mouse.move(first.x + 100, first.y + 3, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Control');
  await expect(page.locator('.library-paper-select:checked')).toHaveCount(4);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.library-paper-select:checked')).toHaveCount(4);
  await row(page, 0).getByRole('button', { name: 'Paper 0 메모 편집', exact: true }).click();
  const input = row(page, 0).getByRole('textbox'); await input.fill('메모 내용'); await input.selectText();
  await expect(page.locator('.library-paper-select:checked')).toHaveCount(4);
  await expect(page.locator('.library-drag-ghost')).toHaveCount(0);
});

test('selected papers move as one drag and batch move failure preserves selection for retry', async ({ page }) => {
  await seed(page);
  await check(page, 0).check(); await check(page, 2).check();
  await button(page, 'Paper 0').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '선택한 2개 논문 이동' })).toBeVisible();
  await page.keyboard.press('Escape');
  const source = (await button(page, 'Paper 0').boundingBox())!, target = (await folder(page, 'Research').boundingBox())!;
  await page.mouse.move(source.x + 8, source.y + 5); await page.mouse.down();
  await page.mouse.move(target.x + 20, target.y + 10, { steps: 10 });
  await expect(page.locator('.library-drag-ghost')).toHaveText('2개 논문'); await page.mouse.up();
  await expect(page.locator('.library-papers > li')).toHaveCount(4);
  await folder(page, 'Research').click(); await expect(page.locator('.library-papers > li')).toHaveCount(2);
  await page.getByRole('checkbox', { name: '전체 선택', exact: true }).check(); await button(page, '선택 이동').click();
  const form = page.getByRole('form', { name: '선택한 논문 이동' });
  await form.getByLabel('이동할 폴더').selectOption('2');
  await page.evaluate(() => { (window as any).__libraryMutationFail = true; (window as any).__libraryBatchDelay = 350; });
  await form.getByRole('button', { name: '이동', exact: true }).click();
  await expect(button(page, 'PDF 추가')).toBeDisabled(); await expect(check(page, 0)).toBeDisabled();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(check(page, 0)).toBeChecked(); await expect(check(page, 2)).toBeChecked();
  await page.evaluate(() => { (window as any).__libraryMutationFail = false; });
  await form.getByRole('button', { name: '이동', exact: true }).click(); await expect(form).toHaveCount(0);
  await folder(page, 'Child').click(); await expect(page.locator('.library-papers > li')).toHaveCount(2);
  await page.reload(); await button(page, 'Library').click(); await folder(page, 'Child').click();
  await expect(page.locator('.library-papers > li')).toHaveCount(2);
});

test('marquee selection can continue through scrolling and stops updating after pointer release', async ({ page }) => {
  await seed(page, 22);
  const main = (await page.locator('.library-main').boundingBox())!, first = (await row(page, 0).boundingBox())!;
  await page.mouse.move(main.x + 8, first.y + 3); await page.mouse.down();
  await page.mouse.move(first.x + 100, main.y + main.height - 6, { steps: 8 });
  await expect(check(page, 21)).toBeChecked({ timeout: 12000 });
  await page.mouse.up();
  await expect(page.locator('.library-paper-select:checked')).toHaveCount(22);
  const scroll = await page.locator('.library-main').evaluate(el => el.scrollTop);
  await page.mouse.move(first.x + 100, main.y + 100);
  await expect(page.locator('.library-main')).toHaveJSProperty('scrollTop', scroll);
});

test('batch deletion previews exactly selected names, can cancel/retry and preserves vocabulary while closing a deleted Reader', async ({ page }) => {
  await installBackend(page); await open(page); await select(page);
  await button(page, '번역').click(); await expect(page.locator('.result-content')).toContainText('점근적');
  await button(page, 'Library').click();
  await page.evaluate(() => { (window as any).__importPaths = ['/a.pdf', '/b.pdf']; });
  await button(page, 'PDF 추가').click(); await expect(button(page, 'b.pdf')).toBeVisible();
  const before = await page.evaluate(() => [localStorage.getItem('test-lookups'), localStorage.getItem('test-highlights'), localStorage.getItem('test-cost')]);
  await page.getByRole('checkbox', { name: 'test-paper.pdf 선택', exact: true }).check();
  await page.getByRole('checkbox', { name: 'a.pdf 선택', exact: true }).check();
  await button(page, '선택 삭제').click();
  const form = page.getByRole('form', { name: '선택한 논문 삭제' });
  await expect(form.locator('li')).toHaveText(['a.pdf', 'test-paper.pdf']);
  await form.getByRole('button', { name: '취소' }).click(); await expect(page.locator('.library-paper-select:checked')).toHaveCount(2);
  await button(page, '선택 삭제').click(); await page.evaluate(() => { (window as any).__libraryMutationFail = true; });
  await form.getByRole('button', { name: '삭제하기' }).click(); await expect(form.getByRole('alert')).toBeVisible();
  await expect(page.locator('.library-papers > li')).toHaveCount(3);
  await page.evaluate(() => { (window as any).__libraryMutationFail = false; });
  await form.getByRole('button', { name: '삭제하기' }).click(); await expect(form).toHaveCount(0);
  await expect(page.locator('.library-papers > li')).toHaveCount(1); await expect(button(page, 'b.pdf')).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('test-lookups'), localStorage.getItem('test-highlights'), localStorage.getItem('test-cost')])).toEqual(before);
  await button(page, 'PDF Reader').click(); await expect(page.locator('.empty-state')).toBeVisible();
});
