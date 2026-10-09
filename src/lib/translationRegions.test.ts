import { expect, it } from 'vitest';
import type { Line, TextRun } from './pageTranslation';
import { readingRegions } from './translationRegions';
import { textBlocks } from './translationLayout';

const build = (items: [string, number, number, number][]) => {
  const runs: TextRun[] = items.map(([text, top, column, fontSize]) => ({ text, top, bottom: top + fontSize, left: column * 300,
    right: column * 300 + 240, fontSize }));
  const lines: Line[] = runs.map((r, i) => ({ ...r, runs: [i], column: items[i][2] }));
  return { runs, lines };
};
it('keeps the entire caption out of body flow and marks notes and page furniture', () => {
  const { runs, lines } = build([
    ['Publication header', 10, 0, 7], ['Robots have varying abilities', 400, 1, 10],
    ['Manuscript received: August 28, 2024.', 650, 1, 8], ['Authors and affiliations.', 660, 1, 8],
    ['Fig. 1. The scenario is illustrated.', 200, 2, 8], ['The plans are shown as arrows.', 210, 2, 8],
    ['in signal strength and sensing.', 235, 2, 10], ['Agents hardly learn any useful', 690, 2, 10],
    ['Authorized licensed use.', 770, 0, 7],
  ]);
  const ordered = readingRegions(lines, runs, 792), blocks = textBlocks(ordered, runs);
  expect(ordered.map(l => l.runs[0])).toEqual([0,1,6,7,4,5,2,3,8]);
  expect(blocks.find(b => b.kind === 'caption')?.lines.flatMap(l => l.runs)).toEqual([4,5]);
  expect(ordered.filter(l => l.kind === 'footnote')).toHaveLength(2);
  expect(ordered.at(-1)?.kind).toBe('footer');
  expect(blocks.find(b => b.kind === 'paragraph')?.lines.flatMap(l => l.runs)).toEqual([1,6]);
});
it('does not mistake normal-size figure reference prose for a floating caption', () => {
  const { runs, lines } = build([['Fig. 2 shows the outcome.', 100, 1, 10], ['Another sentence follows.', 114, 1, 10]]);
  expect(readingRegions(lines, runs, 792).every(l => !l.kind)).toBe(true);
});
it('separates Roman section headings from an unfinished keywords line and adjacent subheadings', () => {
  const { runs, lines } = build([['Index Terms: robotics; learning', 100, 1, 10], ['I. INTRODUCTION', 124, 1, 10],
    ['A. Task allocation', 140, 1, 10], ['The main body starts here.', 155, 1, 10]]);
  const blocks = textBlocks(lines, runs);
  expect(blocks.map(b => b.kind)).toEqual(['paragraph','heading','heading','paragraph']);
});
