import { expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSentence } from '../types';
vi.mock('./pageTranslation', () => ({ extractPageSentences: vi.fn() }));
import { extractPageSentences } from './pageTranslation';
import { continues, extractPageWithContinuations } from './pageContinuations';

const sentence = (id: number, text: string, kind: 'paragraph' | 'heading' = 'paragraph'): SourceSentence => ({ id, text, rects: [[10, 10 + id * 20, 200, 20 + id * 20]], layout: { paragraph: id, kind, math: [] } });
it('completes both sides of a three-page sentence with identical text, local coordinates and shared multi-page highlights', async () => {
  const pages = [
    [sentence(0, 'Finished.'), sentence(1, 'The method considers')],
    [sentence(0, 'several aspects and')],
    [sentence(0, 'improves efficiency.'), sentence(1, 'Another sentence.')],
  ];
  pages.forEach((rows, i) => rows.forEach(row => { row.layout!.sources = [{ pageNumber: i + 1, rects: row.rects }]; }));
  vi.mocked(extractPageSentences).mockImplementation(async (_, n) => pages[n - 1]);
  const pdf = { numPages: 3 } as PDFDocumentProxy;
  const a = await extractPageWithContinuations(pdf, 1), b = await extractPageWithContinuations(pdf, 2), c = await extractPageWithContinuations(pdf, 3);
  expect(a[1].text).toBe('The method considers several aspects and improves efficiency.');
  expect(b[0].text).toBe(a[1].text); expect(c[0].text).toBe(a[1].text);
  expect(a[1].layout!.sources!.map(s => s.pageNumber)).toEqual([1, 2, 3]);
  expect(b[0].layout!.sources).toEqual(a[1].layout!.sources);
  expect(c[0].layout!.sources).toEqual(a[1].layout!.sources);
  expect(a[1].rects).toEqual(pages[0][1].rects); expect(c[0].rects).toEqual(pages[2][0].rects);
});
it('does not attach complete sentences and ignores headings and page numbers at the boundary', async () => {
  expect(continues(sentence(0, 'Finished.”'), sentence(0, 'Next.'))).toBe(false);
  const pages = [[sentence(0, 'We follow Eq.'), sentence(1, '1')], [sentence(0, 'Running header', 'heading'), sentence(1, '(2) to solve the problem.')]];
  vi.mocked(extractPageSentences).mockImplementation(async (_, n) => pages[n - 1]);
  expect((await extractPageWithContinuations({ numPages: 2 } as PDFDocumentProxy, 1))[0].text).toBe('We follow Eq. (2) to solve the problem.');
});
it('keeps equation source pages and canonical tokens when a sentence spans the boundary', async () => {
  const left = sentence(0, 'We use [[PV_MATH_1000]] to'), right = sentence(0, 'compute [[PV_MATH_2000]].');
  left.layout!.math = [{ pageNumber: 1, token: '[[PV_MATH_1000]]', text: 'x', rect: [10, 10, 20, 20], fontSize: 10 }];
  right.layout!.math = [{ pageNumber: 2, token: '[[PV_MATH_2000]]', text: 'y', rect: [30, 10, 40, 20], fontSize: 10 }];
  vi.mocked(extractPageSentences).mockImplementation(async (_, n) => [n === 1 ? left : right]);
  const pdf = { numPages: 2 } as PDFDocumentProxy;
  const a = await extractPageWithContinuations(pdf, 1), b = await extractPageWithContinuations(pdf, 2);
  expect(a[0].layout!.math).toEqual(b[0].layout!.math); expect(a[0].layout!.math.map(m => m.pageNumber)).toEqual([1, 2]);
});
