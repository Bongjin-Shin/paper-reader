import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { installBackend, open, select } from './helpers';

const library = (page: Page) => page.getByRole('button', { name: 'Library', exact: true });
const back = (page: Page) => page.getByRole('button', { name: '뒤로가기', exact: true });
const folder = (page: Page, name: string) => page.getByRole('navigation', { name: 'Library 폴더', exact: true }).getByRole('button', { name, exact: true });
const title = 'Anonymous Hedonic Game for Task Allocation in a Large-Scale Multiple Agent System';
const authors = 'Inmo Jang, Hyo-Sang Shin, and Antonios Tsourdos';

async function journalPaper() {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.TimesRoman), page = pdf.addPage([594, 792]);
  pdf.setTitle('untitled');
  const line = (text: string, x: number, y: number, size: number) => page.drawText(text, { x, y, size, font });
  line('Anonymous Hedonic Game for Task Allocation in a', 49.6, 713.33, 23.91);
  line('Large-Scale Multiple Agent System', 127, 685.42, 23.91);
  line('Inmo Jang', 169.68, 662.51, 10.96);
  line(', Hyo-Sang Shin', 226.47, 662.51, 10.96);
  line(', and Antonios Tsourdos', 310.05, 662.51, 10.96);
  line('Abstract - A two-column journal paper.', 42, 620, 8.97);
  line('I. INTRODUCTION', 131, 414.08, 9.96);
  line('C', 42, 382.84, 29.89);
  line('OOPERATION of many agents', 65.69, 397.15, 9.96);
  line('robots cooperate.', 65.69, 385.19, 9.96);
  for (let i = 0; i < 10; i++) {
    line('Body text in the first column.', 42, 370 - i * 12, 9.96);
    line('Body text in the second column.', 310, 400 - i * 12, 9.96);
  }
  line('Date of publication August 20, 2018', 42, 210, 8.97);
  return pdf.save();
}

test('reopening a saved wrong automatic title repairs title and authors, survives restart and preserves manual corrections', async ({ page }) => {
  await installBackend(page, undefined, await journalPaper()); await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('test-papers', JSON.stringify([{ id: 'paper-a', fileName: 'download.pdf', title: 'COOPERATION body text',
      authors: '', publishedDate: '2018-08-20', titleManual: false, metadataManual: false, metadataChecked: true,
      importance: 4, uploadedAt: '2020-01-01T00:00:00Z' }]));
    localStorage.setItem('test-library-memberships', JSON.stringify([{ paperId: 'paper-a', folderId: 1 }]));
  });
  await library(page).click(); await folder(page, '기본 폴더').click();
  await page.getByRole('button', { name: 'COOPERATION body text', exact: true }).click();
  await expect(page.locator('.document-title')).toHaveText(title);
  await expect(page.locator('.pdf-page .textLayer').first()).toBeVisible();
  await back(page).click();
  await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await expect(page.locator('.library-open-paper')).toHaveText(title);
  await expect(page.locator('.library-authors')).toHaveText(authors);
  await expect(page.locator('.library-published')).toHaveText('2018-08-20');
  await expect(page.locator('.library-uploaded')).toHaveText('2020-01-01');
  await expect(page.getByRole('radio', { name: '중요도 4점' })).toBeChecked();
  await page.reload(); await library(page).click(); await folder(page, '기본 폴더').click();
  await expect(page.locator('.library-open-paper')).toHaveText(title);
  await expect(page.locator('.library-authors')).toHaveText(authors);
  await page.screenshot({ path: '.tools/metadata-back-verification/library-corrected.png' });
  await page.getByRole('button', { name: '논문 정보 수정', exact: true }).click();
  await page.getByLabel('논문 이름', { exact: true }).fill('My chosen title');
  await page.getByLabel('저자명', { exact: true }).fill('');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.reload(); await library(page).click(); await folder(page, '기본 폴더').click();
  await page.getByRole('button', { name: 'My chosen title', exact: true }).click();
  await expect(page.locator('.pdf-page .textLayer').first()).toBeVisible(); await back(page).click();
  await expect(page.locator('.library-open-paper')).toHaveText('My chosen title');
  await expect(page.locator('.library-authors')).toHaveText('—');
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('back traverses screens without reloading Reader canvases, scroll, zoom or saved highlights', async ({ page }) => {
  await installBackend(page); await open(page); await expect(back(page)).toBeDisabled();
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '페이지 너비 맞춤' }).click();
  await expect.poll(() => page.locator('.pdf-page').first().evaluate(el =>
    el.getAttribute('data-rendered-scale') !== '1.25' && el.getAttribute('data-rendered-scale') === el.closest<HTMLElement>('.reader')!.dataset.displayScale)).toBe(true);
  await page.locator('.reader').evaluate(el => { el.scrollTop = 100; });
  await expect.poll(() => page.locator('.reader').evaluate(el => el.scrollTop)).toBe(100);
  await page.evaluate(() => { (window as any).__readerBefore = { canvas: document.querySelector('.pdf-page canvas'), text: document.querySelector('.pdf-page .textLayer'),
    scale: document.querySelector('.pdf-page')?.getAttribute('data-rendered-scale'), reads: (window as any).__calls.filter((c: any) => c.command === 'read_pdf').length }; });
  await library(page).click(); await library(page).click(); // A repeated destination is not another visit.
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await back(page).click(); await expect(library(page)).toHaveAttribute('aria-pressed', 'true');
  await back(page).click(); await expect(back(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: '페이지 너비 맞춤' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => {
    const before = (window as any).__readerBefore;
    return before.canvas === document.querySelector('.pdf-page canvas') && before.text === document.querySelector('.pdf-page .textLayer')
      && before.scale === document.querySelector('.pdf-page')?.getAttribute('data-rendered-scale') && document.querySelector('.reader')?.scrollTop === 100
      && before.reads === (window as any).__calls.filter((c: any) => c.command === 'read_pdf').length;
  })).toBe(true);
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await page.locator('.word-highlight').evaluate(el => {
    const box = el.getBoundingClientRect(); (window as any).__highlightPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  const point = await page.evaluate(() => (window as any).__highlightPoint);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByText('점근적인', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(1);
});

test('back visits folders, dismisses editing and skips deleted folders; a failed open adds no history', async ({ page }) => {
  await installBackend(page); await page.goto('/'); await library(page).click();
  await folder(page, '기본 폴더').click();
  await page.getByRole('button', { name: '새 폴더', exact: true }).click();
  await page.getByLabel('폴더 이름', { exact: true }).fill('Nested');
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.locator('.library-heading h2')).toHaveText('Nested');
  await back(page).click(); await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await folder(page, 'Nested').click();
  await page.getByRole('button', { name: '폴더 이름 변경', exact: true }).click();
  await back(page).click(); await expect(page.getByRole('form')).toHaveCount(0);
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: 'test-paper.pdf', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__readFail = true; });
  await page.getByRole('button', { name: 'test-paper.pdf', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('PDF를 열지 못했습니다.');
  await back(page).click(); await expect(page.locator('.library-heading h2')).toHaveText('Library');
  await folder(page, 'Nested').click();
  await folder(page, '기본 폴더').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '삭제', exact: true }).click();
  await page.getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(folder(page, 'Nested')).toHaveCount(0);
  await expect(page.locator('.library-heading h2')).toHaveText('Library');
  await back(page).click();
  await expect(page.getByRole('button', { name: 'PDF Reader', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(back(page)).toBeDisabled();
});
