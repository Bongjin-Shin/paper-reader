import { useLayoutEffect, useRef, type ChangeEvent, type CompositionEvent, type KeyboardEvent, type RefObject } from 'react';
import { TextEditHistory, type TextSnapshot } from './textEditHistory';

const read = (input: HTMLTextAreaElement): TextSnapshot => ({ value: input.value, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection });

/** Explicit shortcuts also work with Korean IME and WebKit's redo key mapping. */
export function useTextUndo(ref: RefObject<HTMLTextAreaElement | null>, value: string, onValue: (value: string) => void,
  history: TextEditHistory, active = true) {
  const composing = useRef<TextSnapshot | null>(null), restore = useRef<TextSnapshot | null>(null);
  const change = useRef(onValue); change.current = onValue;
  useLayoutEffect(() => {
    if (!composing.current) history.sync(value);
    const input = ref.current, selection = restore.current;
    if (input && selection?.value === value) {
      input.setSelectionRange(selection.start, selection.end, selection.direction); restore.current = null;
    }
  }, [history, value, active, ref]);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input || !active) return;
    const before = (event: InputEvent) => {
      if (event.isComposing || composing.current) return;
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        if (!event.cancelable) return;
        event.preventDefault(); apply(event.inputType === 'historyRedo');
      } else if (!composing.current) history.select(read(input));
    };
    input.addEventListener('beforeinput', before);
    return () => { input.removeEventListener('beforeinput', before); composing.current = null; restore.current = null; };
  }, [history, active, ref]);
  const apply = (redo: boolean) => {
    const input = ref.current; if (!input || input.disabled || input.readOnly || composing.current) return;
    const state = history.move(redo, read(input)); if (!state) return;
    restore.current = state; change.current(state.value);
  };
  return {
    onChange(event: ChangeEvent<HTMLTextAreaElement>) {
      const after = read(event.currentTarget);
      if (!composing.current) history.record(history.current, after, (event.nativeEvent as InputEvent).inputType);
      onValue(after.value);
    },
    onSelect() { if (!composing.current && ref.current) history.select(read(ref.current)); },
    onCompositionStart(event: CompositionEvent<HTMLTextAreaElement>) { composing.current = read(event.currentTarget); },
    onCompositionEnd(event: CompositionEvent<HTMLTextAreaElement>) {
      const after = read(event.currentTarget), before = composing.current; composing.current = null;
      if (before) history.record(before, after, 'composition');
      onValue(after.value);
    },
    onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return false;
      history.select(read(event.currentTarget));
      if (!(event.ctrlKey || event.metaKey) || event.altKey || (event.key.toLowerCase() !== 'z' && event.code !== 'KeyZ')) return false;
      event.preventDefault(); event.stopPropagation(); apply(event.shiftKey); return true;
    },
  };
}
