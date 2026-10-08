import { describe, it, expect } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { extractPaperMetadata, firstPageTitle, publicationDate } from './paperMetadata';

const item = (str: string, size: number, x: number, y: number) => ({ str, transform: [size, 0, 0, size, x, y] }) as TextItem;
const body = Array.from({ length: 12 }, (_, i) => item('Text from the abstract and paper body.', 12, 72, 550 - i * 15));
const doc = (info: object, items: TextItem[] = [], xmp: Record<string, unknown> = {}) => ({
  getMetadata: async () => ({ info, metadata: { get: (key: string) => xmp[key] } }),
  getPage: async () => ({ view: [0, 0, 612, 792], getTextContent: async () => ({ items }) }),
}) as unknown as PDFDocumentProxy;

describe('imported paper metadata', () => {
  it('prefers the embedded title/author and uses explicit publication dates, not file dates', async () => {
    const value = await extractPaperMetadata(doc({ Title: 'A filename-independent paper title', Author: 'Alice; Bob', CreationDate: 'D:20250101120000', ModDate: 'D:20260101000000' }));
    expect(value).toEqual({ title: 'A filename-independent paper title', authors: 'Alice; Bob', publishedDate: '' });
    expect(await extractPaperMetadata(doc({ Title: 'Info title' }, [], { 'dc:title': 'XMP paper title', 'dc:creator': ['김연구', 'Lee'], 'prism:publicationdate': '2024-02-29' })))
      .toEqual({ title: 'XMP paper title', authors: '김연구, Lee', publishedDate: '2024-02-29' });
  });
  it('recovers a multiline title from first-page typography and rejects ordinary uniform body text', async () => {
    const items = [item('A Study of', 24, 72, 718), item('Context-aware Learning', 24, 72, 690), item('Alice Smith', 12, 72, 645), ...body];
    expect(firstPageTitle(items, 792)).toBe('A Study of Context-aware Learning');
    expect(firstPageTitle(body, 792)).toBe('');
    expect((await extractPaperMetadata(doc({ Title: 'Microsoft Word - template.docx' }, items))).title).toBe('A Study of Context-aware Learning');
  });
  it('extracts explicitly published dates without inventing missing day/month precision', async () => {
    expect(publicationDate('2024')).toBe('2024'); expect(publicationDate('2024-02')).toBe('2024-02');
    expect(publicationDate('29 February 2024')).toBe('2024-02-29');
    expect(publicationDate('September 2023')).toBe('2023-09');
    for (const bad of ['2023-02-29', '2024-13', 'D:20240229', '2024-01-32']) expect(publicationDate(bad)).toBe('');
    expect((await extractPaperMetadata(doc({}, [item('Published online: September 20, 2023', 12, 72, 600)]))).publishedDate).toBe('2023-09-20');
    expect((await extractPaperMetadata(doc({}, [item('Received: September 20, 2023', 12, 72, 600)]))).publishedDate).toBe('');
  });
  it('leaves fields blank for scanned PDFs or unusable metadata without blocking import', async () => {
    expect(await extractPaperMetadata(doc({ Title: 'untitled', Author: 'Anonymous' }))).toEqual({ title: '', authors: '', publishedDate: '' });
    const broken = { getMetadata: async () => { throw Error('bad info'); }, getPage: async () => { throw Error('no text'); } } as unknown as PDFDocumentProxy;
    expect((await extractPaperMetadata(broken)).title).toBe('');
  });
});

describe('first-page bibliographic fallbacks', () => {
  it('extracts the reported two-column IEEE paper despite its larger introduction drop cap', async () => {
    // Geometry from the reported PDF: the decorative C is 29.9pt, the actual title 23.9pt.
    const items = [item('IEEE TRANSACTIONS ON ROBOTICS', 6.97, 333, 753),
      item('Anonymous Hedonic Game for Task Allocation in a', 23.91, 49.6, 713.33),
      item('Large-Scale Multiple Agent System', 23.91, 127, 685.42),
      { ...item('Inmo Jang', 10.96, 169.68, 662.51), width: 45.97 },
      { ...item(', Hyo-Sang Shin', 10.96, 226.47, 662.51), width: 72.75 },
      item(', and Antonios Tsourdos', 10.96, 310.05, 662.51),
      item('Abstract—A two-column abstract.', 8.97, 52, 620.57),
      item('I. INTRODUCTION', 9.96, 131, 414.08), item('C', 29.89, 42, 382.84),
      item('OOPERATION of many agents', 9.96, 65.69, 397.15),
      item('robots cooperate.', 9.96, 65.69, 385.19),
      item('Unrelated text from the right column.', 9.96, 310, 385.19),
      item('Date of publication August 20, 2018', 8.97, 42, 220),
      ...body.map(i => ({ ...i, transform: [9.96, 0, 0, 9.96, 42, i.transform[5]] }))];
    expect(await extractPaperMetadata(doc({ Title: 'untitled' }, items))).toEqual({
      title: 'Anonymous Hedonic Game for Task Allocation in a Large-Scale Multiple Agent System',
      authors: 'Inmo Jang, Hyo-Sang Shin, and Antonios Tsourdos', publishedDate: '2018-08-20',
    });
  });
  it('does not let a same-baseline decorative capital inflate a body line without an abstract heading', () => {
    const items = [item('A Study of Context', 24, 72, 718), item('Alice Smith', 12, 72, 675),
      { ...item('C', 32, 72, 570), width: 24 }, item('ooperation is studied in this paper.', 12, 96, 570), ...body];
    expect(firstPageTitle(items, 792)).toBe('A Study of Context');
    expect(firstPageTitle(items.slice(2), 792)).toBe('');
  });
  it('never falls through to a large heading in the body when the title cannot be identified', async () => {
    const items = [item('Abstract', 12, 72, 680), item('COOPERATION OF AGENTS', 28, 72, 560), ...body];
    expect(await extractPaperMetadata(doc({}, items))).toEqual({ title: '', authors: '', publishedDate: '' });
  });
  it('reads author names even when title and publication date already exist in metadata', async () => {
    const items = [item('A Study of Context', 24, 72, 718), item('Alice Smith1, Bob Lee2', 12, 72, 675),
      item('Department of Computer Science, Example University', 10, 72, 650), ...body];
    expect(await extractPaperMetadata(doc({ Title: 'A Study of Context', PublishedDate: '2023-05-17' }, items)))
      .toEqual({ title: 'A Study of Context', authors: 'Alice Smith, Bob Lee', publishedDate: '2023-05-17' });
  });
  it('joins title fragments and multi-column author names without confusing affiliations with authors', async () => {
    const items = [{ ...item('Learning', 24, 72, 718), width: 100 }, item('from Context', 24, 180, 718),
      { ...item('Alice Smith', 12, 72, 675), width: 65 }, item('Bob Lee', 12, 240, 675),
      item('Example University', 10, 72, 650), item('Date of publication: 17 May 2023', 10, 72, 625), ...body];
    expect(await extractPaperMetadata(doc({ Author: 'Administrator', Title: 'Untitled' }, items)))
      .toEqual({ title: 'Learning from Context', authors: 'Alice Smith, Bob Lee', publishedDate: '2023-05-17' });
  });
  it('supports abbreviated, numeric, Korean and conference publication dates', async () => {
    for (const [text, expected] of [['Available online 20 Sept. 2023', '2023-09-20'], ['First published on 2023/9/20', '2023-09-20'],
      ['발행일: 2023년 9월 20일', '2023-09-20'], ['Published as a conference paper at ICLR 2024', '2024']]) {
      expect((await extractPaperMetadata(doc({}, [item(text, 12, 72, 600)]))).publishedDate, text).toBe(expected);
    }
  });
  it('does not invent author names or publication dates from institutions, body text or submission history', async () => {
    const items = [item('A Study of Context', 24, 72, 718), item('Example University', 12, 72, 675), item('Department of Computer Science', 12, 72, 650),
      item('Received 17 May 2023; Accepted 20 June 2023', 10, 72, 625), ...body];
    const result = await extractPaperMetadata(doc({ CreationDate: 'D:20230620000000', ModDate: 'D:20230701000000' }, items));
    expect(result.authors).toBe(''); expect(result.publishedDate).toBe('');
  });
});
