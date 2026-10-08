import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export type LibraryDragItem = { kind: 'folder'; id: number; label: string } | { kind: 'paper'; ids: string[]; label: string };

/** Pointer-based movement also works when Tauri owns native file drag/drop. No native drag session is started. */
export function useLibraryDrag(active: boolean, disabled: boolean,
  canDrop: (item: LibraryDragItem, target: number | null) => boolean,
  move: (item: LibraryDragItem, target: number | null) => void,
  onStart?: (item: LibraryDragItem) => void) {
  const [item, setItem] = useState<LibraryDragItem | null>(null);
  const [target, setTarget] = useState<number | null | undefined>(undefined);
  const ghost = useRef<HTMLDivElement>(null), suppressClick = useRef(false);
  const current = useRef<{ item: LibraryDragItem; x: number; y: number; pointer: number; element: HTMLElement; dragging: boolean } | null>(null);
  const handlers = useRef({ canDrop, move, onStart }); handlers.current = { canDrop, move, onStart };
  useEffect(() => {
    if (!active || disabled) return;
    let frame = 0, x = 0, y = 0;
    const hit = () => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-folder-drop]');
      if (!element || !current.current) return undefined;
      const id = element.dataset.folderDrop === 'root' ? null : Number(element.dataset.folderDrop);
      return handlers.current.canDrop(current.current.item, id) ? id : undefined;
    };
    const paint = () => {
      frame = 0;
      if (!current.current?.dragging) return;
      if (ghost.current) ghost.current.style.transform = `translate(${Math.min(x + 14, window.innerWidth - 210)}px, ${Math.min(y + 14, window.innerHeight - 40)}px)`;
      setTarget(hit());
    };
    const reset = () => {
      const drag = current.current;
      current.current = null;
      if (drag?.element.hasPointerCapture(drag.pointer)) drag.element.releasePointerCapture(drag.pointer);
      cancelAnimationFrame(frame); frame = 0;
      setItem(null); setTarget(undefined);
    };
    const onMove = (event: PointerEvent) => {
      const drag = current.current;
      if (!drag || event.pointerId !== drag.pointer) return;
      x = event.clientX; y = event.clientY;
      if (!drag.dragging && Math.hypot(x - drag.x, y - drag.y) < 7) return;
      if (!drag.dragging) {
        drag.dragging = true; suppressClick.current = true;
        handlers.current.onStart?.(drag.item);
        drag.element.setPointerCapture(drag.pointer); setItem(drag.item);
      }
      event.preventDefault();
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onUp = (event: PointerEvent) => {
      const drag = current.current;
      if (!drag || event.pointerId !== drag.pointer) return;
      x = event.clientX; y = event.clientY;
      const destination = drag.dragging ? hit() : undefined;
      reset();
      if (destination !== undefined) handlers.current.move(drag.item, destination);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('keydown', key);
    return () => {
      reset();
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', reset); window.removeEventListener('blur', reset); window.removeEventListener('keydown', key);
    };
  }, [active, disabled]);
  const begin = (event: ReactPointerEvent<HTMLElement>, item: LibraryDragItem) => {
    if (disabled || event.button !== 0 || event.pointerType === 'touch') return;
    suppressClick.current = false;
    current.current = { item, x: event.clientX, y: event.clientY, pointer: event.pointerId, element: event.currentTarget, dragging: false };
  };
  return { item, target, ghost, begin, suppressClick };
}
