import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, select, wordBox } from './helpers';

const vocabulary = (page: Page) => page.getByRole('button', { name: 'Vocabulary', exact: true }).click();
const reader = (page: Page) => page.getByRole('button', { name: 'PDF Reader', exact: true }).click();
const checked = (page: Page, word: string) => page.getByRole('checkbox', { name: `${word} 선택`, exact: true });
async function save(page: Page, word = 'asymptotic') {
  await select(page, word);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('점근적인');
  await page.keyboard.press('Escape');
}
async function seed(page: Page, count = 3) {
  await page.evaluate(count => {
    localStorage.setItem('test-papers', JSON.stringify([
      { id: 'paper-a', title: 'Paper A', fileName: 'a.pdf' }, { id: 'paper-b', title: 'Paper B', fileName: 'b.pdf' },
    ]));
    localStorage.setItem('test-lookups', JSON.stringify(Array.from({ length: count }, (_, i) => ({
      entryId: i + 1, word: ['allocation', 'asymptotic', 'decision-making'][i] ?? `word-${i}`,
      paperId: i % 2 ? 'paper-b' : 'paper-a', pageNumber: 1, originalSentence: 'Original context.',
      action: 'translation', text: ['할당', '점근적인', '의사 결정'][i] ?? '한국어 뜻',
    }))));
  }, count);
}

test('Vocabulary Ctrl+wheel zoom is bounded and independent from scrolling and PDF zoom', async ({ page }) => {
  await installBackend(page); await open(page); await seed(page, 50);
  await page.evaluate(() => {
    (window as any).__readerNodes = [document.querySelector('.pdf-page canvas'), document.querySelector('.pdf-page .textLayer')];
  });
  await vocabulary(page);
  const zoom = page.locator('.vocabulary-tools .zoom-controls span');
  await expect(zoom).toHaveText('100%');
  await page.mouse.move(700, 500);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect(zoom).toHaveText('122%');
  await expect(page.locator('.vocabulary-simple .vocabulary-word').first()).toHaveCSS('font-size', '19.5424px');
  const scrollBefore = await page.locator('.vocabulary-page').evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, 350);
  await expect.poll(() => page.locator('.vocabulary-page').evaluate(el => el.scrollTop)).toBeGreaterThan(scrollBefore);
  await expect(zoom).toHaveText('122%');
  await page.keyboard.down('Control');
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect(zoom).toHaveText('200%');
  await expect(page.getByRole('button', { name: 'Vocabulary 확대', exact: true })).toBeDisabled();
  await page.keyboard.down('Control');
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await expect(zoom).toHaveText('75%');
  await expect(page.getByRole('button', { name: 'Vocabulary 축소', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  await reader(page);
  await expect(page.locator('.zoom-controls span')).toHaveText('125%');
  expect(await page.evaluate(() => {
    const nodes = (window as any).__readerNodes;
    return nodes[0] === document.querySelector('.pdf-page canvas') && nodes[1] === document.querySelector('.pdf-page .textLayer');
  })).toBe(true);
  await page.mouse.move(700, 500);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect(page.locator('.zoom-controls span')).not.toHaveText('125%');
  await vocabulary(page); await expect(zoom).toHaveText('75%');
  // Line-mode wheels also work; this event must be canceled even at a bound.
  const canceled = await page.locator('.vocabulary-page').evaluate(el => !el.dispatchEvent(
    new WheelEvent('wheel', { ctrlKey: true, deltaY: -3, deltaMode: 1, cancelable: true, bubbles: true })));
  expect(canceled).toBe(true);
  await expect(zoom).toHaveText('83%');
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('Korean meanings sit at the right edge in both views at narrow and enlarged sizes', async ({ page }) => {
  await installBackend(page); await page.goto('/'); await seed(page); await vocabulary(page);
  for (const width of [1200, 640]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['Simple View', 'Detailed View']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      const meanings = page.locator(view === 'Simple View' ? '.vocabulary-simple dd' : '.context-meaning dd');
      await expect(meanings).toHaveCount(3);
      await page.getByRole('button', { name: 'Vocabulary 확대', exact: true }).click();
      for (const meaning of await meanings.all()) {
        await expect(meaning).toHaveCSS('text-align', 'right');
        expect(await meaning.evaluate(el => {
          const text = document.createRange(); text.selectNodeContents(el);
          return Math.abs(text.getBoundingClientRect().right - el.getBoundingClientRect().right);
        })).toBeLessThan(2);
      }
      expect(await page.locator('.vocabulary-page').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: `.tools/vocabulary-controls-verification/${view.split(' ')[0]}-${width}.png` });
    }
  }
});

test('selected deletion removes all paper contexts and highlights, persists, and invalidates only deleted cache', async ({ page }) => {
  await installBackend(page); await open(page); await save(page); await save(page, 'context-aware');
  await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('test-lookups')!);
    localStorage.setItem('test-lookups', JSON.stringify([...rows, { ...rows[0], paperId: 'paper-b' },
      { entryId: 3, word: 'A selected sentence.', paperId: 'paper-a', pageNumber: 1, originalSentence: 'A selected sentence.', action: 'translation', text: '선택한 문장.' }]));
    const papers = JSON.parse(localStorage.getItem('test-papers')!);
    localStorage.setItem('test-papers', JSON.stringify([...papers, { id: 'paper-b', title: 'Paper B', fileName: 'b.pdf' }]));
    const highlights = JSON.parse(localStorage.getItem('test-highlights')!);
    localStorage.setItem('test-highlights', JSON.stringify([...highlights, { ...highlights[0], id: 3, paperId: 'paper-b', lookupIndex: 2 }]));
    (window as any).__readerNodes = [document.querySelector('.pdf-page canvas'), document.querySelector('.pdf-page .textLayer')];
  });
  const cost = await page.evaluate(() => localStorage.getItem('test-cost'));
  await vocabulary(page);
  await page.getByLabel('논문', { exact: true }).selectOption('paper-a');
  await checked(page, 'asymptotic').check(); await checked(page, 'A selected sentence.').check();
  await page.getByRole('button', { name: 'Detailed View' }).click();
  await expect(checked(page, 'asymptotic')).toBeChecked();
  await expect(page.getByText('선택한 항목의 모든 논문 문맥과 하이라이트도 함께 삭제됩니다.')).toBeVisible();
  await page.getByRole('button', { name: '선택 삭제 (2)' }).click();
  await expect(page.getByText('2개 항목을 삭제했습니다.')).toBeVisible();
  await expect(page.locator('.vocabulary-entry h2')).toHaveText(['context-aware']);
  await page.getByLabel('논문', { exact: true }).selectOption('');
  await expect(page.locator('.vocabulary-entry h2')).toHaveText(['context-aware']);
  await expect(page.getByLabel('논문', { exact: true }).locator('option')).toHaveCount(3);
  expect(await page.evaluate(() => localStorage.getItem('test-cost'))).toBe(cost);
  await reader(page); await expect(page.locator('.word-highlight')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const nodes = (window as any).__readerNodes;
    return nodes[0] === document.querySelector('.pdf-page canvas') && nodes[1] === document.querySelector('.pdf-page .textLayer');
  })).toBe(true);
  await page.reload(); await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  const box = await wordBox(page, 'context-aware');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toContainText('점근적인');
  await page.keyboard.press('Escape'); await save(page, 'context-aware');
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
  await save(page);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(1);
  await vocabulary(page); await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveText(['asymptotic', 'context-aware']);
});

test('selection clears on search, paper filter and navigation; failed deletion keeps data and can retry', async ({ page }) => {
  await installBackend(page); await page.goto('/'); await seed(page); await vocabulary(page);
  await checked(page, 'allocation').check();
  await page.getByLabel('단어 검색').fill('asymptotic');
  await expect(page.getByRole('button', { name: '선택 삭제 (0)' })).toBeDisabled();
  await checked(page, 'asymptotic').check();
  await page.getByLabel('단어 검색').fill('');
  await checked(page, 'allocation').check();
  await page.getByLabel('논문', { exact: true }).selectOption('paper-b');
  await expect(page.getByRole('button', { name: '선택 삭제 (0)' })).toBeDisabled();
  await checked(page, 'asymptotic').check(); await reader(page); await vocabulary(page);
  await expect(checked(page, 'asymptotic')).not.toBeChecked();
  await checked(page, 'asymptotic').check();
  await page.evaluate(() => { (window as any).__deleteFail = true; });
  await page.getByRole('button', { name: '선택 삭제 (1)' }).click();
  await expect(page.getByRole('alert')).toContainText('단어를 삭제하지 못했습니다.');
  await expect(checked(page, 'asymptotic')).toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-lookups')!).length)).toBe(3);
  await page.evaluate(() => { (window as any).__deleteFail = false; (window as any).__deleteDelay = 300; });
  await page.getByRole('button', { name: '선택 삭제 (1)' }).click();
  await expect(page.getByRole('button', { name: '삭제 중…' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '전체 선택', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '순서 섞기', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'PDF 내보내기' })).toBeDisabled();
  await expect(page.getByLabel('단어 검색')).toBeDisabled();
  await expect(page.getByText('1개 항목을 삭제했습니다.')).toBeVisible();
  await expect(page.getByText('검색 조건에 맞는 단어가 없습니다.')).toBeVisible();
  await page.getByLabel('논문', { exact: true }).selectOption('');
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveText(['allocation', 'decision-making']);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('select all includes offscreen entries, shows partial selection and toggles in both views', async ({ page }) => {
  await installBackend(page); await page.goto('/'); await seed(page, 30); await vocabulary(page);
  const all = page.getByRole('checkbox', { name: '전체 선택', exact: true });
  const entries = page.locator('.vocabulary-content input[type="checkbox"]');
  await all.check();
  await expect(page.getByRole('button', { name: '선택 삭제 (30)' })).toBeEnabled();
  await expect(page.locator('.vocabulary-content input:checked')).toHaveCount(30);
  await entries.first().uncheck();
  await expect(all).not.toBeChecked();
  await expect(all).toHaveJSProperty('indeterminate', true);
  await all.check();
  await expect(all).toHaveJSProperty('indeterminate', false);
  await page.getByRole('button', { name: 'Detailed View' }).click();
  await expect(all).toBeChecked();
  await expect(page.locator('.vocabulary-content input:checked')).toHaveCount(30);
  await all.uncheck();
  await expect(page.locator('.vocabulary-content input:checked')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '선택 삭제 (0)' })).toBeDisabled();
  await all.check();
  await page.getByRole('button', { name: 'Simple View' }).click();
  await expect(all).toBeChecked();
  await expect(page.locator('.vocabulary-content input:checked')).toHaveCount(30);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('select all follows search and paper filters and deletion leaves hidden entries intact', async ({ page }) => {
  await installBackend(page); await page.goto('/'); await seed(page); await vocabulary(page);
  const all = page.getByRole('checkbox', { name: '전체 선택', exact: true });
  const shuffle = page.getByRole('button', { name: '순서 섞기', exact: true });
  await page.getByLabel('논문', { exact: true }).selectOption('paper-a');
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveText(['allocation', 'decision-making']);
  await all.check();
  await expect(page.getByRole('button', { name: '선택 삭제 (2)' })).toBeEnabled();
  await page.getByLabel('단어 검색').fill('의사');
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveText(['decision-making']);
  await expect(all).not.toBeChecked();
  await expect(all).toHaveJSProperty('indeterminate', false);
  await expect(shuffle).toBeDisabled();
  await all.check();
  await page.getByRole('button', { name: '선택 삭제 (1)' }).click();
  await expect(page.getByText('1개 항목을 삭제했습니다.')).toBeVisible();
  await expect(all).toBeDisabled();
  await expect(shuffle).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'delete_vocabulary').at(-1).args.ids)).toEqual([3]);
  await page.getByLabel('단어 검색').fill('');
  await page.getByLabel('논문', { exact: true }).selectOption('');
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveText(['allocation', 'asymptotic']);
  await all.check();
  await page.getByRole('button', { name: '선택 삭제 (2)' }).click();
  await expect(page.getByText('저장된 단어가 없습니다.', { exact: false })).toBeVisible();
  await expect(all).toBeDisabled();
  await expect(all).not.toBeChecked();
  await expect(shuffle).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
});

test('shuffle changes only visible order and preserves selected identities, meanings and both views', async ({ page }) => {
  await installBackend(page); await page.goto('/'); await seed(page); await vocabulary(page);
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveText(['allocation', 'asymptotic', 'decision-making']);
  const saved = await page.evaluate(() => localStorage.getItem('test-lookups'));
  await checked(page, 'allocation').check();
  // Fix randomness only for the click so the test cannot fail on a coincidental permutation.
  await page.evaluate(() => { (window as any).__originalRandom = Math.random; Math.random = () => 0; });
  await page.getByRole('button', { name: '순서 섞기', exact: true }).click();
  await page.evaluate(() => { Math.random = (window as any).__originalRandom; });
  await expect(page.locator('.vocabulary-simple .vocabulary-word')).toHaveText(['asymptotic', 'decision-making', 'allocation']);
  await expect(page.locator('.vocabulary-simple dd')).toHaveText(['점근적인', '의사 결정', '할당']);
  await expect(checked(page, 'allocation')).toBeChecked();
  await expect(page.getByRole('button', { name: '선택 삭제 (1)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Vocabulary 확대', exact: true }).click();
  await page.getByRole('button', { name: 'Detailed View' }).click();
  await expect(page.locator('.vocabulary-entry h2')).toHaveText(['asymptotic', 'decision-making', 'allocation']);
  await expect(page.locator('.context-meaning dd')).toHaveText(['점근적인', '의사 결정', '할당']);
  await expect(checked(page, 'allocation')).toBeChecked();
  await page.getByRole('checkbox', { name: '전체 선택', exact: true }).check();
  await page.evaluate(() => { Math.random = () => .99999; });
  await page.getByRole('button', { name: '순서 섞기', exact: true }).click();
  await page.evaluate(() => { Math.random = (window as any).__originalRandom; });
  await expect(page.locator('.vocabulary-entry h2')).toHaveText(['decision-making', 'asymptotic', 'allocation']);
  await expect(page.getByRole('checkbox', { name: '전체 선택', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '선택 삭제 (3)' })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('test-lookups'))).toBe(saved);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
  // A new filter reloads the normal order, and subsequent shuffles use just that result.
  await page.getByLabel('논문', { exact: true }).selectOption('paper-a');
  await expect(page.locator('.vocabulary-entry h2')).toHaveText(['allocation', 'decision-making']);
  await page.getByRole('button', { name: '순서 섞기', exact: true }).click();
  await expect(page.locator('.vocabulary-entry h2')).toHaveText(['decision-making', 'allocation']);
  await expect(page.getByRole('button', { name: '선택 삭제 (0)' })).toBeDisabled();
});
