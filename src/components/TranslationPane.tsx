import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const key = 'reader-translation-panel-width';
/** One shared width for every translation attached to a PDF page. */
export function useTranslationWidth(reader: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return saved >= 240 && Number.isFinite(saved) ? saved : Math.max(280, Math.min(440, innerWidth * .31));
  });
  const [maximum, setMaximum] = useState(innerWidth);
  const limit = useCallback(() => {
    const root = reader.current, pages = root?.querySelector('.pages');
    const style = pages ? getComputedStyle(pages) : null;
    const padding = style ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 60;
    return Math.max(240, (root?.clientWidth ?? innerWidth) - padding - 260);
  }, [reader]);
  const resize = useCallback((value: number) => setWidth(Math.round(Math.max(240, Math.min(limit(), value)))), [limit]);
  useEffect(() => {
    const root = reader.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      const max = limit(); setMaximum(max); setWidth(value => Math.min(max, value));
    });
    observer.observe(root); return () => observer.disconnect();
  }, [reader, limit]);
  useEffect(() => { localStorage.setItem(key, String(width)); }, [width]);
  return { width, maximum, resize, reader };
}
export type TranslationWidth = ReturnType<typeof useTranslationWidth>;

export function TranslationResizer({ sizing, pageNumber }: { sizing: TranslationWidth; pageNumber: number }) {
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(null), frame = useRef(0);
  const finish = () => {
    cancelAnimationFrame(frame.current); frame.current = 0;
    drag.current = null; sizing.reader.current?.removeAttribute('data-translation-resizing');
  };
  useEffect(() => () => { cancelAnimationFrame(frame.current); if (drag.current) sizing.reader.current?.removeAttribute('data-translation-resizing'); }, [sizing.reader]);
  return <div className="translation-resizer" role="separator" aria-label={`${pageNumber}페이지 번역창 너비 조절`} aria-orientation="vertical"
    aria-valuemin={240} aria-valuemax={sizing.maximum} aria-valuenow={sizing.width} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width: sizing.width, pointer: event.pointerId };
      sizing.reader.current?.setAttribute('data-translation-resizing', 'true');
    }} onPointerMove={event => {
      const start = drag.current; if (!start || start.pointer !== event.pointerId) return;
      const next = start.width + start.x - event.clientX;
      cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => sizing.resize(next));
    }} onPointerUp={event => {
      const start = drag.current; if (!start) return;
      sizing.resize(start.width + start.x - event.clientX); finish(); event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={finish} onLostPointerCapture={() => { if (drag.current) finish(); }}
    onKeyDown={event => {
      if (!event.altKey && !event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault(); sizing.resize(sizing.width + (event.key === 'ArrowLeft' ? 20 : -20));
      }
    }} />;
}
