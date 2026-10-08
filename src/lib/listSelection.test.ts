import { describe, expect, it } from 'vitest';
import { selectListRange } from './useListSelection';

describe('shared list selection with numeric Vocabulary IDs', () => {
  it('plain clicking a selected item removes only it, while a new item replaces the selection', () => {
    const before = new Set([1, 2]);
    expect([...selectListRange([1, 2, 3], before, 1, 1, false, false)]).toEqual([2]);
    expect([...selectListRange([1, 2, 3], new Set([1]), 1, 1, false, false)]).toEqual([]);
    expect([...selectListRange([1, 2, 3], before, 1, 3, false, false)]).toEqual([3]);
    expect([...before]).toEqual([1, 2]);
  });
  it('keeps numeric IDs, accepts zero as an anchor and ignores an unknown item', () => {
    expect([...selectListRange([0, 7, 2], new Set<number>(), 0, 2, false, true)]).toEqual([0, 7, 2]);
    expect([...selectListRange([0, 7, 2], new Set([7]), 0, 99, true, false)]).toEqual([7]);
  });
  it('uses shuffled/filtered visible order and adds a range without selecting hidden items', () => {
    expect([...selectListRange([9, 1, 5], new Set([9]), 1, 5, true, true)]).toEqual([9, 1, 5]);
    expect([...selectListRange([9, 1, 5], new Set([9]), 1, 5, false, true)]).toEqual([1, 5]);
    expect([...selectListRange([9, 5], new Set([9]), 1, 5, false, true)]).toEqual([5]);
  });
});
