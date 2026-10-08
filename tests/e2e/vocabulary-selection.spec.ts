import { expect, test, type Page } from '@playwright/test';
import { installBackend } from './helpers';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const row = (page: Page, id: number) => page.locator(`.vocabulary-content [data-selection-id="${id}"]`);
const check = (page: Page, id: number) => row(page, id).getByRole('checkbox');
const selected = (page: Page) => page.locator('.vocabulary-content input:checked');
async function seed(page: Page, count = 6) {
  await installBackend(page); await page.goto('/');
  await page.evaluate(count => {
    localStorage.setItem('test-papers', JSON.stringify([{ id: 'a', title: 'Paper A' }, { id: 'b', title: 'Paper B' }]));
    localStorage.setItem('test-lookups', JSON.stringify(Array.from({ length: count }, (_, i) => ({
      entryId: i + 1, word: `word-${String(i + 1).padStart(2, '0')}`, paperId: i % 2 ? 'b' : 'a', pageNumber: 1,
      originalSentence: 'The original sentence is still selectable.', action: 'translation', text: `한국어 뜻 ${i + 1}`,
    }))));
  }, count);
  await button(page, 'Vocabulary').click(); await expect(row(page, 1)).toBeVisible();
}
async function marquee(page: Page, from: number, to: number, reverse = false) {
  await page.locator('.vocabulary-page').evaluate(el => { el.scrollTop = 0; });
  const host = (await page.locator('.vocabulary-page').boundingBox())!;
  const first = (await row(page, from).boundingBox())!, last = (await row(page, to).boundingBox())!;
  await page.mouse.move(host.x + 8, reverse ? last.y + 8 : first.y + 8); await page.mouse.down();
  await page.mouse.move(first.x + 75, reverse ? first.y + 8 : last.y + 8, { steps: 8 });
}

for (const mode of ['Simple View', 'Detailed View']) {
  test(`${mode}: plain clicks toggle existing selections without removing other selected words`, async ({ page }) => {
    await seed(page); await button(page, mode).click();
    await row(page, 2).click(); await expect(check(page, 2)).toBeChecked();
    await row(page, 2).click(); await expect(selected(page)).toHaveCount(0);
    await check(page, 1).check(); await check(page, 2).check();
    await row(page, 2).click(); await expect(check(page, 2)).not.toBeChecked(); await expect(check(page, 1)).toBeChecked();
    await row(page, 4).click(); await expect(selected(page)).toHaveCount(1); await expect(check(page, 4)).toBeChecked();
    await row(page, 6).click({ modifiers: ['Shift'] }); await expect(selected(page)).toHaveCount(3);
  });

  test(`${mode}: Ctrl/Command toggle, Shift range, Ctrl+Shift addition and keyboard selection`, async ({ page }) => {
    await seed(page); await button(page, mode).click();
    await row(page, 2).click({ modifiers: ['Control'] });
    await row(page, 5).click({ modifiers: ['Meta'] });
    await expect(check(page, 2)).toBeChecked(); await expect(check(page, 5)).toBeChecked();
    await row(page, 2).click({ modifiers: ['Control'] }); await expect(check(page, 2)).not.toBeChecked();
    await row(page, 4).click({ modifiers: ['Shift'] });
    await expect(selected(page)).toHaveCount(3);
    for (const id of [2, 3, 4]) await expect(check(page, id)).toBeChecked();
    await row(page, 1).click({ modifiers: ['Control'] });
    await row(page, 2).click({ modifiers: ['Control', 'Shift'] });
    await expect(selected(page)).toHaveCount(4);
    await check(page, 6).click({ modifiers: ['Shift'] }); await expect(selected(page)).toHaveCount(6);
    await check(page, 3).uncheck(); await expect(selected(page)).toHaveCount(5);
    await row(page, 4).focus(); await page.keyboard.press('Control+Space'); await expect(check(page, 4)).not.toBeChecked();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(0);
  });

  test(`${mode}: rectangle selection, Ctrl addition, Escape restoration and zoom-aligned geometry`, async ({ page }) => {
    await seed(page, 4); await button(page, mode).click(); await button(page, 'Vocabulary 확대').click();
    await marquee(page, 1, 2);
    await expect(page.locator('.vocabulary-selection-box')).toBeVisible();
    await expect(selected(page)).toHaveCount(2); await page.mouse.up();
    await check(page, 4).check();
    await page.keyboard.down('Control'); await marquee(page, 1, 2, true); await page.mouse.up(); await page.keyboard.up('Control');
    await expect(selected(page)).toHaveCount(3);
    await marquee(page, 1, 2); await expect(selected(page)).toHaveCount(2);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(selected(page)).toHaveCount(3); await expect(check(page, 4)).toBeChecked();
    await expect(page.locator('.vocabulary-selection-box')).toHaveCount(0);
    await page.screenshot({ path: `.tools/vocabulary-selection-verification/${mode.split(' ')[0]}-selection.png` });
  });
}

test('Shift follows shuffled visible order; filtering and navigation clear the selection', async ({ page }) => {
  await seed(page, 8);
  await row(page, 3).click({ modifiers: ['Control'] }); await button(page, '순서 섞기').click();
  await expect(check(page, 3)).toBeChecked();
  const ids = await page.locator('.vocabulary-content [data-selection-id]').evaluateAll(els => els.map(el => Number(el.getAttribute('data-selection-id'))));
  const anchor = ids.indexOf(3), target = anchor < 4 ? 7 : 0;
  await row(page, ids[target]).click({ modifiers: ['Shift'] });
  const expected = ids.slice(Math.min(anchor, target), Math.max(anchor, target) + 1).sort((a, b) => a - b);
  expect(await selected(page).evaluateAll(els => els.map(el => Number(el.closest('[data-selection-id]')!.getAttribute('data-selection-id'))).sort((a, b) => a - b))).toEqual(expected);
  await page.getByLabel('논문', { exact: true }).selectOption('a'); await expect(selected(page)).toHaveCount(0);
  await row(page, 1).click({ modifiers: ['Control'] }); await row(page, 7).click({ modifiers: ['Shift'] });
  await expect(selected(page)).toHaveCount(4);
  await page.getByLabel('단어 검색').fill('word-03'); await expect(selected(page)).toHaveCount(0);
  await check(page, 3).check(); await button(page, 'Library').click(); await button(page, 'Vocabulary').click();
  await expect(selected(page)).toHaveCount(0);
});

test('rectangle auto-scroll reaches offscreen words, stops on release, and cancels safely on zoom', async ({ page }) => {
  await seed(page, 40);
  const host = (await page.locator('.vocabulary-page').boundingBox())!, first = (await row(page, 1).boundingBox())!;
  await page.mouse.move(host.x + 8, first.y + 3); await page.mouse.down();
  await page.mouse.move(first.x + 80, host.y + host.height - 6, { steps: 8 });
  await expect(check(page, 40)).toBeChecked({ timeout: 12000 }); await page.mouse.up();
  await expect(selected(page)).toHaveCount(40);
  const scroll = await page.locator('.vocabulary-page').evaluate(el => el.scrollTop);
  await page.mouse.move(host.x + 8, host.y + 100);
  await expect(page.locator('.vocabulary-page')).toHaveJSProperty('scrollTop', scroll);
  await marquee(page, 1, 2); await expect(selected(page)).toHaveCount(2);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect(page.locator('.vocabulary-selection-box')).toHaveCount(0); await page.mouse.up();
  await expect(selected(page)).toHaveCount(40);
});

test('selected deletion sends numeric IDs, preserves selection on failure and does not delete hidden words', async ({ page }) => {
  await seed(page);
  await page.getByLabel('논문', { exact: true }).selectOption('a');
  await row(page, 1).click({ modifiers: ['Control'] }); await row(page, 5).click({ modifiers: ['Shift'] });
  await expect(selected(page)).toHaveCount(3);
  await page.evaluate(() => { (window as any).__deleteFail = true; (window as any).__deleteDelay = 250; });
  await button(page, '선택 삭제 (3)').click(); await expect(check(page, 1)).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('삭제하지 못했습니다'); await expect(selected(page)).toHaveCount(3);
  await page.evaluate(() => { (window as any).__deleteFail = false; });
  await button(page, '선택 삭제 (3)').click(); await expect(page.getByText('3개 항목을 삭제했습니다.')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'delete_vocabulary').at(-1).args.ids)).toEqual([1, 3, 5]);
  await page.getByLabel('논문', { exact: true }).selectOption('');
  await expect(page.locator('.vocabulary-content [data-selection-id]')).toHaveCount(3);
  await page.reload(); await button(page, 'Vocabulary').click();
  await expect(page.locator('.vocabulary-word')).toHaveText(['word-02', 'word-04', 'word-06']);
});

test('Detailed context text and search remain editable without starting rectangle selection', async ({ page }) => {
  await seed(page); await button(page, 'Detailed View').click(); await check(page, 1).check();
  await row(page, 1).locator('dd[lang="en"]').selectText();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('The original sentence is still selectable.');
  await expect(selected(page)).toHaveCount(1); await expect(page.locator('.vocabulary-selection-box')).toHaveCount(0);
  await page.getByLabel('단어 검색').fill('한국어 뜻'); await page.getByLabel('단어 검색').selectText();
  await expect(page.locator('.vocabulary-content [data-selection-id]')).toHaveCount(6);
  await expect(selected(page)).toHaveCount(0); await expect(page.locator('.vocabulary-selection-box')).toHaveCount(0);
});
