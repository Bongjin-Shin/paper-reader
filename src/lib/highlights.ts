import type { Highlight, HighlightColor } from '../types';

export const highlightColors: { value: HighlightColor; label: string; css: string }[] = [
  { value: 'yellow', label: '노랑', css: '#f5d55380' },
  { value: 'green', label: '초록', css: '#6fce8980' },
  { value: 'blue', label: '파랑', css: '#70b9ed80' },
  { value: 'pink', label: '분홍', css: '#ef91b980' },
  { value: 'purple', label: '보라', css: '#b99aed80' },
];
export const highlightCss = (color: HighlightColor) => highlightColors.find(item => item.value === color)?.css ?? highlightColors[0].css;

/** Resolve overlapping marks by their complete text length, not the clicked line's area. */
export function highlightAt(highlights: Highlight[], x: number, y: number) {
  return highlights.filter(h => h.position.rects.some(r => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]))
    .sort((a, b) => (a.position.endOffset - a.position.startOffset) - (b.position.endOffset - b.position.startOffset) || a.id - b.id)[0];
}
