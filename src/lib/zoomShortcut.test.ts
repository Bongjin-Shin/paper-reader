import { expect, it } from 'vitest';
import { zoomShortcut } from './usePaneZoomShortcuts';

const event = { key: '', code: '', ctrlKey: true, metaKey: false, altKey: false, isComposing: false, keyCode: 0 };
it('accepts plus, unshifted equal and number pad keys without taking IME or Alt shortcuts', () => {
  for (const key of ['+', '=']) expect(zoomShortcut({ ...event, key })).toBe(1);
  for (const key of ['-', '−', '_']) expect(zoomShortcut({ ...event, key })).toBe(-1);
  expect(zoomShortcut({ ...event, code: 'NumpadAdd' })).toBe(1);
  expect(zoomShortcut({ ...event, code: 'NumpadSubtract' })).toBe(-1);
  expect(zoomShortcut({ ...event, code: 'Numpad0' })).toBe(0);
  expect(zoomShortcut({ ...event, key: '+', isComposing: true })).toBeNull();
  expect(zoomShortcut({ ...event, key: '+', altKey: true })).toBeNull();
  expect(zoomShortcut({ ...event, key: '+', ctrlKey: false })).toBeNull();
});
