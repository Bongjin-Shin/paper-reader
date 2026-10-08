import { expect, it } from 'vitest';
import { chatMarkdown } from './chatMarkdown';
it('normalizes inline and display LaTeX for readable math', () => {
  expect(chatMarkdown(String.raw`**잔차** \(r_i^s\) 입니다.`)).toBe('**잔차** $r_i^s$ 입니다.');
  expect(chatMarkdown('계산식:\n\\[\nr_i^s=\\lambda r_i+(1-\\lambda)r_{i-1}^s\n\\]'))
    .toContain('$$\nr_i^s=\\lambda r_i+(1-\\lambda)r_{i-1}^s\n$$');
});
it('preserves dollar math, code spans, fenced and unfinished code', () => {
  for (const text of [String.raw`$x^2$`, String.raw`코드: \`\\(x\\)\``, '```tex\n\\[x\\]\n```', '~~~tex\n\\(x\\)\n~~~', '```tex\n\\(x\\)']) expect(chatMarkdown(text)).toBe(text);
});
