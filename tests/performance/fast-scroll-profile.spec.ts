import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installBackend } from '../e2e/helpers';
import { makeScrollPdf } from './fixture';

test('profile fast traversal and cold scrollbar jumps', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf());
  await page.addInitScript(() => {
    (window as any).__readerProfile = {
      active: false, counts: {} as Record<string, number>, events: [] as unknown[],
      hit(name: string, pageNumber?: number) {
        if (!this.active) return;
        this.counts[name] = (this.counts[name] ?? 0) + 1;
        if (pageNumber) this.events.push({ name, page: pageNumber, time: performance.now(), scrollTop: document.querySelector('.reader')!.scrollTop });
      },
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Performance.enable');
  const samples = [];
  const label = process.env.PROFILE_LABEL ?? 'current';
  await mkdir('.tools/scroll-profile', { recursive: true });
  for (let run = 0; run < 3; run++) {
    await page.goto('/');
    await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
    await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
    await expect(page.locator('.page-message')).toHaveCount(0);
    await page.waitForTimeout(300);
    const before = await cdp.send('Performance.getMetrics');
    await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReturnAsStream' });
    const result = await page.evaluate(async () => {
      const p = (window as any).__readerProfile;
      const reader = document.querySelector<HTMLElement>('.reader')!;
      const pages = [...document.querySelectorAll<HTMLElement>('.pdf-page')];
      const rootTop = reader.getBoundingClientRect().top;
      const tops = pages.map(el => el.getBoundingClientRect().top - rootTop + reader.scrollTop - 30);
      const frames: number[] = [], longTasks: number[] = [], jumps: unknown[] = [];
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
      observer.observe({ entryTypes: ['longtask'] });
      let last = performance.now();
      const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => {
        const now = performance.now(); frames.push(now - last); last = now; resolve();
      }));
      p.active = true;
      // A cold page every frame: considerably faster than the original 120px/frame trace.
      for (let n = 0; n < 23; n++) { reader.scrollTop = tops[n]; await frame(); }
      for (const target of [24, 4, 20, 8, 16]) {
        const start = performance.now();
        const eventIndex = p.events.length;
        reader.scrollTop = tops[target - 1];
        do { await frame(); } while (!pages[target - 1].dataset.renderedScale && performance.now() - start < 10000);
        if (!pages[target - 1].dataset.renderedScale) throw new Error(`Page ${target} did not become selectable`);
        jumps.push({ page: target, readyMs: performance.now() - start, events: p.events.slice(eventIndex) });
      }
      await new Promise(resolve => setTimeout(resolve, 300));
      observer.disconnect(); p.active = false;
      frames.sort((a, b) => a - b);
      return { counts: p.counts, frameP95Ms: frames[Math.floor(frames.length * .95)], slowFrames: frames.filter(n => n > 25).length,
        frameCount: frames.length, longTasks: longTasks.length, longTaskMs: longTasks.reduce((a, b) => a + b, 0), jumps, events: p.events };
    });
    const finished = new Promise<any>(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    const { stream } = await finished;
    let trace = '';
    for (;;) { const chunk = await cdp.send('IO.read', { handle: stream }); trace += chunk.data; if (chunk.eof) break; }
    await cdp.send('IO.close', { handle: stream });
    await writeFile(`.tools/scroll-profile/fast-${label}-${run + 1}.trace.json`, trace);
    const after = await cdp.send('Performance.getMetrics');
    const delta = Object.fromEntries(after.metrics.filter(m => ['LayoutCount', 'LayoutDuration', 'ScriptDuration', 'TaskDuration'].includes(m.name))
      .map(m => [m.name, m.value - (before.metrics.find(b => b.name === m.name)?.value ?? 0)]));
    samples.push({ ...result, ...delta });
  }
  await writeFile(`.tools/scroll-profile/fast-${label}.json`, JSON.stringify(samples, null, 2));
  console.log(JSON.stringify(samples.map(({ events: _events, jumps, ...sample }) => ({ ...sample,
    jumps: jumps.map((jump: any) => ({ page: jump.page, readyMs: jump.readyMs, starts: jump.events.filter((e: any) => e.name === 'canvasRender').map((e: any) => e.page) })) })), null, 2));
});
