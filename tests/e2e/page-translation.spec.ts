import { expect, test, type Page } from '@playwright/test';
import { installBackend, open, select, wordBox, startPageTranslation } from './helpers';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const panel = (page: Page) => page.locator('.workspace');
async function translate(page: Page, start = true) {
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  if (start) await startPageTranslation(page);
  await expect(panel(page).locator('.translated-sentence').first()).toBeVisible();
}
async function calls(page: Page) { return page.evaluate(() => (window as any).__pageApiCalls ?? 0); }

test('translates only the current page, caches it across restart and never adds vocabulary', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  await expect(panel(page).locator('.translation-page').first().getByRole('button', { name: '이 페이지 번역' })).toBeVisible();
  expect(await calls(page)).toBe(0);
  await panel(page).getByRole('button', { name: '다음 번역 페이지' }).click();
  await expect(panel(page).locator('.translation-page').nth(1).getByRole('button', { name: '이 페이지 번역' })).toBeInViewport();
  expect(await calls(page)).toBe(0);
  await panel(page).getByRole('button', { name: '본문 번역 닫기' }).click();
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  expect(await calls(page)).toBe(0);
  await startPageTranslation(page);
  await expect(panel(page).locator('.translated-sentence')).toHaveCount(4);
  expect(await calls(page)).toBe(1);
  const sources = await page.evaluate(() => (window as any).__calls.find((c: any) => c.command === 'translate_page').args.request.sentences);
  expect(sources.map((s: any) => s.text)).toEqual(['The model maintains an asymptotic linear complexity.', 'Another asymptotic result appears here.', 'A context-aware model improves allocation.', 'A game-theoretical decision-making approach.']);
  expect(await page.evaluate(() => localStorage.getItem('test-lookups'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('test-highlights'))).toBeNull();
  await panel(page).getByRole('button', { name: '다음 번역 페이지' }).click();
  await expect(panel(page)).toContainText('2 / 2 페이지');
  await expect(panel(page).getByRole('button', { name: '이 페이지 번역' })).toBeVisible();
  expect(await calls(page)).toBe(1);
  await panel(page).getByRole('button', { name: '이 페이지 번역' }).click();
  await expect(panel(page)).toContainText('한국어 번역 2-1'); expect(await calls(page)).toBe(2);
  await panel(page).getByRole('button', { name: '이전 번역 페이지' }).click();
  await expect(panel(page)).toContainText('1 / 2 페이지');
  await expect(panel(page)).toContainText('한국어 번역 1-1'); expect(await calls(page)).toBe(2);
  await page.reload(); await open(page); await translate(page, false); expect(await calls(page)).toBe(0);
});

for (const rotation of [0, 90, 180, 270]) test(`source gray rectangles follow PDF coordinates after zoom/scroll (rotation ${rotation})`, async ({ page }) => {
  await installBackend(page, { delay: 0, fail: false, rotation, userUnit: rotation ? 2 : 1 });
  await open(page); await page.getByRole('button', { name: '페이지 너비 맞춤' }).click();
  await translate(page);
  const first = panel(page).locator('.translated-sentence').first(); await first.hover();
  await expect(page.locator('.translation-source-mark')).toHaveCount(1);
  const compare = async () => {
    // Compare the entire first source sentence to a real DOM Range in the live Text Layer.
    const text = await wordBox(page, 'The model maintains an asymptotic linear complexity.');
    const mark = (await page.locator('.translation-source-mark').first().boundingBox())!;
    expect(Math.abs(mark.x - text.x)).toBeLessThan(2); expect(Math.abs(mark.y - text.y)).toBeLessThan(2);
    expect(Math.abs(mark.width - text.width)).toBeLessThan(2); expect(Math.abs(mark.height - text.height)).toBeLessThan(2);
  };
  await compare();
  await first.click(); await page.getByRole('button', { name: '확대', exact: true }).click();
  await compare();
  await page.locator('.reader').evaluate(el => { el.scrollTop += 120; }); await compare();
  await panel(page).getByRole('button', { name: '본문 번역 닫기' }).click();
  await expect(page.locator('.translation-source-mark')).toHaveCount(0);
});

test('sentence hover does not rerender PDF surfaces and existing word lookup stays independent', async ({ page }) => {
  await installBackend(page); await open(page); await select(page);
  await page.getByRole('button', { name: '번역', exact: true }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await page.getByRole('button', { name: '말풍선 닫기' }).click();
  await translate(page);
  // Opening the paired view fits the PDF, so wait for its staging render before testing hover.
  await expect.poll(() => page.locator('.pdf-page').evaluateAll(pages => pages.filter(p => p.querySelector('canvas')).every(p => p.getAttribute('data-rendered-scale') === (p.closest('.reader') as HTMLElement).dataset.displayScale))).toBe(true);
  await page.evaluate(() => { (window as any).__surfaces = [...document.querySelectorAll('.pdf-page canvas, .pdf-page .textLayer')]; });
  for (const sentence of await panel(page).locator('.translated-sentence').all()) await sentence.hover();
  expect(await page.evaluate(() => (window as any).__surfaces.every((el: Element) => el.isConnected))).toBe(true);
  await expect(page.locator('.word-highlight')).toHaveCount(1);
  await select(page); await expect(page.getByRole('dialog')).toBeVisible();
  await panel(page).getByRole('button', { name: '본문 번역 닫기' }).click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);
});

test('failed request can retry, repeated open does not duplicate an in-flight translation', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => { (window as any).__pageFail = true; });
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  await startPageTranslation(page);
  await expect(panel(page).getByRole('alert')).toContainText('실패');
  expect(await page.evaluate(() => localStorage.getItem('test-cost'))).toBeNull();
  await page.evaluate(() => { (window as any).__pageFail = false; (window as any).__pageDelay = 400; });
  await panel(page).getByRole('button', { name: '다시 시도' }).click();
  await panel(page).getByRole('button', { name: '본문 번역 닫기' }).click();
  await translate(page, false); expect(await calls(page)).toBe(2);
});

test('scroll changes the translation page without spending API and late result cannot replace another PDF', async ({ page }) => {
  await installBackend(page); await open(page); await page.evaluate(() => { (window as any).__pageDelay = 700; });
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  await startPageTranslation(page);
  await expect.poll(() => calls(page)).toBe(1);
  await panel(page).getByRole('button', { name: '다음 번역 페이지' }).click();
  await expect(panel(page).getByRole('button', { name: '이 페이지 번역' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('test-page-translations'))).not.toBeNull();
  await expect(panel(page).locator('.translation-page[data-page-number="1"]')).toContainText('한국어 번역 1-1');
  await expect(panel(page).locator('.translation-page[data-page-number="2"]')).not.toContainText('한국어 번역 1-1');
  await page.evaluate(() => (window as any).__emitFileDrag({ type: 'drop', paths: ['/other.pdf'] }));
  await expect(page.locator('.translation-page')).toHaveCount(0); await translate(page);
  const ids = await page.evaluate(() => (window as any).__calls.filter((c: any) => c.command === 'translate_page').map((c: any) => c.args.request.paperId));
  expect(ids).toEqual(['paper-a', 'paper-b']);
});

test('two-column PDF extracts left column before right, with hyphens and exact sentence fragments', async ({ page }) => {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([612, 792]);
  const line = (text: string, x: number, y: number) => p.drawText(text, { x, y, size: 10, font });
  line('A Research Paper With Two Columns', 30, 740);
  line('The left game-', 30, 690); line('The right sentence.', 330, 690);
  line('theoretical method works. Next sentence.', 30, 677); line('A second right sentence.', 330, 677);
  await installBackend(page, undefined, await doc.save()); await open(page); await translate(page);
  const sentences = await page.evaluate(() => (window as any).__calls.find((c: any) => c.command === 'translate_page').args.request.sentences);
  expect(sentences.map((s: any) => s.text)).toEqual(['A Research Paper With Two Columns', 'The left game-theoretical method works.', 'Next sentence.', 'The right sentence.', 'A second right sentence.']);
  expect(sentences[1].rects).toHaveLength(2); expect(sentences[2].rects).toHaveLength(1);
  expect(sentences[1].rects[1][2]).toBeLessThan(sentences[2].rects[0][0]);
  await panel(page).locator('.translated-sentence').nth(1).hover();
  await expect(page.locator('.translation-source-mark')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/body-translation.png' });
});

test('image-only page gives a clear message without a model request', async ({ page }) => {
  const doc = await PDFDocument.create(); doc.addPage([612, 792]);
  await installBackend(page, undefined, await doc.save()); await page.goto('/');
  await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
  await expect(page.locator('.no-text-note')).toBeVisible();
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  await startPageTranslation(page);
  await expect(panel(page).getByRole('alert')).toContainText('텍스트가 없는 페이지'); expect(await calls(page)).toBe(0);
});

test('reopening during a slow cache read never starts translation before the page button', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(() => { (window as any).__pageCacheDelay = 800; (window as any).__pageDelay = 400; });
  await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  await expect(panel(page)).toContainText('저장된 번역 확인 중');
  for (let n = 0; n < 2; n++) {
    await panel(page).getByRole('button', { name: '본문 번역 닫기' }).click();
    await page.getByRole('button', { name: '본문 번역', exact: true }).click();
  }
  await expect(panel(page).locator('.translation-page').first().getByRole('button', { name: '이 페이지 번역' })).toBeVisible();
  expect(await calls(page)).toBe(0);
  await startPageTranslation(page);
  await expect(panel(page)).toContainText('한국어 번역 1-1'); expect(await calls(page)).toBe(1);
});

for (const rotation of [0, 90]) test(`original sentence hover highlights the translation without affecting selection (${rotation})`, async ({ page }) => {
  await installBackend(page, {delay:0,fail:false,rotation,userUnit:1}); await open(page);
  await page.getByRole('button', {name:'페이지 너비 맞춤'}).click(); await translate(page);
  const box = await wordBox(page, 'asymptotic');
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await expect(panel(page).locator('.translated-sentence').first()).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.translation-source-mark')).toHaveCount(1);
  await select(page); await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.word-highlight')).toHaveCount(0);
});

test('panel resizes by dragging or keyboard, keeps PDF fit and matching, and remembers its width', async ({ page }) => {
  await installBackend(page); await open(page); await translate(page);
  await page.getByRole('button',{name:'페이지 너비 맞춤'}).click();
  const handle = page.getByRole('separator',{name:'1페이지 번역창 너비 조절'});
  const before = (await page.locator('.translation-page').first().boundingBox())!.width, b = (await handle.boundingBox())!;
  await page.mouse.move(b.x+b.width/2,b.y+120); await page.mouse.down(); await page.mouse.move(b.x-100,b.y+120,{steps:10}); await page.mouse.up();
  expect((await page.locator('.translation-page').first().boundingBox())!.width).toBeGreaterThan(before+90);
  await handle.focus(); await page.keyboard.press('ArrowRight');
  const resized = (await page.locator('.translation-page').first().boundingBox())!.width;
  const box = await wordBox(page,'asymptotic'); await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await expect(panel(page).locator('.translated-sentence').first()).toHaveAttribute('aria-pressed','true');
  await panel(page).getByRole('button',{name:'본문 번역 닫기'}).click(); await translate(page, false);
  expect((await page.locator('.translation-page').first().boundingBox())!.width).toBeCloseTo(resized,0);
  await page.reload(); await open(page); await translate(page, false);
  expect((await page.locator('.translation-page').first().boundingBox())!.width).toBeCloseTo(resized,0); expect(await calls(page)).toBe(0);
});

test('a complete streamed sentence is readable before page completion; failure retains an unsaved preview for retry', async ({ page }) => {
  await installBackend(page); await open(page);
  await page.evaluate(()=>{ (window as any).__pageStreaming=true; (window as any).__pageDelay=1700; (window as any).__pageFail=true; });
  await page.getByRole('button',{name:'본문 번역',exact:true}).click();
  await startPageTranslation(page);
  await expect(panel(page)).toContainText('먼저 도착한 번역 문장입니다.');
  await expect(panel(page).getByRole('status')).toContainText('1/4 항목');
  expect(await page.evaluate(()=>localStorage.getItem('test-page-translations'))).toBeNull();
  await expect(panel(page).getByRole('alert')).toContainText('실패');
  await expect(panel(page).locator('.translated-sentence')).toHaveCount(1);
  await expect(panel(page)).toContainText('먼저 도착한 번역 문장입니다.');
  expect(await page.evaluate(()=>localStorage.getItem('test-page-translations'))).toBeNull();
  expect(await page.evaluate(()=>localStorage.getItem('test-cost'))).toBeNull();
  await page.evaluate(()=>{ (window as any).__pageFail=false; });
  await panel(page).getByRole('button',{name:'다시 시도'}).click();
  await expect(panel(page)).toContainText('한국어 번역 1-4');
});

test('narrow two-column sentences with split font runs and superscripts stay separate', async ({ page }) => {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),p=doc.addPage([612,792]);
  const draw=(t:string,x:number,y:number,size=12)=>p.drawText(t,{x,y,size,font});
  draw('Left sentence starts',30,690);draw('Right sentence begins',307,690);
  draw('and ends here.',30,676);draw('and ends there.',307,676);
  draw('Next left statement.',30,660);draw('Next right statement.',307,660);
  await installBackend(page,undefined,await doc.save());await open(page);await translate(page);
  const sources=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
  expect(sources.map((s:any)=>s.text)).toEqual(['Left sentence starts and ends here.','Next left statement.','Right sentence begins and ends there.','Next right statement.']);
});
