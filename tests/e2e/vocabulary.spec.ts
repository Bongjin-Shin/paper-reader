import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, select, wordBox } from './helpers';
import { makeScrollPdf } from '../performance/fixture';

async function vocabulary(page: Page) { await page.getByRole('button', { name: 'Vocabulary', exact: true }).click(); }
async function reader(page: Page) { await page.getByRole('button', { name: 'PDF Reader', exact: true }).click(); }
async function clickSaved(page: Page) {
  const word = await wordBox(page);
  await page.mouse.click(word.x + word.width / 2, word.y + word.height / 2);
}
async function save(page: Page, action = '번역') {
  await select(page); await page.getByRole('button', { name: action, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(action === '번역' ? '점근적인' : '극한에서 어떤 성질에 가까워진다는 의미입니다.');
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await page.keyboard.press('Escape');
}

test('empty Vocabulary reads only on navigation and disables entry deletion', async ({ page }) => {
  await installBackend(page); await page.goto('/');
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'get_vocabulary'))).toHaveLength(0);
  await vocabulary(page);
  await expect(page.getByText('저장된 단어가 없습니다.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simple View' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('단어 검색')).toBeVisible();
  await expect(page.getByLabel('논문', { exact: true }).locator('option')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '인쇄 미리보기' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '발음' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '선택 삭제 (0)' })).toBeDisabled();
  await page.evaluate(() => { (window as any).__vocabularyFail = true; });
  await page.getByLabel('단어 검색').fill('none');
  await expect(page.getByRole('alert')).toContainText('로컬 단어장');
  await page.evaluate(() => { (window as any).__vocabularyFail = false; });
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('검색 조건에 맞는 단어가 없습니다.')).toBeVisible();
  await reader(page);
  await expect(page.getByRole('button', { name: 'PDF 파일 열기' })).toBeVisible();
});

test('Simple/Detailed show all contexts and search English or Korean with paper filters', async ({ page }) => {
  await installBackend(page);
  await page.addInitScript(() => {
    localStorage.setItem('test-papers', JSON.stringify([
      { id: 'paper-a', title: 'Multi-Robot Task Allocation', fileName: 'robots.pdf' },
      { id: 'paper-b', title: 'Memory Systems', fileName: 'memory.pdf' },
      { id: 'empty', title: 'Unread Paper', fileName: 'empty.pdf' },
    ]));
    localStorage.setItem('test-lookups', JSON.stringify([
      { entryId: 1, word: 'allocation', paperId: 'paper-a', pageNumber: 6, originalSentence: 'Task allocation among robots.', action: 'translation', text: '작업 배분' },
      { entryId: 1, word: 'allocation', paperId: 'paper-a', pageNumber: 6, originalSentence: 'Task allocation among robots.', action: 'explanation', text: '로봇에게 작업을 나누는 것을 뜻합니다.' },
      { entryId: 1, word: 'allocation', paperId: 'paper-b', pageNumber: 3, originalSentence: 'Memory allocation is required.', action: 'translation', text: '메모리 할당' },
      { entryId: 2, word: 'asymptotic', paperId: 'paper-a', pageNumber: 9, originalSentence: 'An asymptotic bound.', action: 'translation', text: '점근적인' },
      { entryId: 3, word: 'decision-making', paperId: 'paper-b', pageNumber: 4, originalSentence: 'A decision-making process.', action: 'explanation', text: '결정을 내리는 과정입니다.' },
    ]));
  });
  await page.goto('/'); await vocabulary(page);
  const simple = page.locator('.vocabulary-simple');
  await expect(simple.locator('.vocabulary-word')).toHaveText(['allocation', 'asymptotic', 'decision-making']);
  await expect(simple.locator('dd')).toHaveText(['메모리 할당', '점근적인', '—']);
  await expect(simple).not.toContainText('조회'); await expect(simple).not.toContainText('Memory Systems');
  await page.screenshot({ path: 'test-results/vocabulary-simple.png' });
  await page.getByRole('button', { name: 'Detailed View' }).click();
  const allocation = page.locator('.vocabulary-entry').filter({ has: page.getByRole('heading', { name: 'allocation', exact: true }) });
  await expect(allocation).toContainText('조회 3회');
  await expect(allocation.locator('.vocabulary-context')).toHaveCount(2);
  for (const text of ['작업 배분', '메모리 할당', '로봇에게 작업을 나누는 것을 뜻합니다.', 'Task allocation among robots.', 'Memory allocation is required.', 'Multi-Robot Task Allocation', 'Memory Systems', '6페이지', '3페이지'])
    await expect(allocation).toContainText(text);
  await page.screenshot({ path: 'test-results/vocabulary-detailed.png' });
  await page.getByLabel('단어 검색').fill(' ALLO ');
  await expect(page.locator('.vocabulary-entry')).toHaveCount(1);
  await page.getByLabel('단어 검색').fill('작업 배분');
  await expect(page.locator('.vocabulary-entry')).toHaveCount(1);
  await page.getByLabel('논문', { exact: true }).selectOption('paper-a');
  await expect(allocation.locator('.vocabulary-context')).toHaveCount(1);
  await expect(allocation).toContainText('조회 3회');
  await page.getByRole('button', { name: 'Simple View' }).click();
  await expect(simple.locator('dd')).toHaveText(['작업 배분']);
  await page.getByLabel('논문', { exact: true }).selectOption('paper-b');
  await expect(page.getByText('검색 조건에 맞는 단어가 없습니다.')).toBeVisible();
  await page.getByLabel('단어 검색').fill('');
  await expect(simple.locator('.vocabulary-word')).toHaveText(['allocation', 'decision-making']);
  await page.getByLabel('논문', { exact: true }).selectOption('empty');
  await expect(page.getByText('검색 조건에 맞는 단어가 없습니다.')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
  await page.getByLabel('논문', { exact: true }).selectOption('');
  await expect(simple.locator('.vocabulary-word')).toHaveCount(3);
  await reader(page);
  await expect(page.locator('.vocabulary-page')).toHaveCount(0);
  await vocabulary(page);
  await expect(simple.locator('.vocabulary-word')).toHaveCount(3);
});

test('cached requests increment Lookup Count, persist and highlight new paper locations without charge', async ({ page }) => {
  await installBackend(page); await open(page); await save(page);
  const cost = await page.evaluate(() => localStorage.getItem('test-cost'));
  await page.evaluate(() => { (window as any).__fail = true; });
  await save(page); // Same word/context/action, even while API is unavailable.
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(1);
  await vocabulary(page); await page.getByRole('button', { name: 'Detailed View' }).click();
  await expect(page.locator('.vocabulary-entry')).toContainText('조회 2회');
  await page.reload(); await reader(page);
  await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
  await save(page);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
  await page.evaluate(() => (window as any).__emitFileDrag({ type: 'drop', paths: ['/papers/second.pdf'] }));
  await expect(page.locator('.document-title')).toHaveText('second.pdf');
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
  await save(page);
  expect(await page.evaluate(() => localStorage.getItem('test-cost'))).toBe(cost);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
  await vocabulary(page); await page.getByRole('button', { name: 'Detailed View' }).click();
  await expect(page.locator('.vocabulary-entry')).toContainText('조회 4회');
  await expect(page.locator('.vocabulary-context')).toHaveCount(2);
});

test('highlight clicks and saved result switches read locally without changing counts or usage', async ({ page }) => {
  await installBackend(page); await open(page); await save(page); await save(page, '설명');
  await page.evaluate(() => { (window as any).__fail = true; });
  const before = await page.evaluate(() => ({ calls: (window as any).__apiCalls, cost: localStorage.getItem('test-cost'), count: JSON.parse(localStorage.getItem('test-lookups')!).length }));
  await clickSaved(page);
  // Explanations no longer overwrite the saved translation/highlight.
  await expect(page.getByRole('dialog')).toContainText('점근적인');
  await page.getByRole('button', { name: '설명 보기' }).click();
  await expect(page.getByRole('dialog')).toContainText('극한에서 어떤 성질에 가까워진다는 의미입니다.');
  await page.getByRole('button', { name: '뜻 보기' }).click();
  await expect(page.getByRole('dialog')).toContainText('점근적인');
  await page.getByRole('button', { name: '설명 보기' }).click();
  await expect(page.getByRole('dialog')).toContainText('극한에서');
  const after = await page.evaluate(() => ({ calls: (window as any).__apiCalls, cost: localStorage.getItem('test-cost'), count: JSON.parse(localStorage.getItem('test-lookups')!).length }));
  expect(after).toEqual(before);
  await page.keyboard.press('Escape'); await select(page);
  await expect(page.getByRole('button', { name: '번역', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '설명', exact: true })).toBeVisible();
});

test('highlight local read handles errors and stale replies without turning into API requests', async ({ page }) => {
  await installBackend(page); await open(page); await save(page);
  await page.evaluate(() => { (window as any).__savedFail = true; });
  await clickSaved(page);
  await expect(page.getByRole('dialog')).toContainText('저장된 결과를 읽지 못했습니다.');
  await page.evaluate(() => { (window as any).__savedFail = false; });
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('dialog')).toContainText('점근적인');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (window as any).__savedDelay = 350; });
  await clickSaved(page); await select(page, 'context-aware');
  await page.waitForTimeout(400);
  await expect(page.getByRole('dialog', { name: 'context-aware 단어 도구' })).toBeVisible();
  await expect(page.getByRole('button', { name: '번역', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(1);
});

test('dragging from a saved highlight still selects full text instead of opening a saved result', async ({ page }) => {
  await installBackend(page); await open(page); await save(page);
  await page.mouse.click(30, 300); // Clear the browser's old selection, leaving the saved highlight.
  const a = await wordBox(page), b = await wordBox(page, 'complexity');
  await page.mouse.move(a.x + .2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width - .2, b.y + b.height / 2, { steps: 15 }); await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '선택 텍스트 도구' })).toBeVisible();
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('선택한 전체 문장의 번역입니다.')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'get_saved_highlight'))).toHaveLength(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-lookups')!).length)).toBe(2);
});

test('reader scroll, fit zoom and cached page nodes survive Vocabulary navigation and searching', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf()); await open(page);
  await page.getByRole('button', { name: '페이지 너비 맞춤' }).click();
  const target = page.locator('.pdf-page[data-page-number="8"]');
  await target.evaluate(el => {
    const reader = document.querySelector('.reader')!;
    reader.scrollTop += el.getBoundingClientRect().top - reader.getBoundingClientRect().top;
  });
  await expect(target).toHaveAttribute('data-rendered-scale');
  await page.evaluate(() => {
    const target = document.querySelector('.pdf-page[data-page-number="8"]')!;
    (window as any).__readerBefore = { canvas: target.querySelector('canvas'), text: target.querySelector('.textLayer'),
      scroll: document.querySelector('.reader')!.scrollTop, scale: target.getAttribute('data-rendered-scale') };
  });
  await vocabulary(page); await page.getByLabel('단어 검색').fill('test');
  await expect(page.getByText('검색 조건에 맞는 단어가 없습니다.')).toBeVisible();
  await reader(page);
  await expect(page.getByRole('button', { name: '페이지 너비 맞춤' })).toHaveAttribute('aria-pressed', 'true');
  const restored = await page.evaluate(() => {
    const before = (window as any).__readerBefore, target = document.querySelector('.pdf-page[data-page-number="8"]')!;
    return { canvas: before.canvas === target.querySelector('canvas'), text: before.text === target.querySelector('.textLayer'),
      beforeScroll: before.scroll, scroll: document.querySelector('.reader')!.scrollTop,
      beforeScale: before.scale, scale: target.getAttribute('data-rendered-scale') };
  });
  expect(restored.canvas).toBe(true); expect(restored.text).toBe(true);
  expect(restored.scroll).toBe(restored.beforeScroll); expect(restored.scale).toBe(restored.beforeScale);
});

test('a pending word result updates Vocabulary without reopening its bubble', async ({ page }) => {
  await installBackend(page, { delay: 400, fail: false, rotation: 0, userUnit: 1 }); await open(page);
  await select(page); await page.getByRole('button', { name: '번역', exact: true }).click(); await vocabulary(page);
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveText('asymptotic');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await reader(page); await expect(page.locator('.word-highlight')).toHaveCount(1);
});

for (const rotation of [0, 90, 270]) {
  test(`restored highlight clicks stay aligned after zoom with rotation ${rotation}`, async ({ page }) => {
    await installBackend(page, { delay: 0, fail: false, rotation, userUnit: 1 }); await open(page); await save(page);
    await page.reload(); await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
    await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
    await page.getByRole('button', { name: '확대', exact: true }).click();
    await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.5');
    await clickSaved(page); await expect(page.getByRole('dialog')).toContainText('점근적인');
    expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
    await page.getByRole('button', { name: '축소', exact: true }).click();
    await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
    await expect(page.getByRole('dialog')).toBeVisible();
  });
}
