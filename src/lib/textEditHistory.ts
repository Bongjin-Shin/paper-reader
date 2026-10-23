export interface TextSnapshot {
  value: string; start: number; end: number; direction: 'forward' | 'backward' | 'none';
}
const snapshot = (value: string): TextSnapshot => ({ value, start: value.length, end: value.length, direction: 'none' });
type Edit = { before: TextSnapshot; after: TextSnapshot };
const sameSelection = (a: TextSnapshot, b: TextSnapshot) => a.start === b.start && a.end === b.end && a.direction === b.direction;

/** Draft-only history: sending/loading a value starts a new editing session. */
export class TextEditHistory {
  current: TextSnapshot;
  private undoStack: Edit[] = [];
  private redoStack: Edit[] = [];
  private group = '';
  private changedAt = 0;
  constructor(value = '') { this.current = snapshot(value); }
  sync(value: string) {
    if (value === this.current.value) return;
    this.current = snapshot(value); this.undoStack = []; this.redoStack = []; this.group = '';
  }
  select(state: TextSnapshot) {
    if (state.value !== this.current.value) return;
    if (!sameSelection(state, this.current)) this.group = '';
    this.current = state;
  }
  record(before: TextSnapshot, after: TextSnapshot, inputType = '', now = Date.now()) {
    if (before.value === after.value) { this.select(after); return; }
    this.sync(before.value);
    const last = this.undoStack.at(-1);
    const continuous = /^(?:insertText|deleteContentBackward|deleteContentForward)$/.test(inputType)
      && after.start === after.end && !after.value.slice(before.start, after.start).includes('\n');
    if (continuous && this.group === inputType && now - this.changedAt < 750 && last
      && before.start === before.end && last.after.value === before.value && sameSelection(last.after, before)) last.after = after;
    else { this.undoStack.push({ before, after }); if (this.undoStack.length > 100) this.undoStack.shift(); }
    this.current = after; this.redoStack = []; this.group = continuous ? inputType : ''; this.changedAt = now;
  }
  move(redo: boolean, selection: TextSnapshot): TextSnapshot | undefined {
    this.select(selection); this.group = '';
    const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack;
    const edit = from.pop(); if (!edit) return;
    to.push(edit); this.current = redo ? edit.after : edit.before;
    return this.current;
  }
}
