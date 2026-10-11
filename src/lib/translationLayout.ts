import type { SourceSentence } from '../types';
import type { TextRun, Line } from './pageTranslation';

export const mathFont = /(?:CMMI|CMSY|CMEX|MSAM|MSBM|MTMI|MTSY|MTEX|Math|Symbol|Euler)/i;
const mathSign = /[=<>≤≥≠≈≡±×÷∈∉∋⊂⊃⊆⊇∪∩∑∏∫√∞∂∇∅⋃⋂]/u;
const mathPart = /^(?:[\p{L}\d]{1,2}|sin|cos|tan|log|ln|exp|lim|arg|min|max|loc|if|update|s\.t\.)[\s\d\p{P}\p{S}]*$/u;
export const runSize = (r: TextRun) => r.fontSize ?? r.bottom - r.top;
/** Symbol fonts can report oversized selection boxes, especially accents and
 * extensible operators. Stop inline crops before adjacent prose's actual ink. */
export function clipInlineEquation(box: {left:number;right:number;top:number;bottom:number}, line: Line, runs: TextRun[]) {
  const ids = new Set(line.runs), anchors = line.runs.map(i=>runs[i]).filter(r=>!r.math);
  const bases = (anchors.length ? anchors : line.runs.map(i=>runs[i])).map(r=>r.baseline ?? r.bottom).sort((a,b)=>a-b);
  const baseline = bases[Math.floor(bases.length/2)], size = lineSize(line,runs);
  let {top,bottom} = box;
  for (const [i,run] of runs.entries()) {
    if (ids.has(i) || run.math || run.right<=box.left || run.left>=box.right || run.baseline===undefined) continue;
    if (run.baseline < baseline-size*.5) top=Math.max(top,(run.inkBottom ?? run.bottom)+.4);
    if (run.baseline > baseline+size*.5) bottom=Math.min(bottom,(run.inkTop ?? run.top)-.4);
  }
  return bottom>top ? {...box,top,bottom} : box;
}
export function lineSize(line: Line, runs: TextRun[]) {
  const prose = line.runs.filter(i => /[A-Za-z]{3}/.test(runs[i].text) && !runs[i].math);
  const ids = prose.length ? prose : line.runs;
  return Math.max(...ids.map(i => runSize(runs[i])));
}
export function isHeading(line: Line, runs: TextRun[], bodySize: number) {
  const text = line.runs.map(i => runs[i].text).join(' ').trim();
  const words = text.match(/[A-Za-z]+/g) ?? [];
  // Entire abstracts are often bold. Weight alone cannot distinguish a heading
  // from prose, and punctuation on the final wrapped line must not change kind.
  return words.length > 0 && words.length < 18 && !/[.!?;:]$/.test(text)
    && !mathSign.test(text) && (lineSize(line, runs) > bodySize * 1.12
      || /^(?:(?:\d+(?:\.\d+)*\.?|[IVXLCDM]+\.|[A-Z]\.)\s+)?(?:abstract|introduction|background|related work|materials and methods|methodology|methods?|results?(?: and discussion)?|discussion|conclusions?|references|acknowledg(?:e)?ments?|appendix)$/i.test(text)
      || (words.length <= 10 && text === text.toUpperCase() && line.runs.some(i => runs[i].bold))
      || /^(?:\d+(?:\.\d+)+|\d+\.|[IVXLCDM]+\.|[A-Z]\.)\s+[A-Z]/.test(text));
}

/** Reviewer manuscript line numbers are a narrow, sequential gutter beside prose. */
export function lineNumberRuns(runs: TextRun[]): Set<number> {
  const candidates = runs.map((r, i) => ({ r, i })).filter(({ r }) => /^\d{1,4}$/.test(r.text.trim()) && !r.math);
  const result = new Set<number>();
  for (const { r: seed } of candidates) {
    const size = runSize(seed), group = candidates.filter(({ r }) => Math.abs(r.right - seed.right) < size * .8
      && runs.some(other => other !== r && other.left - r.right > size * 1.5 && other.left - r.right < size * 8
        && Math.abs((other.baseline ?? other.bottom) - (r.baseline ?? r.bottom)) < size * .4 && /[A-Za-z]{4}/.test(other.text)));
    group.sort((a, b) => a.r.top - b.r.top);
    if (group.length < 5 || group.slice(1).filter(({ r }, i) => Number(r.text) === Number(group[i].r.text) + 1).length < (group.length - 1) * .8) continue;
    // A table's row index is not a margin gutter if prose also occurs to its left.
    if (runs.some(r => r.left < seed.left - size && /[A-Za-z]{4}/.test(r.text))) continue;
    group.forEach(({ i }) => result.add(i));
  }
  return result;
}
export function mathGroups(line: Line, runs: TextRun[]): number[][] {
  const groups: number[][] = [];
  const size = Math.max(...line.runs.map(i=>runSize(runs[i])));
  // Descriptive subscripts (N_success, f_cost) use a prose font. They are still
  // part of the equation, not words to translate or boundaries between crops.
  const label = (i: number) => runSize(runs[i]) < size * .85 && /^[A-Za-z]{1,24}$/.test(runs[i].text.trim());
  // Braces around affiliation emails and author daggers are not equations by
  // themselves. They can still join a group containing actual mathematical text.
  const seed = (i: number) => (!!runs[i].math && !/^[{}†‡]+$/.test(runs[i].text.trim()))
    || (mathSign.test(runs[i].text) && (runs[i].text.match(/[A-Za-z]{3,}/g) ?? []).every(w => /^(?:sin|cos|tan|log|exp|lim|arg|min|max|loc|update)$/.test(w)));
  const candidate = (i: number) => seed(i) || (!/^(?:[.!?;:]|we|in|is|to|of|an|as|or|at|by|be|on|a)$/i.test(runs[i].text.trim())
    && (label(i) || mathPart.test(runs[i].text.trim()) || /^(?:min|max|arg\s*(?:min|max))\s+[A-Za-z]$/.test(runs[i].text.trim())
      || /^[\s\d\p{P}\p{S}]+$/u.test(runs[i].text)));
  let group: number[] = [];
  const flush = () => { if (group.some(seed)) groups.push(group); group = []; };
  for (const i of line.runs) {
    const prev = group.at(-1);
    if (!candidate(i) || (prev !== undefined && runs[i].left - runs[prev].right > runSize(runs[i]) * 1.5)) flush();
    if (candidate(i)) group.push(i);
  }
  flush(); return groups;
}
export function isEquation(line: Line, runs: TextRun[]) {
  const groups = mathGroups(line, runs);
  if (!groups.length) return false;
  const mathematical = new Set(groups.flat());
  return line.runs.every(i => mathematical.has(i) || /^(?:[\s\d\p{P}\p{S}]+|if|update)$/u.test(runs[i].text.trim()));
}
export interface TextBlock { lines: Line[]; kind: NonNullable<SourceSentence['layout']>['kind']; table?: NonNullable<SourceSentence['layout']>['table'] }
/** Lines are layout hints, not translation units. Keep unfinished prose together
 * despite italics, superscripts, increased leading, or a column boundary. */
export function textBlocks(lines: Line[], runs: TextRun[]): TextBlock[] {
  const sizes = lines.filter(l => !l.kind).flatMap(l => l.runs.map(i => runs[i]))
    .filter(r => /[A-Za-z]{3}/.test(r.text) && !r.math).map(runSize).sort((a,b)=>a-b);
  const body = sizes[Math.floor(sizes.length/2)] || 10;
  const blocks: TextBlock[] = [];
  for (const [lineIndex,line] of lines.entries()) {
    const prior = blocks.at(-1), previous = prior?.lines.at(-1);
    const text = line.runs.map(i=>runs[i].text).join(' ').trim();
    let kind: TextBlock['kind'] = line.kind ?? (isEquation(line,runs) ? 'equation' : isHeading(line,runs,body) ? 'heading' : 'paragraph');
    if (!line.kind && lineIndex === 0 && lines[1] && lines[1].top-line.bottom>body*2 && !/[.!?]$/.test(text)) kind='heading';
    if (/^\(\d+[a-z]?\)$/.test(text) && prior?.kind === 'equation' && previous && line.top - previous.bottom < body * 2) kind = 'equation';
    const priorText = previous?.runs.map(i=>runs[i].text).join(' ').trim() ?? '';
    const terminal = /[.!?][\]\)"'’”]*$/.test(priorText) && !/\b(?:Fig|Eq|Sec|al)\.$/.test(priorText);
    const size = lineSize(line,runs), prevSize = previous ? lineSize(previous,runs) : size;
    const gap = previous ? line.top - previous.bottom : 0;
    const differentColumn = previous && line.column !== previous.column;
    const continuesColumn = previous?.column === 1 && line.column === 2 && !terminal;
    // Typography/caption-like text in the middle of unfinished prose is not a
    // new heading. Keep the sentence intact across that line boundary as well.
    if (kind==='heading' && prior?.kind==='paragraph' && !terminal && !/[:;]$/.test(priorText)
      && !/^(?:(?:\d+(?:\.\d+)*\.?|[IVXLCDM]+\.|[A-Z]\.)\s+)?(?:abstract|introduction|background|related work|materials and methods|methodology|methods?|results?(?: and discussion)?|discussion|conclusions?|references|acknowledg(?:e)?ments?|appendix)$/i.test(text)
      && (!differentColumn || continuesColumn) && gap<body*1.5 && Math.abs(size-prevSize)<body*.2) kind='paragraph';
    const headingContinuation = !/^(?:[IVXLCDM]+\.|[A-Z]\.|\d+(?:\.\d+)*\.)\s/.test(text) && kind === 'heading' && prior?.kind === 'heading' && gap < body && Math.abs(size-prevSize) < body * .2;
    const paragraphBreak = kind === 'paragraph' && terminal && (gap > body * .6 || (previous && line.left - previous.left > body * .6));
    const split = !prior || !previous || kind !== prior.kind || line.region !== previous.region
      || (kind === 'heading' && !headingContinuation)
      || (differentColumn && !continuesColumn && !headingContinuation)
      || (kind === 'equation' && gap > body * 2)
      || paragraphBreak || (gap > body * 5);
    if (split) blocks.push({lines:[line],kind}); else prior.lines.push(line);
  }
  return blocks;
}
