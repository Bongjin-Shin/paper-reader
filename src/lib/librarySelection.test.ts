import { describe, expect, it } from 'vitest';
import { selectLibraryRange } from './useLibrarySelection';

describe('Library selection follows visible order', () => {
  it('adds/removes only the Ctrl-clicked item without changing the original set', () => {
    const before = new Set(['b']);
    expect([...selectLibraryRange(['a', 'b', 'c'], before, 'b', 'a', true, false)]).toEqual(['b', 'a']);
    expect([...selectLibraryRange(['a', 'b', 'c'], before, 'b', 'b', true, false)]).toEqual([]);
    expect([...before]).toEqual(['b']);
  });
  it('selects an inclusive range in either direction and uses the current sorted order', () => {
    expect([...selectLibraryRange(['d', 'b', 'c', 'a'], new Set(['d']), 'a', 'b', false, true)]).toEqual(['b', 'c', 'a']);
    expect([...selectLibraryRange(['a', 'b', 'c', 'd'], new Set(), 'b', 'd', false, true)]).toEqual(['b', 'c', 'd']);
  });
  it('Ctrl+Shift adds a range and a missing anchor starts with the clicked item', () => {
    expect([...selectLibraryRange(['a', 'b', 'c', 'd'], new Set(['a']), 'c', 'd', true, true)]).toEqual(['a', 'c', 'd']);
    expect([...selectLibraryRange(['a', 'b'], new Set(['a']), 'removed', 'b', false, true)]).toEqual(['b']);
  });
});
