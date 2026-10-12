import { test, expect, type Page } from '@playwright/test';
import { installBackend, open, startPageTranslation } from './helpers';

async function aligned(page: Page) {
  await expect.poll(() => page.locator('.page-pair').evaluateAll(rows => Math.max(...rows.map(row => {
    const source=row.querySelector('.pdf-page')!.getBoundingClientRect(), translated=row.querySelector('.translation-page')!.getBoundingClientRect();
    return Math.max(Math.abs(source.top-translated.top),Math.abs(source.bottom-translated.bottom),Math.abs(source.right-translated.left));
  })))).toBeLessThan(1);
}
test('page pairs share scroll and geometry, keep local translation scroll, and reuse rendered PDF text',async({page})=>{
 await installBackend(page);await open(page);
 await page.evaluate(()=>{(window as any).__firstLayer=document.querySelector('.textLayer');(window as any).__longPageTranslation='원문과 번역을 한 페이지에서 함께 읽습니다. '.repeat(100)+'**마지막 문장**';});
 await page.getByRole('button',{name:'본문 번역',exact:true}).click();
 await expect(page.locator('.translation-page')).toHaveCount(2);await aligned(page);
 await expect(page.getByRole('region',{name:'1페이지 번역 내용',exact:true}).getByRole('button',{name:'이 페이지 번역'})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__pageApiCalls??0)).toBe(0);
 await startPageTranslation(page);
 const reader=page.locator('.reader'),inner=page.getByRole('region',{name:'1페이지 번역 내용',exact:true});
 await expect(inner.locator('.translated-sentence')).toHaveCount(4);
 expect(await page.evaluate(()=>(window as any).__firstLayer===document.querySelector('.textLayer'))).toBe(true);
 const box=(await inner.boundingBox())!,root=(await reader.boundingBox())!;
 const before=await reader.evaluate(e=>e.scrollTop);
 await page.mouse.move(box.x+30,Math.min(box.y+180,root.y+root.height-40));await page.mouse.wheel(0,400);
 await expect.poll(()=>inner.evaluate(e=>e.scrollTop)).toBeGreaterThan(100);expect(await reader.evaluate(e=>e.scrollTop)).toBe(before);
 await inner.evaluate(e=>{e.scrollTop=e.scrollHeight;});
 await page.mouse.wheel(0,400);await expect.poll(()=>reader.evaluate(e=>e.scrollTop)).toBeGreaterThan(before+100);await aligned(page);
 await page.getByRole('button',{name:'다음 번역 페이지'}).click();
 const second=page.getByRole('region',{name:'2페이지 번역 내용',exact:true});
 await expect(second).toBeInViewport();expect(await page.evaluate(()=>(window as any).__pageApiCalls)).toBe(1);
 await startPageTranslation(page,2);await expect(second.locator('.translated-sentence')).toHaveCount(4);
 const atSecond=await reader.evaluate(e=>e.scrollTop),sb=(await second.boundingBox())!;
 await page.mouse.move(sb.x+30,Math.max(root.y+60,sb.y+100));await page.mouse.wheel(0,-220);
 await expect.poll(()=>reader.evaluate(e=>e.scrollTop)).toBeLessThan(atSecond-100);expect(await second.evaluate(e=>e.scrollTop)).toBe(0);await aligned(page);
 await page.getByRole('button',{name:'이전 번역 페이지'}).click();
 const handle=page.getByRole('separator',{name:'1페이지 번역창 너비 조절'});
 const width=(await page.locator('.translation-page').first().boundingBox())!.width;
 await handle.focus();await page.keyboard.press('ArrowLeft');await aligned(page);
 expect((await page.locator('.translation-page').last().boundingBox())!.width).toBeCloseTo(width+20,0);
 await page.getByRole('button',{name:'확대',exact:true}).click();await aligned(page);
 await page.getByRole('button',{name:'페이지 너비 맞춤'}).click();await aligned(page);
 await inner.evaluate(e=>{e.scrollTop=0;});await reader.evaluate(e=>{e.scrollTop=0;});
 await expect.poll(()=>page.locator('.pdf-page').first().evaluate(el=>Number((el as HTMLElement).dataset.renderedScale)===Number(el.closest<HTMLElement>('.reader')!.dataset.displayScale))).toBe(true);
 await page.screenshot({path:'.tools/paired-reader-qa/paired-reader.png'});
 await page.locator('.page-pair').first().evaluate(el=>{
   const root=el.closest<HTMLElement>('.reader')!;
   root.scrollTop+=el.getBoundingClientRect().bottom-root.getBoundingClientRect().top-root.clientHeight*.45;
 });
 await aligned(page);
 await page.screenshot({path:'.tools/paired-reader-qa/page-boundary.png'});
 await page.getByRole('button',{name:'본문 번역 닫기'}).click();await expect(page.locator('.translation-page')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__firstLayer===document.querySelector('.textLayer'))).toBe(true);
 await page.getByRole('button',{name:'본문 번역',exact:true}).click();await aligned(page);
 expect(await page.evaluate(()=>(window as any).__pageApiCalls)).toBe(2);
});
