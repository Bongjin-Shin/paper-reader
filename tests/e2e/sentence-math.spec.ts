import {test,expect} from '@playwright/test';
import {installBackend,open, startPageTranslation } from './helpers';
import {makeSentenceMathPdf} from '../sentenceMathFixture';
import {PDFDocument,StandardFonts} from 'pdf-lib';

test('translation units are complete sentences across leading and fonts, with academic references intact',async({page})=>{
 await installBackend(page,undefined,await makeSentenceMathPdf());await open(page);await page.getByRole('button',{name:'본문 번역',exact:true}).click(); await startPageTranslation(page);
 await expect(page.locator('.translated-sentence').first()).toBeVisible();
 const source=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 expect(source[1].text).toBe('This is a long sentence that starts on the first line continues on the second line with another font and finishes on the third line.');
 expect(source[1].rects).toHaveLength(3);expect(source[2].text).toBe('Another sentence follows.');expect(source[3].text).toBe('As shown in Fig. 2, the equation is used.');
 await page.locator('.translated-sentence').nth(1).hover();await expect(page.locator('.translation-source-mark')).toHaveCount(3);
});

test('Korean sentences flow in justified paragraphs at narrow and wide panel widths',async({page})=>{
 await installBackend(page,undefined,await makeSentenceMathPdf());await open(page);
 await page.evaluate(()=>{(window as any).__longPageTranslation='문장이 길어 다음 줄로 넘어가더라도 문장 전체의 의미를 유지하면서 번역하고 번역창의 너비에 맞추어 자연스럽게 줄을 바꿉니다. 이러한 문장들은 원래 문단 안에서 함께 표시됩니다.';});
 await page.getByRole('button',{name:'본문 번역',exact:true}).click(); await startPageTranslation(page);
 const paragraph=page.locator('.translation-paragraph').filter({has:page.locator('[data-sentence-id="1"]')});
 await expect(paragraph.locator('.translated-sentence')).toHaveCount(2);
 expect(await paragraph.evaluate(el=>getComputedStyle(el).textAlign)).toBe('justify');
 const handle=page.getByRole('separator',{name:'1페이지 번역창 너비 조절'});await handle.focus();
 for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');
 const narrow=(await paragraph.boundingBox())!.height;
 for(let i=0;i<14;i++)await page.keyboard.press('ArrowLeft');
 expect((await paragraph.boundingBox())!.height).toBeLessThan(narrow);
 expect(await page.locator('.translation-page-content').first().evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 await page.locator('[data-sentence-id="1"]').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-sentence-id="1"]')).toHaveAttribute('aria-pressed','true');
});

for(const rotation of [0,90])test(`LaTeX formulas preserve scripts and fractions, survive resize/zoom/restart (${rotation})`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await installBackend(page,{delay:0,fail:false,rotation,userUnit:1},await makeSentenceMathPdf(rotation));await open(page);
 await page.getByRole('button',{name:'페이지 너비 맞춤'}).click();await page.getByRole('button',{name:'본문 번역',exact:true}).click(); await startPageTranslation(page);
 const math=page.locator('.translated-sentences .katex');await expect(math).toHaveCount(2);
 await expect(page.locator('.translated-sentences img')).toHaveCount(0);
 await expect(page.locator('.translated-sentences .katex-error')).toHaveCount(0);
 await expect(page.locator('.translated-sentences math mfrac')).toHaveCount(1);
 await expect(page.locator('.translated-sentences math msup')).toHaveCount(1);
 expect(await page.locator('.translation-page-content').first().textContent()).not.toContain('[[PV_MATH_');
 const markup=await math.evaluateAll(els=>els.map(el=>el.innerHTML));
 const equation=page.locator('.translation-paragraph.translation-equation');await expect(equation).toHaveCount(1);
 await equation.locator('.translated-sentence').hover();await expect(page.locator('.translation-source-mark')).toHaveCount(1);
 const sourceBox=(await page.locator('.translation-source-mark').boundingBox())!;await page.mouse.move(sourceBox.x+sourceBox.width/2,sourceBox.y+sourceBox.height/2);await expect(equation.locator('.translated-sentence')).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'확대',exact:true}).click();await page.getByRole('separator',{name:'1페이지 번역창 너비 조절'}).focus();await page.keyboard.press('ArrowLeft');
 expect(await math.evaluateAll(els=>els.map(el=>el.innerHTML))).toEqual(markup);
 await page.screenshot({path:`.tools/sentence-math-verification/formulas-${rotation}.png`});
 await page.reload();await open(page);await page.getByRole('button',{name:'본문 번역',exact:true}).click();await expect(math).toHaveCount(2);await expect(page.locator('.translated-sentences math mfrac')).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).__pageApiCalls??0)).toBe(0);expect(errors).toEqual([]);
});

test('long two-column sentences remain whole through line and column wrapping',async({page})=>{
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),p=doc.addPage([612,792]);
 const line=(s:string,x:number,y:number)=>p.drawText(s,{x,y,size:10,font});
 line('The left sentence starts here and',30,700);line('continues at the top of the right column.',330,700);
 line('continues through the next line',30,677);line('A new sentence then starts and',330,677);
 line('before it reaches the right column and',30,654);line('finishes on the next line.',330,654);
 await installBackend(page,undefined,await doc.save());await open(page);await page.getByRole('button',{name:'본문 번역',exact:true}).click(); await startPageTranslation(page);await expect(page.locator('.translated-sentence')).toHaveCount(2);
 const source=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 expect(source[0].text).toBe('The left sentence starts here and continues through the next line before it reaches the right column and continues at the top of the right column.');expect(source[0].rects).toHaveLength(4);
 expect(source[1].text).toBe('A new sentence then starts and finishes on the next line.');
});
