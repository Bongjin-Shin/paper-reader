import { useEffect, useRef, useState, type ReactNode } from 'react';

const key = 'reader-translation-panel-width';
export function TranslationPane({ active, children }: { active: boolean; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return saved >= 240 && Number.isFinite(saved) ? saved : Math.max(280, Math.min(440, innerWidth * .31));
  });
  const widthRef = useRef(width);
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(null);
  const frame = useRef(0);
  const limits = () => {
    const parent = host.current?.parentElement;
    const chatWidth = parent?.querySelector<HTMLElement>('.chat-container:not([hidden])')?.getBoundingClientRect().width ?? 0;
    return { min: 240, max: Math.max(240, (parent?.clientWidth ?? innerWidth) - chatWidth - 266) };
  };
  const apply = (value: number, commit = false) => {
    const { min, max } = limits();
    const next = Math.round(Math.max(min, Math.min(max, value)));
    widthRef.current = next;
    if (host.current) host.current.style.flexBasis = `${next}px`;
    handle.current?.setAttribute('aria-valuenow', String(next));
    handle.current?.setAttribute('aria-valuemax', String(max));
    if (commit) { setWidth(next); localStorage.setItem(key, String(next)); }
  };
  const finish = () => {
    cancelAnimationFrame(frame.current); frame.current = 0;
    drag.current = null; host.current?.removeAttribute('data-resizing'); apply(widthRef.current, true);
  };
  useEffect(() => {
    const parent = host.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => apply(widthRef.current, true)); observer.observe(parent);
    const reader = parent.querySelector('.reader'); if (reader) observer.observe(reader);
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); };
  }, []);
  return <div ref={host} className={active ? 'translation-container' : 'translation-inactive'}
    style={{ flexBasis: width }} inert={!active} aria-hidden={!active}>
    <div ref={handle} className="translation-resizer" role="separator" aria-label="번역창 너비 조절" aria-orientation="vertical"
      aria-valuemin={240} aria-valuemax={limits().max} aria-valuenow={width} tabIndex={0}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: host.current!.getBoundingClientRect().width, pointer: event.pointerId };
        host.current!.dataset.resizing = 'true';
      }} onPointerMove={event => {
        const start = drag.current; if (!start || start.pointer !== event.pointerId) return;
        const next = start.width + start.x - event.clientX;
        cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => apply(next));
      }} onPointerUp={event => {
        const start = drag.current; if (!start) return;
        apply(start.width + start.x - event.clientX); finish(); event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={finish} onLostPointerCapture={() => { if (drag.current) finish(); }}
      onKeyDown={event => {
        if (!event.altKey && !event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault(); apply(widthRef.current + (event.key === 'ArrowLeft' ? 20 : -20), true);
        }
      }} />
    {children}
  </div>;
}
