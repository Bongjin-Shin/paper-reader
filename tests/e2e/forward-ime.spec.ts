import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, select } from './helpers';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const folder = (page: Page, name: string) => page.getByRole('navigation', { name: 'Library 폴더', exact: true }).getByRole('button', { name, exact: true });
async function sideButton(page: Page, direction: 'back' | 'forward', point = { x: 600, y: 600 }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: direction, buttons: direction === 'back' ? 8 : 16, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: direction, buttons: 0, clickCount: 1 });
  await cdp.detach();
}
async function memoSetup(page: Page) {
  await installBackend(page); await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('test-papers', JSON.stringify([{ id: 'paper-a', fileName: 'notes.pdf', title: 'Notes', memo: 'Original' }]));
    localStorage.setItem('test-library-memberships', JSON.stringify([{ paperId: 'paper-a', folderId: 1 }]));
  });
  await button(page, 'Library').click(); await folder(page, '기본 폴더').click();
}

test('forward restores folder/screen visits, skips deleted folders and resets after branching', async ({ page }) => {
  await installBackend(page); await page.goto('/');
  await expect(button(page, '앞으로가기')).toBeDisabled();
  await button(page, 'Library').click(); await folder(page, '기본 폴더').click();
  await button(page, '새 폴더').click(); await page.getByLabel('폴더 이름', { exact: true }).fill('Child');
  await button(page, '만들기').click(); await expect(page.locator('.library-heading h2')).toHaveText('Child');
  await button(page, 'Vocabulary').click();
  await button(page, '뒤로가기').click(); await button(page, '뒤로가기').click();
  await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await folder(page, '기본 폴더').click(); await button(page, 'Library').click(); // No-op visits retain forward history.
  await button(page, '앞으로가기').click(); await expect(page.locator('.library-heading h2')).toHaveText('Child');
  await button(page, '앞으로가기').click(); await expect(button(page, 'Vocabulary')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, '앞으로가기')).toBeDisabled();
  await button(page, '뒤로가기').click(); await button(page, '뒤로가기').click();
  await folder(page, 'Child').click({ button: 'right' }); await page.getByRole('menuitem', { name: '삭제', exact: true }).click();
  await button(page, '삭제하기').click(); await expect(folder(page, 'Child')).toHaveCount(0);
  await button(page, '앞으로가기').click(); await expect(button(page, 'Vocabulary')).toHaveAttribute('aria-pressed', 'true');
  await button(page, '뒤로가기').click(); await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await button(page, 'PDF Reader').click(); await expect(button(page, '앞으로가기')).toBeDisabled();
});

test('hardware forward navigates once, suppresses browser defaults and supports WebKit mouse-only events', async ({ page }) => {
  await memoSetup(page); await button(page, 'Vocabulary').click();
  await page.evaluate(() => { history.pushState({}, '', '/sentinel'); history.pushState({}, '', '/browser-forward'); history.back(); });
  await expect(page).toHaveURL(/\/sentinel$/);
  await sideButton(page, 'back'); await sideButton(page, 'back');
  await expect(page.locator('.library-heading h2')).toHaveText('Library');
  await sideButton(page, 'forward'); await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await sideButton(page, 'forward'); await expect(button(page, 'Vocabulary')).toHaveAttribute('aria-pressed', 'true');
  await sideButton(page, 'forward'); await expect(page).toHaveURL(/\/sentinel$/);
  await sideButton(page, 'back'); await sideButton(page, 'back');
  expect(await page.evaluate(() => ['mousedown', 'mouseup', 'auxclick'].map(type => !window.dispatchEvent(
    new MouseEvent(type, { button: 4, bubbles: true, cancelable: true }))))).toEqual([true, true, true]);
  await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await page.mouse.click(600, 600, { button: 'middle' }); await page.mouse.click(600, 600, { button: 'right' });
  await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await page.evaluate(() => { (window as any).__memoDelay = 800; });
  await button(page, 'Notes 메모 편집').click();
  const input = page.getByRole('textbox', { name: 'Notes 메모', exact: true });
  await input.fill('Saved'); const box = (await input.boundingBox())!;
  await button(page, '저장').click(); await expect(button(page, '앞으로가기')).toBeDisabled();
  await sideButton(page, 'forward', { x: box.x + 12, y: box.y + 12 });
  await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await expect(button(page, 'Notes 메모 편집')).toHaveText('Saved');
  await sideButton(page, 'forward'); await expect(button(page, 'Vocabulary')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/sentinel$/);
});

test('forward reuses Reader canvas, text, zoom, scroll and saved highlight without API calls', async ({ page }) => {
  await installBackend(page); await open(page);
  await select(page); await button(page, '번역').click(); await expect(page.locator('.word-highlight')).toHaveCount(1);
  await page.keyboard.press('Escape'); await button(page, '페이지 너비 맞춤').click();
  await expect.poll(() => page.locator('.pdf-page').first().evaluate(el => el.getAttribute('data-rendered-scale') !== '1.25'
    && el.getAttribute('data-rendered-scale') === el.closest<HTMLElement>('.reader')!.dataset.displayScale)).toBe(true);
  await page.locator('.reader').evaluate(el => { el.scrollTop = 100; });
  await page.evaluate(() => { (window as any).__readerSnapshot = { canvas: document.querySelector('.pdf-page canvas'),
    text: document.querySelector('.pdf-page .textLayer'), scale: document.querySelector('.pdf-page')?.getAttribute('data-rendered-scale'),
    reads: (window as any).__calls.filter((call: any) => call.command === 'read_pdf').length }; });
  await button(page, 'Library').click(); await folder(page, '기본 폴더').click(); await button(page, 'PDF Reader').click();
  await button(page, '뒤로가기').click(); await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await button(page, '앞으로가기').click(); await expect(button(page, 'PDF Reader')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => {
    const before = (window as any).__readerSnapshot;
    return before.canvas === document.querySelector('.pdf-page canvas') && before.text === document.querySelector('.pdf-page .textLayer')
      && before.scale === document.querySelector('.pdf-page')?.getAttribute('data-rendered-scale')
      && document.querySelector('.reader')?.scrollTop === 100
      && before.reads === (window as any).__calls.filter((call: any) => call.command === 'read_pdf').length;
  })).toBe(true);
  await expect(button(page, '페이지 너비 맞춤')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  const box = (await page.locator('.word-highlight').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText('점근적인', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(1);
});

test('Korean composition stays in the memo, supports intermediate edits and commits on Save without losing characters', async ({ page }) => {
  await memoSetup(page); await button(page, 'Notes 메모 편집').click();
  const input = page.getByRole('textbox', { name: 'Notes 메모', exact: true });
  await input.fill('');
  const cdp = await page.context().newCDPSession(page);
  for (const text of ['ㅎ', '하', '한', '하', 'ㅎ', '', 'ㅎ', '하', '한']) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await expect(input).toHaveValue(text);
  }
  await cdp.send('Input.insertText', { text: '한' });
  for (const text of ['ㄱ', '그', '글']) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await expect(input).toHaveValue('한' + text);
  }
  await button(page, '저장').click();
  await expect(button(page, 'Notes 메모 편집')).toHaveText('한글');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-papers')!)[0].memo)).toBe('한글');
  await cdp.detach(); await page.reload();
  await button(page, 'Library').click(); await folder(page, '기본 폴더').click();
  await expect(button(page, 'Notes 메모 편집')).toHaveText('한글');
  await button(page, 'Notes 메모 편집').click(); await input.press('End'); await input.press('Backspace');
  await expect(input).toHaveValue('한'); await button(page, '저장').click();
  await expect(button(page, 'Notes 메모 편집')).toHaveText('한');
});

test('Escape during IME composition keeps the memo open, while Escape after composition still cancels', async ({ page }) => {
  await memoSetup(page); await button(page, 'Notes 메모 편집').click();
  const input = page.getByRole('textbox', { name: 'Notes 메모', exact: true });
  await input.fill('');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  // Check composition state even for WebKit sequences whose key event omits isComposing.
  await input.dispatchEvent('keydown', { key: 'Escape', bubbles: true });
  await expect(input).toBeVisible(); await expect(input).toHaveValue('한');
  await cdp.send('Input.insertText', { text: '한' });
  await input.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true });
  await expect(input).toBeVisible();
  await input.dispatchEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true });
  await expect(input).toBeVisible();
  await input.press('Escape'); await expect(input).toHaveCount(0);
  await expect(button(page, 'Notes 메모 편집')).toHaveText('Original');
  await cdp.detach();
});
