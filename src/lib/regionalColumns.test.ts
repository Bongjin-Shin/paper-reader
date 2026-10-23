import { expect, it, vi } from 'vitest';
vi.mock('pdfjs-dist', () => ({ TextLayer: class {} }));
import { orderedLines, type TextRun } from './pageTranslation';
import { textBlocks } from './translationLayout';
import { readingRegions } from './translationRegions';

const run = (text: string, left: number, right: number, y: number, fontSize = 10): TextRun =>
  ({ text, left, right, top: y - fontSize * .8, bottom: y + fontSize * .2, baseline: y, fontSize });
const text = (runs: TextRun[], ids: number[]) => ids.map(i => runs[i].text).join(' ');

it('separates a smaller keyword sidebar and wide abstract above ordinary body columns', () => {
  const runs = [
    run('A full-width title with a long first line', 30, 570, 30, 18),
    run('and its short continuation', 30, 250, 51, 18),
    run('A R T I C L E', 30, 78, 110, 9), run('I N F O', 84, 110, 110, 9),
    run('A B S T R A C T', 205, 270, 110, 9),
    run('Keywords:', 30, 65, 130, 8), run('This paper studies ', 205, 290, 130, 9),
    run('conditional models ', 290, 390, 130, 9), run('for image-', 390, 570, 130, 9),
    run('Leak', 30, 47, 141, 8), run('based detection. The method uses', 205, 570, 142, 9),
    run('Anomaly detection', 30, 96, 152, 8), run('pressure measurements with', 205, 570, 154, 9),
    run('Generative adversarial networks', 30, 145, 163, 8),
    run('the uncertainty of demand.', 205, 570, 166, 9),
    run('Water distribution', 30, 100, 174, 8), run('Results are accurate.', 205, 570, 178, 9),
    run('1. Introduction', 30, 160, 230), run('1.1. Literature review', 315, 450, 230),
    ...Array.from({ length: 8 }, (_, i) => [
      run(`Left body line ${i}.`, 30, 295, 248 + 13 * i),
      run(`Right body line ${i}.`, 315, 570, 248 + 13 * i),
    ]).flat(),
  ];
  const lines = orderedLines(runs);
  expect(lines.flatMap(l => l.runs)).toEqual([0, 1, 2, 3, 5, 9, 11, 13, 15, 4, 6, 7, 8, 10, 12, 14, 16,
    17, ...Array.from({ length: 8 }, (_, i) => 19 + i * 2), 18, ...Array.from({ length: 8 }, (_, i) => 20 + i * 2)]);
  expect(new Set(lines.flatMap(l => l.runs)).size).toBe(runs.length);
  const blocks = textBlocks(readingRegions(lines, runs, 792), runs);
  expect(blocks.filter(b => b.kind === 'heading').map(b => text(runs, b.lines.flatMap(l => l.runs)))).toEqual([
    'A full-width title with a long first line and its short continuation', 'A R T I C L E I N F O',
    'A B S T R A C T', '1. Introduction', '1.1. Literature review',
  ]);
  const keywords = blocks.find(b => b.lines.some(l => l.runs.includes(5)))!;
  expect(keywords.lines.flatMap(l => l.runs)).toEqual([5, 9, 11, 13, 15]);
  const abstract = blocks.find(b => b.lines.some(l => l.runs.includes(6)))!;
  expect(abstract.lines.flatMap(l => l.runs)).toEqual([6, 7, 8, 10, 12, 14, 16]);
  expect(lines.find(l => l.runs.includes(6))!.columnGroup).not.toBe(lines.find(l => l.runs.includes(19))!.columnGroup);
});

it('does not treat a horizontal paragraph gap as the end of a shared column flow', () => {
  const runs = [
    run('Left first.', 30, 295, 100), run('Right first.', 315, 570, 100),
    run('Left second.', 30, 295, 113), run('Right second.', 315, 570, 113),
    run('Left third.', 30, 295, 160), run('Right third.', 315, 570, 160),
    run('Left final unfinished sentence', 30, 295, 173), run('Right final.', 315, 570, 173),
  ];
  const lines = orderedLines(runs);
  expect(lines.flatMap(l => l.runs)).toEqual([0, 2, 4, 6, 1, 3, 5, 7]);
  expect(new Set(lines.map(l => l.columnGroup)).size).toBe(1);
  expect(textBlocks(lines, runs).some(b => b.lines.some(l => l.runs.includes(6)) && b.lines.some(l => l.runs.includes(1)))).toBe(true);
});

it('does not join unfinished prose across a change in column layout', () => {
  const runs = [run('Unfinished auxiliary text', 200, 570, 200), run('The next section begins', 30, 295, 240)];
  const lines = runs.map((r, i) => ({ ...r, runs: [i], column: i ? 1 : 2, columnGroup: i }));
  expect(textBlocks(lines, runs)).toHaveLength(2);
});

it('keeps explicit headings separate from an unpunctuated list in the preceding column', () => {
  const runs = [run('Water distribution', 30, 110, 200), run('1.1. Literature review', 315, 450, 110)];
  const lines = runs.map((r, i) => ({ ...r, runs: [i], column: i + 1, columnGroup: 0 }));
  expect(textBlocks(lines, runs).map(b => b.kind)).toEqual(['paragraph', 'heading']);
});
