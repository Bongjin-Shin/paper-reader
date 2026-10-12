import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { syncPageGeometry } from './pageGeometry';

export const clampZoom = (scale: number) => Math.round(Math.max(.1, Math.min(4, scale)) * 10000) / 10000;
export const fitScale = (availableWidth: number, pageWidth: number, padding: number) => clampZoom((availableWidth - padding) / pageWidth);

export function useReaderZoom(reader: RefObject<HTMLElement | null>, pdf: PDFDocumentProxy | null, onSettled: () => void, sideWidth = 0) {
  const [scale, setScale] = useState(1.25);
  const [renderScale, setRenderScale] = useState(1.25);
  const [renderRevision, setRenderRevision] = useState(0);
  const [fitting, setFitting] = useState(false);
  const scaleRef = useRef(scale);
  const fittingRef = useRef(false);
  const pageWidth = useRef(612);
  const callback = useRef(onSettled);
  callback.current = onSettled;
  const reservedWidth = useRef(sideWidth); reservedWidth.current = sideWidth;
  const zooming = useRef(false);
  const frame = useRef(0);
  const qualityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wheelFrame = useRef(0);
  const pendingWheel = useRef<{ scale: number; x: number; y: number } | null>(null);
  const anchor = useRef<{ page: HTMLElement; x: number; y: number; screenX: number; screenY: number } | null>(null);

  const apply = useCallback((next: number, point?: { x: number; y: number }) => {
    const host = reader.current;
    next = clampZoom(next);
    if (!host) return;
    // Continuing to wheel at the limit is still an active gesture; don't start a
    // large high-resolution render between those inputs and the direction reversal.
    clearTimeout(qualityTimer.current);
    qualityTimer.current = setTimeout(() => { setRenderScale(next); setRenderRevision(value => value + 1); }, 140);
    if (next === scaleRef.current) return;
    host.dispatchEvent(new Event('readerzoomstart'));
    const bounds = host.getBoundingClientRect();
    const position = point ?? { x: bounds.left + Math.max(60, host.clientWidth - reservedWidth.current) / 2, y: bounds.top + Math.min(180, host.clientHeight / 2) };
    const pages = host.querySelectorAll<HTMLElement>('.pdf-page');
    const firstBelow = (y: number) => {
      let low = 0, high = pages.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (pages[middle].getBoundingClientRect().bottom < y) low = middle + 1;
        else high = middle;
      }
      return pages[low];
    };
    const candidate = firstBelow(position.y);
    const page = candidate && candidate.getBoundingClientRect().top <= position.y ? candidate : firstBelow(bounds.top);
    const before = page?.getBoundingClientRect();
    anchor.current = before ? { page, x: (position.x - before.left) / before.width,
      y: (position.y - before.top) / before.height, screenX: position.x, screenY: position.y } : null;
    zooming.current = true;
    scaleRef.current = next;
    setScale(next);
  }, [reader]);

  const fit = useCallback(() => {
    const host = reader.current;
    const pages = host?.querySelector('.pages');
    if (!host || !pages) return;
    const style = getComputedStyle(pages);
    apply(fitScale(host.clientWidth, pageWidth.current, parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + reservedWidth.current));
  }, [apply, reader]);

  useLayoutEffect(() => {
    // Respect the user's zoom mode when opening or resizing translations.
    if (fittingRef.current) fit();
  }, [sideWidth, fit]);

  useEffect(() => {
    if (!pdf) return;
    let active = true;
    void Promise.all(Array.from({ length: pdf.numPages }, (_, index) => pdf.getPage(index + 1)))
      .then(pages => { if (active) { pageWidth.current = Math.max(...pages.map(page => page.getViewport({ scale: 1 }).width)); if (fittingRef.current) fit(); } })
      .catch(() => {}); // Individual page errors are shown by the reader.
    return () => { active = false; };
  }, [pdf, fit]);

  useLayoutEffect(() => {
    const host = reader.current;
    if (host) {
      // Batch preview geometry with the toolbar commit, without rendering the page
      // components. No inherited scale variable invalidates every text span's style.
      host.dataset.displayScale = String(scale);
      for (const page of host.querySelectorAll<HTMLElement>('.pdf-page')) {
        if (page.dataset.renderedScale !== String(scale)) page.removeAttribute('data-rendered-scale');
        syncPageGeometry(page, scale);
      }
      const saved = anchor.current;
      if (saved && host.contains(saved.page)) {
        const after = saved.page.getBoundingClientRect();
        host.scrollLeft += after.left + saved.x * after.width - saved.screenX;
        host.scrollTop += after.top + saved.y * after.height - saved.screenY;
      }
      anchor.current = null;
      host.dispatchEvent(new Event('readerzoom'));
    }
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      zooming.current = false; callback.current();
    });
    return () => cancelAnimationFrame(frame.current);
  }, [scale, reader]);

  useEffect(() => {
    const host = reader.current;
    if (!host) return;
    const observer = new ResizeObserver(() => { if (fittingRef.current) fit(); else callback.current(); });
    observer.observe(host);
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !pdf) return;
      event.preventDefault();
      if (!event.deltaY) return;
      clearTimeout(qualityTimer.current);
      host.dispatchEvent(new Event('readerzoomstart'));
      fittingRef.current = false; setFitting(false);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1;
      pendingWheel.current = { scale: clampZoom((pendingWheel.current?.scale ?? scaleRef.current) * Math.exp(-Math.max(-100, Math.min(100, event.deltaY * unit)) * .002)),
        x: event.clientX, y: event.clientY };
      if (!wheelFrame.current) wheelFrame.current = requestAnimationFrame(() => {
        wheelFrame.current = 0;
        const next = pendingWheel.current; pendingWheel.current = null;
        if (next) apply(next.scale, next);
      });
    };
    host.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); host.removeEventListener('wheel', wheel); };
  }, [reader, pdf, fit, apply]);

  useEffect(() => {
    // Replacing a PDF must not apply an old wheel/quality request to the new document.
    setRenderScale(scaleRef.current);
    return () => { clearTimeout(qualityTimer.current); cancelAnimationFrame(wheelFrame.current); wheelFrame.current = 0; pendingWheel.current = null; };
  }, [pdf]);

  const cancelWheel = () => { cancelAnimationFrame(wheelFrame.current); wheelFrame.current = 0; pendingWheel.current = null; };
  return { scale, renderScale, renderRevision, fitting, zooming, scaleRef,
    step: (direction: number) => { const next = (pendingWheel.current?.scale ?? scaleRef.current) + direction * .25; cancelWheel(); fittingRef.current = false; setFitting(false); apply(next); },
    fitWidth: () => { cancelWheel(); fittingRef.current = true; setFitting(true); fit(); } };
}
