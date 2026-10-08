import type { Highlight, HighlightColor, WordSelection } from '../types';

export const highlightColors: { value: HighlightColor; label: string; css: string }[] = [
  { value: 'yellow', label: '노랑', css: '#f5d55380' },
  { value: 'green', label: '초록', css: '#6fce8980' },
  { value: 'blue', label: '파랑', css: '#70b9ed80' },
  { value: 'pink', label: '분홍', css: '#ef91b980' },
  { value: 'purple', label: '보라', css: '#b99aed80' },
];
export const highlightCss = (color: HighlightColor) => highlightColors.find(item => item.value === color)?.css ?? highlightColors[0].css;

export function selectedHighlightIds(highlights: Highlight[], selection: WordSelection) {
  return highlights.filter(highlight => selection.segments.some(segment => segment.pageNumber === highlight.pageNumber &&
    segment.startOffset < highlight.position.endOffset && segment.endOffset > highlight.position.startOffset)).map(h => h.id);
}
