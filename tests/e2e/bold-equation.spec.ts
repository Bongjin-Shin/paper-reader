import {test,expect} from '@playwright/test';
import {installBackend,open, startPageTranslation } from './helpers';
import {makeBoldAbstractPdf,makeLabeledEquationPdf,comparison} from '../boldEquationFixture';
for(const columns of [1,2])test(`bold abstract is translated in complete sentences, including its last line (${columns} columns)`,async({page})=>{
 await installBackend(page,undefined,await makeBoldAbstractPdf(columns));await open(page);
 await page.getByRole('button',{name:'본문 번역',exact:true}).click(); await startPageTranslation(page);await expect(page.locator('.translated-sentence').first()).toBeVisible();
 const source=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 const sentence=source.find((s:any)=>s.text===comparison);expect(sentence).toBeTruthy();expect(sentence.layout.kind).toBe('paragraph');expect(sentence.rects).toHaveLength(3);
 expect(source.some((s:any)=>s.text==='effectiveness of the proposed algorithm.')).toBe(false);
 expect(source.some((s:any)=>s.text==='I. INTRODUCTION'&&s.layout.kind==='heading')).toBe(true);
 await page.locator(`[data-sentence-id="${sentence.id}"]`).hover();await expect(page.locator('.translation-source-mark')).toHaveCount(3);
 await page.locator(`[data-sentence-id="${sentence.id}"]`).click();
 await page.getByRole('button',{name:'확대',exact:true}).click();await expect(page.locator('.translation-source-mark')).toHaveCount(3);
});
test('descriptive subscripts and multiline cases render and copy as one LaTeX expression',async({page})=>{
 await installBackend(page,undefined,await makeLabeledEquationPdf());await open(page);await page.getByRole('button',{name:'본문 번역',exact:true}).click(); await startPageTranslation(page);
 const formula=page.locator('.translation-equation .katex');await expect(formula).toHaveCount(1);
 await expect(page.locator('img.translation-equation, .katex-error')).toHaveCount(0);
 const sources=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 const eq=sources.filter((s:any)=>s.layout.kind==='equation');expect(eq).toHaveLength(1);expect(eq[0].layout.math).toHaveLength(1);
 expect(eq[0].layout.math[0].text).toContain('success');expect(eq[0].layout.math[0].text).toContain('cost');expect(eq[0].layout.math[0].text).toContain('x = 0');
 expect(eq[0].text).toMatch(/^\[\[PV_MATH_\d+\]\]$/);
 const latex=await formula.locator('annotation').textContent();expect(latex).toContain('N_{\\mathrm{success}}');expect(latex).toContain('\\begin{cases}');
 const copied=await formula.locator('.katex-html').evaluate(el=>{
  const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
  const data=new DataTransfer();document.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));
  selection.removeAllRanges();return data.getData('text/plain');
 });expect(copied).toBe('$$\n'+latex+'\n$$');
 await formula.hover();await expect(page.locator('.translation-source-mark')).toHaveCount(1);
 await page.screenshot({path:'.tools/bold-sentence-bubble-verification/labeled-equation.png'});
 await page.reload();await open(page);await page.getByRole('button',{name:'본문 번역',exact:true}).click();await expect(formula).toHaveCount(1);
 expect(await formula.locator('annotation').textContent()).toBe(latex);
 expect(await page.evaluate(()=>(window as any).__pageApiCalls??0)).toBe(0);
});
