import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, select } from './helpers';

const library = (page: Page) => page.getByRole('button', { name: 'Library', exact: true }).click();
const reader = (page: Page) => page.getByRole('button', { name: 'PDF Reader', exact: true }).click();
const folders = (page: Page) => page.getByRole('navigation', { name: 'Library 폴더', exact: true });
const root = (page: Page) => folders(page).getByRole('button', { name: 'Library 홈', exact: true }).click();
async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click();
  await page.getByLabel('폴더 이름', { exact: true }).fill(name);
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.locator('.library-heading h2')).toHaveText(name);
  await expect(page.getByRole('form')).toHaveCount(0);
}
async function saveWord(page: Page) {
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1); await page.keyboard.press('Escape');
}

test('Library creates nested folders, renames and moves them, and imports without duplicate papers', async ({ page }) => {
  await installBackend(page); await page.goto('/'); await library(page);
  await expect(page.getByText('이 위치에 저장된 논문이 없습니다.')).toBeVisible();
  await createFolder(page, '연구'); await createFolder(page, '강화 학습'); await createFolder(page, '2026');
  await folders(page).getByRole('button', { name: '강화 학습', exact: true }).click();
  await page.getByRole('button', { name: '폴더 이름 변경', exact: true }).click();
  await page.getByLabel('폴더 이름', { exact: true }).fill('로봇 학습');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('.library-heading h2')).toHaveText('로봇 학습');
  await page.getByRole('button', { name: '폴더 이동', exact: true }).click();
  await expect(page.getByLabel('이동할 폴더').locator('option')).toHaveText(['Library 홈', '기본 폴더', '연구']);
  await page.getByLabel('이동할 폴더').selectOption('');
  await page.getByRole('button', { name: '이동', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '현재 폴더 경로' })).toHaveText('Library 홈 / 로봇 학습');
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.locator('.library-papers > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.locator('.library-papers > li')).toHaveCount(1);
  await page.getByRole('button', { name: '이름 변경', exact: true }).click();
  await page.getByLabel('논문 이름', { exact: true }).fill('로봇 제어 논문');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '로봇 제어 논문', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '폴더로 이동', exact: true }).click();
  await page.getByLabel('이동할 폴더').selectOption({ label: '로봇 학습 / 2026' });
  await page.getByRole('button', { name: '이동', exact: true }).click();
  await expect(page.locator('.library-papers > li')).toHaveCount(0);
  await folders(page).getByRole('button', { name: '2026', exact: true }).click();
  await expect(page.getByRole('button', { name: '로봇 제어 논문', exact: true })).toBeVisible();
  await page.screenshot({ path: '.tools/library-verification/library-nested.png' });
  await page.setViewportSize({ width: 640, height: 900 });
  expect(await page.locator('.library-main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.tools/library-verification/library-narrow.png' });
  await page.reload(); await library(page);
  await folders(page).getByRole('button', { name: '2026', exact: true }).click();
  await expect(page.getByRole('button', { name: '로봇 제어 논문', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('existing PDFs reopen from Library with saved highlights and preserve cached reader nodes on navigation', async ({ page }) => {
  await installBackend(page); await open(page); await saveWord(page);
  await page.getByRole('button', { name: '페이지 너비 맞춤' }).click();
  await expect.poll(() => page.locator('.pdf-page').first().evaluate(el =>
    el.getAttribute('data-rendered-scale') !== '1.25' &&
    el.getAttribute('data-rendered-scale') === el.closest<HTMLElement>('.reader')!.dataset.displayScale)).toBe(true);
  await page.evaluate(() => { (window as any).__nodes = [document.querySelector('.pdf-page canvas'), document.querySelector('.pdf-page .textLayer')];
    (window as any).__scaleBefore = document.querySelector('.pdf-page')?.getAttribute('data-rendered-scale'); });
  await library(page);
  await expect(page.getByRole('button', { name: 'test-paper.pdf', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '이름 변경', exact: true }).click();
  await page.getByLabel('논문 이름', { exact: true }).fill('논문 제목');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '논문 제목', exact: true }).click();
  await expect(page.getByRole('button', { name: '페이지 너비 맞춤' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => {
    const nodes = (window as any).__nodes;
    return nodes[0] === document.querySelector('.pdf-page canvas') && nodes[1] === document.querySelector('.pdf-page .textLayer') &&
      (window as any).__scaleBefore === document.querySelector('.pdf-page')?.getAttribute('data-rendered-scale');
  })).toBe(true);
  await expect(page.locator('.document-title')).toHaveText('논문 제목');
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await page.getByRole('button', { name: 'Detailed View' }).click();
  await expect(page.locator('.vocabulary-context')).toContainText('논문 제목');
  await page.reload(); await library(page);
  await page.getByRole('button', { name: '논문 제목', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'open_pdf'))).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('Library PDF drop targets the selected folder and handles import cancellation and failure', async ({ page }) => {
  await installBackend(page); await open(page); await library(page); await createFolder(page, '읽을 논문');
  await page.evaluate(() => { (window as any).__importCancel = true; });
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PDF 추가', exact: true })).toBeEnabled();
  await expect(page.locator('.library-papers > li')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__importCancel = false; (window as any).__libraryMutationFail = true; });
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('PDF를 저장하지 못했습니다.');
  await page.evaluate(() => { (window as any).__libraryMutationFail = false; (window as any).__emitFileDrag({ type: 'enter', valid: true }); });
  await expect(page.getByText('현재 폴더에 PDF 추가', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__emitFileDrag({ type: 'drop', paths: ['/papers/another.pdf'] }); });
  await expect(page.getByRole('button', { name: 'another.pdf', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const last = await page.evaluate(() => (window as any).__calls.findLast((c: any) => c.command === 'import_dropped_library_pdf'));
  expect(last.args.folderId).toBe(2);
  await page.evaluate(() => { (window as any).__emitFileDrag({ type: 'drop', paths: ['/papers/not-pdf.txt'] }); });
  await expect(page.getByRole('alert')).toContainText('PDF 파일만');
  await reader(page); await expect(page.locator('.document-title')).toHaveText('test-paper.pdf');
  await expect(page.locator('.pdf-page .textLayer').first()).toBeVisible();
});

test('folder deletion previews descendants, can cancel, and removes only the selected subtree', async ({ page }) => {
  await installBackend(page); await open(page); await saveWord(page); await library(page);
  await createFolder(page, '연구'); await createFolder(page, '하위');
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.locator('.library-papers > li')).toHaveCount(1);
  await root(page); await createFolder(page, '보관');
  await page.evaluate(() => { (window as any).__emitFileDrag({ type: 'drop', paths: ['/papers/kept.pdf'] }); });
  await expect(page.getByRole('button', { name: 'kept.pdf', exact: true })).toBeVisible();
  const before = await page.evaluate(() => ({ cost: localStorage.getItem('test-cost'), lookups: localStorage.getItem('test-lookups'), highlights: localStorage.getItem('test-highlights') }));
  await folders(page).getByRole('button', { name: '연구', exact: true }).click();
  await page.getByRole('button', { name: '폴더 삭제', exact: true }).click();
  await expect(page.getByRole('form', { name: '폴더 삭제' })).toContainText('하위 폴더 1개, 논문 1개');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(folders(page).getByRole('button', { name: '하위', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '폴더 삭제', exact: true }).click();
  await page.getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(folders(page).getByRole('button', { name: '연구', exact: true })).toHaveCount(0);
  await expect(folders(page).getByRole('button', { name: '하위', exact: true })).toHaveCount(0);
  await folders(page).getByRole('button', { name: '보관', exact: true }).click();
  await expect(page.getByRole('button', { name: 'kept.pdf', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ cost: localStorage.getItem('test-cost'), lookups: localStorage.getItem('test-lookups'), highlights: localStorage.getItem('test-highlights') }))).toEqual(before);
  await reader(page); await expect(page.getByRole('button', { name: 'PDF 파일 열기' })).toBeVisible();
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveText('asymptotic');
  await page.reload(); await library(page);
  await expect(folders(page).getByRole('button', { name: '연구', exact: true })).toHaveCount(0);
});

test('paper deletion handles errors, keeps vocabulary, and permits reimport with restored highlights', async ({ page }) => {
  await installBackend(page); await open(page); await saveWord(page); await library(page);
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('form', { name: '논문 삭제' })).toContainText('원본 파일과 Vocabulary 기록은 유지됩니다.');
  await page.evaluate(() => { (window as any).__libraryMutationFail = true; });
  await page.getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Library 변경에 실패했습니다.');
  await expect(page.locator('.library-papers > li')).toHaveCount(1);
  await page.evaluate(() => { (window as any).__libraryMutationFail = false; });
  await page.getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(page.locator('.library-papers > li')).toHaveCount(0);
  await page.reload(); await library(page); await expect(page.locator('.library-papers > li')).toHaveCount(0);
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await page.getByRole('button', { name: 'test-paper.pdf', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('Library load, folder validation and missing saved PDF errors are recoverable', async ({ page }) => {
  await installBackend(page); await page.goto('/');
  await page.evaluate(() => { (window as any).__libraryFail = true; }); await library(page);
  await expect(page.getByRole('alert')).toContainText('Library를 읽지 못했습니다.');
  await expect(page.getByRole('button', { name: '새 폴더', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).__libraryFail = false; });
  await page.getByRole('button', { name: '다시 시도', exact: true }).click(); await createFolder(page, '연구'); await root(page);
  await page.getByRole('button', { name: '새 폴더', exact: true }).click();
  await page.getByLabel('폴더 이름', { exact: true }).fill('연구');
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('같은 위치에 같은 이름의 폴더');
  await page.getByLabel('폴더 이름', { exact: true }).fill('다른 연구');
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.locator('.library-heading h2')).toHaveText('다른 연구');
  await page.getByRole('button', { name: 'PDF 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: 'test-paper.pdf', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__readFail = true; });
  await page.getByRole('button', { name: 'test-paper.pdf', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('저장된 PDF를 읽지 못했습니다.');
  await expect(page.getByRole('button', { name: 'Library', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { (window as any).__readFail = false; });
  await page.getByRole('button', { name: 'test-paper.pdf', exact: true }).click();
  await expect(page.locator('.pdf-page .textLayer').first()).toBeVisible();
});
