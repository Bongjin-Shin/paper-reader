import { useLayoutEffect, type RefObject } from 'react';

/** Grow with wrapped lines; CSS supplies the minimum and maximum height. */
export function useAutoSizeTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string, scale = 1) {
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const resize = () => {
      if (!input.clientWidth) return;
      const scroll = input.scrollTop, style = getComputedStyle(input);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight + border}px`;
      input.scrollTop = document.activeElement === input && input.selectionEnd === value.length ? input.scrollHeight : scroll;
    };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) { width = input.clientWidth; resize(); }
    });
    observer.observe(input);
    window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, [ref, value, scale]);
}
