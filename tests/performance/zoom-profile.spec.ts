import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installBackend, select } from '../e2e/helpers';
import { makeScrollPdf } from './fixture';

test('profile repeated zoom with real PDF.js canvas, text and saved highlights', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf());
  await page.addInitScript(() => {
    (window as any).__readerProfile = { active: false, counts: {} as Record<string, number>,
      hit(name: string) { if (this.active) this.counts[name] = (this.counts[name] ?? 0) + 1; } };
    localStorage.setItem('test-highlights', JSON.stringify(Array.from({ length: 24 * 48 }, (_, i) => ({
      id: i + 1, paperId: 'paper-a', vocabularyEntryId: 1, selectedText: 'asymptotic', pageNumber: Math.floor(i / 48) + 1,
      position: { version: 1, rects: [[240, 744 - i % 48 * 14, 290, 756 - i % 48 * 14]], startOffset: 0, endOffset: 10 },
    }))));
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await cdp.send('Performance.enable');
  const samples = [], label = process.env.PROFILE_LABEL ?? 'current';
  await mkdir('.tools/zoom-verification', { recursive: true });
  for (let run = 0; run < 3; run++) {
    await page.goto('/'); await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
    await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
    await expect(page.locator('.page-message')).toHaveCount(0); await select(page, 'asymptotic', 20);
    await page.waitForTimeout(250);
    const before = await cdp.send('Performance.getMetrics');
    const result = await page.evaluate(async () => {
      const p = (window as any).__readerProfile, host = document.querySelector('.reader')!;
      const frames: number[] = [], longTasks: number[] = [];
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
      observer.observe({ entryTypes: ['longtask'] });
      let last = performance.now(), finished = false;
      const tick = (now: number) => { frames.push(now - last); last = now; if (!finished) requestAnimationFrame(tick); };
      p.active = true; requestAnimationFrame(tick);
      for (const delta of [-18, 18]) for (let n = 0; n < (delta < 0 ? 12 : 8); n++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        for (let j = 0; j < 2; j++) host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
          clientX: 600, clientY: 410, deltaY: delta }));
      }
      const stopped = performance.now();
      await new Promise(resolve => setTimeout(resolve, 180));
      const first = document.querySelector<HTMLElement>('.pdf-page')!;
      while (Number(first.dataset.renderedScale) !== Number(document.querySelector<HTMLElement>('.reader')!.dataset.displayScale || first.style.getPropertyValue('--scale-factor')) && performance.now() - stopped < 10000)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const readyMs = performance.now() - stopped;
      await new Promise(resolve => setTimeout(resolve, 250));
      finished = true; p.active = false; observer.disconnect(); frames.sort((a,b) => a-b);
      return { counts: p.counts, frameP95Ms: frames[Math.floor(frames.length*.95)], longTasks: longTasks.length,
        longTaskMs: longTasks.reduce((a,b)=>a+b,0), readyMs, finalScale: first.dataset.renderedScale,
        selected: window.getSelection()?.toString(), peakFrameMs: Math.max(...frames) };
    });
    const after = await cdp.send('Performance.getMetrics');
    const delta = Object.fromEntries(after.metrics.filter(m => ['LayoutCount','LayoutDuration','ScriptDuration','TaskDuration'].includes(m.name))
      .map(m => [m.name,m.value-(before.metrics.find(b=>b.name===m.name)?.value??0)]));
    expect(result.finalScale).toBeDefined(); expect(result.selected).toBe('asymptotic');
    samples.push({ ...result, ...delta });
  }
  await writeFile(`.tools/zoom-verification/${label}.json`,JSON.stringify(samples,null,2));
  console.log(JSON.stringify(samples,null,2));
});
