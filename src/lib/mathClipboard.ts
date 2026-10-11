import type { EquationGlyph } from '../types';
import { normalizeLatex } from './latex';

export type CopyGlyph = EquationGlyph & { width?: number };
const symbols: Record<string, string> = {
  α:'\\alpha', β:'\\beta', γ:'\\gamma', δ:'\\delta', ε:'\\epsilon', ϵ:'\\varepsilon', ζ:'\\zeta', η:'\\eta', θ:'\\theta', ϑ:'\\vartheta',
  ι:'\\iota', κ:'\\kappa', λ:'\\lambda', μ:'\\mu', ν:'\\nu', ξ:'\\xi', π:'\\pi', ρ:'\\rho', σ:'\\sigma', τ:'\\tau', υ:'\\upsilon', φ:'\\phi', ϕ:'\\varphi', χ:'\\chi', ψ:'\\psi', ω:'\\omega',
  Γ:'\\Gamma', Δ:'\\Delta', Θ:'\\Theta', Λ:'\\Lambda', Ξ:'\\Xi', Π:'\\Pi', Σ:'\\Sigma', Φ:'\\Phi', Ψ:'\\Psi', Ω:'\\Omega',
  '∑':'\\sum', '∏':'\\prod', '∫':'\\int', '∮':'\\oint', '√':'\\sqrt', '∞':'\\infty', '∂':'\\partial', '∇':'\\nabla',
  '∈':'\\in', '∉':'\\notin', '⊂':'\\subset', '⊃':'\\supset', '⊆':'\\subseteq', '⊇':'\\supseteq', '∪':'\\cup', '∩':'\\cap', '⋃':'\\bigcup', '⋂':'\\bigcap',
  '≤':'\\le', '≥':'\\ge', '≠':'\\ne', '≈':'\\approx', '≡':'\\equiv', '±':'\\pm', '×':'\\times', '·':'\\cdot', '÷':'\\div',
  '→':'\\to', '←':'\\leftarrow', '↔':'\\leftrightarrow', '⇒':'\\Rightarrow', '∀':'\\forall', '∃':'\\exists', '∅':'\\emptyset',
  '…':'\\ldots', '⋯':'\\cdots', '⋮':'\\vdots', '⋱':'\\ddots', '−':'-', '–':'-', 'ℝ':'\\mathbb{R}', 'ℕ':'\\mathbb{N}', 'ℤ':'\\mathbb{Z}',
};
export function latexText(text: string): string {
  return [...text.replace(/\.\s*\.\s*\./g, '…')].map(c => symbols[c] ? symbols[c] + ' ' : /[{}%&#$]/.test(c) ? '\\' + c : c)
    .join('').replace(/\b(sin|cos|tan|log|ln|exp|lim|min|max)\b/g, '\\$1').replace(/\s+/g, ' ').trim();
}
const right = (g: CopyGlyph) => g.x + (g.width ?? Math.max(1, g.text.length) * g.size * .5);
const overlap = (a: CopyGlyph, b: CopyGlyph) => Math.min(right(a), right(b)) - Math.max(a.x, b.x);
const largeOperator = (g: CopyGlyph) => /^[∑∏∫∮⋃⋂]$/.test(g.text.trim());

/** Local fallback for PDFs: use baselines/sizes, not the flattened PDF text.
 * Saved model-generated LaTeX takes precedence when the same expression exists. */
export function glyphsToLatex(input: CopyGlyph[], depth = 0): string {
  const glyphs = input.filter(g => g.text.trim());
  if (!glyphs.length) return '';
  if (depth > 8 || glyphs.length > 2048) return latexText(glyphs.map(g => g.text).join(' '));
  const ordinary = glyphs.filter(g => !largeOperator(g));
  const size = Math.max(...(ordinary.length ? ordinary : glyphs).map(g => g.size));
  const anchors = glyphs.filter(g => g.size >= size * .9 && !largeOperator(g));
  const candidates = anchors.length ? anchors : glyphs;
  const baseline = candidates.reduce((best, g) => {
    const score = (at: CopyGlyph) => candidates.filter(c => Math.abs(c.y - at.y) < size * .22)
      .reduce((sum, c) => sum + Math.min(12, c.text.trim().length), 0);
    return score(g) > score(best) ? g : best;
  }).y;
  const base = glyphs.filter(g => Math.abs(g.y - baseline) <= size * .22 && g.size >= size * .85 || largeOperator(g)).sort((a,b) => a.x-b.x);
  const used = new Set<CopyGlyph>();
  const atoms: { x: number; tex: string; y: number }[] = [];
  for (const op of base.filter(largeOperator)) {
    const end = base.find(g => g.x > op.x + size * .5)?.x ?? right(op) + size * 2;
    const limits = glyphs.filter(g => g !== op && g.size < size * .9 && g.x >= op.x - size * .5 && g.x < end);
    const upper = limits.filter(g => g.y < baseline - size * .22), lower = limits.filter(g => g.y > baseline + size * .1);
    [op,...upper,...lower].forEach(g => used.add(g));
    atoms.push({ x:op.x, y:baseline, tex:latexText(op.text)
      + (lower.length ? `_{${glyphsToLatex(lower,depth+1)}}` : '') + (upper.length ? `^{${glyphsToLatex(upper,depth+1)}}` : '') });
  }
  // A fraction straddles the baseline with vertically separated, overlapping
  // numerator/denominator. Ordinary superscript/subscript pairs remain attached
  // to their base letter unless the denominator extends well below that line.
  const upper = glyphs.filter(g => !used.has(g) && g.y < baseline - size * .25);
  const lower = glyphs.filter(g => !used.has(g) && g.y > baseline + size * .32);
  for (const numerator of upper) {
    if (used.has(numerator)) continue;
    const denominator = lower.find(g => !used.has(g) && overlap(g,numerator) > Math.min(right(g)-g.x,right(numerator)-numerator.x) * .35);
    if (!denominator || base.some(g => !used.has(g) && overlap(g,numerator) > size * .15)) continue;
    used.add(numerator); used.add(denominator);
    atoms.push({x: Math.min(numerator.x,denominator.x), y:baseline, tex:`\\frac{${glyphsToLatex([numerator],depth+1)}}{${glyphsToLatex([denominator],depth+1)}}`});
  }
  // A selected fraction alone has no surrounding baseline anchor.
  if (!atoms.length && base.length && glyphs.length > base.length) {
    const high = Math.min(...glyphs.map(g=>g.y)), low = Math.max(...glyphs.map(g=>g.y));
    const top = glyphs.filter(g=>g.y < (high+low)/2), bottom = glyphs.filter(g=>g.y >= (high+low)/2);
    if (low-high > size*.7 && top.length && bottom.length && top.some(a=>bottom.some(b=>overlap(a,b)>size*.2))
      && Math.abs(Math.min(...top.map(g=>g.x))-Math.min(...bottom.map(g=>g.x)))<size*.4) {
      return `\\frac{${glyphsToLatex(top,depth+1)}}{${glyphsToLatex(bottom,depth+1)}}`;
    }
  }
  for (const [index, g] of base.entries()) {
    if (used.has(g)) continue;
    const next = base[index+1]?.x ?? Infinity;
    const scripts = glyphs.filter(s => !used.has(s) && s !== g && s.size < g.size * .86
      && s.x >= g.x && s.x < next - size * .05);
    const upper = scripts.filter(s => s.y < g.y - g.size * .1);
    const lower = scripts.filter(s => s.y > g.y + g.size * .08);
    [g,...upper,...lower].forEach(s=>used.add(s));
    atoms.push({x:g.x,y:baseline,tex:latexText(g.text)
      + (lower.length ? `_{${glyphsToLatex(lower,depth+1)}}` : '') + (upper.length ? `^{${glyphsToLatex(upper,depth+1)}}` : '')});
  }
  for (const g of glyphs.filter(g=>!used.has(g))) atoms.push({x:g.x,y:g.y,tex:latexText(g.text)});
  // Multiple full-size baselines are separate display equations, not scripts.
  const rows: typeof atoms[] = [];
  for (const atom of atoms.sort((a,b)=>a.y-b.y || a.x-b.x)) {
    const row = rows.find(r=>Math.abs(r[0].y-atom.y)<size*.4);
    if (row) row.push(atom); else rows.push([atom]);
  }
  const text = rows.map(row=>row.sort((a,b)=>a.x-b.x).map(g=>g.tex).join(' ').replace(/\s+([,;])/g,'$1').trim());
  return text.length > 1 ? `\\begin{gathered} ${text.join(' \\\\ ')} \\end{gathered}` : text[0] ?? '';
}
export const mathMarkdown = (latex: string, display = false) => {
  const text = normalizeLatex(latex);
  return display ? `\n\n$$\n${text}\n$$\n\n` : `$${text}$`;
};
