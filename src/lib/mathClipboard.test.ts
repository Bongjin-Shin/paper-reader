import { expect, it } from 'vitest';
import { glyphsToLatex, latexText, mathMarkdown, type CopyGlyph } from './mathClipboard';
const g=(text:string,x:number,y=0,size=10,width?:number):CopyGlyph=>({text,x,y,size,width});
it('reconstructs sets and nested subscripts instead of flattening PDF glyphs',()=>{
 const text=glyphsToLatex([g('S',0),g('=',12),g('{',25),g('s',30),g('1',35,1.5,7),g(', s',40),g('2',50,1.5,7),
  g(', . . . , s',55),g('k',82,1.5,7),g('s',86,2.5,5),g('}',91)]);
 expect(text).toBe('S = \\{ s_{1}, s_{2}, \\ldots, s_{k_{s}} \\}');
});
it('keeps upper and lower summation limits together with nested subscripts',()=>{
 const text=glyphsToLatex([g('k',0),g('n',5,1.5,7),g('=',15),g('∑',28,0,14,12),g('k',42,-8,7),g('s',47,-7,5),
  g('i = 1',41,6,7),g('n',65),g('s',72,1.5,7),g('i',76,2.5,5)]);
 expect(text).toBe('k_{n} = \\sum_{i = 1}^{k_{s}} n_{s_{i}}');
});
it('copies a superscript and a fraction using LaTeX syntax',()=>{
 expect(glyphsToLatex([g('E = mc',0,0,14,44),g('2',44,-7,8),g('(1)',190,0,12)])).toBe('E = mc^{2} (1)');
 expect(glyphsToLatex([g('y =',0,0,14,20),g('1',27,-6,8,4),g('n',28,6,8,4)])).toBe('y = \\frac{1}{n}');
 expect(glyphsToLatex([g('1',27,-6,8,4),g('n',28,6,8,4)])).toBe('\\frac{1}{n}');
});
it('encodes math symbols, escapes braces, and uses standard Markdown delimiters',()=>{
 expect(latexText('α ∈ {1, 2, . . .}')).toBe('\\alpha \\in \\{1, 2, \\ldots \\}');
 expect(mathMarkdown('x_{i}')).toBe('$x_{i}$');
 expect(mathMarkdown('$$\\sum_i x_i$$',true)).toBe('\n\n$$\n\\sum_i x_i\n$$\n\n');
});
