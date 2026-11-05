import { expect, test } from '@playwright/test';
import { installBackend, open, select } from './helpers';

test('PDF rendering and text selection work without native Map upsert methods', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Map.prototype, 'getOrInsert');
    Reflect.deleteProperty(Map.prototype, 'getOrInsertComputed');
  });
  await installBackend(page);
  await open(page);
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
  await select(page);
  await expect(page.getByRole('button', { name: '번역', exact: true })).toBeVisible();
});

test('PDF rendering and text selection work without ReadableStream async iteration', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(ReadableStream.prototype, Symbol.asyncIterator);
    Reflect.deleteProperty(ReadableStream.prototype, 'values');
  });
  await installBackend(page);
  await open(page);
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
  await select(page);
  await expect(page.getByRole('button', { name: '번역', exact: true })).toBeVisible();
});
