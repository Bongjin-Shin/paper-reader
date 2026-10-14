import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export type SelectOption = { value: string; label: string };
type Props = {
  label: string; title?: string; value: string; options: SelectOption[];
  disabled?: boolean; onChange: (value: string) => void;
};

/** Native select popups choose their own direction in WebView. Keep these above the composer. */
export function UpwardSelect({ label, title, value, options, disabled, onChange }: Props) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 220, maxHeight: 0 });
  const search = useRef({ text: '', time: 0 });
  const selected = options.findIndex(option => option.value === value);
  const expanded = open && !disabled && options.length > 0;
  const show = () => { setActive(Math.max(0, selected)); search.current.text = ''; setOpen(true); };
  const choose = (index: number) => {
    const option = options[index]; if (!option) return;
    setOpen(false); trigger.current?.focus({ preventScroll: true });
    if (option.value !== value) onChange(option.value);
  };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - rect.top + 6, width, maxHeight: Math.max(0, Math.min(300, rect.top - 14)) });
    };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place(); };
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    place();
    const observer = new ResizeObserver(place); if (trigger.current) observer.observe(trigger.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', scroll, true);
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => {
      observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true);
      document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside);
    };
  }, [expanded]);
  useLayoutEffect(() => {
    if (!expanded || !menu.current) return;
    const item = menu.current.children[active] as HTMLElement | undefined; if (!item) return;
    const list = menu.current;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }, [active, expanded, position.maxHeight]);
  const keydown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing || !options.length) return;
    if (event.key === 'Escape' || (event.altKey && event.key === 'ArrowUp')) {
      if (expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      return;
    }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!expanded) { show(); return; }
      if (event.key === 'Enter' || event.key === ' ') choose(active);
      else setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now(), letter = event.key.toLocaleLowerCase();
      const text = now - search.current.time < 700 ? search.current.text + letter : letter;
      search.current = { text, time: now };
      const prefix = [...text].every(char => char === letter) ? letter : text;
      const start = expanded ? active : Math.max(0, selected);
      const match = Array.from({ length: options.length }, (_, i) => (start + (prefix.length === 1 ? i + 1 : i)) % options.length)
        .find(index => options[index].label.toLocaleLowerCase().startsWith(prefix));
      setOpen(true); if (match !== undefined) setActive(match);
    }
  };
  return <>
    <button ref={trigger} type="button" role="combobox" className="upward-select-trigger" aria-label={label}
      title={title ?? label} data-value={value} disabled={disabled || !options.length}
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? id : undefined}
      aria-activedescendant={expanded ? `${id}-${active}` : undefined} onKeyDown={keydown}
      onClick={() => expanded ? setOpen(false) : show()}>
      <span>{options[selected]?.label ?? label}</span><span className="upward-select-chevron" aria-hidden="true">⌃</span>
    </button>
    {expanded && createPortal(<div ref={menu} id={id} role="listbox" aria-label={label} className="upward-select-menu"
      style={position} onPointerDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option"
        aria-selected={option.value === value} className={index === active ? 'active' : undefined}
        onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span>{option.label}</span><span aria-hidden="true">{option.value === value ? '✓' : ''}</span>
      </div>)}
    </div>, document.body)}
  </>;
}
