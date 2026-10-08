import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasSize, MAX_CANVAS_PIXELS, PageRenderCache, RenderQueue } from './pageRendering';

describe('canvas backing-store budget', () => {
  it('preserves ordinary DPR 1 and 2 resolution', () => {
    expect(canvasSize(765, 990, 1)).toEqual({ width: 765, height: 990, ratio: 1 });
    expect(canvasSize(765, 990, 3)).toEqual({ width: 1530, height: 1980, ratio: 2 });
  });
  it('caps very large/zoomed pages by area and by either dimension', () => {
    for (const [w, h] of [[2448, 3168], [9000, 12000], [100000, 100], [100, 100000]]) {
      const size = canvasSize(w, h, 3);
      expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(8192);
      expect(size.ratio).toBeLessThanOrEqual(2);
    }
  });
});

describe('render scheduling', () => {
  it('coalesces a frame and skips pages passed before canvas allocation', async () => {
    const frames: (() => void)[] = [];
    const queue = new RenderQueue(1, run => { frames.push(run); });
    const order: number[] = [];
    let current = 1;
    const stale = queue.enqueue(async () => { order.push(1); }, () => current === 1 ? -1 : Infinity);
    const destination = queue.enqueue(async () => { order.push(2); }, () => current === 2 ? -1 : Infinity);
    queue.refresh(); queue.refresh();
    expect(frames).toHaveLength(1);
    current = 2; frames.shift()!(); await destination.promise;
    expect(order).toEqual([2]);
    const rejected = expect(stale.promise).rejects.toMatchObject({ name: 'AbortError' });
    stale.cancel(); await rejected;
  });
  it('uses current priority, and resumes deferred prefetch only when allowed', async () => {
    const queue = new RenderQueue(1);
    const order: string[] = [];
    let visible = 'destination', moving = true;
    const first = queue.enqueue(async () => { order.push('previous'); }, () => visible === 'previous' ? -100 : moving ? Infinity : 1);
    const destination = queue.enqueue(async () => { order.push('destination'); }, () => visible === 'destination' ? -800 : 1);
    await destination.promise;
    expect(order).toEqual(['destination']);
    visible = 'previous'; queue.refresh();
    await first.promise;
    expect(order).toEqual(['destination', 'previous']);
    const prefetch = queue.enqueue(async () => { order.push('prefetch'); }, () => moving ? Infinity : 1);
    await Promise.resolve(); expect(order).toHaveLength(2);
    moving = false; queue.refresh(); await prefetch.promise;
    expect(order).toEqual(['destination', 'previous', 'prefetch']);
  });
  it('bounds simultaneous work and continues after a render fails', async () => {
    const queue = new RenderQueue(2);
    const releases: (() => void)[] = [];
    let running = 0;
    let peak = 0;
    const jobs = Array.from({ length: 5 }, (_, i) => queue.enqueue(async () => {
      peak = Math.max(peak, ++running);
      await new Promise<void>(resolve => releases.push(resolve));
      running--;
      if (i === 1) throw new Error('failed page');
    }));
    const completed = Promise.allSettled(jobs.map(job => job.promise));
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      releases.shift()!();
    }
    const results = await completed;
    expect(peak).toBe(2);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(running).toBe(0);
  });
  it('never starts a queued render cancelled by a zoom or document replacement', async () => {
    const queue = new RenderQueue(1);
    let release: () => void = () => {};
    const first = queue.enqueue(() => new Promise<void>(resolve => { release = resolve; }));
    let invoked = false;
    const stale = queue.enqueue(async () => { invoked = true; });
    const rejected = expect(stale.promise).rejects.toMatchObject({ name: 'AbortError' });
    stale.cancel();
    await rejected;
    release();
    await first.promise;
    await queue.enqueue(async () => {}).promise;
    expect(invoked).toBe(false);
  });
});

describe('viewport scheduling during fast scroll', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  function setup() {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16));
    const observers: { callback: IntersectionObserverCallback; options: IntersectionObserverInit; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn();
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) { observers.push({ callback, options, disconnect: this.disconnect }); }
    });
    const selected = new Set<HTMLElement>();
    vi.stubGlobal('window', { getSelection: () => ({ rangeCount: selected.size ? 1 : 0,
      getRangeAt: () => ({ intersectsNode: (host: HTMLElement) => selected.has(host) }) }) });
    const reader = Object.assign(new EventTarget(), { scrollTop: 0, scrollLeft: 0 });
    const cache = new PageRenderCache();
    const page = (top: number) => {
      const host = { dataset: {}, closest: () => reader, offsetTop: top, offsetLeft: 0, offsetWidth: 600, offsetHeight: 1000 } as unknown as HTMLElement;
      const update = vi.fn(); const stop = cache.observe(host, update);
      return { host, update, stop };
    };
    const notify = (kind: 'visible' | 'near', hosts: HTMLElement[]) => {
      const observer = observers.find(o => kind === 'near' ? o.options.rootMargin : !o.options.rootMargin)!;
      const margin = kind === 'near' ? 900 : 0;
      observer.callback(hosts.map(host => {
        const top = host.offsetTop - reader.scrollTop;
        const height = Math.max(0, Math.min(top + 1000, 800 + margin) - Math.max(top, -margin));
        return { target: host, isIntersecting: height > 0, rootBounds: { width: 1000, height: 800 },
          intersectionRect: { width: 600, height }, boundingClientRect: { top, left: 0, width: 600, height: 1000 } };
      }) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    };
    const scroll = (top: number) => { reader.scrollTop = top; reader.dispatchEvent(new Event('scroll')); };
    return { cache, page, notify, scroll, reader, selected, observers };
  }

  it('prioritizes the destination and cancels passed work before another observer delivery', () => {
    const { cache, page, notify, scroll, reader } = setup();
    const old = page(0), target = page(1024), next = page(2048);
    const hosts = [old.host, target.host, next.host];
    notify('visible', hosts); notify('near', hosts);
    expect(cache.continueRendering(old.host)).toBe(true);
    scroll(1000);
    expect(cache.continueRendering(old.host)).toBe(false);
    expect(old.update).toHaveBeenLastCalledWith(false);
    notify('visible', hosts); notify('near', hosts);
    expect(cache.priority(target.host)).toBeLessThan(0);
    expect(cache.priority(next.host)).toBe(Infinity);
    // A new scrollbar jump can precede both scroll-event and observer delivery.
    reader.scrollTop = 2048;
    expect(cache.continueRendering(target.host)).toBe(false);
    expect(target.update).toHaveBeenLastCalledWith(false);
    old.stop(); target.stop(); next.stop();
  });

  it('defers only offscreen prefetch, protects a drag anchor and cleans up timers on drop', () => {
    const { cache, page, notify, scroll, selected, observers } = setup();
    const first = page(0), second = page(1024);
    const hosts = [first.host, second.host];
    notify('visible', hosts); notify('near', hosts);
    selected.add(first.host); scroll(1024); notify('visible', hosts); notify('near', hosts);
    expect(cache.continueRendering(first.host)).toBe(true);
    expect(first.update).not.toHaveBeenCalledWith(false);
    selected.clear();
    expect(cache.priority(first.host)).toBe(Infinity);
    vi.advanceTimersByTime(100);
    expect(cache.priority(first.host)).toBe(1);
    scroll(0); first.stop(); second.stop();
    const count = first.update.mock.calls.length + second.update.mock.calls.length;
    vi.runAllTimers();
    expect(first.update.mock.calls.length + second.update.mock.calls.length).toBe(count);
    expect(observers.every(o => o.disconnect.mock.calls.length === 1)).toBe(true);
  });
});
