import { expect, it } from 'vitest';
import katex from 'katex';
import { normalizeLatex } from './latex';
it('repairs JSON control characters and overescaped commands in saved equations', () => {
 const damaged = '\boldsymbol{1}_n ' + String.raw`\\\\in \\\\mathbb{R}^{n\\\\times 1}`;
 const latex=normalizeLatex(damaged);
 expect(latex).toBe(String.raw`\boldsymbol{1}_n \in \mathbb{R}^{n\times 1}`);
 expect(()=>katex.renderToString(latex,{throwOnError:true})).not.toThrow();
 expect(normalizeLatex('\frac{1}{n} + x^{\top}')).toBe(String.raw`\frac{1}{n} + x^{\top}`);
});
it('preserves real matrix/aligned row separators and strips optional delimiters', () => {
 const source=String.raw`\begin{aligned} x &= 1 \\ y &= \frac{1}{n} \end{aligned}`;
 expect(normalizeLatex(source)).toBe(source);
 const rows=String.raw`\begin{matrix} 1 & 2 \\\frac{1}{n} & 4 \end{matrix}`;
 expect(normalizeLatex(rows)).toBe(rows);
 expect(normalizeLatex('\\[' + source + '\\]')).toBe(source);
 expect(normalizeLatex('$$x^2$$')).toBe('x^2');
});
