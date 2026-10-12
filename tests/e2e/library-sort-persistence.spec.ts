import { expect, test } from '@playwright/test';
import { installBackend } from './helpers';

test('Library remembers every sort column and direction across restart, folder and screen changes', async ({ page }) => {
  await installBackend(page); await page.goto('/');
  await page.evaluate(() => {
    const papers = [
      { id: 'a', title: 'Paper A', importance: 5, memo: 'Zebra', authors: 'Bob', publishedDate: '2022', uploadedAt: '2024-01-01T00:00:00Z' },
      { id: 'b', title: 'Paper B', importance: 2, memo: 'Apple', authors: 'Alice', publishedDate: '2024', uploadedAt: '2023-01-01T00:00:00Z' },
      { id: 'c', title: 'Paper C', importance: 0, memo: '', authors: '', publishedDate: '', uploadedAt: '' },
    ].map(p => ({ ...p, fileName: p.id + '.pdf' }));
    localStorage.setItem('test-papers', JSON.stringify(papers));
    localStorage.setItem('test-library-memberships', JSON.stringify(papers.map(p => ({ paperId: p.id, folderId: null }))));
  });
  const library = () => page.getByRole('button', { name: 'Library', exact: true }).click();
  const titles = page.locator('.library-open-paper');
  await library();
  await expect(titles).toHaveText(['Paper A', 'Paper B', 'Paper C']);
  for (const [label, direction, expected] of [
    ['중요도', 'desc', ['Paper A', 'Paper B', 'Paper C']],
    ['중요도', 'asc', ['Paper B', 'Paper A', 'Paper C']],
    ['메모', 'asc', ['Paper B', 'Paper A', 'Paper C']],
    ['메모', 'desc', ['Paper A', 'Paper B', 'Paper C']],
    ['저자명', 'asc', ['Paper B', 'Paper A', 'Paper C']],
    ['저자명', 'desc', ['Paper A', 'Paper B', 'Paper C']],
    ['발행일', 'desc', ['Paper B', 'Paper A', 'Paper C']],
    ['발행일', 'asc', ['Paper A', 'Paper B', 'Paper C']],
    ['업로드 날짜', 'desc', ['Paper A', 'Paper B', 'Paper C']],
    ['업로드 날짜', 'asc', ['Paper B', 'Paper A', 'Paper C']],
    ['논문 제목', 'asc', ['Paper A', 'Paper B', 'Paper C']],
    ['논문 제목', 'desc', ['Paper C', 'Paper B', 'Paper A']],
  ] as const) {
    const header = page.getByRole('button', { name: `${label} 정렬`, exact: true });
    await header.click();
    await expect(titles).toHaveText([...expected]);
    await page.reload(); await library();
    await expect(header).toHaveAttribute('aria-pressed', 'true');
    await expect(header).toHaveAttribute('data-sort-direction', direction);
    await expect(titles).toHaveText([...expected]);
  }
  const folders = page.getByRole('navigation', { name: 'Library 폴더', exact: true });
  await folders.getByRole('button', { name: '기본 폴더', exact: true }).click();
  await folders.getByRole('button', { name: 'Library 홈', exact: true }).click();
  await page.getByRole('button', { name: 'PDF Reader', exact: true }).click(); await library();
  await expect(titles).toHaveText(['Paper C', 'Paper B', 'Paper A']);
  expect(await page.evaluate(() => (window as any).__calls.some((call: any) => call.command === 'update_paper_metadata'))).toBe(false);
});

test('an invalid saved sort falls back to title and can be replaced with a valid preference', async ({ page }) => {
  await installBackend(page); await page.goto('/');
  await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
  await page.evaluate(() => localStorage.setItem('paper-vocabulary.library-sort.v1', JSON.stringify({ key: 'removed-column', direction: 'asc' })));
  await page.reload(); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: '논문 제목 정렬', exact: true })).toHaveAttribute('data-sort-direction', 'asc');
  await page.getByRole('button', { name: '중요도 정렬', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: '중요도 정렬', exact: true })).toHaveAttribute('data-sort-direction', 'desc');
});
