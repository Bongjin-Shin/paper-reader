import { useLayoutEffect, type RefObject } from 'react';

/** Map each page's scroll progress to its translation, without React updates per frame. */
export function useTranslationScroll(reader: RefObject<HTMLElement | null>, translation: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const source = reader.current, target = translation.current;
    if (!source || !target) return;
    let frame = 0, leader: HTMLElement = source, dirty = true;
    let sourcePoints: number[] = [], targetPoints: number[] = [];
    const measure = (container: HTMLElement, selector: string) => {
      const items = [...container.querySelectorAll<HTMLElement>(selector)], origin = container.getBoundingClientRect().top;
      const points = items.map(item => item.getBoundingClientRect().top - origin + container.scrollTop);
      if (items.length) points.push(points.at(-1)! + items.at(-1)!.offsetHeight);
      return points;
    };
    let expectedSource: number | undefined, expectedTarget: number | undefined;
    const sync = () => {
      frame = 0;
      if (dirty) { sourcePoints = measure(source, '.pdf-page'); targetPoints = measure(target, '.translation-page'); dirty = false; }
      const from = leader, to = from === source ? target : source;
      const fromPoints = from === source ? sourcePoints : targetPoints, toPoints = to === source ? sourcePoints : targetPoints;
      if (fromPoints.length < 2 || fromPoints.length !== toPoints.length) return;
      const anchor = from.scrollTop + from.clientHeight * .2;
      let low = 0, high = fromPoints.length - 1;
      while (low + 1 < high) { const mid = (low + high) >>> 1; if (fromPoints[mid] <= anchor) low = mid; else high = mid; }
      const start = fromPoints[low], end = fromPoints[low + 1], dest = toPoints[low], destEnd = toPoints[low + 1];
      const next = Math.max(0, Math.min(to.scrollHeight - to.clientHeight, dest + (anchor - start) / Math.max(1, end - start) * (destEnd - dest) - to.clientHeight * .2));
      if (Math.abs(to.scrollTop - next) < 1) return;
      to.scrollTop = next;
      if (to === source) expectedSource = to.scrollTop; else expectedTarget = to.scrollTop;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const sourceScroll = () => {
      if (expectedSource !== undefined && Math.abs(source.scrollTop - expectedSource) < 1) { expectedSource = undefined; return; }
      expectedSource = undefined; leader = source; schedule();
    };
    const targetScroll = () => {
      if (expectedTarget !== undefined && Math.abs(target.scrollTop - expectedTarget) < 1) { expectedTarget = undefined; return; }
      expectedTarget = undefined;
      if (leader === target) schedule();
    };
    const targetIntent = (event: Event) => {
      if (event.type === 'pointerdown' && event.target !== target) return;
      if (event.type === 'keydown' && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes((event as KeyboardEvent).key)) return;
      leader = target;
    };
    const sourceIntent = () => { leader = source; };
    // Streaming text/reflow must keep the PDF reading position stable even if the
    // last click was inside the translation pane.
    const reflow = () => { dirty = true; leader = source; schedule(); };
    const resize = new ResizeObserver(reflow);
    resize.observe(source); resize.observe(target);
    const sourcePages = source.querySelector('.pages'); if (sourcePages) resize.observe(sourcePages);
    target.querySelectorAll('.translation-page').forEach(el => resize.observe(el));
    source.addEventListener('scroll', sourceScroll, { passive: true });
    target.addEventListener('scroll', targetScroll, { passive: true });
    for (const event of ['wheel', 'pointerdown', 'keydown']) {
      target.addEventListener(event, targetIntent, { passive: true }); source.addEventListener(event, sourceIntent, { passive: true });
    }
    source.addEventListener('readerzoom', reflow); schedule();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect();
      source.removeEventListener('scroll', sourceScroll); target.removeEventListener('scroll', targetScroll);
      for (const event of ['wheel', 'pointerdown', 'keydown']) { target.removeEventListener(event, targetIntent); source.removeEventListener(event, sourceIntent); }
      source.removeEventListener('readerzoom', reflow);
    };
  }, [reader, translation]);
}
