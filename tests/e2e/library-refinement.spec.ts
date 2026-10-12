import { test, expect, type Page, type Locator } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { installBackend } from './helpers';
const library = (page: Page) => page.getByRole('button', { name: 'Library', exact: true }).click();
const folder = (page: Page, name: string) => page.getByRole('navigation', { name: 'Library 폴더', exact: true }).getByRole('button', { name, exact: true });
async function drag(page: Page, source: Locator, target: Locator) {
  const a = (await source.boundingBox())!, b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await page.mouse.up();
}
async function bodyOnlyPaper() {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([612, 792]);
  page.drawText('Learning from Context', { x: 72, y: 710, size: 24, font });
  page.drawText('Alice Smith1, Bob Lee2', { x: 72, y: 665, size: 12, font });
  page.drawText('Department of Computing, Example University', { x: 72, y: 640, size: 10, font });
  page.drawText('Available online 17 May 2023', { x: 72, y: 615, size: 10, font });
  for (let i = 0; i < 12; i++) page.drawText('The model maintains asymptotic complexity.', { x: 72, y: 580 - i * 20, size: 12, font });
  return pdf.save();
}

test('default folder renames and moves with its papers while keeping identity and persistence', async ({ page }) => {
  await installBackend(page); await page.goto('/'); await library(page); await folder(page, '기본 폴더').click();
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: 'test-paper.pdf', exact: true })).toBeVisible();
  await folder(page, '기본 폴더').click({ button: 'right' }); await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click();
  await page.getByLabel('폴더 이름', { exact: true }).fill('My Papers'); await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(folder(page, 'My Papers')).toBeVisible(); await folder(page, 'Library 홈').click();
  await page.getByRole('button', { name: '새 폴더', exact: true }).click();
  await page.getByLabel('폴더 이름', { exact: true }).fill('Archive'); await page.getByRole('button', { name: '만들기', exact: true }).click();
  await drag(page, folder(page, 'My Papers'), folder(page, 'Archive'));
  await folder(page, 'My Papers').click();
  await expect(page.getByRole('navigation', { name: '현재 폴더 경로' })).toHaveText('Library 홈 / Archive / My Papers');
  await expect(page.getByRole('button', { name: 'test-paper.pdf', exact: true })).toBeVisible();
  await page.reload(); await library(page); await folder(page, 'My Papers').click();
  await expect(page.getByRole('navigation', { name: '현재 폴더 경로' })).toHaveText('Library 홈 / Archive / My Papers');
  await page.getByRole('button', { name: 'test-paper.pdf', exact: true }).click();
  await expect(page.locator('.pdf-page .textLayer').first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-library-memberships')!)[0].folderId)).toBe(1);
});

test('import fills title author and publication from page text and retries prior empty extraction', async ({ page }) => {
  await installBackend(page, undefined, await bodyOnlyPaper()); await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('test-papers', JSON.stringify([{ id: 'paper-a', title: 'test-paper.pdf', fileName: 'test-paper.pdf', authors: '', publishedDate: '', metadataChecked: true, importance: 4, uploadedAt: '2020-01-01T00:00:00Z' }]));
    localStorage.setItem('test-library-memberships', JSON.stringify([{ paperId: 'paper-a', folderId: null }]));
  });
  await library(page); await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Learning from Context', exact: true })).toBeVisible();
  await expect(page.locator('.library-authors')).toHaveText('Alice Smith, Bob Lee');
  await expect(page.locator('.library-published')).toHaveText('2023-05-17');
  await expect(page.locator('.library-uploaded')).toHaveText('2020-01-01');
  await expect(page.getByRole('radio', { name: '중요도 4점' })).toBeChecked();
  await page.reload(); await library(page); await expect(page.locator('.library-authors')).toHaveText('Alice Smith, Bob Lee');
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('sorting covers displayed columns both directions, missing values last, and stays within the selected folder', async ({ page }) => {
  await installBackend(page); await page.goto('/');
  await page.evaluate(() => {
    const papers = [
      { id: 'a', title: 'Paper A', authors: 'Bob', publishedDate: '2022-02', importance: 5, uploadedAt: '2024-01-01T00:00:00Z' },
      { id: 'b', title: 'Paper B', authors: 'Alice', publishedDate: '2024-06-12', importance: 2, uploadedAt: '2023-01-01T00:00:00Z' },
      { id: 'c', title: 'Paper C', authors: '', publishedDate: '', importance: 0, uploadedAt: '2022-01-01T00:00:00Z' },
      { id: 'other', title: 'Other folder paper', authors: 'Other', publishedDate: '2026', importance: 5, uploadedAt: '2026-01-01T00:00:00Z' },
    ].map(p => ({ ...p, fileName: p.id + '.pdf' }));
    localStorage.setItem('test-papers', JSON.stringify(papers));
    localStorage.setItem('test-library-memberships', JSON.stringify(papers.map(p => ({ paperId: p.id, folderId: p.id === 'other' ? 1 : null }))));
  });
  await library(page); const titles = page.locator('.library-open-paper');
  await expect(titles).toHaveText(['Paper A', 'Paper B', 'Paper C']);
  await expect(page.getByLabel('정렬 기준', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '메모 정렬', exact: true })).toBeVisible();
  await expect(page.locator('.library-columns button')).toHaveCount(6);
  const titleHeader = page.getByRole('button', { name: '논문 제목 정렬', exact: true });
  await titleHeader.focus(); await page.keyboard.press('Enter');
  await expect(titles).toHaveText(['Paper C', 'Paper B', 'Paper A']);
  await expect(titleHeader).toHaveAttribute('data-sort-direction', 'desc');
  await page.keyboard.press('Space'); await expect(titles).toHaveText(['Paper A', 'Paper B', 'Paper C']);
  await page.getByRole('button', { name: '발행일 정렬', exact: true }).click(); await expect(titles).toHaveText(['Paper B', 'Paper A', 'Paper C']);
  await expect(page.getByRole('button', { name: '발행일 정렬', exact: true })).toHaveAttribute('data-sort-direction', 'desc');
  await expect(titleHeader).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '발행일 정렬', exact: true }).click(); await expect(titles).toHaveText(['Paper A', 'Paper B', 'Paper C']);
  await page.getByRole('button', { name: '중요도 정렬', exact: true }).click(); await expect(titles).toHaveText(['Paper A', 'Paper B', 'Paper C']);
  await page.getByRole('button', { name: '중요도 정렬', exact: true }).click(); await expect(titles).toHaveText(['Paper B', 'Paper A', 'Paper C']);
  await page.getByRole('button', { name: '저자명 정렬', exact: true }).click(); await expect(titles).toHaveText(['Paper B', 'Paper A', 'Paper C']);
  await page.getByRole('button', { name: '저자명 정렬', exact: true }).click(); await expect(titles).toHaveText(['Paper A', 'Paper B', 'Paper C']);
  await page.getByRole('button', { name: '업로드 날짜 정렬', exact: true }).click(); await expect(titles).toHaveText(['Paper A', 'Paper B', 'Paper C']);
  await page.getByRole('button', { name: '업로드 날짜 정렬', exact: true }).click(); await expect(titles).toHaveText(['Paper C', 'Paper B', 'Paper A']);
  await folder(page, '기본 폴더').click(); await expect(titles).toHaveText(['Other folder paper']);
  await folder(page, 'Library 홈').click(); await expect(titles).toHaveText(['Paper C', 'Paper B', 'Paper A']);
  await page.screenshot({ path: '.tools/library-refinement-verification/sorting.png' });
  await page.setViewportSize({ width: 640, height: 900 });
  expect(await page.locator('.library-main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'update_paper_metadata' || c.command === 'lookup_word'))).toHaveLength(0);
});
