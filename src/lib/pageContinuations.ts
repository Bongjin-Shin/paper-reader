import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSentence } from '../types';
import { extractPageSentences } from './pageTranslation';

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<SourceSentence[]>>>();
function read(pdf: PDFDocumentProxy, page: number) {
  let pages = cache.get(pdf);
  if (!pages) { pages = new Map(); cache.set(pdf, pages); }
  let result = pages.get(page);
  if (!result) {
    result = extractPageSentences(pdf, page); pages.set(page, result);
    void result.catch(() => pages!.delete(page));
    if (pages.size > 8) pages.delete(pages.keys().next().value!);
  }
  return result;
}
// Headings, captions and page numbers do not continue body prose across a page.
export function bodyEdges(sentences: SourceSentence[]) {
  const body = sentences.filter(s => (!s.layout || s.layout.kind === 'paragraph')
    && /[\p{L}]{2}/u.test(s.text) && !/^(?:Fig(?:ure)?\.?|Table)\s*\d/i.test(s.text));
  return { first: body[0], last: body.at(-1) };
}
export function continues(left?: SourceSentence, right?: SourceSentence) {
  if (!left || !right) return false;
  const end = left.text.trim();
  const abbreviation = /\b(?:Fig|Eq|Sec|Ref|Dr|Prof|No|et al|e\.g|i\.e)\.$/i.test(end);
  return (!/[.!?。！？]["'”’\])]*$/.test(end) || abbreviation)
    && !/[:;]$/.test(end) && !/^\d+(?:\.\d+)*\s+[A-Z]/.test(right.text);
}
export function joinContinuation(parts: SourceSentence[], local: SourceSentence): SourceSentence {
  const text = parts.map(p => p.text).reduce((a, b) => a.endsWith('\u00ad') ? a.slice(0, -1) + b : a.endsWith('-') ? a + b : a + ' ' + b);
  return { ...local, text, layout: { ...local.layout, paragraph: local.layout?.paragraph ?? local.id, kind: 'paragraph',
    math: parts.flatMap(p => p.layout?.math ?? []), sources: parts.flatMap(p => p.layout?.sources ?? []) } };
}

export async function extractPageWithContinuations(pdf: PDFDocumentProxy, number: number, fresh = false) {
  if (fresh) cache.delete(pdf);
  const local = await read(pdf, number), edges = bodyEdges(local);
  const output = [...local];
  for (const sentence of new Set([edges.first, edges.last])) {
    if (!sentence) continue;
    const parts = [sentence];
    if (sentence === edges.first) for (let page = number - 1; page >= 1; page--) {
      const previous = bodyEdges(await read(pdf, page).catch(() => []));
      if (!continues(previous.last, parts[0])) break;
      parts.unshift(previous.last!);
      if (previous.first !== previous.last) break;
      if (parts.reduce((n, s) => n + s.text.length, 0) > 20000) throw new Error('페이지에 걸친 문장이 너무 깁니다. 필요한 부분을 선택해 번역해 주세요.');
    }
    if (sentence === edges.last) for (let page = number + 1; page <= pdf.numPages; page++) {
      const next = bodyEdges(await read(pdf, page).catch(() => []));
      if (!continues(parts.at(-1), next.first)) break;
      parts.push(next.first!);
      if (next.first !== next.last) break;
      if (parts.reduce((n, s) => n + s.text.length, 0) > 20000) throw new Error('페이지에 걸친 문장이 너무 깁니다. 필요한 부분을 선택해 번역해 주세요.');
    }
    if (parts.length > 1) output[sentence.id] = joinContinuation(parts, sentence);
  }
  return output;
}
