import { test, expect } from '@playwright/test';
import { installBackend, open, startPageTranslation } from './helpers';
import { makeRegionalColumnsPdf } from '../regionalColumnsFixture';
import type { SourceSentence } from '../../src/types';

test('mixed column widths keep metadata, abstract, and body in separate translation flows and highlights', async ({ page }) => {
  await installBackend(page, undefined, await makeRegionalColumnsPdf()); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click(); await startPageTranslation(page);
  await expect(page.locator('.translated-sentence').first()).toBeVisible();
  const rows: SourceSentence[] = await page.evaluate(() => (window as any).__calls.find((c: any) => c.command === 'translate_page').args.request.sentences);
  const keywords = rows.find(s => s.text.startsWith('Keywords:'))!;
  const abstract = rows.find(s => s.text.startsWith('This paper studies'))!;
  expect(keywords.text).toBe('Keywords: Leak Anomaly detection Generative adversarial networks Water distribution');
  expect(abstract.text).toBe('This paper studies conditional models for image-based detection in distribution networks.');
  expect(rows.find(s => s.text.startsWith('The method'))?.text).toBe('The method uses pressure measurements and accounts for demand uncertainty.');
  expect(rows.filter(s => s.layout?.kind === 'heading').map(s => s.text)).toContain('A B S T R A C T');
  expect(rows.filter(s => /^(Left|Right) body/.test(s.text)).map(s => s.text)).toEqual([
    ...Array.from({ length: 8 }, (_, i) => `Left body paragraph ${i + 1} introduces the method.`),
    ...Array.from({ length: 8 }, (_, i) => `Right body paragraph ${i + 1} reviews prior work.`),
  ]);
  expect(keywords.rects.every(r => r[2] < 180)).toBe(true);
  expect(abstract.rects.every(r => r[0] >= 204)).toBe(true);
  expect(abstract.layout?.paragraph).not.toBe(keywords.layout?.paragraph);
  for (const sentence of [keywords, abstract]) {
    await page.locator(`.translated-sentence[data-sentence-id="${sentence.id}"]`).hover();
    await expect(page.locator('.translation-source-mark')).toHaveCount(sentence.rects.length);
    const marks = await page.locator('.translation-source-mark').evaluateAll(elements => elements.map(e => {
      const page = e.closest('.pdf-page')!.getBoundingClientRect(), mark = e.getBoundingClientRect();
      return { left: (mark.left - page.left) / page.width, right: (mark.right - page.left) / page.width };
    }));
    if (sentence === keywords) expect(marks.every(r => r.right < 180 / 612)).toBe(true);
    else expect(marks.every(r => r.left > 204 / 612)).toBe(true);
  }
  await page.screenshot({ path: '.tools/regional-columns-qa/mixed-columns.png' });
});
