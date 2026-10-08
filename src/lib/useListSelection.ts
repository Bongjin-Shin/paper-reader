import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

export function selectListRange<Id extends string | number>(ids: Id[], previous: Set<Id>, anchor: Id | null, id: Id,
  toggle: boolean, range: boolean) {
  if (!ids.includes(id)) return new Set(previous);
  if (range && anchor !== null && ids.includes(anchor)) {
    const from = ids.indexOf(anchor), to = ids.indexOf(id);
    return new Set([...(toggle ? previous : []), ...ids.slice(Math.min(from, to), Math.max(from, to) + 1)]);
  }
  if (!toggle && !previous.has(id)) return new Set([id]);
  const next = new Set(previous);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
const same = <Id,>(a: Set<Id>, b: Set<Id>) => a.size === b.size && [...a].every(id => b.has(id));

/** Selection geometry is measured only at the start of a blank-area drag. Reader scrolling is untouched. */
export function useListSelection<Id extends string | number>(active: boolean, disabled: boolean, scope: string | number | null, ids: Id[],
  host: RefObject<HTMLElement | null>, excluded: string, layoutKey: string | number = '') {
  const [selected, setSelected] = useState(new Set<Id>());
  const selectedRef = useRef(selected), anchor = useRef<Id | null>(null);
  const [dragging, setDragging] = useState(false);
  const overlay = useRef<HTMLDivElement>(null), suppressClick = useRef(false);
  const latest = useRef({ ids, disabled }); latest.current = { ids, disabled };
  const session = useRef<{
    pointer: number; x: number; y: number; clientX: number; clientY: number; moved: boolean;
    before: Set<Id>; base: Set<Id>; anchor: Id | null; rows: { id: Id; left: number; top: number; right: number; bottom: number }[];
  } | null>(null);
  const assign = (next: Set<Id>) => {
    if (same(selectedRef.current, next)) return;
    selectedRef.current = next; setSelected(next);
  };
  const clear = () => { anchor.current = null; assign(new Set()); };
  useEffect(() => { clear(); }, [active, scope]);
  useEffect(() => {
    assign(new Set([...selectedRef.current].filter(id => ids.includes(id))));
    if (anchor.current !== null && !ids.includes(anchor.current)) anchor.current = null;
  }, [ids]);
  const select = (id: Id, toggle: boolean, range: boolean) => {
    if (latest.current.disabled) return;
    assign(selectListRange(latest.current.ids, selectedRef.current, anchor.current, id, toggle, range));
    if (!range || anchor.current === null) anchor.current = id;
  };

  useEffect(() => {
    if (!active || disabled) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const state = session.current, element = host.current;
      if (!state?.moved || !element) return;
      const bounds = element.getBoundingClientRect();
      const speed = state.clientY < bounds.top + 28 ? -14 : state.clientY > bounds.bottom - 28 ? 14 : 0;
      if (speed) element.scrollTop += speed;
      const x = Math.max(bounds.left, Math.min(bounds.right, state.clientX)) - bounds.left + element.scrollLeft;
      const y = Math.max(bounds.top, Math.min(bounds.bottom, state.clientY)) - bounds.top + element.scrollTop;
      const left = Math.min(x, state.x), top = Math.min(y, state.y), right = Math.max(x, state.x), bottom = Math.max(y, state.y);
      assign(new Set([...state.base, ...state.rows.filter(row => row.left < right && row.right > left && row.top < bottom && row.bottom > top).map(row => row.id)]));
      if (overlay.current) {
        const screenLeft = Math.max(bounds.left, left + bounds.left - element.scrollLeft);
        const screenTop = Math.max(bounds.top, top + bounds.top - element.scrollTop);
        Object.assign(overlay.current.style, { left: `${screenLeft}px`, top: `${screenTop}px`,
          width: `${Math.max(0, Math.min(bounds.right, right + bounds.left - element.scrollLeft) - screenLeft)}px`,
          height: `${Math.max(0, Math.min(bounds.bottom, bottom + bounds.top - element.scrollTop) - screenTop)}px` });
      }
      frame = requestAnimationFrame(paint);
    };
    const finish = (cancel = false) => {
      const state = session.current; session.current = null;
      cancelAnimationFrame(frame); frame = 0;
      if (state && cancel) { assign(state.before); anchor.current = state.anchor; }
      if (state && host.current?.hasPointerCapture(state.pointer)) host.current.releasePointerCapture(state.pointer);
      setDragging(false);
    };
    const move = (event: PointerEvent) => {
      const state = session.current, element = host.current;
      if (!state || !element || state.pointer !== event.pointerId) return;
      state.clientX = event.clientX; state.clientY = event.clientY;
      const bounds = element.getBoundingClientRect();
      if (!state.moved && Math.hypot(event.clientX - bounds.left + element.scrollLeft - state.x,
        event.clientY - bounds.top + element.scrollTop - state.y) < 5) return;
      state.moved = true; suppressClick.current = true; setDragging(true);
      event.preventDefault();
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = (event: PointerEvent) => {
      if (session.current?.pointer !== event.pointerId) return;
      session.current.clientX = event.clientX; session.current.clientY = event.clientY;
      if (session.current.moved) { cancelAnimationFrame(frame); paint(); }
      else assign(session.current.base);
      finish();
    };
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); window.addEventListener('keydown', key);
    return () => {
      cancel(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel); window.removeEventListener('keydown', key);
    };
  }, [active, disabled, host, scope, ids, layoutKey]);
  const begin = (event: ReactPointerEvent<HTMLElement>) => {
    if (disabled || !ids.length || event.button !== 0 || event.pointerType === 'touch' ||
      (event.target as Element).closest(`[data-selection-id], button, input, textarea, select, label, form, nav, ${excluded}`)) return;
    const element = event.currentTarget, bounds = element.getBoundingClientRect();
    const byKey = new Map(ids.map(id => [String(id), id]));
    const rows = Array.from(element.querySelectorAll<HTMLElement>('[data-selection-id]'), row => {
      const box = row.getBoundingClientRect();
      return { id: byKey.get(row.dataset.selectionId!)!, left: box.left - bounds.left + element.scrollLeft, right: box.right - bounds.left + element.scrollLeft,
        top: box.top - bounds.top + element.scrollTop, bottom: box.bottom - bounds.top + element.scrollTop };
    });
    session.current = { pointer: event.pointerId, x: event.clientX - bounds.left + element.scrollLeft,
      y: event.clientY - bounds.top + element.scrollTop, clientX: event.clientX, clientY: event.clientY,
      before: new Set(selectedRef.current), base: event.ctrlKey || event.metaKey ? new Set(selectedRef.current) : new Set(), anchor: anchor.current, moved: false, rows };
    anchor.current = null;
    event.preventDefault(); element.setPointerCapture(event.pointerId);
  };
  return { selected, select, assign, clear, begin, dragging, overlay, suppressClick };
}
