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
it('repairs double-escaped set braces and cases without damaging row breaks', () => {
 const set = String.raw`\\left\\{T_i^t,N_i^t,M_i^t\\right\\}`;
 expect(normalizeLatex(set)).toBe(String.raw`\left\{T_i^t,N_i^t,M_i^t\right\}`);
 expect(()=>katex.renderToString(normalizeLatex(set),{throwOnError:true})).not.toThrow();
 const cases=String.raw`w_i=\begin{cases}\frac{\sum_{j=1}^{k_b}\operatorname{abs}(c_L^{(j)}-q_{m_i}^{(j)})}{\sum_{j=1}^{k_b}q_{m_i}^{(j)}}, & c_L\succeq q_{m_i} \\ \eta, & \text{otherwise}\end{cases}`;
 expect(normalizeLatex(cases)).toBe(cases);
 expect(katex.renderToString(normalizeLatex(cases),{throwOnError:true})).toContain('mfrac');
});
it('restores operators before subscripts and decodes uniformly escaped cases rows once',()=>{
 const source=String.raw`\begin{cases}\sum_{i=1}^n\bar{x}_i,&x\succeq0\\\eta,&\text{otherwise}\end{cases}`;
 const encoded=source.replaceAll('\\','\\\\');
 expect(normalizeLatex(encoded)).toBe(source);
 const html=katex.renderToString(normalizeLatex(encoded),{throwOnError:true});
 expect(html).toContain('∑');expect(html).toContain('<mover');expect(html).toMatch(/[≽⪰]/);
});
it('keeps single and per-row equation numbers in flow without invalid repeated KaTeX tags', () => {
 const source=String.raw`\begin{aligned}Q&=W^Qh^q\tag{3}\\\alpha_z&=\operatorname{Attention}(Q_z,K_z,V_z)\tag{4}\\&=\frac{Q_zK_z^T}{\sqrt d}V_z\tag{5}\end{aligned}`;
 const latex=normalizeLatex(source), html=katex.renderToString(latex,{displayMode:true,throwOnError:true});
 expect(latex).not.toContain('\\tag');
 for(const number of [3,4,5])expect(html).toContain(`(${number})`);
 expect(html).not.toContain('class="tag"');
 expect((html.match(/<mtr>/g) ?? []).length).toBe(3);
 expect(normalizeLatex(String.raw`W=\frac{1}{k_m}\sum_{i=1}^{k_n}w_i\tag{1}`)).toContain(String.raw`\qquad\text{(1)}`);
 expect(normalizeLatex(String.raw`x=1\tag*{A}`)).toContain(String.raw`\qquad\text{A}`);
});
it('preserves continuation rows beginning with alignment markers or braced expressions', () => {
 const source = String.raw`\begin{aligned}x&=a\\&=b\\{y}&=c\end{aligned}`;
 expect(normalizeLatex(source)).toBe(source);
 expect((katex.renderToString(normalizeLatex(source), {throwOnError:true}).match(/<mtr>/g) ?? []).length).toBe(3);
});
