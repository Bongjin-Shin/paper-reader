import {expect,test,type Page} from '@playwright/test';
import {installBackend,open,wordBox} from './helpers';
import {makeScrollPdf} from '../performance/fixture';
async function selectPhrase(page:Page,reverse=false) {
 const a=await wordBox(page,'The model maintains asymptotic complexity',18),b=await wordBox(page,'context-aware decision-making.',20);
 const start={x:a.x+.2,y:a.y+a.height/2},end={x:b.x+b.width-.2,y:b.y+b.height/2};
 await page.mouse.move((reverse?end:start).x,(reverse?end:start).y);await page.mouse.down();await page.mouse.move((reverse?start:end).x,(reverse?start:end).y,{steps:12});await page.mouse.up();
}
for(const reverse of [false,true])test(`sentence result follows source through pending/result scroll (${reverse})`,async({page})=>{
 await installBackend(page,{delay:700,fail:false,rotation:0,userUnit:1},makeScrollPdf(6));await open(page);await selectPhrase(page,reverse);
 const bubble=page.getByRole('dialog',{name:'선택 텍스트 도구'});await expect(bubble).toBeVisible();
 await page.getByRole('button',{name:'번역',exact:true}).click();
 await page.locator('.reader').evaluate(el=>{el.scrollTop=100;});
 await expect(bubble).toContainText('선택한 전체 문장의 번역입니다.');
 const before=(await bubble.boundingBox())!;
 await page.locator('.reader').evaluate(el=>{el.scrollTop+=1000;});
 await expect.poll(async()=> (await bubble.boundingBox())!.y).toBeCloseTo(before.y-1000,0);
 await page.locator('.reader').evaluate(el=>{el.scrollTop=100;});
 await expect.poll(async()=> (await bubble.boundingBox())!.y).toBeCloseTo(before.y,0);
 await bubble.locator('strong').click();
 await page.mouse.move(30,500);await page.mouse.wheel(0,400);
 const scroll=await page.locator('.reader').evaluate(el=>el.scrollTop);
 await expect.poll(async()=> (await bubble.boundingBox())!.y).toBeCloseTo(before.y-(scroll-100),0);
});
test('long sentence bubbles move synchronously with the document without scroll-driven style updates',async({page})=>{
 await installBackend(page,undefined,makeScrollPdf(6));await open(page);
 await page.evaluate(()=>{(window as any).__phraseResult='긴 문장 번역 결과도 원문과 함께 움직입니다. '.repeat(30);});await selectPhrase(page);
 await page.getByRole('button',{name:'번역',exact:true}).click();const bubble=page.getByRole('dialog');await expect(bubble).toContainText('긴 문장 번역 결과');
 const result=await page.evaluate(()=>{
  const reader=document.querySelector('.reader')!,el=document.querySelector<HTMLElement>('.word-bubble')!,y=el.getBoundingClientRect().top,style=el.getAttribute('style'),scroll=reader.scrollTop;
  reader.scrollTop+=1100;
  return {movement:el.getBoundingClientRect().top-y,delta:reader.scrollTop-scroll,unchanged:style===el.getAttribute('style'),position:getComputedStyle(el).position};
 });
 expect(result.position).toBe('absolute');expect(result.unchanged).toBe(true);expect(result.movement).toBeCloseTo(-result.delta,0);
 await page.locator('.reader').evaluate(el=>{el.scrollTop=0;});await expect(bubble.locator('strong')).toBeInViewport();
 await bubble.locator('strong').click();await page.keyboard.press('Delete');await expect(bubble).toHaveCount(0);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-lookups')??'[]').length)).toBe(1);
});
test('wheel over the end of a long sentence result continues scrolling the PDF instead of trapping the pointer',async({page})=>{
 await installBackend(page,undefined,makeScrollPdf(6));await open(page);
 await page.evaluate(()=>{(window as any).__phraseResult='긴 번역 결과를 읽고 PDF를 계속 스크롤합니다. '.repeat(30);});await selectPhrase(page);
 await page.getByRole('button',{name:'번역',exact:true}).click();const bubble=page.getByRole('dialog');await expect(bubble).toContainText('긴 번역 결과');
 await bubble.locator('.result-content').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 const box=(await bubble.boundingBox())!,before=await page.locator('.reader').evaluate(el=>el.scrollTop);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,160);
 await expect.poll(()=>page.locator('.reader').evaluate(el=>el.scrollTop)).toBeGreaterThan(before);
 const delta=await page.locator('.reader').evaluate(el=>el.scrollTop)-before;
 expect((await bubble.boundingBox())!.y).toBeCloseTo(box.y-delta,0);
});
