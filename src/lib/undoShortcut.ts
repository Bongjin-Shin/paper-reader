/** Text editors and IME keep their native undo history. */
export function undoShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'keyCode' | 'repeat'>,
  target: EventTarget | null): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || event.keyCode === 229 || event.repeat || event.key.toLowerCase() !== 'z') return null;
  if (target instanceof Element && target.closest('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return null;
  return event.shiftKey ? 'redo' : 'undo';
}
