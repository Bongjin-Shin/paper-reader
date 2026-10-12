import {test,expect} from '@playwright/test';
import {installBackend,open, startPageTranslation } from './helpers';
import {makeTranslationTablePdf} from '../translationTableFixture';
import {PDFDocument,StandardFonts} from 'pdf-lib';

test('a dense page exceeding the old character and sentence limits can translate and reload in full',async({page})=>{
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),sheet=doc.addPage([650,4500]);
 for(let i=0;i<320;i++)sheet.drawText(`Sentence ${i} contains all source information for a dense reference page and must be translated in full.`,{x:50,y:4400-i*13,size:8,font});
 await installBackend(page,undefined,await doc.save());await open(page);
 await page.getByRole('button',{name:'본문 번역',exact:true}).click();await startPageTranslation(page);
 await expect(page.locator('.translation-page [role="alert"]')).toHaveCount(0);
 await expect(page.locator('.translation-page .translated-sentence')).toHaveCount(320);
 const rows=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 expect(rows.reduce((n:number,s:any)=>n+s.text.length,0)).toBeGreaterThan(20000);
 expect(rows.at(-1).text).toContain('Sentence 319');
 await page.reload();await open(page);await page.getByRole('button',{name:'본문 번역',exact:true}).click();
 await expect(page.locator('.translation-page .translated-sentence')).toHaveCount(320);
 expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.command==='translate_page'))).toHaveLength(0);
});

test('tables keep only translated captions, excluding both cells and original table images',async({page})=>{
 await installBackend(page,undefined,await makeTranslationTablePdf());await open(page);
 await page.getByRole('button',{name:'본문 번역',exact:true}).click(); await startPageTranslation(page);
 const caption=page.locator('.translation-caption');
 await expect(caption).toHaveCount(1); await expect(caption).toHaveAttribute('aria-label','그림·표 설명');
 await expect(caption.locator('.translated-sentence').first()).toBeVisible();
 await expect(page.locator('.translated-sentences img, .original-table, .translation-table')).toHaveCount(0);
 const rows=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 expect(rows.filter((s:any)=>s.layout.kind==='table')).toHaveLength(0);
 expect(rows.map((s:any)=>s.text).join(' ')).not.toMatch(/Predictor|Reconstructor|Compensator/);
 expect(rows.some((s:any)=>s.layout.kind==='caption'&&s.text.includes('Table 1'))).toBe(true);
 expect(rows.find((s:any)=>s.text.includes('Body sentences'))?.layout.kind).toBe('paragraph');
 await page.reload();await open(page);await page.getByRole('button',{name:'본문 번역',exact:true}).click();
 await expect(page.locator('.translation-caption')).toBeVisible();
 await expect(page.locator('.translated-sentences img, .original-table, .translation-table')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.command==='translate_page'))).toHaveLength(0);
});

test('wide gutters scroll the complete translation while inner padding protects text from overlay scrollbars',async({page})=>{
 await installBackend(page);await open(page);
 await page.evaluate(()=>{(window as any).__longPageTranslation='스크롤바와 글씨 사이에 여백을 둡니다. '.repeat(80);});
 await page.getByRole('button',{name:'본문 번역',exact:true}).click(); await startPageTranslation(page);
 const pane=page.locator('.reader'),card=page.locator('.translation-page').first(),inner=card.locator('.translation-page-content');
 await expect(inner.locator('.translated-sentence')).toHaveCount(4);
 const bounds=await inner.evaluate(e=>({padding:parseFloat(getComputedStyle(e).paddingRight),right:e.getBoundingClientRect().right,textRight:e.querySelector('.translated-sentences')!.getBoundingClientRect().right}));
 expect(bounds.padding).toBeGreaterThanOrEqual(20);expect(bounds.right-bounds.textRight).toBeGreaterThanOrEqual(20);
 const pb=(await pane.boundingBox())!,cb=(await page.locator('.page-pair').first().boundingBox())!;
 expect(cb.x-pb.x).toBeGreaterThanOrEqual(24);expect(pb.x+pb.width-cb.x-cb.width).toBeGreaterThanOrEqual(24);
 await pane.evaluate(e=>{e.scrollTop=0;});
 await page.mouse.move(pb.x+12,pb.y+200);await page.mouse.wheel(0,300);
 await expect.poll(()=>pane.evaluate(e=>e.scrollTop)).toBeGreaterThan(100);expect(await inner.evaluate(e=>e.scrollTop)).toBe(0);
 await page.mouse.move(pb.x+pb.width-18,pb.y+200);await page.mouse.wheel(0,-300);
 await expect.poll(()=>pane.evaluate(e=>e.scrollTop)).toBe(0);expect(await inner.evaluate(e=>e.scrollTop)).toBe(0);
});
