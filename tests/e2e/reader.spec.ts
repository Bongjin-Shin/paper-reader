import { expect, test } from '@playwright/test';
import { installBackend, open, select, wordBox } from './helpers';

test('selection does not call AI or save; translation highlights only selected occurrence; restores and scales', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installBackend(page);
  await open(page);
  await select(page);
  await expect(page.getByRole('button', { name: '번역', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__calls.filter((call: any) => call.command === 'lookup_word'))).toHaveLength(0);
  await expect(page.locator('.word-highlight')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('점근적인', { exact: true })).toBeVisible();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  const request = await page.evaluate(() => (window as any).__calls.find((call: any) => call.command === 'lookup_word').args.request);
  expect(request.originalSentence).toBe('The model maintains an asymptotic linear complexity.');
  expect(request.word).toBe('asymptotic');
  await page.keyboard.press('Escape');
  const initial = await page.locator('.word-highlight').boundingBox();
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.5');
  await expect(page.locator('.page-message')).toHaveCount(0);
  const zoomed = await page.locator('.word-highlight').boundingBox();
  expect(zoomed!.width / initial!.width).toBeCloseTo(1.2, 1);
  const word = await wordBox(page);
  expect(Math.abs(zoomed!.x - word.x)).toBeLessThan(1);
  expect(Math.abs(zoomed!.y - word.y)).toBeLessThan(1);
  await page.reload();
  await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await expect(page.locator('.page-message')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls.filter((call: any) => call.command === 'lookup_word'))).toHaveLength(0);
  await page.screenshot({ path: 'test-results/reader.png' });
  expect(errors).toEqual([]);
});

test('explanation caches without vocabulary or highlights after dismissing a pending bubble', async ({ page }) => {
  await installBackend(page, { delay: 350, fail: false, rotation: 0, userUnit: 1 });
  await open(page);
  await select(page);
  await page.getByRole('button', { name: '설명', exact: true }).click();
  await expect(page.getByText('설명하는 중…')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.word-highlight')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await select(page, 'asymptotic', 1);
  await page.getByRole('button', { name: '설명', exact: true }).click();
  await expect(page.getByText('극한에서 어떤 성질에 가까워진다는 의미입니다.')).toBeVisible();
  await expect(page.locator('.word-highlight')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/explanation.png' });
  expect(await page.evaluate(() => localStorage.getItem('test-lookups'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-explanation-cache') ?? '[]').length)).toBe(2);
});

test('failed AI calls do not highlight; retry works; scrolling keeps the result bubble', async ({ page }) => {
  await installBackend(page, { delay: 0, fail: true, rotation: 0, userUnit: 1 });
  await open(page);
  await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByText('OpenAI 연결 실패')).toBeVisible();
  await expect(page.locator('.word-highlight')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__fail = false; });
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await page.locator('.reader').evaluate(element => { element.scrollTop = 100; });
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('new selections replace temporary menus and outside clicks dismiss them; hyphenated words stay intact', async ({ page }) => {
  await installBackend(page);
  await open(page);
  await select(page);
  await select(page, 'context-aware');
  await expect(page.getByRole('dialog', { name: 'context-aware 단어 도구' })).toBeVisible();
  await page.mouse.click(20, 200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.word-highlight')).toHaveCount(0);
});

test('empty screen stays minimal', async ({ page }) => {
  await installBackend(page);
  await page.goto('/');
  await expect(page.getByRole('heading')).toContainText('논문 속 낯선 단어를');
  await expect(page.getByRole('button')).toHaveCount(14); // Existing controls plus the requested translation connection setting
  await page.screenshot({ path: 'test-results/empty.png' });
});

for (const [rotation, userUnit] of [[90, 1], [270, 1], [0, 2]]) {
  test(`aligns highlight with text for rotation=${rotation}, userUnit=${userUnit}`, async ({ page }) => {
    await installBackend(page, { delay: 0, fail: false, rotation, userUnit });
    await open(page);
    await select(page);
    await page.getByRole('button', { name: '번역', exact: true }).click();
    await expect(page.locator('.word-highlight')).toHaveCount(1);
    const highlight = await page.locator('.word-highlight').boundingBox();
    const word = await wordBox(page);
    expect(Math.abs(highlight!.x - word.x)).toBeLessThan(1);
    expect(Math.abs(highlight!.y - word.y)).toBeLessThan(1);
    expect(Math.abs(highlight!.width - word.width)).toBeLessThan(1);
    expect(Math.abs(highlight!.height - word.height)).toBeLessThan(1);
  });
}
