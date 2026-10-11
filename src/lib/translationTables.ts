import { OPS, Util, type PDFPageProxy, type PageViewport } from 'pdfjs-dist';
import { orderedLines, type TextRun, type Line } from './pageTranslation';
import type { TextBlock } from './translationLayout';

export interface HorizontalRule { left: number; right: number; top: number }
/** Vector rules identify ruled tables without confusing two-column body text. */
export async function tableRules(page: PDFPageProxy, viewport: PageViewport): Promise<HorizontalRule[]> {
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
      if (right - left > 60 * page.userUnit && bottom - top < 2 * page.userUnit) rules.push({ left, right, top: (top + bottom) / 2 });
    }
  }
  return rules;
}
const textOf = (line: Line, runs: TextRun[]) => line.runs.map(i => runs[i].text).join(' ').trim();
const median = (a: number[]) => [...a].sort((x,y) => x-y)[Math.floor(a.length / 2)] ?? 10;
export function extractTables(runs: TextRun[], rules: HorizontalRule[]) {
  const size = median(runs.filter(r => !r.math && /[A-Za-z]{4}/.test(r.text)).map(r => r.fontSize ?? 10));
  const captions = orderedLines(runs).filter(l => /^Table\s*(?:\d+|[A-Z](?:\.?\d+)?|[IVXLCDM]+)\b/i.test(textOf(l, runs)));
  const used = new Set<number>(), tables: { captionTop: number; cells: TextBlock[] }[] = [];
  for (const caption of captions) {
    const top = rules.filter(r => r.top > caption.bottom && r.top - caption.bottom < size * 16
      && Math.abs(r.left - caption.left) < size * 3).sort((a,b) => a.top-b.top)[0];
    if (!top) continue;
    const aligned = rules.filter(r => r.top >= top.top && Math.abs(r.left-top.left) < size && Math.abs(r.right-top.right) < size).sort((a,b) => a.top-b.top);
    const borders = [aligned[0]];
    for (const rule of aligned.slice(1)) {
      if (rule.top - borders.at(-1)!.top > size * 12) break;
      if (rule.top - borders.at(-1)!.top > 1) borders.push(rule);
    }
    if (borders.length < 3) continue;
    const ids = runs.flatMap((r,i) => !used.has(i) && r.left >= top.left-size && r.right <= top.right+size
      && (r.baseline ?? r.bottom) > top.top && (r.baseline ?? r.bottom) < borders.at(-1)!.top + 1 ? [i] : []);
    const header = ids.filter(i => (runs[i].baseline ?? runs[i].bottom) < borders[1].top).sort((a,b) => runs[a].left-runs[b].left);
    const groups: number[][] = [];
    for (const i of header) {
      const prior = groups.at(-1);
      if (!prior || runs[i].left - Math.max(...prior.map(j=>runs[j].right)) > size * 1.8) groups.push([i]);
      else prior.push(i);
    }
    if (groups.length < 2 || groups.length > 16) continue;
    const columns = groups.map(group => Math.min(...group.map(i=>runs[i].left)) - size * .5);
    const columnOf = (r: TextRun) => columns.reduce((found, x, i) => r.left >= x ? i : found, 0);
    const labels = ids.filter(i => !header.includes(i) && columnOf(runs[i]) === 0).sort((a,b) => (runs[a].baseline ?? runs[a].bottom) - (runs[b].baseline ?? runs[b].bottom));
    const anchors: number[] = [];
    for (const i of labels) {
      const y = runs[i].baseline ?? runs[i].bottom;
      if (!anchors.length || y - anchors.at(-1)! > size * 1.35) anchors.push(y);
    }
    if (!anchors.length) continue;
    const cells = new Map<string, number[]>();
    for (const i of ids) {
      const r = runs[i], row = header.includes(i) ? 0 : 1 + anchors.reduce((best,y,index) => Math.abs(y-(r.baseline ?? r.bottom)) < Math.abs(anchors[best]-(r.baseline ?? r.bottom)) ? index : best, 0);
      const key = `${row}:${columnOf(r)}`; cells.set(key, [...cells.get(key) ?? [], i]);
    }
    const tableId = tables.length;
    const blocks: TextBlock[] = [...cells].sort(([a],[b]) => { const [ar,ac]=a.split(':').map(Number),[br,bc]=b.split(':').map(Number);return ar-br || ac-bc; }).map(([key, ids]) => {
      const [row,column] = key.split(':').map(Number);
      return { kind: 'table', table: { id: tableId, row, column, columns: groups.length, header: row === 0 },
        lines: orderedLines(ids.map(i=>runs[i])).map(line=>({...line,runs:line.runs.map(i=>ids[i])})) };
    });
    ids.forEach(i=>used.add(i)); tables.push({ captionTop: caption.top, cells: blocks });
  }
  return { used, tables };
}
