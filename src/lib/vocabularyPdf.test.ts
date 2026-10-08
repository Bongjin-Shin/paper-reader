import { describe, expect, it } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createVocabularyPdf } from './vocabularyPdf';
import type { VocabularyEntry } from '../types';

const font = new Uint8Array(readFileSync('src/assets/fonts/NanumGothic-Regular.ttf'));
const entry: VocabularyEntry = { id: 1, word: 'allocation', translation: '작업 배분', explanation: '로봇에게 작업을 배분합니다.', lookupCount: 4,
  contexts: [{ paperId: 'a', paperTitle: '다중 로봇의 작업 배분', pageNumber: 3, originalSentence: 'Task allocation among robots.', translation: '작업 배분', explanation: '로봇에게 작업을 배분합니다.' },
    { paperId: 'b', paperTitle: 'Memory Systems', pageNumber: 7, originalSentence: 'Memory allocation is required.', translation: '메모리 할당', explanation: null }] };

async function inspect(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const pdf = await task.promise; const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n); const viewport = page.getViewport({ scale: 1 });
    expect(viewport.width).toBeCloseTo(595.28, 1); expect(viewport.height).toBeCloseTo(841.89, 1);
    const content = await page.getTextContent();
    const items = content.items.filter(item => 'str' in item);
    for (const item of items) {
      expect(item.transform[4]).toBeGreaterThanOrEqual(24);
      expect(item.transform[4] + item.width).toBeLessThan(viewport.width - 20);
      expect(item.transform[5]).toBeGreaterThanOrEqual(20);
      expect(item.transform[5]).toBeLessThan(viewport.height - 20);
    }
    pages.push(items.map(item => item.str).join(' '));
  }
  await task.destroy(); return pages;
}

describe('Vocabulary PDF export', () => {
  it('exports compact two-column Simple pages with embedded Korean and complete wrapped selections', async () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ ...entry, id: i + 1, word: `allocation-${i}`, translation: `작업 배분 ${i}` }));
    entries.push({ ...entry, id: 101, word: 'A'.repeat(2000) + ' LAST', translation: '긴 문장 전체 번역입니다. '.repeat(100) + '끝말' });
    const bytes = await createVocabularyPdf(entries, 'simple', font);
    const pages = await inspect(bytes); const text = pages.join(' ');
    expect(pages.length).toBeGreaterThan(1); expect(text).toContain('작업 배분'); expect(text).toContain('allocation-99'); expect(text).toContain('LAST'); expect(text).toContain('끝말');
    expect(text).not.toContain('Memory Systems'); expect(text).not.toContain('조회');
    mkdirSync('.tools/export-qa', { recursive: true }); writeFileSync('.tools/export-qa/vocabulary-simple.pdf', bytes);
  });
  it('exports every Detailed context, lookup count and long paragraphs over multiple pages', async () => {
    const bytes = await createVocabularyPdf([entry, { ...entry, id: 2, word: 'A selected sentence.', contexts: [{ ...entry.contexts[0], originalSentence: 'A very long context sentence. '.repeat(250) + 'FINAL-CONTEXT', explanation: '여러 줄에 걸쳐 기록된 설명입니다. '.repeat(90) + '마지막설명' }] }], 'detailed', font);
    const pages = await inspect(bytes); const text = pages.join(' ');
    expect(pages.length).toBeGreaterThan(2);
    for (const part of ['작업 배분', '메모리 할당', 'Memory Systems', '7페이지', '조회 4회', 'FINAL-CONTEXT', '마지막설명']) expect(text).toContain(part);
    mkdirSync('.tools/export-qa', { recursive: true }); writeFileSync('.tools/export-qa/vocabulary-detailed.pdf', bytes);
  });
  it('does not create a misleading empty document', async () => {
    await expect(createVocabularyPdf([], 'simple', font)).rejects.toThrow('내보낼 단어');
  });
  it.each(['simple', 'detailed'] as const)('right-aligns short, wrapped and missing meanings in %s output across pages', async mode => {
    const meanings = ['뜻', '작업을 여러 로봇에게 배분하는 방법입니다. '.repeat(150), null];
    const entries = Array.from({ length: mode === 'simple' ? 70 : 3 }, (_, i) => ({ ...entry, id: i + 1,
      word: `allocation-${i}`, translation: i < 3 ? meanings[i] : '작업 배분',
      contexts: [{ ...entry.contexts[0], paperTitle: 'Paper A', explanation: 'An explanation.',
        translation: i < 3 ? meanings[i] : '작업 배분' }] }));
    const bytes = await createVocabularyPdf(entries, mode, font);
    await inspect(bytes);
    const task = getDocument({ data: bytes.slice() });
    try {
      const pdf = await task.promise;
      expect(pdf.numPages).toBeGreaterThan(1);
      const edges = new Set<number>(); let meaningLines = 0, missing = false;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n), width = page.getViewport({ scale: 1 }).width;
        const text = (await page.getTextContent()).items.filter(item => 'str' in item);
        const meanings = text.filter(item => item.height === (mode === 'simple' ? 9 : 10)
          && !item.str.endsWith('페이지') && (/[가-힣]/u.test(item.str) || item.str === '-'));
        for (const item of meanings) {
          const right = mode === 'simple' && item.transform[4] < width / 2 ? (width - 22) / 2 : width - 38;
          expect(item.transform[4] + item.width).toBeCloseTo(right, 1);
          edges.add(right); meaningLines++; if (item.str === '-') missing = true;
        }
        // Words and explanatory text keep their original left alignment.
        for (const item of text.filter(item => item.str.startsWith('allocation-') || item.str === 'An explanation.')) {
          const left = mode === 'simple' && item.transform[4] > width / 2 ? (width + 22) / 2 : item.str === 'An explanation.' ? 46 : 38;
          expect(item.transform[4]).toBeCloseTo(left, 1);
        }
      }
      expect(meaningLines).toBeGreaterThan(20); expect(missing).toBe(true);
      expect(edges.size).toBe(mode === 'simple' ? 2 : 1);
      mkdirSync('.tools/print-alignment-verification', { recursive: true });
      writeFileSync(`.tools/print-alignment-verification/aligned-${mode}.pdf`, bytes);
    } finally { await task.destroy(); }
  });
});
