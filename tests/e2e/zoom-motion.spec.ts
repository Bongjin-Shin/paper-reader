import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, select, wordBox } from './helpers';
import { makeScrollPdf } from '../performance/fixture';

async function ready(page: Page) {
  await expect.poll(() => page.locator('.pdf-page').first().evaluate(el =>
    Number(el.getAttribute('data-rendered-scale')) === Number(el.closest<HTMLElement>('.reader')!.dataset.displayScale))).toBe(true);
}

test('a result near the top starts readable, then leaves the viewport with its word', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(4)); await open(page); await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('점근적인');
  await expect(page.getByRole('dialog').locator('strong')).toBeInViewport();
  await expect(page.getByRole('button', { name: '말풍선 닫기' })).toBeInViewport();
  const before = (await page.getByRole('dialog').boundingBox())!;
  await page.locator('.reader').evaluate(el => { el.scrollTop = 300; });
  await expect.poll(async () => (await page.getByRole('dialog').boundingBox())!.y).toBeCloseTo(before.y - 300, 0);
});

test('attached bubbles move by the full scroll distance offscreen in both axes and return unchanged', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(8)); await open(page);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '확대', exact: true }).click();
  await ready(page); await select(page, 'asymptotic', 10);
  await page.getByRole('button', { name: '번역', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('점근적인');
  const before = (await page.getByRole('dialog').boundingBox())!;
  const origin = await page.locator('.reader').evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
  const stored = await page.evaluate(() => localStorage.getItem('test-highlights'));
  await page.mouse.click(15, 700);
  const delta = await page.locator('.reader').evaluate((el, origin) => {
    el.scrollTop += 1200; el.scrollLeft += 150;
    return { x: el.scrollLeft - origin.x, y: el.scrollTop - origin.y };
  }, origin);
  await expect.poll(async () => (await page.getByRole('dialog').boundingBox())!.y).toBeCloseTo(before.y - delta.y, 0);
  expect((await page.getByRole('dialog').boundingBox())!.x).toBeCloseTo(before.x - delta.x, 0);
  expect((await page.getByRole('dialog').boundingBox())!.y + before.height).toBeLessThan(0);
  expect(await page.evaluate(() => document.elementFromPoint(400, 32)?.closest('.word-bubble') !== null)).toBe(false);
  await page.locator('.reader').evaluate((el, origin) => { el.scrollTop = origin.y; el.scrollLeft = origin.x; }, origin);
  await expect.poll(async () => (await page.getByRole('dialog').boundingBox())!.y).toBeCloseTo(before.y, 0);
  await expect(page.getByRole('button', { name: '말풍선 닫기' })).toBeInViewport();
  expect(await page.evaluate(() => localStorage.getItem('test-highlights'))).toBe(stored);
  expect(await page.evaluate(() => (window as any).__apiCalls)).toBe(1);
});

test('continuous zoom retains text and replaces the sharp canvas without a blank frame', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf()); await open(page);
  await select(page, 'asymptotic', 20); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('점근적인');
  await page.evaluate(async () => {
    const host = document.querySelector('.reader')!, first = document.querySelector('.pdf-page')!;
    const old = (window as any).__oldSurfaces = [first.querySelector('canvas'), first.querySelector('.textLayer')];
    let pageStyleWrites = 0;
    const styles = new MutationObserver(records => { pageStyleWrites += records.filter(record =>
      (record.target as Element).matches('.textLayer span')).length; });
    styles.observe(document.querySelector('.pages')!, { attributes: true, attributeFilter: ['style'], subtree: true });
    (window as any).__zoomChanges = { canvas: 0, text: 0, blank: 0 };
    const inspect = () => {
      const p = (window as any).__zoomChanges;
      if (!first.querySelector('canvas') || !first.querySelector('.textLayer')) p.blank++;
    };
    const observer = (window as any).__zoomObserver = new MutationObserver(records => {
      inspect();
      for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) {
        if (node.matches('canvas')) (window as any).__zoomChanges.canvas++;
        if (node.matches('.textLayer')) (window as any).__zoomChanges.text++;
      }
    });
    observer.observe(first, { childList: true, subtree: true });
    for (let n = 0; n < 14; n++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      for (let j = 0; j < 3; j++) host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
        ctrlKey: true, clientX: 600, clientY: 400, deltaY: n < 9 ? -7 : 7 }));
      if (!old.every(el => el.isConnected)) throw new Error('Zoom replaced the live preview during continuous input');
      inspect();
    }
    await Promise.resolve(); styles.disconnect();
    if (pageStyleWrites) throw new Error(`Continuous zoom rewrote ${pageStyleWrites} text span styles`);
  });
  await expect(page.locator('.zoom-controls span')).not.toHaveText('125%'); await ready(page);
  expect(await page.evaluate(() => (window as any).__zoomChanges)).toEqual({ canvas: 1, text: 0, blank: 0 });
  expect(await page.evaluate(() => { const old = (window as any).__oldSurfaces; (window as any).__zoomObserver.disconnect(); return [old[0].width, old[0].isConnected, old[1].isConnected]; })).toEqual([0, false, true]);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('asymptotic');
  const word = await wordBox(page, 'asymptotic', 20), highlight = (await page.locator('.word-highlight').boundingBox())!;
  expect(Math.abs(word.x - highlight.x)).toBeLessThan(1); expect(Math.abs(word.y - highlight.y)).toBeLessThan(1);
  await page.getByRole('button', { name: '페이지 너비 맞춤' }).click(); await ready(page);
  await expect.poll(() => page.locator('.reader').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test('zoom deep in a long document preserves the pointed PDF location and settled selection', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(120)); await open(page);
  const target = page.locator('.pdf-page[data-page-number="110"]');
  await target.evaluate(el => { document.querySelector('.reader')!.scrollTop = (el as HTMLElement).offsetTop + 150; });
  await expect(target).toHaveAttribute('data-rendered-scale', '1.25');
  const point = await target.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    return { x: 600, y: 400, pdfX: (600 - bounds.left) / bounds.width, pdfY: (400 - bounds.top) / bounds.height };
  });
  await page.locator('.reader').evaluate(async (host, point) => {
    for (let n = 0; n < 10; n++) {
      host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
        clientX: point.x, clientY: point.y, deltaY: -12 }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }, point);
  await expect.poll(() => target.evaluate(el => Number(el.getAttribute('data-rendered-scale')) ===
    Number(el.closest<HTMLElement>('.reader')!.dataset.displayScale))).toBe(true);
  const after = await target.boundingBox();
  expect(after!.x + point.pdfX * after!.width).toBeCloseTo(point.x, 0);
  expect(Math.abs(after!.y + point.pdfY * after!.height - point.y)).toBeLessThan(2);
  await select(page, 'asymptotic', 20, 110);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('점근적인');
});

test('continued wheel input at maximum zoom postpones sharp rendering until the gesture ends', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(4)); await open(page);
  await page.evaluate(() => {
    const plus = document.querySelector<HTMLButtonElement>('[aria-label="확대"]')!;
    for (let i = 0; i < 10; i++) plus.click();
  });
  await ready(page);
  await page.evaluate(async () => {
    const host = document.querySelector('.reader')!, canvas = document.querySelector('.pdf-page canvas')!;
    for (let i = 0; i < 24; i++) {
      host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
        clientX: 600, clientY: 400, deltaY: -60 }));
      await new Promise(resolve => setTimeout(resolve, 20));
      if (!canvas.isConnected) throw new Error('Sharp rendering interrupted an ongoing wheel gesture at the zoom limit');
    }
  });
  await expect(page.locator('.zoom-controls span')).toHaveText('400%'); await ready(page);
  await page.getByRole('button', { name: '페이지 너비 맞춤' }).click(); await ready(page);
  await select(page, 'decision-making');
});

test('reversing zoom back to a cached scale reuses its surface and remains selectable', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf()); await open(page);
  await page.evaluate(async () => {
    const first=document.querySelector('.pdf-page')!;
    (window as any).__cachedZoom=[first.querySelector('canvas'),first.querySelector('.textLayer')];
    document.querySelector<HTMLButtonElement>('[aria-label="확대"]')!.click();
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    document.querySelector<HTMLButtonElement>('[aria-label="축소"]')!.click();
  });
  await expect(page.locator('.zoom-controls span')).toHaveText('125%'); await ready(page);
  await select(page); await page.getByRole('button', { name:'번역', exact:true }).click();
  await expect(page.getByRole('dialog')).toContainText('점근적인');
  expect(await page.evaluate(()=>{
    const first=document.querySelector('.pdf-page')!, cached=(window as any).__cachedZoom;
    return cached[0]===first.querySelector('canvas') && cached[1]===first.querySelector('.textLayer');
  })).toBe(true);
});

test('scrolling upward carries an attached bubble below the Reader instead of pushing it against the bottom', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf(4)); await open(page);
  await page.locator('.pdf-page[data-page-number="2"]').evaluate(el => {
    document.querySelector('.reader')!.scrollTop = (el as HTMLElement).offsetTop - 30;
  });
  await select(page, 'asymptotic', 20, 2);
  await page.getByRole('button', { name: '번역', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('점근적인');
  const before = (await page.getByRole('dialog').boundingBox())!;
  await page.locator('.reader').evaluate(el => { el.scrollTop -= 800; });
  await expect.poll(async () => (await page.getByRole('dialog').boundingBox())!.y).toBeCloseTo(before.y + 800, 0);
  expect((await page.getByRole('dialog').boundingBox())!.y).toBeGreaterThan(900);
  await page.locator('.reader').evaluate(el => { el.scrollTop += 800; });
  await expect.poll(async () => (await page.getByRole('dialog').boundingBox())!.y).toBeCloseTo(before.y, 0);
  await expect(page.getByRole('button', { name: '말풍선 닫기' })).toBeInViewport();
});

test('rapid toolbar reversal and PDF replacement discard stale zoom renders and leave the new document selectable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await installBackend(page, undefined, makeScrollPdf()); await open(page);
  await page.evaluate(() => {
    const plus = document.querySelector<HTMLButtonElement>('[aria-label="확대"]')!, minus = document.querySelector<HTMLButtonElement>('[aria-label="축소"]')!;
    for (let i = 0; i < 7; i++) plus.click();
    for (let i = 0; i < 4; i++) minus.click();
  });
  await expect(page.locator('.zoom-controls span')).toHaveText('200%');
  await page.evaluate(() => (window as any).__emitFileDrag({ type: 'drop', paths: ['/papers/zoom-drop.pdf'] }));
  await expect(page.locator('.document-title')).toHaveText('zoom-drop.pdf'); await ready(page);
  await page.getByRole('button', { name: '페이지 너비 맞춤' }).click(); await ready(page);
  await select(page, 'decision-making'); await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1); expect(errors).toEqual([]);
});
