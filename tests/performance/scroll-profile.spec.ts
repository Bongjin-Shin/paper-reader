import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installBackend, select } from '../e2e/helpers';
import { makeScrollPdf } from './fixture';

test('profile the same down/up scroll and repeated page revisits', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf());
  await page.addInitScript(() => {
    const profile = (window as any).__readerProfile = {
      counts: {} as Record<string, number>, frames: [] as number[], longTasks: [] as number[],
      active: false, peakCanvases: 0, peakPixels: 0,
      hit(name: string) { if (this.active) this.counts[name] = (this.counts[name] ?? 0) + 1; },
    };
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { profile.hit('geometryReads'); return rect.call(this); };
    new PerformanceObserver(list => { if (profile.active) profile.longTasks.push(...list.getEntries().map(e => e.duration)); }).observe({ entryTypes: ['longtask'] });
    // Many restored highlights make redundant coordinate transforms visible.
    localStorage.setItem('test-highlights', JSON.stringify(Array.from({ length: 24 * 48 }, (_, i) => ({
      id: i + 1, paperId: 'paper-a', vocabularyEntryId: 1, selectedText: 'asymptotic', pageNumber: Math.floor(i / 48) + 1,
      position: { version: 1, rects: [[240, 744 - i % 48 * 14, 290, 756 - i % 48 * 14]], startOffset: 0, endOffset: 10 },
    }))));
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Performance.enable');
  await page.goto('/');
  await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
  await expect(page.locator('.page-message')).toHaveCount(0);
  // Wait for initial observer delivery before collecting the scroll sample.
  await page.waitForTimeout(500);
  const samples = [];
  for (let run = 0; run < 3; run++) {
    await select(page);
    const before = await cdp.send('Performance.getMetrics');
    await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReturnAsStream' });
    await page.evaluate(async () => {
      const p = (window as any).__readerProfile;
      p.counts = {}; p.frames = []; p.longTasks = []; p.peakCanvases = 0; p.peakPixels = 0; p.active = true;
      const reader = document.querySelector('.reader')!;
      let last = performance.now();
      // 8 pages down/up, repeated: same inputs and distance before and after.
      for (const direction of [1, -1, 1, -1]) {
        for (let n = 0; n < 70; n++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          const now = performance.now(); p.frames.push(now - last); last = now;
          reader.scrollTop += direction * 120;
          const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.canvas-layer canvas')];
          p.peakCanvases = Math.max(p.peakCanvases, canvases.length);
          p.peakPixels = Math.max(p.peakPixels, canvases.reduce((sum, c) => sum + c.width * c.height, 0));
        }
      }
      await new Promise(resolve => setTimeout(resolve, 400));
      p.active = false;
    });
    const finished = new Promise<any>(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    const { stream } = await finished;
    let trace = '';
    for (;;) { const chunk = await cdp.send('IO.read', { handle: stream }); trace += chunk.data; if (chunk.eof) break; }
    await cdp.send('IO.close', { handle: stream });
    const after = await cdp.send('Performance.getMetrics');
    const delta = Object.fromEntries(after.metrics.filter(m => ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'].includes(m.name))
      .map(m => [m.name, m.value - (before.metrics.find(b => b.name === m.name)?.value ?? 0)]));
    const result = await page.evaluate(() => {
      const p = (window as any).__readerProfile;
      const frames = [...p.frames].sort((a: number, b: number) => a - b);
      return { counts: p.counts, peakCanvases: p.peakCanvases, peakPixels: p.peakPixels,
        frameP95Ms: frames[Math.floor(frames.length * .95)], slowFrames: frames.filter((n: number) => n > 25).length,
        longTasks: p.longTasks.length, longTaskMs: p.longTasks.reduce((a: number, b: number) => a + b, 0) };
    });
    samples.push({ ...result, ...delta });
    const label = process.env.PROFILE_LABEL ?? 'current';
    await mkdir('.tools/scroll-profile', { recursive: true });
    await writeFile(`.tools/scroll-profile/${label}-${run + 1}.trace.json`, trace);
  }
  await writeFile(`.tools/scroll-profile/${process.env.PROFILE_LABEL ?? 'current'}.json`, JSON.stringify(samples, null, 2));
  console.log(JSON.stringify(samples, null, 2));
});
