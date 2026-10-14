import type { PDFDocumentProxy } from 'pdfjs-dist';
export interface PaperPageText { page: number; text: string }
const documents = new WeakMap<PDFDocumentProxy, Promise<PaperPageText[]>>();
export function readPaperText(pdf: PDFDocumentProxy) {
  let pending = documents.get(pdf);
  if (!pending) {
    pending = (async () => {
      const pages: PaperPageText[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number), content = await page.getTextContent();
        pages.push({ page: number, text: content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim() });
      }
      return pages;
    })();
    documents.set(pdf, pending);
    void pending.catch(() => documents.delete(pdf));
  }
  return pending;
}

/** Prefer the reading position and matching passages; preserve page labels and omissions. */
export function paperContext(pages: PaperPageText[], question: string, current: number, budget = 80000) {
  const terms = [...new Set(question.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
  const chunks = pages.flatMap(page => {
    const result: { page: number; start: number; text: string; score: number }[] = [];
    for (let start = 0; start < page.text.length; start += 3500) {
      const text = page.text.slice(start, start + 3500), lower = text.toLocaleLowerCase();
      const score = terms.reduce((n, term) => n + (lower.includes(term) ? 10 : 0), 0)
        + (page.page === current ? 8 : Math.abs(page.page - current) === 1 ? 4 : page.page === 1 ? 2 : 0);
      result.push({ page: page.page, start, text, score });
    }
    return result;
  });
  const chosen: typeof chunks = []; let size = 300;
  const encoder = new TextEncoder();
  for (const chunk of [...chunks].sort((a, b) => b.score - a.score || a.page - b.page || a.start - b.start)) {
    const bytes = encoder.encode(chunk.text).length + 100;
    if (size + bytes > budget) continue;
    chosen.push(chunk); size += bytes;
  }
  if (!chosen.length) throw new Error('선택 가능한 논문 텍스트가 없습니다. 이미지 PDF의 OCR은 지원하지 않습니다.');
  const omitted = chosen.length < chunks.length;
  return `${omitted ? '관련 본문 발췌입니다. 생략된 부분이 있습니다.' : '선택 가능한 전체 본문입니다.'} 그림과 텍스트로 추출되지 않은 수식은 포함되지 않습니다.\n`
    + chosen.sort((a, b) => a.page - b.page || a.start - b.start).map(c => `[p. ${c.page}; 문자 ${c.start + 1}–${c.start + c.text.length}]\n${c.text}`).join('\n\n');
}
