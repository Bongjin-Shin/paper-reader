import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, select, wordBox } from './helpers';

async function dragText(page: Page, from: string, to = from, reverse = false) {
  const first = await wordBox(page, from);
  const last = await wordBox(page, to);
  const a = { x: first.x + .2, y: first.y + first.height / 2 };
  const b = { x: last.x + last.width - .2, y: last.y + last.height / 2 };
  const start = reverse ? b : a;
  const end = reverse ? a : b;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function fileDrag(page: Page, payload: unknown) {
  await page.evaluate(payload => (window as any).__emitFileDrag(payload), payload);
}

test('dragged single words retain the existing save/highlight flow without pronunciation', async ({ page }) => {
  await installBackend(page); await open(page);
  await dragText(page, 'asymptotic');
  await expect(page.getByRole('button', { name: '발음', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '추가 메뉴' })).toHaveCount(0);
  await expect(page.locator('.word-highlight')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command.startsWith('lookup_')))).toHaveLength(0);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('점근적인', { exact: true })).toBeVisible();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  const request = await page.evaluate(() => (window as any).__calls.find((c: any) => c.command === 'lookup_word').args.request);
  expect(request.word).toBe('asymptotic');
});

for (const action of ['번역', '설명']) {
  test(`dragged phrases ${action} send all selected text but never save highlights`, async ({ page }) => {
    await installBackend(page); await open(page);
    await dragText(page, 'an asymptotic linear complexity');
    await expect(page.getByRole('dialog', { name: '선택 텍스트 도구' })).toBeVisible();
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByText(action === '번역' ? '선택한 전체 문장의 번역입니다.' : '선택한 문맥 전체에 대한 설명입니다.')).toBeVisible();
    await expect(page.locator('.word-highlight')).toHaveCount(0);
    const calls = await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command.startsWith('lookup_')));
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('lookup_text');
    expect(calls[0].args.request.selectedText).toBe('an asymptotic linear complexity');
    expect(calls[0].args.request.context).toBe('The model maintains an asymptotic linear complexity.');
  });
}

test('reverse multiline drag keeps every selected word and line break', async ({ page }) => {
  await installBackend(page); await open(page);
  const first = 'The model maintains an asymptotic linear complexity.';
  const last = 'Another asymptotic result appears here.';
  await dragText(page, first, last, true);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('선택한 전체 문장의 번역입니다.')).toBeVisible();
  const request = await page.evaluate(() => (window as any).__calls.find((c: any) => c.command === 'lookup_text').args.request);
  expect(request.selectedText).toBe(`${first}\n${last}`);
  await expect(page.locator('.word-highlight')).toHaveCount(0);
});

test('drag and double-click preserve game-theoretical and decision-making', async ({ page }) => {
  await installBackend(page); await open(page);
  await dragText(page, 'game-theoretical');
  await expect(page.getByRole('dialog', { name: 'game-theoretical 단어 도구' })).toBeVisible();
  await page.keyboard.press('Escape');
  await select(page, 'decision-making');
  await expect(page.getByRole('dialog', { name: 'decision-making 단어 도구' })).toBeVisible();
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
});

test('zoom preserves the selected word, bubble result and saved highlight; fit tracks window width', async ({ page }) => {
  await installBackend(page); await open(page);
  await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('점근적인', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.5');
  await expect(page.getByText('점근적인', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('asymptotic');
  const selected = await wordBox(page);
  const highlight = await page.locator('.word-highlight').boundingBox();
  expect(Math.abs(highlight!.x - selected.x)).toBeLessThan(1);
  expect(Math.abs(highlight!.y - selected.y)).toBeLessThan(1);
  const bubble = await page.getByRole('dialog').boundingBox();
  expect(Math.abs(bubble!.x + bubble!.width / 2 - selected.x - selected.width / 2)).toBeLessThan(2);
  await page.getByRole('button', { name: '페이지 너비 맞춤' }).click();
  await expect(page.getByRole('button', { name: '페이지 너비 맞춤' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.reader').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 900, height: 750 });
  await expect.poll(() => page.locator('.reader').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'test-results/width-fit.png' });
});

test('Ctrl + wheel zooms the PDF without browser zoom and leaves ordinary wheel scrolling intact', async ({ page }) => {
  await installBackend(page); await open(page);
  await select(page);
  const before = await page.locator('.zoom-controls span').innerText();
  await page.mouse.move(580, 360);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect(page.locator('.zoom-controls span')).not.toHaveText(before);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await page.locator('.toolbar').boundingBox())!.height).toBe(65);
  const zoom = await page.locator('.zoom-controls span').innerText();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.locator('.reader').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.zoom-controls span')).toHaveText(zoom);
});

test('native PDF drop opens from empty screen, replaces an open PDF, and rejects non-PDF', async ({ page }) => {
  await installBackend(page); await page.goto('/');
  await expect(page.locator('.drop-zone')).toBeVisible();
  await fileDrag(page, { type: 'enter', valid: true });
  await expect(page.locator('.drop-overlay')).toContainText('PDF를 놓아 열기');
  await fileDrag(page, { type: 'leave' });
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  await fileDrag(page, { type: 'drop', paths: ['/papers/first.pdf'] });
  await expect(page.locator('.document-title')).toHaveText('first.pdf');
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await fileDrag(page, { type: 'enter', valid: true });
  await expect(page.locator('.drop-overlay')).toBeVisible();
  await fileDrag(page, { type: 'drop', paths: ['/papers/second.PDF'] });
  await expect(page.locator('.document-title')).toHaveText('second.PDF');
  await fileDrag(page, { type: 'enter', valid: false });
  await expect(page.locator('.drop-overlay')).toContainText('PDF 파일을');
  await fileDrag(page, { type: 'drop', paths: ['/papers/readme.txt'] });
  await expect(page.getByRole('alert')).toContainText('PDF 파일만');
  await expect(page.locator('.document-title')).toHaveText('second.PDF');
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'open_dropped_pdf'))).toHaveLength(2);
});

test('initial credit and cumulative costs persist; both lookup kinds charge; failed requests do not', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.getByRole('button', { name: 'API 예상 잔액 설정' }).click();
  await page.getByLabel('초기 크레딧 (USD)').fill('5');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('button', { name: 'API 예상 잔액 설정' })).toContainText('API ~$5.00');
  await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByRole('button', { name: 'API 예상 잔액 설정' })).toContainText('API ~$4.99');
  await page.keyboard.press('Escape');
  await dragText(page, 'an asymptotic linear complexity');
  await page.getByRole('button', { name: '설명', exact: true }).click();
  await expect(page.getByRole('button', { name: 'API 예상 잔액 설정' })).toContainText('API ~$4.98');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (window as any).__fail = true; });
  await select(page, 'context-aware');
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('OpenAI 연결 실패')).toBeVisible();
  await expect(page.getByRole('button', { name: 'API 예상 잔액 설정' })).toContainText('API ~$4.98');
  await page.reload();
  await expect(page.getByRole('button', { name: 'API 예상 잔액 설정' })).toContainText('API ~$4.98');
  await expect(page.getByRole('button', { name: 'API 예상 잔액 설정' })).toContainText('Estimated');
  await page.getByRole('button', { name: 'API 예상 잔액 설정' }).click();
  await page.getByLabel('초기 크레딧 (USD)').fill('10');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('button', { name: 'API 예상 잔액 설정' })).toContainText('API ~$9.98');
});
