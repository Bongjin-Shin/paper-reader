import { OPS, Util, type PDFPageProxy, type PageViewport } from 'pdfjs-dist';
import { orderedLines, type TextRun, type Line } from './pageTranslation';

export interface HorizontalRule { left: number; right: number; top: number }
/** Vector rules identify ruled tables without confusing two-column body text. */
export async function tableRules(page: PDFPageProxy, viewport: PageViewport, minimumWidth = 60): Promise<HorizontalRule[]> {
  const list = await page.getOperatorList(), stack: number[][] = [], rules: HorizontalRule[] = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i], args = list.argsArray[i];
    if (op === OPS.save || op === OPS.paintFormXObjectBegin) {
      stack.push(matrix);
      if (op === OPS.paintFormXObjectBegin && args?.[0]) matrix = Util.transform(matrix, args[0]);
    } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd) matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === OPS.transform) matrix = Util.transform(matrix, args);
    else if (op === OPS.constructPath && args?.[2]?.length === 4) {
      const [x1, y1, x2, y2] = args[2], transform = Util.transform(viewport.transform, matrix);
      const points = [[x1, y1], [x2, y1], [x1, y2], [x2, y2]].map(p => { Util.applyTransform(p, transform); return p; });
      const left = Math.min(...points.map(p => p[0])), right = Math.max(...points.map(p => p[0]));
      const top = Math.min(...points.map(p => p[1])), bottom = Math.max(...points.map(p => p[1]));
      if (right - left > minimumWidth * page.userUnit && bottom - top < 2 * page.userUnit) rules.push({ left, right, top: (top + bottom) / 2 });
    }
  }
  return rules;
}
const textOf = (line: Line, runs: TextRun[]) => line.runs.map(i => runs[i].text).join(' ').trim();
const median = (a: number[]) => [...a].sort((x,y) => x-y)[Math.floor(a.length / 2)] ?? 10;
export function extractTables(runs: TextRun[], rules: HorizontalRule[]) {
  const size = median(runs.filter(r => !r.math && /[A-Za-z]{4}/.test(r.text)).map(r => r.fontSize ?? 10));
  const captions = orderedLines(runs).filter(l => /^Table\s*(?:\d+|[A-Z](?:\.?\d+)?|[IVXLCDM]+)\b/i.test(textOf(l, runs)));
  const used = new Set<number>(), tables: { captionTop: number; label: string; bounds: { left: number; right: number; top: number; bottom: number } }[] = [];
  for (const caption of captions) {
    const top = rules.filter(r => r.top > caption.bottom && r.top - caption.bottom < size * 16
      && caption.left >= r.left - size * 3 && caption.left <= r.right + size).sort((a,b) => a.top-b.top)[0];
    if (!top) continue;
    const aligned = rules.filter(r => r.top >= top.top && Math.abs(r.left-top.left) < size && Math.abs(r.right-top.right) < size).sort((a,b) => a.top-b.top);
    const borders = [aligned[0]];
    for (const rule of aligned.slice(1)) {
      if (rule.top - borders.at(-1)!.top > size * 12) break;
      if (rule.top - borders.at(-1)!.top > 1) borders.push(rule);
    }
    if (borders.length < 2) continue;
    const ids = runs.flatMap((r,i) => !used.has(i) && r.left >= top.left-size && r.right <= top.right+size
      && (r.baseline ?? r.bottom) > top.top && (r.baseline ?? r.bottom) < borders.at(-1)!.top + 1 ? [i] : []);
    if (!ids.length) continue;
    ids.forEach(i=>used.add(i));
    tables.push({ captionTop: caption.top, label: textOf(caption, runs), bounds: {
      left: Math.min(top.left, ...ids.map(i=>runs[i].left)) - 2,
      right: Math.max(top.right, ...ids.map(i=>runs[i].right)) + 2,
      top: top.top - 2, bottom: Math.max(borders.at(-1)!.top, ...ids.map(i=>runs[i].bottom)) + 2,
    } });
  }
  return { used, tables };
}
