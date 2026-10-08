import {test,expect} from '@playwright/test';
import {installBackend,open} from './helpers';
import {makeBoldAbstractPdf,makeLabeledEquationPdf,comparison} from '../boldEquationFixture';
for(const columns of [1,2])test(`bold abstract is translated in complete sentences, including its last line (${columns} columns)`,async({page})=>{
 await installBackend(page,undefined,await makeBoldAbstractPdf(columns));await open(page);
 await page.getByRole('button',{name:'본문 번역',exact:true}).click();await expect(page.locator('.translated-sentence').first()).toBeVisible();
 const source=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 const sentence=source.find((s:any)=>s.text===comparison);expect(sentence).toBeTruthy();expect(sentence.layout.kind).toBe('paragraph');expect(sentence.rects).toHaveLength(3);
 expect(source.some((s:any)=>s.text==='effectiveness of the proposed algorithm.')).toBe(false);
 expect(source.some((s:any)=>s.text==='I. INTRODUCTION'&&s.layout.kind==='heading')).toBe(true);
 await page.locator(`[data-sentence-id="${sentence.id}"]`).hover();await expect(page.locator('.translation-source-mark')).toHaveCount(3);
 await page.locator(`[data-sentence-id="${sentence.id}"]`).click();
 await page.getByRole('button',{name:'확대',exact:true}).click();await expect(page.locator('.translation-source-mark')).toHaveCount(3);
});
test('descriptive subscripts and a multiline cases equation are preserved as one original image',async({page})=>{
 await installBackend(page,undefined,await makeLabeledEquationPdf());await open(page);await page.getByRole('button',{name:'본문 번역',exact:true}).click();
 const images=page.locator('img.translation-equation');await expect(images).toHaveCount(1);
 await expect.poll(()=>images.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
 const sources=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 const eq=sources.filter((s:any)=>s.layout.kind==='equation');expect(eq).toHaveLength(1);expect(eq[0].layout.math).toHaveLength(1);
 expect(eq[0].layout.math[0].text).toContain('success');expect(eq[0].layout.math[0].text).toContain('cost');expect(eq[0].layout.math[0].text).toContain('x = 0');
 expect(eq[0].text).toMatch(/^\[\[PV_MATH_\d+\]\]$/);expect(await page.locator('.translation-content').textContent()).not.toContain('success');
 await images.hover();await expect(page.locator('.translation-source-mark')).toHaveCount(1);
 await page.screenshot({path:'.tools/bold-sentence-bubble-verification/labeled-equation.png'});
 await page.reload();await open(page);await page.getByRole('button',{name:'본문 번역',exact:true}).click();await expect(images).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).__pageApiCalls??0)).toBe(0);
});
