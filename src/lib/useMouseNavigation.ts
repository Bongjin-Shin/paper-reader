import { useEffect, useRef } from 'react';

/** Side buttons 3/4 are Browser Back/Forward. Consume the WebView default; navigate once on release. */
export function useMouseNavigation(back: () => void, forward: () => void) {
  const callbacks = useRef({ back, forward });
  callbacks.current = { back, forward };
  useEffect(() => {
    const handledByPointer = new Set<number>();
    const isNavigation = (event: MouseEvent) => event.button === 3 || event.button === 4;
    const navigate = (event: MouseEvent) => event.button === 3 ? callbacks.current.back() : callbacks.current.forward();
    const consume = (event: MouseEvent) => {
      if (!isNavigation(event)) return;
      event.preventDefault(); event.stopPropagation();
    };
    const press = (event: MouseEvent) => {
      if (!isNavigation(event)) return;
      handledByPointer.delete(event.button); consume(event);
    };
    const pointerRelease = (event: PointerEvent) => {
      if (!isNavigation(event)) return;
      handledByPointer.add(event.button);
      consume(event); navigate(event);
    };
    const mouseRelease = (event: MouseEvent) => {
      if (!isNavigation(event)) return;
      consume(event);
      if (!handledByPointer.has(event.button)) navigate(event);
    };
    // Disabled form controls suppress mouse events in Chromium, but still dispatch pointer events.
    // WebKit may deliver only mouse events for side buttons despite exposing PointerEvent.
    // Fall back for that actual event sequence, without firing twice for compatibility events.
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', pointerRelease, true);
    window.addEventListener('mousedown', press, true);
    window.addEventListener('mouseup', mouseRelease, true);
    window.addEventListener('auxclick', consume, true);
    return () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', pointerRelease, true);
      window.removeEventListener('mousedown', press, true);
      window.removeEventListener('mouseup', mouseRelease, true);
      window.removeEventListener('auxclick', consume, true);
    };
  }, []);
}
