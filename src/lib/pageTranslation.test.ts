import { expect, it, vi } from 'vitest';
vi.mock('pdfjs-dist', () => ({ TextLayer: class {} }));
import { orderedLines, sentenceRanges, type TextRun } from './pageTranslation';
const run = (text: string, left: number, top: number, right: number): TextRun => ({ text, left, top, right, bottom: top + 12 });
it('reads interleaved columns after spanning title and before spanning footer', () => {
  const runs = [run('Title', 30, 10, 570), run('Left 1.', 30, 70, 270), run('Right 1.', 320, 70, 570),
    run('Left 2.', 30, 85, 270), run('Right 2.', 320, 85, 570), run('Footer', 30, 150, 570)];
  expect(orderedLines(runs).flatMap(l => l.runs.map(i => runs[i].text))).toEqual(['Title', 'Left 1.', 'Left 2.', 'Right 1.', 'Right 2.', 'Footer']);
});
it('joins adjacent font runs without mixing different lines', () => {
  const runs = [run('bold', 65, 10, 90), run('First ', 30, 10, 64), run('Next line.', 30, 30, 240)];
  expect(orderedLines(runs).map(l => l.runs.map(i => runs[i].text).join(''))).toEqual(['First bold', 'Next line.']);
});
it('keeps sentence offsets and real hyphens across PDF line breaks', () => {
  const text = 'A game-\ntheoretical method works. Another decision-making method follows.  ';
  const segments = sentenceRanges(text);
  expect(segments.map(s => s.text)).toEqual(['A game-theoretical method works.', 'Another decision-making method follows.']);
  expect(text.slice(segments[0].start, segments[0].end)).toBe('A game-\ntheoretical method works.');
  expect(sentenceRanges('Cooper\u00ad\nation succeeds.')[0].text).toBe('Cooperation succeeds.');
});
it('keeps single-column short headings with the text below', () => {
  const runs = [run('Introduction', 30, 10, 170), run('Full line', 30, 30, 570), run('Short line', 30, 45, 200)];
  expect(orderedLines(runs).flatMap(l => l.runs)).toEqual([0, 1, 2]);
});
it('never cuts a math placeholder at a sentence boundary, including adjacent punctuation', () => {
  const text = 'The values are zero.[[PV_MATH_4020]] is a vector. Another value (1).[[PV_MATH_4030]] denotes a mask.';
  const ranges = sentenceRanges(text);
  for (const token of ['[[PV_MATH_4020]]', '[[PV_MATH_4030]]']) {
    expect(ranges.filter(r => r.text.includes(token))).toHaveLength(1);
    const start = text.indexOf(token), end = start + token.length;
    expect(ranges.every(r => !(r.start > start && r.start < end) && !(r.end > start && r.end < end))).toBe(true);
  }
  expect(ranges.map(r => text.slice(r.start, r.end)).join(' ')).not.toMatch(/\[\[\s+PV_MATH/);
});
it('detects a narrow column gutter before merging adjacent line fragments', () => {
  const runs = [run('Left first', 30, 40, 295), run('Right first', 307, 40, 570),
    run('Left second', 30, 55, 295), run('Right second', 307, 55, 570)];
  expect(orderedLines(runs).flatMap(l => l.runs.map(i => runs[i].text))).toEqual(['Left first','Left second','Right first','Right second']);
});
it('keeps superscript citations with their baseline instead of ordering them first', () => {
  const runs = [run('An author', 30, 30, 90), { text: '1', left: 90, right: 94, top: 27, bottom: 34 },
    run(' and another author.', 96, 30, 240)];
  expect(orderedLines(runs).map(l => l.runs.map(i => runs[i].text).join(''))).toEqual(['An author1 and another author.']);
});
it('supports a full-width abstract above a two-column body', () => {
  const runs = [run('Full abstract sentence.',30,10,570),run('Abstract continues.',30,25,570),
    run('Left first.',30,60,295),run('Right first.',307,60,570),run('Left second.',30,75,295),run('Right second.',307,75,570)];
  expect(orderedLines(runs).flatMap(l=>l.runs.map(i=>runs[i].text))).toEqual(['Full abstract sentence.','Abstract continues.','Left first.','Left second.','Right first.','Right second.']);
});
it('keeps a larger heading inside its own column without interleaving right-column text', () => {
  const runs = [run('Left first.',30,10,295),run('Right first.',307,10,570),
    {text:'Section heading',left:30,right:220,top:30,bottom:47},
    run('Right continues.',307,30,570),run('Left last.',30,55,295),run('Right last.',307,55,570)];
  expect(orderedLines(runs).flatMap(l=>l.runs.map(i=>runs[i].text))).toEqual(['Left first.','Section heading','Left last.','Right first.','Right continues.','Right last.']);
});
it('keeps a short second title line with a spanning title above two columns', () => {
  const runs = [{text:'A full-width title',left:30,right:570,top:0,bottom:24},
    {text:'and its continuation',left:30,right:270,top:28,bottom:52},
    run('Left first.',30,80,295),run('Right first.',307,80,570),run('Left last.',30,95,295),run('Right last.',307,95,570)];
  const lines = orderedLines(runs);
  expect(lines.map(l=>l.column)).toEqual([0,0,1,1,2,2]);
  expect(lines.flatMap(l=>l.runs)).toEqual([0,1,2,4,3,5]);
});
it('attaches a drop cap to the first line instead of the line under it',()=>{
 const runs=[{text:'W',left:30,right:56,top:30,bottom:63,baseline:57,fontSize:30},
  {text:'ITH the first line',left:56,right:250,top:32,bottom:43,baseline:40,fontSize:10},
  {text:'and the next line.',left:56,right:250,top:44,bottom:55,baseline:52,fontSize:10}];
 expect(orderedLines(runs).map(l=>l.runs.map(i=>runs[i].text).join(''))).toEqual(['WITH the first line','and the next line.']);
});
