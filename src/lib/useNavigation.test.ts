import { describe, it, expect } from 'vitest';
import { initialNavigation, navigationReducer as reduce } from './useNavigation';

describe('app back and forward navigation', () => {
  it('ignores repeated destinations and stops at the first screen', () => {
    expect(reduce(initialNavigation, { type: 'back' })).toBe(initialNavigation);
    expect(reduce(initialNavigation, { type: 'forward' })).toBe(initialNavigation);
    expect(reduce(initialNavigation, { type: 'view', view: 'reader' })).toBe(initialNavigation);
    const library = reduce(initialNavigation, { type: 'view', view: 'library' });
    expect(reduce(library, { type: 'folder', folderId: null })).toBe(library);
    expect(reduce(library, { type: 'back' })).toEqual({ ...initialNavigation, future: [library.current] });
    expect(reduce(reduce(library, { type: 'back' }), { type: 'forward' })).toEqual(library);
  });
  it('goes back through screens and folder visits in order, including a library-opened Reader', () => {
    let state = reduce(initialNavigation, { type: 'view', view: 'library' });
    state = reduce(state, { type: 'folder', folderId: 1 });
    state = reduce(state, { type: 'folder', folderId: 2 });
    state = reduce(state, { type: 'view', view: 'reader' });
    state = reduce(state, { type: 'view', view: 'vocabulary' });
    for (const [view, folderId] of [['reader', 2], ['library', 2], ['library', 1], ['library', null], ['reader', null]]) {
      state = reduce(state, { type: 'back' });
      expect(state.current).toEqual({ view, folderId });
    }
    expect(state.history).toEqual([]);
  });
  it('skips deleted folder visits and removes repeated destinations after deletion', () => {
    let state = reduce(initialNavigation, { type: 'view', view: 'library' });
    state = reduce(state, { type: 'folder', folderId: 1 });
    state = reduce(state, { type: 'folder', folderId: 2 });
    state = reduce(state, { type: 'folder', folderId: null });
    state = reduce(state, { type: 'folders', ids: [] });
    expect(state.history).toEqual([initialNavigation.current]);
    expect(reduce(state, { type: 'back' }).current).toEqual(initialNavigation.current);
    const missing = reduce(reduce(initialNavigation, { type: 'folder', folderId: 3 }), { type: 'folders', ids: [] });
    expect(missing.current).toEqual({ view: 'library', folderId: null });
    expect(reduce(missing, { type: 'folders', ids: [] })).toBe(missing);
  });
  it('round-trips screen and folder history one visit at a time', () => {
    let state = reduce(initialNavigation, { type: 'folder', folderId: 1 });
    state = reduce(state, { type: 'folder', folderId: 2 });
    state = reduce(state, { type: 'view', view: 'reader' });
    state = reduce(state, { type: 'view', view: 'vocabulary' });
    const last = state;
    for (let i = 0; i < 4; i++) state = reduce(state, { type: 'back' });
    expect(reduce(state, { type: 'back' })).toBe(state);
    for (const [view, folderId] of [['library', 1], ['library', 2], ['reader', 2], ['vocabulary', 2]]) {
      state = reduce(state, { type: 'forward' });
      expect(state.current).toEqual({ view, folderId });
    }
    expect(state).toEqual(last);
    expect(reduce(state, { type: 'forward' })).toBe(state);
  });
  it('retains forward visits for no-op navigation and resets them on a new branch', () => {
    const library = reduce(initialNavigation, { type: 'folder', folderId: 1 });
    const vocabulary = reduce(library, { type: 'view', view: 'vocabulary' });
    const back = reduce(vocabulary, { type: 'back' });
    expect(reduce(back, { type: 'folder', folderId: 1 })).toBe(back);
    expect(reduce(back, { type: 'view', view: 'library' })).toBe(back);
    expect(reduce(back, { type: 'folders', ids: [1] })).toBe(back);
    const branch = reduce(back, { type: 'folder', folderId: 2 });
    expect(branch.future).toEqual([]);
    expect(reduce(branch, { type: 'forward' })).toBe(branch);
    expect(reduce(branch, { type: 'back' }).current).toEqual(library.current);
  });
  it('prunes deleted folders from forward visits and normalizes remembered folder IDs', () => {
    let state = reduce(initialNavigation, { type: 'view', view: 'library' });
    state = reduce(state, { type: 'folder', folderId: 1 });
    state = reduce(state, { type: 'folder', folderId: 2 });
    state = reduce(state, { type: 'view', view: 'reader' });
    state = reduce(state, { type: 'folder', folderId: 2 });
    state = reduce(state, { type: 'view', view: 'reader' });
    for (let i = 0; i < 5; i++) state = reduce(state, { type: 'back' });
    state = reduce(state, { type: 'folders', ids: [] });
    expect(state.current).toEqual({ view: 'library', folderId: null });
    expect(state.future).toEqual([{ view: 'reader', folderId: null }]);
    state = reduce(state, { type: 'forward' });
    expect(state.current).toEqual(initialNavigation.current);
    expect(state.future).toEqual([]);
    expect(reduce(state, { type: 'folders', ids: [] })).toBe(state);
  });
});
