import type { PageViewport } from 'pdfjs-dist';
import type { PdfRect, WordSelection } from '../types';

const englishWord = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/;
const wordCharacter = /[A-Za-z'’-]/;
const rounded = (value: number) => Math.round(value * 100) / 100;

export function contextAt(text: string, start: number, end: number): string {
  let left = start;
  let right = end;
  while (left > 0 && start - left < 700) {
    if (/[.!?]/.test(text[left - 1]) && /\s/.test(text[left] ?? '')) break;
    left--;
  }
  while (right < text.length && right - end < 700) {
    if (/[.!?]/.test(text[right]) && (right + 1 === text.length || /\s/.test(text[right + 1]))) {
      right++;
      break;
    }
    right++;
  }
  return text.slice(left, right).replace(/\s+/g, ' ').trim();
}

export function rectToPdf(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
  layer: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, viewport: PageViewport): PdfRect {
  const xScale = viewport.width / layer.width;
  const yScale = viewport.height / layer.height;
  const [x1, y1] = viewport.convertToPdfPoint((rect.left - layer.left) * xScale, (rect.top - layer.top) * yScale);
  const [x2, y2] = viewport.convertToPdfPoint((rect.right - layer.left) * xScale, (rect.bottom - layer.top) * yScale);
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)].map(rounded) as PdfRect;
}

export function pdfToStyle(rect: PdfRect, viewport: PageViewport) {
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

const viewports = new WeakMap<HTMLDivElement, PageViewport>();
export const registerTextLayer = (layer: HTMLDivElement, viewport: PageViewport) => viewports.set(layer, viewport);
export const isSingleEnglishWord = (text: string) => text.length <= 100 && englishWord.test(text);

/** Preserve PDF.js text items and explicit line breaks, including split font runs. */
export function indexText(layer: HTMLDivElement) {
  const nodes: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let text = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      const start = text.length;
      text += node.textContent ?? '';
      nodes.push({ node: node as Text, start, end: text.length });
    } else if (node.nodeName === 'BR') text += '\n';
  }
  return { text, nodes };
}

export function restoreTextSelection(selection: WordSelection) {
  const first = selection.segments[0];
  const last = selection.segments.at(-1)!;
  const find = (pageNumber: number, offset: number, end: boolean) => {
    const layer = document.querySelector<HTMLDivElement>(`.pdf-page[data-page-number="${pageNumber}"] .textLayer`);
    if (!layer) return null;
    const items = indexText(layer).nodes;
    const item = end ? items.find(item => offset > item.start && offset <= item.end)
      : items.find(item => offset >= item.start && offset < item.end);
    return item ? { node: item.node, offset: offset - item.start } : null;
  };
  const start = find(first.pageNumber, first.startOffset, false);
  const end = find(last.pageNumber, last.endOffset, true);
  if (start && end) {
    const range = document.createRange();
    range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
  }
}

export function readWordSelection(layer: HTMLDivElement, viewport: PageViewport, pageNumber: number): WordSelection | null {
  return readSelection(layer, viewport, pageNumber, 'word');
}
export function readDragSelection(layer: HTMLDivElement, viewport: PageViewport, pageNumber: number): WordSelection | null {
  return readSelection(layer, viewport, pageNumber, 'drag');
}

function boundaryOffset(container: Node, offset: number, nodes: ReturnType<typeof indexText>['nodes']): number {
  const item = nodes.find(item => item.node === container);
  if (item) return item.start + offset;
  // Triple-click selections may end on a span/BR parent rather than a Text node.
  const point = document.createRange();
  point.setStart(container, offset); point.collapse(true);
  let result = 0;
  for (const item of nodes) {
    if (point.comparePoint(item.node, item.node.length) <= 0) result = item.end;
    else return item.start;
  }
  return result;
}

function readSelection(layer: HTMLDivElement, viewport: PageViewport, pageNumber: number, mode: 'word' | 'drag'): WordSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const containingLayer = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLDivElement>('.textLayer');
  const startLayer = containingLayer(range.startContainer);
  const endLayer = containingLayer(range.endContainer);
  if (!startLayer || !endLayer || (mode === 'word' && startLayer !== endLayer)) return null;
  const focusAtStart = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
  if (mode === 'word' && range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = range.startContainer.textContent ?? '';
    let start = range.startOffset;
    let end = range.endOffset;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    while (start > 0 && wordCharacter.test(text[start - 1])) start--;
    while (end < text.length && wordCharacter.test(text[end])) end++;
    while (start < end && /['’-]/.test(text[start])) start++;
    while (end > start && /['’-]/.test(text[end - 1])) end--;
    range.setStart(range.startContainer, start); range.setEnd(range.endContainer, end);
  }
  const layers = [...document.querySelectorAll<HTMLDivElement>('.pdf-page .textLayer')];
  const selectedLayers = layers.slice(layers.indexOf(startLayer), layers.indexOf(endLayer) + 1);
  const segments: WordSelection['segments'] = [];
  let selectedText = '';
  let before = '';
  let after = '';
  for (const current of selectedLayers) {
    const indexed = indexText(current);
    let start = current === startLayer ? boundaryOffset(range.startContainer, range.startOffset, indexed.nodes) : 0;
    let end = current === endLayer ? boundaryOffset(range.endContainer, range.endOffset, indexed.nodes) : indexed.text.length;
    while (start < end && /\s/.test(indexed.text[start])) start++;
    while (end > start && /\s/.test(indexed.text[end - 1])) end--;
    if (current === startLayer) before = indexed.text.slice(0, start);
    if (current === endLayer) after = indexed.text.slice(end);
    selectedText += (selectedText ? '\n' : '') + indexed.text.slice(start, end);
    const currentViewport = viewports.get(current) ?? (current === layer ? viewport : null);
    if (!currentViewport || !indexed.nodes.length || end <= start) continue;
    const first = indexed.nodes.find(item => start >= item.start && start < item.end);
    const last = indexed.nodes.find(item => end > item.start && end <= item.end);
    if (!first || !last) return null;
    const part = document.createRange();
    part.setStart(first.node, start - first.start); part.setEnd(last.node, end - last.start);
    const host = current.parentElement!.getBoundingClientRect();
    const rects = [...part.getClientRects()].filter(rect => rect.width > .5 && rect.height > .5)
      .map(rect => rectToPdf(rect, host, currentViewport));
    // A Range spanning spans can report identical rectangles for both element and text.
    const unique = rects.filter((rect, index) => rects.findIndex(other => other.every((value, i) => value === rect[i])) === index);
    segments.push({ pageNumber: Number(current.closest<HTMLElement>('.pdf-page')?.dataset.pageNumber ?? pageNumber),
      startOffset: start, endOffset: end, rects: unique });
  }
  if (!selectedText.trim() || !segments.length || segments.some(segment => !segment.rects.length)) return null;
  const single = segments.length === 1 && isSingleEnglishWord(selectedText);
  if (mode === 'word' && !single) return null;
  const focus = focusAtStart ? segments[0] : segments.at(-1)!;
  const focusLayer = focusAtStart ? startLayer : endLayer;
  const focusViewport = viewports.get(focusLayer) ?? viewport;
  const anchorPdfRect = focusAtStart ? focus.rects[0] : focus.rects.at(-1)!;
  const box = pdfToStyle(anchorPdfRect, focusViewport);
  const origin = focusLayer.parentElement!.getBoundingClientRect();
  const context = before + selectedText + after;
  const result: WordSelection = { word: selectedText, isSingleWord: single,
    originalSentence: contextAt(context, before.length, before.length + selectedText.length),
    pageNumber: segments[0].pageNumber,
    position: { version: 1, rects: segments[0].rects, startOffset: segments[0].startOffset, endOffset: segments[0].endOffset },
    segments, anchorPageNumber: focus.pageNumber, anchorPdfRect,
    anchor: { left: origin.left + box.left, top: origin.top + box.top, bottom: origin.top + box.top + box.height, width: box.width } };
  restoreTextSelection(result);
  return result;
}
