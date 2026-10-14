import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const clamp = (value: number) => Math.round(Math.max(.7, Math.min(2, value)) * 100) / 100;

/** Text zoom is independent of PDF geometry and shared by all pages in a pane. */
export function useTextZoom(key: string, root: RefObject<HTMLElement | null>, enabled: boolean, selector?: string) {
  const [scale, setScale] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return saved > 0 && Number.isFinite(saved) ? clamp(saved) : 1;
  });
  const current = useRef(scale);
  const anchor = useRef<{ element: HTMLElement; fraction: number; offset: number } | null>(null);
  const change = useCallback((value: number, target?: Element | null, y?: number) => {
    const next = clamp(value);
    if (next === current.current) return;
    const content = target?.closest<HTMLElement>('.translation-page-content, .chat-messages');
    if (content) {
      const offset = Math.max(0, Math.min(content.clientHeight, (y ?? content.getBoundingClientRect().top) - content.getBoundingClientRect().top));
      anchor.current = { element: content, fraction: (content.scrollTop + offset) / content.scrollHeight, offset };
    }
    current.current = next; setScale(next);
  }, []);
  useLayoutEffect(() => {
    const saved = anchor.current;
    if (saved?.element.isConnected) saved.element.scrollTop = saved.fraction * saved.element.scrollHeight - saved.offset;
    anchor.current = null;
  }, [scale]);
  useEffect(() => { localStorage.setItem(key, String(scale)); }, [key, scale]);
  useEffect(() => {
    const element = root.current;
    if (!element || !enabled) return;
    const accepts = (target: EventTarget | null) => target instanceof Element && (!selector || !!target.closest(selector));
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !accepts(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.deltaY) change(current.current + (event.deltaY < 0 ? .1 : -.1), event.target as Element, event.clientY);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { element.removeEventListener('wheel', wheel); };
  }, [root, enabled, selector, change]);
  return { scale, step: (direction: number) => change(current.current + direction * .1), reset: () => change(1) };
}
export type TextZoom = ReturnType<typeof useTextZoom>;
