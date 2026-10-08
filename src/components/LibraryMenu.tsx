import { useLayoutEffect, useRef } from 'react';

export function LibraryMenu({ x, y, items, onClose }: {
  x: number; y: number; items: { label: string; run: () => void; danger?: boolean }[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
    menu.querySelector('button')?.focus();
    const outside = (event: Event) => { if (!menu.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); previous?.focus(); }
      else if (event.key === 'Tab') onClose();
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const buttons = [...menu.querySelectorAll('button')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', outside, true); window.addEventListener('resize', onClose); window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', outside, true); window.removeEventListener('resize', onClose); window.removeEventListener('blur', onClose);
    };
  }, [x, y, onClose]);
  return <div ref={ref} className="library-context-menu" role="menu" aria-label="Library 항목 작업"
    onContextMenu={event => event.preventDefault()}>{items.map(item =>
    <button key={item.label} role="menuitem" className={item.danger ? 'library-delete' : ''} onClick={() => { onClose(); item.run(); }}>{item.label}</button>)}
  </div>;
}
