import { describe, expect, it } from 'vitest';
import { contextAt, isSingleEnglishWord, pdfToStyle, rectToPdf } from './selection';
import { clampZoom, fitScale } from './useReaderZoom';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makeTestPdf } from '../../tests/fixture';

describe('context extraction', () => {
  it('selects the sentence for this occurrence, including line breaks', () => {
    const text = 'Earlier asymptotic result. The model has\nasymptotic complexity. Next result.';
    const start = text.lastIndexOf('asymptotic');
    expect(contextAt(text, start, start + 10)).toBe('The model has asymptotic complexity.');
  });
  it('bounds input around the selected occurrence in a long paragraph', () => {
    const text = 'a '.repeat(2000) + 'allocation' + ' b'.repeat(2000);
    const context = contextAt(text, 4000, 4010);
    expect(context.length).toBeLessThanOrEqual(1410);
    expect(context).toContain('allocation');
  });
});

describe('selection routing and width fitting', () => {
  it('keeps hyphenated words and contractions in the single-word flow', () => {
    for (const word of ['game-theoretical', 'decision-making', "don't", 'reader’s', 'Allocation']) expect(isSingleEnglishWord(word)).toBe(true);
    for (const phrase of ['two words', 'A sentence.', 'decision--making', 'word,', '한국어', '']) expect(isSingleEnglishWord(phrase)).toBe(false);
  });
  it('fits page widths including large user units and guards scale limits', () => {
    expect(fitScale(1200, 612, 60)).toBeCloseTo(1140 / 612, 4);
    expect(fitScale(640, 1224, 36)).toBeCloseTo(604 / 1224, 4);
    expect(clampZoom(-1)).toBe(.1);
    expect(clampZoom(10)).toBe(4);
  });
});

describe('highlight coordinates', () => {
  for (const rotation of [0, 90, 180, 270]) {
    it(`preserves PDF coordinates across zoom, crop and rotation ${rotation}`, async () => {
      const task = getDocument({ data: makeTestPdf(rotation) });
      const document = await task.promise;
      const page = await document.getPage(1);
      const original = [80, 100, 140, 112] as [number, number, number, number];
      const viewport = page.getViewport({ scale: 1.5 });
      const style = pdfToStyle(original, viewport);
      const saved = rectToPdf({ left: style.left + 40, top: style.top + 60,
        right: style.left + style.width + 40, bottom: style.top + style.height + 60 },
      { left: 40, top: 60, width: viewport.width, height: viewport.height }, viewport);
      expect(saved).toEqual(original);
      const zoomed = page.getViewport({ scale: 2.25 });
      const restored = pdfToStyle(saved, zoomed);
      expect(restored.width).toBeCloseTo(style.width * 1.5);
      expect(restored.height).toBeCloseTo(style.height * 1.5);
      await task.destroy();
    });
  }
});
