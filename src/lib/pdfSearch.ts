import type { PDFPageProxy } from 'pdfjs-dist';
import type { PdfRect } from '../types';

type TextItem = Extract<Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items'][number], { str: string }>;
export interface PdfSearchMatch { id: number; pageNumber: number; anchor: PdfRect; parts: { item: number; start: number; end: number }[] }
/** Keep offsets into the original text, including compatibility ligatures. */
export function searchText(raw: string) {
  let text = '';
  const offsets: { start: number; end: number }[] = [], skipped = new Set<number>();
  for (const match of raw.matchAll(/(?<=\p{L})[-\u00ad][ \t]*\n\s*(?=\p{Ll})/gu))
    for (let i = match.index; i < match.index + match[0].length; i++) skipped.add(i);
  for (let start = 0; start < raw.length;) {
    const char = String.fromCodePoint(raw.codePointAt(start)!); const end = start + char.length;
    if (!skipped.has(start) && char !== '\u00ad') for (const normalized of char.normalize('NFKC').toLowerCase()) {
      const value = /\s/u.test(normalized) ? ' ' : normalized;
      if (value === ' ' && text.endsWith(' ')) offsets[offsets.length - 1].end = end;
      else { text += value; for (let i = 0; i < value.length; i++) offsets.push({ start, end }); }
    }
    start = end;
  }
  return { text, offsets };
}
export function indexSearchPage(items: TextItem[]) {
  let raw = '';
  const spans = items.map((item, index) => {
    const prior = items[index - 1];
    if (prior && !/\s$/.test(raw) && !/^\s/.test(item.str) && Math.abs(prior.transform[5] - item.transform[5]) < 1
      && item.transform[4] - prior.transform[4] - prior.width > Math.hypot(...item.transform.slice(2, 4)) * .2) raw += ' ';
    const start = raw.length; raw += item.str; const end = raw.length;
    if (item.hasEOL) raw += '\n';
    return { start, end };
  });
  return { ...searchText(raw), spans, items };
}
export function findPageMatches(index: ReturnType<typeof indexSearchPage>, query: string, pageNumber: number): Omit<PdfSearchMatch, 'id'>[] {
  const needle = searchText(query).text.trim(), result: Omit<PdfSearchMatch, 'id'>[] = [];
  if (!needle) return result;
  for (let at = index.text.indexOf(needle); at !== -1; at = index.text.indexOf(needle, at + needle.length)) {
    const start = index.offsets[at].start, end = index.offsets[at + needle.length - 1].end;
    const parts = index.spans.flatMap((span, item) => start < span.end && end > span.start
      ? [{ item, start: Math.max(start, span.start) - span.start, end: Math.min(end, span.end) - span.start }] : []);
    if (!parts.length) continue;
    const first = parts[0], item = index.items[first.item], [a, b, c, d, x, y] = item.transform;
    const length = Math.hypot(a, b) || 1, left = item.width * first.start / Math.max(1, item.str.length), right = item.width * first.end / Math.max(1, item.str.length);
    const points = [left, right].flatMap(advance => [-.2, .85].map(up => [x + a / length * advance + c * up, y + b / length * advance + d * up]));
    result.push({ pageNumber, parts, anchor: [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))] });
  }
  return result;
}

const layers = new WeakMap<HTMLElement, HTMLElement[]>();
export const registerSearchTextLayer = (layer: HTMLElement, divs: HTMLElement[]) => layers.set(layer, divs);
export function searchClientRects(layer: HTMLElement, match: PdfSearchMatch) {
  const divs = layers.get(layer);
  return match.parts.flatMap(part => {
    const node = divs?.[part.item]?.firstChild;
    if (node?.nodeType !== Node.TEXT_NODE) return [];
    const range = document.createRange();
    range.setStart(node, Math.min(part.start, node.textContent?.length ?? 0));
    range.setEnd(node, Math.min(part.end, node.textContent?.length ?? 0));
    return [...range.getClientRects()].filter(r => r.width > .1 && r.height > .1);
  });
}
