import { test, expect } from '@playwright/test';
import { installBackend, open, wordBox, startPageTranslation } from './helpers';
import { makeTranslationRegionsPdf } from '../translationRegionsFixture';
import type { PageTranslationRequest } from '../../src/types';

const requests = (page: import('@playwright/test').Page) => page.evaluate(() =>
  (window as any).__calls.filter((c: any) => c.command === 'translate_page').map((c: any) => c.args.request)) as Promise<PageTranslationRequest[]>;

test('page cards keep captions and notes separate and complete body sentences across columns and pages', async ({ page }) => {
  await installBackend(page, undefined, await makeTranslationRegionsPdf()); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  const first = page.locator('.translation-page').nth(0), second = page.locator('.translation-page').nth(1);
  await expect(first.locator('.translation-caption')).toHaveCount(1);
  const rows = (await requests(page))[0].sentences;
  const joined = rows.find(s => s.text.includes('varying abilities'))!;
  expect(joined.text).toBe('The scenario involves robots with varying abilities in signal strength, sensing, and payload.');
  expect(joined.layout?.kind).toBe('paragraph'); expect(joined.rects).toHaveLength(3);
  expect(rows.filter(s => s.layout?.kind === 'caption').map(s => s.text).join(' ')).toBe('Fig. 1. A cooperative rescue scenario. The robots work together, with plans shown as arrows.');
  expect(rows.find(s => s.text.includes('Manuscript received'))?.layout?.kind).toBe('footnote');
  expect(rows.find(s => s.text.includes('Authorized licensed'))?.layout?.kind).toBe('footer');
  expect(rows.find(s => s.text.includes('IEEE Robotics Letters'))?.layout?.kind).toBe('header');
  const boundary = rows.find(s => s.text.includes('hardly learn'))!;
  expect(boundary.text).toBe('Learning can fail because agents can hardly learn any useful strategies from incomplete experiences.');
  expect(boundary.layout?.sources?.map(s => s.pageNumber)).toEqual([1, 2]);
  await page.getByRole('button', { name: '다음 번역 페이지' }).click();
  await second.getByRole('button', { name: '이 페이지 번역' }).click();
  await expect(second.locator('.translated-sentence').first()).toBeVisible();
  const counterpart = (await requests(page))[1].sentences.find(s => s.text.includes('hardly learn'))!;
  expect(counterpart.text).toBe(boundary.text);
  expect(counterpart.layout?.sources).toEqual(boundary.layout?.sources);
  await second.locator(`[data-sentence-id="${counterpart.id}"]`).hover();
  await expect(page.locator('.pdf-page[data-page-number="1"] .translation-source-mark')).toHaveCount(2);
  await expect(page.locator('.pdf-page[data-page-number="2"] .translation-source-mark')).toHaveCount(1);
  const cards = await page.locator('.translation-page').evaluateAll(els => els.map(el => {
    const style = getComputedStyle(el), box = el.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, height: box.height, minHeight: parseFloat(style.minHeight), background: style.backgroundColor, border: style.borderTopWidth };
  }));
  expect(cards[1].top - cards[0].bottom).toBeGreaterThanOrEqual(20);
  expect(cards[0].background).toBe('rgb(255, 255, 255)'); expect(cards[0].border).toBe('1px');
  for (const card of cards) expect(card.height).toBeGreaterThanOrEqual(card.minHeight - 1);
  await page.screenshot({ path: '.tools/translation-structure-qa/page-cards.png' });
});

test('hover only highlights even when the matching translated sentence is offscreen', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => { (window as any).__longPageTranslation = '긴 번역 문장입니다. '.repeat(150); });
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  await expect(page.locator('.translated-sentence')).toHaveCount(4);
  const target = page.locator('[data-sentence-id="1"]');
  const pane = (await page.locator('.translation-content').boundingBox())!;
  expect((await target.boundingBox())!.y).toBeGreaterThan(pane.y + pane.height);
  const position = () => page.evaluate(() => [...document.querySelectorAll('.reader, .translation-content')].map(e => [e.scrollTop, e.scrollLeft]));
  await expect.poll(() => page.locator('.translation-content').evaluate(el => el.scrollTop)).toBe(0);
  const before = await position();
  const source = await wordBox(page, 'Another asymptotic result appears here.');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.translation-source-mark')).toHaveCount(1);
  // Two animation frames let both the source hover handler and scroll sync run.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await position()).toEqual(before);
  const visible = await page.locator('.translated-sentence').first().evaluate(el => {
    const clip = el.closest('.translation-content')!.getBoundingClientRect();
    const r = [...el.getClientRects()].find(r => r.bottom > clip.top + 8 && r.top < clip.bottom - 8)!;
    return { x: r.left + r.width / 2, y: (Math.max(r.top, clip.top + 8) + Math.min(r.bottom, clip.bottom - 8)) / 2 };
  });
  await page.mouse.move(visible.x, visible.y);
  await expect(page.locator('.translated-sentence').first()).toHaveAttribute('aria-pressed', 'true');
  expect(await position()).toEqual(before);
});

test('retranslation bypasses a saved page, preserves it on failure, and saves Markdown replacements', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  const button = page.getByRole('button', { name: '1페이지 재번역' });
  await expect(button).toBeEnabled();
  const original = await page.locator('.translated-sentences').textContent();
  await page.evaluate(() => { (window as any).__pageFail = true; (window as any).__pageDelay = 500; });
  await button.click(); await expect(button).toBeDisabled();
  await expect(page.locator('.translation-page').first().getByRole('alert')).toContainText('실패');
  expect(await page.locator('.translated-sentences').textContent()).toBe(original);
  await page.evaluate(() => { (window as any).__pageFail = false; (window as any).__longPageTranslation = '**새 번역**과 *기울임*, $x^2$ 수식입니다.'; });
  await button.click(); await expect(button).toBeDisabled();
  await expect(page.locator('.translated-sentence strong')).toHaveCount(4);
  await expect(page.locator('.translated-sentence em')).toHaveCount(4);
  await expect(page.locator('.translated-sentence .katex')).toHaveCount(4);
  await expect(button).toBeEnabled();
  expect((await requests(page)).map(r => r.force)).toEqual([false, true, true]);
  expect(await page.evaluate(() => (window as any).__pageApiCalls)).toBe(3);
  await page.reload(); await open(page); await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  await expect(page.locator('.translated-sentence strong')).toHaveCount(4);
  expect(await page.evaluate(() => (window as any).__pageApiCalls ?? 0)).toBe(0);
});
