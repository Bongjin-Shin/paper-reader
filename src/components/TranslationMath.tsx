import { useMemo } from 'react';
import katex from 'katex';
import type { EquationSource } from '../types';
import { normalizeLatex } from '../lib/latex';

export function TranslationMath({ latex, source, display }: { latex: string; source?: EquationSource; display: boolean }) {
  const result = useMemo(() => {
    try { return { html: katex.renderToString(normalizeLatex(latex), { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000 }) }; }
    catch { return { fallback: source?.text || normalizeLatex(latex) }; }
  }, [latex, source, display]);
  return result.html ? <span className={display ? 'translation-math display' : 'translation-math'} dangerouslySetInnerHTML={{ __html: result.html }} />
    : <span className="translation-math-fallback" title="수식을 표시하지 못했습니다. 페이지 재번역으로 다시 변환할 수 있습니다.">{result.fallback}</span>;
}
