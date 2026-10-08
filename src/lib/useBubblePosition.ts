import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { BubbleState } from '../components/WordBubble';

export type BubblePlacement = { pageNumber: number; left: number; top: number };
type Position = { left: number; top: number };

/** Bubbles are document content. Scrolling never needs a listener or React update. */
export function useBubblePosition(bubble: BubbleState, hasRemove: boolean, reader: RefObject<HTMLElement | null>, onPlace: (position: BubblePlacement) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position>({ left: -1000, top: -1000 });
  const current = useRef(position), frame = useRef(0);
  const placement = useRef(bubble.placement);
  placement.current = bubble.placement;
  const save = useRef(onPlace); save.current = onPlace;
  const anchor = useRef(bubble.selection.anchor);
  const initialAnchor = useRef(bubble.selection.anchor);
  const attachment = useRef<{ above: boolean; shiftX: number } | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; clientX: number; clientY: number; moved: boolean } | null>(null);

  const paint = (next: Position) => {
    current.current = next;
    if (ref.current) Object.assign(ref.current.style, { left: `${next.left}px`, top: `${next.top}px` });
  };
  const paintDrag = () => {
    frame.current = 0;
    const state = drag.current, host = reader.current, surface = ref.current;
    const pages = host?.querySelector<HTMLElement>('.pages');
    if (!state?.moved || !host || !surface || !pages) return;
    const origin = pages.getBoundingClientRect(), bounds = host.getBoundingClientRect();
    // Clamp only during the drag. Once released, scrolling/resize never pulls a
    // bubble back into the screen or changes its chosen document location.
    const left = Math.max(bounds.left + 8, Math.min(bounds.right - surface.offsetWidth - 8, state.clientX - state.x));
    const top = Math.max(bounds.top + 8, Math.min(bounds.bottom - surface.offsetHeight - 8, state.clientY - state.y));
    paint({ left: left - origin.left, top: top - origin.top });
  };
  const finish = () => {
    cancelAnimationFrame(frame.current); paintDrag();
    const state = drag.current; drag.current = null;
    const surface = ref.current, host = reader.current;
    if (state?.moved && surface && host) {
      const box = surface.getBoundingClientRect();
      const pages = [...host.querySelectorAll<HTMLElement>('.pdf-page')];
      const page = pages.find(page => page.getBoundingClientRect().bottom >= box.top) ?? pages.at(-1);
      if (page) {
        const bounds = page.getBoundingClientRect(), scale = bounds.width / Number(page.dataset.pdfWidth);
        const point = { pageNumber: Number(page.dataset.pageNumber), left: (box.left - bounds.left) / scale, top: (box.top - bounds.top) / scale };
        placement.current = point; save.current(point);
      }
      setPosition(current.current);
    }
    if (state && surface?.hasPointerCapture(state.pointerId)) surface.releasePointerCapture(state.pointerId);
    surface?.removeAttribute('data-dragging');
  };
  useLayoutEffect(() => {
    const selected = bubble.selection.anchor, host = reader.current;
    anchor.current = { ...selected, left: selected.left + (host?.scrollLeft ?? 0),
      top: selected.top + (host?.scrollTop ?? 0), bottom: selected.bottom + (host?.scrollTop ?? 0) };
  }, [bubble.selection.anchor, reader]);
  useLayoutEffect(() => {
    const place = () => {
      const surface = ref.current, host = reader.current, pages = host?.querySelector<HTMLElement>('.pages');
      if (!surface || !host?.clientWidth || !pages || drag.current?.moved) return;
      const origin = pages.getBoundingClientRect(), point = placement.current;
      if (point) {
        const page = host.querySelector<HTMLElement>(`.pdf-page[data-page-number="${point.pageNumber}"]`);
        if (!page) return;
        const bounds = page.getBoundingClientRect(), scale = bounds.width / Number(page.dataset.pdfWidth);
        paint({ left: bounds.left - origin.left + point.left * scale, top: bounds.top - origin.top + point.top * scale });
      } else {
        const { width, height } = surface.getBoundingClientRect();
        const minimumTop = host.getBoundingClientRect().top + 8;
        const initialLeft = initialAnchor.current.left + initialAnchor.current.width / 2 - width / 2;
        attachment.current = { above: initialAnchor.current.top - height - 10 >= minimumTop,
          shiftX: Math.max(12, Math.min(window.innerWidth - width - 12, initialLeft)) - initialLeft };
        paint({ left: anchor.current.left - host.scrollLeft + anchor.current.width / 2 - width / 2 + attachment.current.shiftX - origin.left,
          top: (attachment.current.above ? anchor.current.top - height - 10 : anchor.current.bottom + 10) - host.scrollTop - origin.top });
      }
      setPosition(current.current);
    };
    place();
    const host = reader.current;
    const observer = new ResizeObserver(place);
    if (host) observer.observe(host);
    host?.addEventListener('readerzoom', place);
    return () => { observer.disconnect(); host?.removeEventListener('readerzoom', place); };
  }, [bubble, hasRemove, reader]);
  useEffect(() => {
    window.addEventListener('blur', finish);
    return () => { window.removeEventListener('blur', finish); cancelAnimationFrame(frame.current); };
  }, [reader]);

  return { ref, position,
    begin: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || (event.target as Element).closest('button, a, input, textarea, select')) return;
      const scroller = (event.target as Element).closest<HTMLElement>('.result-content, .phrase-result strong');
      if (scroller && event.clientX >= scroller.getBoundingClientRect().left + scroller.clientWidth && scroller.scrollHeight > scroller.clientHeight) return;
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      drag.current = { pointerId: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top,
        clientX: event.clientX, clientY: event.clientY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    move: (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;
      if (!(event.buttons & 1)) { finish(); return; }
      if (!state.moved && Math.hypot(event.clientX - state.clientX, event.clientY - state.clientY) < 3) return;
      state.clientX = event.clientX; state.clientY = event.clientY; state.moved = true;
      event.preventDefault(); ref.current?.setAttribute('data-dragging', 'true');
      if (!frame.current) frame.current = requestAnimationFrame(paintDrag);
    },
    end: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current.clientX = event.clientX; drag.current.clientY = event.clientY; finish();
    },
    cancel: finish,
  };
}
