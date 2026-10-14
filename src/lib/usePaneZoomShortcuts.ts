import { useEffect, useRef } from 'react';

type Zoom = { step: (direction: number) => void; reset: () => void };
type Pane = 'pdf' | 'translation' | 'chat';
type Key = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing' | 'keyCode'>;
export function zoomShortcut(event: Key): -1 | 0 | 1 | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || event.keyCode === 229) return null;
  if (['+', '='].includes(event.key) || event.code === 'NumpadAdd') return 1;
  if (['-', '−', '_'].includes(event.key) || event.code === 'NumpadSubtract') return -1;
  if (event.key === '0' || event.code === 'Numpad0') return 0;
  return null;
}
function pane(target: EventTarget | null): Pane | null {
  if (!(target instanceof Element) || !target.isConnected || target.closest('[hidden], [inert], .reader-inactive')) return null;
  if (target.closest('.chat-container')) return 'chat';
  if (target.closest('.translation-page, .reader-navigation')) return 'translation';
  if (target.closest('.reader, .zoom-controls')) return 'pdf';
  return null;
}

/** One keyboard handler prevents both browser zoom and two panes handling the same key. */
export function usePaneZoomShortcuts(enabled: boolean, pdf: Zoom, translation: Zoom, chat: Zoom) {
  const actions = useRef({ pdf, translation, chat }); actions.current = { pdf, translation, chat };
  useEffect(() => {
    if (!enabled) return;
    let hovered: EventTarget | null = null, interacted: EventTarget | null = null;
    const move = (event: PointerEvent) => { hovered = event.target; };
    const focus = (event: Event) => { if (pane(event.target)) interacted = event.target; };
    const keydown = (event: KeyboardEvent) => {
      const direction = zoomShortcut(event);
      if (event.defaultPrevented || direction === null || document.querySelector('[role="dialog"], .print-preview')) return;
      const focused = document.activeElement;
      const editing = focused?.matches('input, textarea, select, [contenteditable="true"]');
      // Keep an active chat draft's keyboard controls in chat; otherwise follow the pointer.
      const destination = (editing ? pane(focused) : null) ?? pane(hovered) ?? pane(event.target) ?? pane(interacted) ?? 'pdf';
      event.preventDefault(); event.stopPropagation();
      if (direction === 0) actions.current[destination].reset();
      else actions.current[destination].step(direction);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', focus);
    window.addEventListener('focusin', focus);
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerdown', focus);
      window.removeEventListener('focusin', focus); window.removeEventListener('keydown', keydown);
    };
  }, [enabled]);
}
