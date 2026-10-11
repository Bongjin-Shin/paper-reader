import { TextLayer, Util, type PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSentence, EquationSource } from '../types';
import { mathFont, mathGroups, textBlocks, clipInlineEquation, lineNumberRuns } from './translationLayout';
import { readingRegions } from './translationRegions';
import { rectToPdf } from './selection';
import { extractTables, tableRules } from './translationTables';

export interface TextRun { text: string; left: number; top: number; right: number; bottom: number; baseline?: number; fontSize?: number; inkTop?: number; inkBottom?: number; math?: boolean; bold?: boolean; italic?: boolean }
export interface Line { runs: number[]; left: number; top: number; right: number; bottom: number; column: number; kind?: NonNullable<SourceSentence['layout']>['kind']; region?: number }
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };

/** Find repeated whitespace BETWEEN columns before joining font runs into lines.
 * Group by vertical overlap so superscripts cannot reorder the surrounding text. */
export function orderedLines(runs: TextRun[]): Line[] {
  if (!runs.length) return [];
  const rows: Line[] = [];
  const make = (ids: number[], column = 0): Line => ({ runs: ids, column,
    left: Math.min(...ids.map(i => runs[i].left)), right: Math.max(...ids.map(i => runs[i].right)),
    top: Math.min(...ids.map(i => runs[i].top)), bottom: Math.max(...ids.map(i => runs[i].bottom)) });
  const order = runs.map((_, i) => i).sort((a, b) => runs[a].top - runs[b].top || runs[a].left - runs[b].left);
  const height = median(runs.filter(r => r.text.length > 3).map(r => r.fontSize ?? r.bottom - r.top)) || 10;
  const baseline = (r: Line) => median(r.runs.map(i => runs[i].baseline ?? runs[i].bottom));
  const scripts: number[] = [];
  const dropCaps: number[] = [];
  // Baselines are independent of font ascent and glyph bounding-box height.
  for (const i of order) {
    const run = runs[i];
    if (!run.math && /^[A-Z]$/.test(run.text) && (run.fontSize ?? height) > height * 1.8) { dropCaps.push(i); continue; }
    const raised = run.text.trim().length <= 3 && runs.some(other => other !== run && /[A-Za-z]{3}/.test(other.text)
      && (other.fontSize ?? height) > (run.fontSize ?? height) * 1.18 && other.baseline !== undefined && run.baseline !== undefined
      && other.baseline - run.baseline > height * .15 && other.baseline - run.baseline < height * .9
      && Math.min(Math.abs(other.right-run.left), Math.abs(run.right-other.left)) < height * 1.2);
    if (run.baseline !== undefined && (raised || ((run.fontSize ?? height) < height * .83 && (run.text.trim().length <= 3 || run.math))
      || /^[˜~ˆ^˙]$/.test(run.text.trim()) || (run.math && /^[^\p{L}\p{N}]+$/u.test(run.text)))) { scripts.push(i); continue; }
    const row = [...rows].reverse().find(r => run.baseline !== undefined
      ? Math.abs(baseline(r) - run.baseline) < Math.max(height,run.fontSize ?? height,...r.runs.map(i=>runs[i].fontSize ?? height)) * .25
      : Math.min(r.bottom, run.bottom) - Math.max(r.top, run.top) >= Math.min(r.bottom - r.top, run.bottom - run.top) * .35
        && Math.abs((r.top + r.bottom) - (run.top + run.bottom)) < height * 1.5);
    if (row) Object.assign(row, make([...row.runs, i])); else rows.push(make([i]));
  }
  for (const i of scripts) {
    const run = runs[i];
    const candidates = rows.filter(r => Math.abs(baseline(r) - run.baseline!) < height * 1.05);
    const distance = (r: Line) => Math.min(...r.runs.map(j => Math.max(0, runs[j].left - run.right, run.left - runs[j].right)))
      + Math.abs(baseline(r) - run.baseline!) * .35;
    const row = candidates.sort((a,b) => distance(a)-distance(b))[0];
    if (row) Object.assign(row, make([...row.runs, i])); else rows.push(make([i]));
  }
  for (const i of dropCaps) {
    const run = runs[i];
    const row = rows.filter(r => r.left >= run.left && r.left-run.right < height*2 && Math.abs(r.top-run.top)<height)
      .sort((a,b)=>Math.abs(a.top-run.top)-Math.abs(b.top-run.top))[0];
    if (row) Object.assign(row,make([...row.runs,i])); else rows.push(make([i]));
  }
  rows.sort((a, b) => a.top - b.top);
  for (const row of rows) row.runs.sort((a, b) => runs[a].left - runs[b].left);
  const min = Math.min(...runs.map(r => r.left)), max = Math.max(...runs.map(r => r.right)), width = max - min;
  const gaps = rows.flatMap(row => row.runs.slice(1).flatMap((id, index) => {
    const left = runs[row.runs[index]].right, right = runs[id].left;
    return right - left >= height * .8 && (left + right) / 2 > min + width * .25 && (left + right) / 2 < max - width * .25
      ? [(left + right) / 2] : [];
  }));
  let split = 0, best = 1.5;
  for (const x of gaps) {
    let pairs = 0, crossing = 0;
    for (const row of rows) {
      if (row.runs.some(i => runs[i].left < x && runs[i].right > x)) { crossing++; continue; }
      const left = row.runs.filter(i => runs[i].right <= x), right = row.runs.filter(i => runs[i].left >= x);
      const prose = (ids:number[]) => ids.some(i=>!runs[i].math && (runs[i].fontSize ?? height)>=height*.83
        && /[A-Za-z]{3}/.test(runs[i].text) && !/[=<>≤≥∑]/.test(runs[i].text));
      if (left.length && right.length && x - runs[left[0]].left > width * .15 && runs[right.at(-1)!].right - x > width * .15
        && runs[right[0]].left - runs[left.at(-1)!].right >= height * .8 && prose(left) && prose(right)) pairs++;
    }
    // Floating figures can leave too few coincident baselines to prove a gutter.
    // Repeated column starts also establish it when each side has several prose
    // lines, even if the caption uses a smaller font or different line spacing.
    const starts = (side: 'left' | 'right') => rows.filter(row => !row.runs.some(i => runs[i].left < x && runs[i].right > x))
      .map(row => row.runs.filter(i => side === 'left' ? runs[i].right <= x : runs[i].left >= x))
      .filter(ids => ids.some(i => !runs[i].math && (runs[i].fontSize ?? height) >= height * .83 && /[A-Za-z]{4}/.test(runs[i].text)))
      .map(ids => runs[ids[0]].left);
    const aligned = (xs: number[]) => Math.max(0, ...xs.map(start => xs.filter(v => Math.abs(v-start) < height * 1.5).length));
    const support = pairs >= 2 ? pairs : Math.min(aligned(starts('left')), aligned(starts('right')));
    const score = (pairs >= 2 ? pairs : support >= 3 ? support * .6 : 0) - crossing * .08;
    if (score > best) { best = score; split = x; }
  }
  if (!split) return rows;
  const result: Line[] = [], band: Line[] = [];
  const flush = () => { result.push(...band.filter(l => l.column === 1), ...band.filter(l => l.column === 2)); band.length = 0; };
  for (const [rowIndex, row] of rows.entries()) {
    const left = row.runs.filter(i => runs[i].right <= split), right = row.runs.filter(i => runs[i].left >= split);
    const previous = result.at(-1), rowHeight = row.bottom - row.top;
    // A wrapped full-width title may end before the gutter. Keep its next line
    // with it, without treating larger headings inside either column as spanning.
    const titleContinuation = !band.length && previous?.column === 0 && !right.length
      && rowHeight > height * 1.35 && Math.abs(rowHeight - (previous.bottom - previous.top)) < height * .25
      && row.top - previous.bottom < rowHeight * .8 && Math.abs(row.left - previous.left) < height;
    const header = rowIndex === 0 && rows.length > 1 && rows[1].top - row.bottom > height * 1.2
      && left.length > 0 && right.length > 0 && row.runs.some(i => /^\d{1,5}$/.test(runs[i].text.trim()));
    const bridges = header || row.runs.some(i => runs[i].left < split && runs[i].right > split)
      || (left.length && right.length && runs[right[0]].left - runs[left.at(-1)!].right < height * .8) || titleContinuation;
    if (bridges) { flush(); result.push(row); }
    else { if (left.length) band.push(make(left, 1)); if (right.length) band.push(make(right, 2)); }
  }
  flush(); return result;
}

export function sentenceRanges(text: string): { start: number; end: number; text: string }[] {
  const prepared = text.replace(/\n/g, ' ').replace(/\b(?:Fig(?:s)?|Eq(?:s)?|Sec|Refs?|Dr|Mr|Mrs|Prof|No|et al)\.|\b(?:e\.g|i\.e)\./gi, value => value.replaceAll('.', '·'));
  return [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(prepared)].map(item => {
    const start = item.index + item.segment.length - item.segment.trimStart().length;
    const end = item.index + item.segment.trimEnd().length;
    return { start, end, text: text.slice(start, end).replace(/[-\u00ad]\n(?=[a-z])/g, match => match[0] === '\u00ad' ? '' : '-')
      .replace(/\s+/g, ' ').trim() };
  }).filter(item => /[\p{L}\p{N}]/u.test(item.text));
}

/** Only on an explicit page translation. No canvas and no changes to the live selection.
 * A temporary, unrotated PDF.js Text Layer gives exact character Range boxes in PDF units. */
export async function extractPageSentences(pdf: PDFDocumentProxy, pageNumber: number): Promise<SourceSentence[]> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1, rotation: 0 });
  const content = await page.getTextContent();
  const host = document.createElement('div');
  host.className = 'translation-extraction';
  Object.assign(host.style, { width: `${viewport.width}px`, height: `${viewport.height}px` });
  const layer = document.createElement('div'); layer.className = 'textLayer';
  layer.style.setProperty('--scale-factor', '1');
  layer.style.setProperty('--total-scale-factor', String(page.userUnit));
  host.append(layer); document.body.append(host);
  const task = new TextLayer({ textContentSource: content, container: layer, viewport });
  try {
    await task.render();
    const rules = await tableRules(page, viewport); // Also loads font names through PDF.js' operator cache.
    const nodes: Text[] = [], runs: TextRun[] = [];
    const items = content.items.filter(item => 'str' in item);
    for (const [index, element] of task.textDivs.entries()) {
      const item = items[index], node = element.firstChild;
      if (!item?.str.trim() || !node || node.nodeType !== Node.TEXT_NODE) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const bounds = range.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) continue;
      const matrix = Util.transform(viewport.transform, item.transform);
      const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null;
      const name = String(font?.name ?? '');
      const size = Math.hypot(matrix[2],matrix[3]), style = content.styles[item.fontName];
      nodes.push(node as Text);
      runs.push({ text: item.str, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
        baseline: matrix[5] + (/^[√∑∏⋃⋂∫]$/.test(item.str) && style.ascent === 0 ? size * .84 : 0), fontSize: size,
        inkTop: matrix[5] - size * (style.ascent || .8), inkBottom: matrix[5] - size * (style.descent || -.2),
        math: mathFont.test(name), bold: /bold|semibold/i.test(name), italic: /italic|oblique/i.test(name) });
    }
    const numbers = lineNumberRuns(runs);
    for (const index of [...numbers].sort((a, b) => b - a)) { runs.splice(index, 1); nodes.splice(index, 1); }
    const bodySize = median(runs.filter(r => !r.math && /[A-Za-z]{3}/.test(r.text)).map(r => r.fontSize ?? 10)) || 10;
    const origin = host.getBoundingClientRect();
    const { used, tables } = extractTables(runs, rules.map(r=>({left:r.left+origin.left,right:r.right+origin.left,top:r.top+origin.top})));
    const bodyIds = runs.map((_,i)=>i).filter(i=>!used.has(i));
    const bodyLines = orderedLines(bodyIds.map(i=>runs[i])).map(line=>({...line,runs:line.runs.map(i=>bodyIds[i])}));
    const lines = readingRegions(bodyLines, runs, viewport.height);
    const blocks = textBlocks(lines, runs);
    for (const table of tables) {
      const after = blocks.findIndex(block => block.kind === 'caption' && block.lines.some(line=>Math.abs(line.top-table.captionTop)<bodySize));
      blocks.splice(after < 0 ? blocks.length : after+1, 0, ...table.cells);
    }
    const sentences: SourceSentence[] = [];
    let mathId = pageNumber * 1000;
    const equation = (ids: number[], punctuation = '', line?: Line): EquationSource => {
      const boxes = ids.map(i => {
        if (punctuation && i===ids.at(-1)) {
          const end = runs[i].text.lastIndexOf(punctuation);
          if (end>0) { const range = document.createRange(); range.setStart(nodes[i],0); range.setEnd(nodes[i],end); return range.getBoundingClientRect(); }
        }
        return runs[i];
      });
      let box = { left: Math.min(...boxes.map(r=>r.left))-1, right: Math.max(...boxes.map(r=>r.right))+1,
        top: Math.min(...boxes.map(r=>r.top))-2, bottom: Math.max(...boxes.map(r=>r.bottom))+2 };
      if (line) box = clipInlineEquation(box,line,runs);
      const round = (n: number) => Math.round(n * 100) / 100;
      return { pageNumber, token: `[[PV_MATH_${mathId++}]]`, text: ids.map(i=>runs[i].text).join(' ').trim(), rect: rectToPdf(box as DOMRect,origin,viewport), fontSize: (median(ids.map(i=>runs[i].fontSize ?? 10)) || 10) / page.userUnit,
        glyphs: ids.map(i => ({ text: runs[i].text, x: round(runs[i].left - box.left), y: round((runs[i].baseline ?? runs[i].bottom) - box.top), size: round(runs[i].fontSize ?? 10) })) };
    };
    for (const [paragraph, block] of blocks.entries()) {
      const prose = block.lines.flatMap(l => l.runs.map(i => runs[i])).filter(r => !r.math);
      const weight = (predicate: (r: TextRun) => boolean) => prose.reduce((n, r) => n + (predicate(r) ? r.text.trim().length : 0), 0);
      const total = weight(() => true) || 1;
      const typography = { fontScale: Math.max(.65, Math.min(2.5, (median(prose.map(r => r.fontSize ?? bodySize)) || bodySize) / bodySize)),
        bold: weight(r => !!r.bold) / total > .55, italic: weight(r => !!r.italic) / total > .55 };
      const cellRuns = block.lines.flatMap(l=>l.runs.map(i=>runs[i]));
      const mathCell = block.table && !block.table.header && cellRuns.some(r=>r.math)
        && !cellRuns.some(r=>!r.math && (r.fontSize ?? bodySize)>=bodySize*.85 && /[A-Za-z]{4,}\s+[A-Za-z]{4,}/.test(r.text));
      if (block.kind === 'equation' || mathCell) {
        const math = equation(block.lines.flatMap(line=>line.runs));
        sentences.push({id:sentences.length,text:math.token,rects:[math.rect],layout:{paragraph,kind:block.kind,table:block.table,math:[math],typography,sources:[{pageNumber,rects:[math.rect]}]}});
        continue;
      }
      let text = '';
      const spans: { run?: number; math?: EquationSource; start: number; end: number }[] = [];
      for (const [lineIndex, line] of block.lines.entries()) {
        if (lineIndex) text += '\n';
        const groups = mathGroups(line,runs), mathRuns = new Set(groups.flat());
        const starts = new Map(groups.map(ids=>[ids[0], ids]));
        let previous: TextRun | undefined;
        for (const run of line.runs) {
          const item = runs[run], ids = starts.get(run);
          if (mathRuns.has(run) && !ids) continue;
          const dropCap = previous && /^[A-Z]$/.test(previous.text) && (previous.fontSize ?? 0)>(item.fontSize ?? 10)*1.8;
          if (previous && !dropCap && item.left - previous.right > (item.fontSize ?? item.bottom-item.top) * .12 && !/\s$/.test(text) && !/^\s/.test(item.text)) text += ' ';
          const start = text.length;
          if (ids) { const punctuation = /(?<!\.)[.!?]\s*$/.exec(runs[ids.at(-1)!].text)?.[0].trim() ?? '';
            const math = equation(ids,punctuation,line); text += math.token+punctuation; spans.push({math,start,end:text.length}); previous = runs[ids.at(-1)!]; }
          else { text += item.text; spans.push({run,start,end:text.length}); previous = item; }
        }
      }
      const ranges = block.kind === 'heading' || block.kind === 'table' ? [{start:0,end:text.length,text:text.replace(/\s+/g,' ').trim()}] : sentenceRanges(text);
      for (const sentence of ranges) {
        const rects: SourceSentence['rects'] = [], math: EquationSource[] = [];
        for (const span of spans) {
          const start = Math.max(span.start, sentence.start), end = Math.min(span.end, sentence.end);
          if (start >= end) continue;
          if (span.math) { rects.push(span.math.rect); math.push(span.math); continue; }
          const range = document.createRange(); range.setStart(nodes[span.run!], start-span.start); range.setEnd(nodes[span.run!], end-span.start);
          for (const box of range.getClientRects()) { if (box.width>.1 && box.height>.1) rects.push(rectToPdf(box,origin,viewport)); }
        }
        if (rects.length) sentences.push({id:sentences.length,text:sentence.text,rects,layout:{paragraph,kind:block.kind,table:block.table,math,typography,sources:[{pageNumber,rects}]}});
      }
    }
    if (!sentences.length) throw new Error('선택 가능한 텍스트가 없는 페이지입니다. 이미지로 된 페이지는 본문 번역을 지원하지 않습니다.');
    if (sentences.length > 256 || sentences.reduce((sum, s) => sum + [...s.text].length + (s.layout?.math.reduce((n,m)=>n+[...m.text].length,0) ?? 0), 0) > 20000) {
      throw new Error('이 페이지의 텍스트가 너무 많습니다. 필요한 부분을 드래그해 번역해 주세요.');
    }
    return sentences;
  } finally { task.cancel(); host.remove(); }
}
