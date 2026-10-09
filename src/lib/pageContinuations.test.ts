import { expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSentence } from '../types';
vi.mock('./pageTranslation', () => ({ extractPageSentences: vi.fn() }));
import { extractPageSentences } from './pageTranslation';
import { continues, extractPageWithContinuations } from './pageContinuations';

const sentence = (id: number, text: string, kind: NonNullable<SourceSentence['layout']>['kind'] = 'paragraph'): SourceSentence => ({ id, text, rects: [[10, 10 + id * 20, 200, 20 + id * 20]], layout: { paragraph: id, kind, math: [] } });
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

it('skips captions, notes and publisher furniture when completing both sides of a page boundary', async () => {
  const pages = [[sentence(0, 'Agents can hardly learn any useful'), sentence(1, 'Fig. 1. The scenario.', 'caption'),
    sentence(2, 'Manuscript received in 2024.', 'footnote'), sentence(3, 'Copyright and licensed use.', 'footer')],
    [sentence(0, 'Preprint accepted for publication.', 'header'), sentence(1, 'strategies from incomplete experiences.'), sentence(2, 'Next sentence.')]];
  vi.mocked(extractPageSentences).mockImplementation(async (_, n) => pages[n - 1]);
  const pdf = { numPages: 2 } as PDFDocumentProxy;
  const first = await extractPageWithContinuations(pdf, 1), second = await extractPageWithContinuations(pdf, 2);
  expect(first[0].text).toBe('Agents can hardly learn any useful strategies from incomplete experiences.');
  expect(second[1].text).toBe(first[0].text);
  expect(first[1]).toEqual(pages[0][1]); expect(second[0]).toEqual(pages[1][0]);
});
it('re-extracts local and adjacent geometry when explicitly translating again', async () => {
  let changed = false;
  vi.mocked(extractPageSentences).mockImplementation(async () => [sentence(0, changed ? 'Updated source.' : 'Old source.')]);
  const pdf = { numPages: 1 } as PDFDocumentProxy;
  expect((await extractPageWithContinuations(pdf, 1))[0].text).toBe('Old source.'); changed = true;
  expect((await extractPageWithContinuations(pdf, 1))[0].text).toBe('Old source.');
  expect((await extractPageWithContinuations(pdf, 1, true))[0].text).toBe('Updated source.');
});
