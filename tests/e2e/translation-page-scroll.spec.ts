import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { installBackend, open, startPageTranslation } from './helpers';

test('mixed page sizes and rotation keep translations bounded to their originals at every zoom and width', async ({ page }) => {
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 for(const [index,size] of [[612,792],[792,612],[420,594]].entries()) {
  const sheet=doc.addPage(size);sheet.drawText(`Page ${index+1} contains a complete sentence.`,{x:40,y:size[1]-80,size:12,font});
  if(index===2)sheet.setRotation(degrees(90));
 }
 await installBackend(page,undefined,await doc.save());await open(page);
 await page.evaluate(()=>{(window as any).__longPageTranslation='페이지마다 원문 높이에 맞춰 번역을 읽습니다. '.repeat(100)+'**마지막 문장**';});
 await page.getByRole('button',{name:'본문 번역',exact:true}).click();await startPageTranslation(page);
 const assertBounds=async()=>{
  await expect.poll(()=>page.locator('.page-pair').evaluateAll(rows=>rows.every((row,i)=>{
   const source=row.querySelector('.pdf-page')!.getBoundingClientRect(),translated=row.querySelector('.translation-page')!.getBoundingClientRect();
   const content=row.querySelector('.translation-page-content')!.getBoundingClientRect();
   return Math.abs(source.height-translated.height)<1 && Math.abs(source.y-translated.y)<1 && content.bottom<=translated.bottom
    && (!i || row.getBoundingClientRect().top-rows[i-1].getBoundingClientRect().bottom>=23);
  }))).toBe(true);
 };
 await assertBounds();
 const inner=page.getByRole('region',{name:'1페이지 번역 내용',exact:true});await expect(inner.locator('strong')).toHaveText('마지막 문장');
 const handle=page.getByRole('separator',{name:'1페이지 번역창 너비 조절'});await handle.focus();
 for(let i=0;i<12;i++)await page.keyboard.press('ArrowLeft');await assertBounds();
 await page.getByRole('button',{name:'확대',exact:true}).click();await assertBounds();
 await page.getByRole('button',{name:'페이지 너비 맞춤'}).click();await assertBounds();
 await inner.locator('strong').scrollIntoViewIfNeeded();await expect(inner.locator('strong')).toBeInViewport({ratio:1});
 await page.getByRole('button',{name:'논문 채팅',exact:true}).click();await assertBounds();
 await expect.poll(()=>page.locator('.reader').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
 await page.getByRole('button',{name:'논문 채팅 닫기'}).click();await assertBounds();
 expect(await page.evaluate(()=>(window as any).__pageApiCalls)).toBe(1);
});
