import { expect, test } from '@playwright/test';
import { installBackend, open } from './helpers';
import { makeScrollPdf } from '../performance/fixture';

test('page, canvas and text proportions stay identical through repeated zoom and cached page revisits', async ({ page }) => {
  test.setTimeout(60000);
  await installBackend(page, undefined, makeScrollPdf(12)); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  await page.evaluate(async () => {
    const reader = document.querySelector<HTMLElement>('.reader')!;
    const pages = [...reader.querySelectorAll<HTMLElement>('.pdf-page')];
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const check = () => {
      for (const host of pages) {
        const canvas = host.querySelector('canvas'), text = host.querySelector('.text-surface');
        if (!canvas || !text) continue;
        const bounds = host.getBoundingClientRect(), paint = canvas.getBoundingClientRect(), glyphs = text.getBoundingClientRect();
        if (Math.max(Math.abs(paint.width - bounds.width), Math.abs(paint.height - bounds.height),
          Math.abs(glyphs.width - bounds.width), Math.abs(glyphs.height - bounds.height)) > 1)
          throw new Error(JSON.stringify({ page: host.dataset.pageNumber, scale: host.dataset.renderedScale,
            display: reader.dataset.displayScale, bounds, paint, glyphs, surface: host.querySelector('.page-surface')?.getAttribute('style') }));
      }
    };
    // Inspect the canvas replacement itself, not only the settled React render:
    // the new canvas must never inherit the previous painted scale's transform.
    let mutationError: unknown;
    const observer = new MutationObserver(() => { try { check(); } catch (error) { mutationError ??= error; } });
    observer.observe(reader, { childList: true, subtree: true });
    for (let i = 0; i < 32; i++) {
      const target = pages[[5, 6, 1, 10][i % 4]];
      reader.scrollTop += target.getBoundingClientRect().top - reader.getBoundingClientRect().top - 40;
      const button = document.querySelector<HTMLButtonElement>(`[aria-label="${i % 4 < 2 ? '확대' : '축소'}"]`)!;
      button.click(); await wait([16, 145, 210, 50][i % 4]);
      check();
    }
    await wait(700); observer.disconnect(); check();
    if (mutationError) throw mutationError;
  });
  await expect(page.locator('.page-message')).toHaveCount(0);
});
