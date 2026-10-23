import { orderedLines, type TextRun } from './pageTranslation';
import type { HorizontalRule } from './translationTables';
import { runSize } from './translationLayout';

/** Algorithm boxes are floating code, not prose. Detect their own column bounds
 * before line ordering, since their heading may share a baseline with body text
 * in the other column. A mention of “Algorithm 1” alone never excludes text. */
export function algorithmRuns(runs: TextRun[], rules: HorizontalRule[]): Set<number> {
  const used = new Set<number>();
  for (const label of runs) {
    if (!/^Algorithm(?:\s|$)/i.test(label.text.trim())) continue;
    const size = runSize(label), baseline = label.baseline ?? label.bottom;
    const top = rules.filter(r => r.right - r.left > size * 8
      && label.left >= r.left - size * .5 && label.left <= r.left + size * 2
      && baseline > r.top && baseline - r.top < size * 2)
      .sort((a,b) => b.top - a.top)[0];
    if (!top) continue;
    const header = runs.filter(r => Math.abs((r.baseline ?? r.bottom) - baseline) < size * .4
      && r.left >= top.left - 1 && r.right <= top.right + 1)
      .sort((a,b) => a.left - b.left).map(r => r.text).join(' ');
    if (!/^Algorithm\s+(?:\d+|[IVXLCDM]+)\b/i.test(header)) continue;
    const below = rules.filter(r => r.top > baseline && Math.abs(r.left - top.left) < size * .5
      && Math.abs(r.right - top.right) < size * .5).sort((a,b) => a.top - b.top);
    const separator = below[0];
    const bottom = separator && below.find(r => r.top > separator.top + size);
    // Three aligned borders establish a closed pseudocode box, including a
    // wrapped title. Do not guess an end from keywords in surrounding prose.
    if (!separator || separator.top - baseline > size * 4 || !bottom) continue;
    runs.forEach((r,i) => {
      const base = r.baseline ?? r.bottom;
      if (r.left >= top.left - size * .5 && r.right <= top.right + size * .5
        && base > top.top && base < bottom.top + 1) used.add(i);
    });
  }
  // Some algorithm2e styles have only indentation/vertical guides, and put
  // their caption BELOW the code. Require a complete Input/Output/control-flow
  // pattern in one column instead of deleting paragraphs mentioning algorithms.
  const lines = orderedLines(runs);
  const text = (ids: number[]) => ids.map(i => runs[i].text).join(' ').trim();
  for (const caption of lines) {
    if (!/^Algorithm\s+(?:\d+|[IVXLCDM]+)\s*[:.]/i.test(text(caption.runs))) continue;
    if (caption.runs.some(i => used.has(i))) continue;
    const above = lines.filter(l => l.column === caption.column && l.columnGroup === caption.columnGroup && l.top < caption.top);
    const start = above.reduce((last,l,i) => /^(?:Input|Require)\s*:/i.test(text(l.runs)) ? i : last, -1);
    if (start < 0) continue;
    const code = above.slice(start), texts = code.map(l => text(l.runs));
    if (!texts.some(t => /^(?:Output|Ensure)\s*:/i.test(t))
      || texts.filter(t => /^(?:\d+[.:]?\s+)?(?:for(?:each)?\b|while\b|if\b|else\b|end\b|return\b)/i.test(t)).length < 3
      || !/^(?:\d+[.:]?\s+)?(?:end\b|return\b)/i.test(texts.at(-1) ?? '')
      || caption.top - code.at(-1)!.bottom > runSize(runs[caption.runs[0]]) * 2) continue;
    [...code,caption].forEach(l => l.runs.forEach(i => used.add(i)));
  }
  return used;
}
