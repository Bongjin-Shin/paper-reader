import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const key = 'reader-chat-panel-width';
export function useChatWidth(layout: RefObject<HTMLElement | null>) {
  const [preferred, setPreferred] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= 280 ? saved : Math.max(280, Math.min(410, innerWidth * .29));
  });
  const [maximum, setMaximum] = useState(Math.max(280, innerWidth - 320));
  useEffect(() => {
    const element = layout.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setMaximum(Math.max(280, element.clientWidth - 320)));
    observer.observe(element); return () => observer.disconnect();
  }, [layout]);
  useEffect(() => { localStorage.setItem(key, String(preferred)); }, [preferred]);
  const resize = useCallback((value: number) => setPreferred(Math.round(Math.max(280, Math.min(maximum, value)))), [maximum]);
  return { width: Math.min(preferred, maximum), maximum, resize, layout };
}

export function ChatResizer({ sizing }: { sizing: ReturnType<typeof useChatWidth> }) {
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(null), frame = useRef(0);
  const finish = () => {
    cancelAnimationFrame(frame.current); drag.current = null;
    sizing.layout.current?.removeAttribute('data-chat-resizing');
  };
  useEffect(() => () => { cancelAnimationFrame(frame.current); sizing.layout.current?.removeAttribute('data-chat-resizing'); }, [sizing.layout]);
  return <div className="chat-resizer" role="separator" aria-label="논문 채팅창 너비 조절" aria-orientation="vertical"
    aria-valuemin={280} aria-valuemax={sizing.maximum} aria-valuenow={sizing.width} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width: sizing.width, pointer: event.pointerId };
      sizing.layout.current?.setAttribute('data-chat-resizing', 'true');
    }} onPointerMove={event => {
      const start = drag.current; if (!start || start.pointer !== event.pointerId) return;
      const next = start.width + start.x - event.clientX;
      cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => sizing.resize(next));
    }} onPointerUp={event => {
      const start = drag.current; if (!start || start.pointer !== event.pointerId) return;
      sizing.resize(start.width + start.x - event.clientX); finish(); event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={event => {
      if (!event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); sizing.resize(sizing.width + (event.key === 'ArrowLeft' ? 20 : -20));
      }
    }} />;
}
