import { test, expect, type Page, type Locator } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { installBackend, open } from './helpers';

const library = (page: Page) => page.getByRole('button', { name: 'Library', exact: true }).click();
const folders = (page: Page) => page.getByRole('navigation', { name: 'Library 폴더', exact: true });
const folder = (page: Page, name: string) => folders(page).getByRole('button', { name, exact: true });
async function seed(page: Page) {
  await page.evaluate(() => localStorage.setItem('test-library-folders', JSON.stringify([
    { id: 1, parentId: null, name: 'Research' }, { id: 2, parentId: 1, name: 'Child' }, { id: 3, parentId: null, name: 'Archive' },
  ])));
}
async function drag(page: Page, source: Locator, target: Locator, release = true) {
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  if (release) await page.mouse.up();
}
async function paperPdf(embeddedTitle = true) {
  const pdf = await PDFDocument.create();
  if (embeddedTitle) pdf.setTitle('Learning from Context');
  pdf.setAuthor('Alice Smith; Bob Lee'); pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  const page = pdf.addPage([612, 792]), font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Learning from Context', { x: 72, y: 710, size: 24, font });
  page.drawText('Published online: September 20, 2023', { x: 72, y: 615, size: 12, font });
  for (let i = 0; i < 12; i++) page.drawText('The model maintains asymptotic complexity.', { x: 72, y: 580 - i * 20, size: 12, font });
  return pdf.save();
}

test('pointer drag moves papers and nested folders, suppresses opening, and rejects cycles', async ({ page }) => {
  await installBackend(page); await open(page); await seed(page); await library(page);
  const title = page.getByRole('button', { name: 'test-paper.pdf', exact: true });
  await drag(page, title, folder(page, 'Child'), false);
  await expect(folder(page, 'Child')).toHaveAttribute('data-drop-active', 'true');
  await expect(page.locator('.library-drag-ghost')).toContainText('test-paper.pdf');
  await page.mouse.up();
  await expect(page.locator('.library-papers > li')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await folder(page, 'Child').click(); await expect(title).toBeVisible();
  await drag(page, folder(page, 'Research'), folder(page, 'Child'));
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'move_library_folder'))).toHaveLength(0);
  await drag(page, folder(page, 'Child'), folder(page, 'Archive'));
  await expect(page.getByRole('navigation', { name: '현재 폴더 경로' })).toHaveText('Library 홈 / Archive / Child');
  await drag(page, title, folder(page, 'Library 홈'));
  await expect(page.locator('.library-papers > li')).toHaveCount(0);
  await page.reload(); await library(page); await expect(title).toBeVisible();
  await folder(page, 'Child').click();
  await expect(page.getByRole('navigation', { name: '현재 폴더 경로' })).toHaveText('Library 홈 / Archive / Child');
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('drag cancellation and failed move preserve location and allow retry', async ({ page }) => {
  await installBackend(page); await open(page); await seed(page); await library(page);
  const title = page.getByRole('button', { name: 'test-paper.pdf', exact: true });
  await drag(page, title, folder(page, 'Archive'), false); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(title).toBeVisible(); await expect(page.locator('.library-drag-ghost')).toHaveCount(0);
  await page.getByRole('button', { name: '새 폴더', exact: true }).click();
  await expect(page.getByRole('form', { name: '새 폴더', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.evaluate(() => { (window as any).__libraryMutationFail = true; });
  await drag(page, title, folder(page, 'Archive')); await expect(page.getByRole('alert')).toContainText('Library 변경에 실패');
  await expect(title).toBeVisible();
  await page.evaluate(() => { (window as any).__libraryMutationFail = false; });
  await drag(page, title, folder(page, 'Archive')); await expect(page.locator('.library-papers > li')).toHaveCount(0);
  await folder(page, 'Archive').click(); await expect(title).toBeVisible();
});

test('sidebar create and context menus operate on the clicked folder or paper, with keyboard dismissal', async ({ page }) => {
  await installBackend(page); await open(page); await seed(page); await library(page);
  await expect(page.getByRole('navigation', { name: '화면 선택' }).getByRole('button')).toHaveText(['PDF Reader', 'Library', 'Vocabulary']);
  await folder(page, 'Research').click(); await page.locator('.library-sidebar').getByRole('button', { name: '폴더 생성' }).click();
  await page.getByLabel('폴더 이름', { exact: true }).fill('Sidebar child'); await page.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '현재 폴더 경로' })).toHaveText('Library 홈 / Research / Sidebar child');
  await folder(page, 'Library 홈').click();
  await folder(page, 'Child').click({ button: 'right' }); await page.getByRole('menuitem', { name: '새 하위 폴더' }).click();
  await expect(page.getByRole('form')).toContainText('Library / Research / Child');
  await page.getByLabel('폴더 이름', { exact: true }).fill('Context child'); await page.getByRole('button', { name: '만들기', exact: true }).click();
  await folder(page, 'Archive').click({ button: 'right' }); await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click();
  await page.getByLabel('폴더 이름', { exact: true }).fill('Renamed'); await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(folder(page, 'Renamed')).toBeVisible();
  await folder(page, 'Renamed').click({ button: 'right' }); await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: '삭제', exact: true })).toBeFocused(); await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0);
  await folder(page, 'Library 홈').click();
  const title = page.getByRole('button', { name: 'test-paper.pdf', exact: true });
  await title.click({ button: 'right' }); await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click();
  await page.getByLabel('논문 이름', { exact: true }).fill('Renamed paper'); await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: 'Renamed paper', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '새 폴더', exact: true }).click(); await expect(page.getByRole('form')).toContainText('위치: Library');
});

test('PDF import extracts title author and publication date, and metadata/rating survive correction and reimport', async ({ page }) => {
  await installBackend(page, undefined, await paperPdf()); await page.goto('/'); await library(page);
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Learning from Context', exact: true })).toBeVisible();
  await expect(page.locator('.library-columns')).toHaveText('논문 제목↑메모저자명↕발행일↕중요도↕업로드 날짜↕');
  await expect(page.locator('.library-authors')).toHaveText('Alice Smith; Bob Lee');
  await expect(page.locator('.library-published')).toHaveText('2023-09-20');
  await expect(page.locator('.library-uploaded')).toHaveText('2026-09-22');
  await page.getByRole('radio', { name: '중요도 4점' }).check(); await expect(page.getByRole('radio', { name: '중요도 4점' })).toBeChecked();
  await expect(page.getByRole('button', { name: '논문 정보 수정', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '논문 정보 수정', exact: true }).click();
  await page.getByLabel('논문 이름', { exact: true }).fill('교정한 논문 제목'); await page.getByLabel('저자명', { exact: true }).fill('김연구, 이연구');
  await page.getByLabel('발행일', { exact: true }).fill('2022-03'); await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '교정한 논문 제목', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PDF 추가', exact: true })).toBeEnabled();
  await page.reload(); await library(page);
  await expect(page.locator('.library-authors')).toHaveText('김연구, 이연구'); await expect(page.locator('.library-published')).toHaveText('2022-03');
  await expect(page.getByRole('radio', { name: '중요도 4점' })).toBeChecked(); await expect(page.locator('.library-uploaded')).toHaveText('2026-09-22');
  await page.screenshot({ path: '.tools/library-usability-verification/library-metadata.png' });
  await page.setViewportSize({ width: 640, height: 900 });
  expect(await page.locator('.library-main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.tools/library-usability-verification/library-narrow.png' });
  await page.getByRole('button', { name: '교정한 논문 제목', exact: true }).click();
  await expect(page.locator('.document-title')).toHaveText('교정한 논문 제목');
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('native file-drop extracts a first-page title and failed rating saves leave the old value intact', async ({ page }) => {
  await installBackend(page, undefined, await paperPdf(false)); await page.goto('/'); await library(page);
  await page.evaluate(() => { (window as any).__emitFileDrag({ type: 'drop', paths: ['/papers/download-123.pdf'] }); });
  await expect(page.getByRole('button', { name: 'Learning from Context', exact: true })).toBeVisible();
  await expect(page.locator('.library-paper-title small')).toHaveText('download-123.pdf');
  await page.evaluate(() => { (window as any).__libraryMutationFail = true; });
  await page.getByRole('radio', { name: '중요도 5점' }).click(); await expect(page.getByRole('alert')).toContainText('Library 변경에 실패');
  await expect(page.getByRole('radio', { name: '중요도 5점' })).not.toBeChecked();
  await page.evaluate(() => { (window as any).__libraryMutationFail = false; });
  await page.getByRole('radio', { name: '중요도 5점' }).check(); await expect(page.getByRole('radio', { name: '중요도 5점' })).toBeChecked();
});
