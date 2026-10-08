import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installBackend } from '../e2e/helpers';
import { makeScrollPdf } from './fixture';

test('profile actual fast wheel input and its delivery latency', async ({ page }) => {
  await installBackend(page, undefined, makeScrollPdf());
  // Isolated diagnostic A/B only. Never changes the shipped Ctrl+wheel handler.
  if (process.env.PROFILE_PASSIVE_WHEEL === '1') await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      return add.call(this, type, callback, type === 'wheel' && typeof options === 'object' ? { ...options, passive: true } : options);
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const samples = [];
  const label = process.env.PROFILE_LABEL ?? 'current';
  await mkdir('.tools/scroll-profile', { recursive: true });
  for (let run = 0; run < 3; run++) {
    await page.goto('/');
    await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
    await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-rendered-scale', '1.25');
    await expect(page.locator('.page-message')).toHaveCount(0);
    await page.waitForTimeout(200);
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,input,latencyInfo,cc,benchmark', transferMode: 'ReturnAsStream' });
    await page.evaluate(() => {
      const reader = document.querySelector('.reader')!;
      const result = (window as any).__wheelProfile = { start: performance.now(), active: true, frames: [] as number[], scrolls: [] as unknown[] };
      let last = result.start;
      const frame = () => {
        if (!result.active) return;
        const now = performance.now(); result.frames.push(now - last); last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      reader.addEventListener('scroll', () => {
        if (result.active) result.scrolls.push({ ms: performance.now() - result.start, top: reader.scrollTop });
      }, { passive: true });
    });
    await cdp.send('Input.synthesizeScrollGesture', { x: 580, y: 400, yDistance: -16000, speed: 16000, gestureSourceType: 'mouse' });
    const result = await page.evaluate(() => {
      const r = (window as any).__wheelProfile;
      r.active = false;
      r.durationMs = performance.now() - r.start;
      r.frames.sort((a: number, b: number) => a - b);
      return { durationMs: r.durationMs, frameP95Ms: r.frames[Math.floor(r.frames.length * .95)], frames: r.frames.length,
        scrolls: r.scrolls, top: document.querySelector('.reader')!.scrollTop };
    });
    const finished = new Promise<any>(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    const { stream } = await finished;
    let trace = '';
    for (;;) { const chunk = await cdp.send('IO.read', { handle: stream }); trace += chunk.data; if (chunk.eof) break; }
    await cdp.send('IO.close', { handle: stream });
    await writeFile(`.tools/scroll-profile/wheel-${label}-${run + 1}.trace.json`, trace);
    expect(result.top).toBeGreaterThan(15000);
    samples.push(result);
  }
  await writeFile(`.tools/scroll-profile/wheel-${label}.json`, JSON.stringify(samples, null, 2));
  console.log(JSON.stringify(samples.map(({ scrolls, ...r }) => ({ ...r, firstScrollMs: scrolls[0]?.ms, lastScrollMs: scrolls.at(-1)?.ms, scrollEvents: scrolls.length })), null, 2));
});
