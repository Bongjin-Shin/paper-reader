import {test,expect} from '@playwright/test';
import {installBackend,open, startPageTranslation } from './helpers';
import {makeTranslationTablePdf} from '../translationTableFixture';

test('ruled table cells remain separate from body text and math stays inside horizontal table scrolling',async({page})=>{
 await installBackend(page,undefined,await makeTranslationTablePdf());await open(page);
 await page.evaluate(()=>{
  const internal=(window as any).__TAURI_INTERNALS__, original=internal.invoke;
  internal.invoke=async(command:string,args:any)=>{
   const result=await original(command,args);
   if(command!=='translate_page')return result;
   const labels:Record<string,string>={Model:'모델',Input:'입력',Output:'출력',Predictor:'예측기',Reconstructor:'재구성기','Residual Compensator':'잔차 보정기'};
   return {...result,sentences:result.sentences.map((s:any)=>({...s,
    translation:s.layout?.table ? labels[s.text]??s.text : s.translation,
    equations:s.equations.map((m:any)=>({...m,latex:'\boldsymbol{P}_{\\mathrm{leaky,sparse}}(t-w:t-1) + '+String.raw`\\boldsymbol{1}_{n\times w} \boldsymbol{AF}_{\mathrm{leaky}}^\top(t-w:t-1)`}))
   }))};
  };
 });
 await page.getByRole('button',{name:'본문 번역',exact:true}).click(); await startPageTranslation(page);
 const table=page.getByRole('table'),scroll=page.getByRole('region',{name:'표 번역'});
 await expect(table.getByRole('row')).toHaveCount(4);await expect(table.getByRole('columnheader')).toHaveCount(3);
 await expect(table.getByRole('cell')).toHaveCount(9);await expect(table.locator('.katex')).toHaveCount(6);
 await expect(table.locator('.katex-error, .translation-math-fallback')).toHaveCount(0);
 const rows=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 expect(rows.filter((s:any)=>s.layout.kind==='table')).toHaveLength(12);
 expect(rows.filter((s:any)=>s.layout.kind==='paragraph').map((s:any)=>s.text).join(' ')).not.toMatch(/Predictor|Reconstructor|Compensator/);
 expect(rows.find((s:any)=>s.text.includes('Body sentences'))?.layout.kind).toBe('paragraph');
 expect(rows.filter((s:any)=>s.layout.table&&!s.layout.table.header&&s.layout.table.column>0).every((s:any)=>s.layout.math.length===1)).toBe(true);
 expect(await scroll.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
 expect(await page.locator('.translation-page-content').first().evaluate(e=>e.scrollWidth===e.clientWidth)).toBe(true);
 await expect(page.locator('.translation-page-header h3').first()).toHaveText('1/2 페이지');
 await table.scrollIntoViewIfNeeded();await page.screenshot({path:'.tools/find-table-qa/table.png'});
});
test('wide gutters scroll the complete translation while inner padding protects text from overlay scrollbars',async({page})=>{
 await installBackend(page);await open(page);
 await page.evaluate(()=>{(window as any).__longPageTranslation='스크롤바와 글씨 사이에 여백을 둡니다. '.repeat(80);});
 await page.getByRole('button',{name:'본문 번역',exact:true}).click(); await startPageTranslation(page);
 const pane=page.locator('.translation-content'),card=page.locator('.translation-page').first(),inner=card.locator('.translation-page-content');
 await expect(inner.locator('.translated-sentence')).toHaveCount(4);
 const bounds=await inner.evaluate(e=>({padding:parseFloat(getComputedStyle(e).paddingRight),right:e.getBoundingClientRect().right,textRight:e.querySelector('.translated-sentences')!.getBoundingClientRect().right}));
 expect(bounds.padding).toBeGreaterThanOrEqual(20);expect(bounds.right-bounds.textRight).toBeGreaterThanOrEqual(20);
 const pb=(await pane.boundingBox())!,cb=(await card.boundingBox())!;
 expect(cb.x-pb.x).toBeGreaterThanOrEqual(24);expect(pb.x+pb.width-cb.x-cb.width).toBeGreaterThanOrEqual(24);
 const readerTop=await page.locator('.reader').evaluate(e=>e.scrollTop);
 await page.mouse.move(pb.x+12,pb.y+200);await page.mouse.wheel(0,300);
 await expect.poll(()=>pane.evaluate(e=>e.scrollTop)).toBeGreaterThan(100);expect(await inner.evaluate(e=>e.scrollTop)).toBe(0);
 await page.mouse.move(pb.x+pb.width-18,pb.y+200);await page.mouse.wheel(0,-300);
 await expect.poll(()=>pane.evaluate(e=>e.scrollTop)).toBe(0);expect(await page.locator('.reader').evaluate(e=>e.scrollTop)).toBe(readerTop);
});
