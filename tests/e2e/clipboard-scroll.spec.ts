import {test,expect,type Page} from '@playwright/test';
import {installBackend,open} from './helpers';
import {makeSentenceMathPdf} from '../sentenceMathFixture';

async function captureCopy(page: Page) {
 return page.evaluate(()=>{
  const data=new DataTransfer(),event=new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true});
  document.dispatchEvent(event);
  return {text:data.getData('text/plain'),markdown:data.getData('text/markdown'),html:data.getData('text/html'),handled:event.defaultPrevented};
 });
}
async function selectElement(page:Page,selector:string) {
 await page.locator(selector).first().evaluate(el=>{
  const range=document.createRange();range.selectNodeContents(el);
  const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 });
}
async function selectPdf(page:Page,start:string,end:string,endIndex=0) {
 await page.locator('.pdf-page').first().evaluate((el,{start,end,endIndex})=>{
  const nodes:Text[]=[];const walk=document.createTreeWalker(el.querySelector('.textLayer')!,NodeFilter.SHOW_TEXT);
  while(walk.nextNode())nodes.push(walk.currentNode as Text);
  const a=nodes.find(n=>n.data.trim()===start.trim())!,b=nodes.filter(n=>n.data.trim()===end.trim())[endIndex];
  if(!a||!b)throw new Error('Missing fixture text');
  const range=document.createRange();range.setStart(a,0);range.setEnd(b,b.length);
  const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 },{start,end,endIndex});
}
for(const rotation of [0,90])test(`original PDF copies scripts and fractions before any translation (${rotation})`,async({page})=>{
 await installBackend(page,{delay:0,fail:false,rotation,userUnit:1},await makeSentenceMathPdf(rotation));await open(page);
 await selectPdf(page,'E = mc','(1)');
 const power=await captureCopy(page);expect(power.handled).toBe(true);expect(power.text).toContain('E = mc^{2}');expect(power.text).toContain('$$');expect(power.html).toBe('');
 await selectPdf(page,'y =','(2)');const fraction=await captureCopy(page);
 expect(fraction.text).toContain('\\frac{1}{n}');expect(fraction.markdown).toBe(fraction.text);
 await selectPdf(page,'We use ',' to solve this problem.');
 expect((await captureCopy(page)).text).toBe('We use $x = 2$ to solve this problem.');
 await page.getByRole('button',{name:'확대',exact:true}).click();
 await expect.poll(async()=>(await captureCopy(page)).text).toBe('We use $x = 2$ to solve this problem.');
 expect(await page.evaluate(()=>(window as any).__pageApiCalls??0)).toBe(0);
});
test('rendered math copies one original TeX expression even for a partial visual selection',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await installBackend(page,undefined,await makeSentenceMathPdf());await open(page);
 await page.getByRole('button',{name:'본문 번역',exact:true}).click();
 const formula=page.locator('.translation-equation .katex');await expect(formula).toHaveCount(1);
 await selectElement(page,'.translation-equation .katex-html');
 const result=await captureCopy(page);
 expect(result.text).toBe('$$\n\\begin{aligned} E &= mc^2 \\quad (1) \\\\ y &= \\frac{1}{n} \\quad (2) \\end{aligned}\n$$');
 expect(result.markdown).toBe(result.text);expect(result.html).toBe('');
 await page.keyboard.press('Control+c');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(result.text);
 await formula.locator('.katex-html').evaluate(el=>{
  const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);walk.nextNode();
  const node=walk.currentNode;const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);
  const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 });
 expect((await captureCopy(page)).text).toBe(result.text);
 await selectPdf(page,'E = mc','(2)');
 expect((await captureCopy(page)).text).toBe(result.text);
});
test('mixed translated prose, Markdown and inline math copy without visual duplicates',async({page})=>{
 await installBackend(page);await open(page);
 await page.evaluate(()=>{(window as any).__longPageTranslation='**굵은 글씨**와 *기울임*, $S=\\{s_1,s_{k_s}\\}$를 사용합니다.';});
 await page.getByRole('button',{name:'본문 번역',exact:true}).click();
 await expect(page.locator('.translated-sentence .katex')).toHaveCount(4);
 await selectElement(page,'.translated-sentence');
 const copied=await captureCopy(page);
 expect(copied.text).toBe('**굵은 글씨**와 *기울임*, $S=\\{s_1,s_{k_s}\\}$를 사용합니다.');
 expect(copied.text.match(/S=/g)).toHaveLength(1);expect(copied.text).not.toContain('​');
});
test('wheel scrolling, page controls, and zoom leave the other pane in place; toolbar stays compact',async({page})=>{
 await installBackend(page);await open(page);await page.getByRole('button',{name:'본문 번역',exact:true}).click();
 await expect(page.locator('.translated-sentence')).toHaveCount(4);
 const reader=page.locator('.reader'),pane=page.locator('.translation-content'),bar=page.locator('.translation-pagination');
 expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(40);
 await expect(page.locator('.page-translation-panel > header')).toHaveCount(0);
 await expect(bar).not.toContainText('본문 번역');await expect(bar).not.toContainText('스크롤 연동');
 const rp=await reader.evaluate(el=>el.scrollTop),tp=await pane.evaluate(el=>el.scrollTop);
 const rb=(await reader.boundingBox())!;await page.mouse.move(rb.x+rb.width/2,rb.y+rb.height/2);await page.mouse.wheel(0,320);
 await expect.poll(()=>reader.evaluate(el=>el.scrollTop)).toBeGreaterThan(rp+100);expect(await pane.evaluate(el=>el.scrollTop)).toBe(tp);
 const stationary=await reader.evaluate(el=>el.scrollTop);const pb=(await pane.boundingBox())!;
 // Short page content has no inner overflow, so the page list scrolls directly.
 await page.mouse.move(pb.x+pb.width/2,pb.y+pb.height/2);await page.mouse.wheel(0,260);
 await expect.poll(()=>pane.evaluate(el=>el.scrollTop)).toBeGreaterThan(tp+50);expect(await reader.evaluate(el=>el.scrollTop)).toBe(stationary);
 await page.getByRole('button',{name:'다음 번역 페이지'}).click();await expect(bar).toContainText('2 / 2 페이지');expect(await reader.evaluate(el=>el.scrollTop)).toBe(stationary);
 const beforeZoom=await pane.evaluate(el=>el.scrollTop);await page.getByRole('button',{name:'확대',exact:true}).click();
 await expect.poll(()=>pane.evaluate(el=>el.scrollTop)).toBe(beforeZoom);
 // At the bottom, wheel events must not chain into the PDF or workspace.
 await pane.evaluate(el=>{el.scrollTop=el.scrollHeight;});const beforeBoundary=await reader.evaluate(el=>el.scrollTop);
 await page.mouse.move(pb.x+pb.width/2,pb.y+pb.height/2);await page.mouse.wheel(0,600);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 expect(await reader.evaluate(el=>el.scrollTop)).toBe(beforeBoundary);
 await page.screenshot({path:'.tools/clipboard-scroll-qa/compact-toolbar.png'});
});
