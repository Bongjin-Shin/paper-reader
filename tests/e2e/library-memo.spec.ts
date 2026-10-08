import { expect, test, type Page } from '@playwright/test';
import { installBackend } from './helpers';
const library = (page: Page) => page.getByRole('button', { name: 'Library', exact: true });
const back = (page: Page) => page.getByRole('button', { name: '뒤로가기', exact: true });
const folder = (page: Page, name: string) => page.getByRole('navigation', { name: 'Library 폴더', exact: true }).getByRole('button', { name, exact: true });
const row = (page: Page, title: string) => page.locator('.library-papers > li').filter({ has: page.getByRole('button', { name: title, exact: true }) });
async function setup(page: Page) {
  await installBackend(page); await page.goto('/');
  await page.evaluate(() => {
    const papers = ['A','B'].map((name, i) => ({ id: i ? 'paper-b' : 'paper-a', fileName: name+'.pdf', title: 'Paper '+name,
      titleManual: true, metadataManual: true, authors: 'Author '+name, publishedDate: '2023', importance: 4,
      uploadedAt: '2020-01-01T00:00:00Z', memo: i ? 'Keep this memo' : '' }));
    localStorage.setItem('test-papers',JSON.stringify(papers));
    localStorage.setItem('test-library-memberships',JSON.stringify(papers.map(p => ({paperId:p.id,folderId:1}))));
  });
  await library(page).click(); await folder(page,'기본 폴더').click();
}
async function mouseBack(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:600,y:600,button:'back',buttons:8,clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:600,y:600,button:'back',buttons:0,clickCount:1});
  await cdp.detach();
}

test('memo edits save multiline Unicode text per paper and survive sorting, reimport, folder moves and restart', async ({ page }) => {
  await setup(page);
  const memo = "다음 주 검토 📝\nAuthor's notes: 본문 3절 다시 읽기";
  await row(page,'Paper A').getByRole('button',{name:'Paper A 메모 편집'}).click();
  await page.getByRole('textbox',{name:'Paper A 메모',exact:true}).fill(memo);
  await row(page,'Paper A').getByRole('button',{name:'저장',exact:true}).click();
  await expect(row(page,'Paper A').locator('.library-memo-content')).toHaveText(memo);
  await expect(row(page,'Paper B').locator('.library-memo-content')).toHaveText('Keep this memo');
  await page.getByRole('button',{name:'논문 제목 정렬'}).click();
  await expect(page.locator('.library-open-paper')).toHaveText(['Paper B','Paper A']);
  await expect(row(page,'Paper A').locator('.library-memo-content')).toHaveText(memo);
  await page.getByRole('button',{name:'PDF 추가',exact:true}).click();
  await expect(page.getByRole('button',{name:'PDF 추가',exact:true})).toBeEnabled();
  await expect(row(page,'Paper A').locator('.library-memo-content')).toHaveText(memo);
  await page.getByRole('button',{name:'새 폴더',exact:true}).click();
  await page.getByLabel('폴더 이름',{exact:true}).fill('Notes');
  await page.getByRole('button',{name:'만들기',exact:true}).click();
  await folder(page,'기본 폴더').click();
  await row(page,'Paper A').getByRole('button',{name:'폴더로 이동'}).click();
  await page.getByLabel('이동할 폴더').selectOption({label:'기본 폴더 / Notes'});
  await page.getByRole('button',{name:'이동',exact:true}).click();
  await folder(page,'Notes').click();
  await page.getByRole('button',{name:'Paper A',exact:true}).click();
  await expect(page.locator('.pdf-page .textLayer').first()).toBeVisible();
  await mouseBack(page); await expect(page.locator('.library-heading h2')).toHaveText('Notes');
  await expect(row(page,'Paper A').locator('.library-memo-content')).toHaveText(memo);
  await page.reload(); await library(page).click(); await folder(page,'Notes').click();
  await expect(row(page,'Paper A').locator('.library-memo-content')).toHaveText(memo);
  await page.screenshot({path:'.tools/library-memo-verification/memo.png'});
  const cells=await row(page,'Paper A').locator('.library-paper-details > *').evaluateAll(elements=>elements.map(el=>({x:el.getBoundingClientRect().x,cls:el.className})));
  expect(cells.map(cell=>cell.cls).slice(0,3)).toEqual(['library-paper-title','library-memo','library-authors']);
  expect(cells[0].x).toBeLessThan(cells[1].x); expect(cells[1].x).toBeLessThan(cells[2].x);
  await page.setViewportSize({width:640,height:900});
  expect(await page.locator('.library-main').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>(window as any).__apiCalls)).toBe(0);
});

test('memo save failure retains draft, cancellation preserves the old value, and clearing saves an empty memo', async ({ page }) => {
  await setup(page);
  await row(page,'Paper B').getByRole('button',{name:'Paper B 메모 편집'}).click();
  const input=page.getByRole('textbox',{name:'Paper B 메모',exact:true});
  await input.fill('Uncommitted draft');
  const box=(await input.boundingBox())!;
  await page.mouse.move(box.x+12,box.y+15); await page.mouse.down();
  await page.mouse.move(box.x+box.width-12,box.y+15,{steps:8}); await page.mouse.up();
  await expect(page.locator('.library-drag-ghost')).toHaveCount(0);
  await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await page.evaluate(()=>{(window as any).__libraryMutationFail=true; (window as any).__memoDelay=500;});
  await row(page,'Paper B').getByRole('button',{name:'저장',exact:true}).click();
  await expect(back(page)).toBeDisabled(); await mouseBack(page);
  await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await expect(row(page,'Paper B').getByRole('alert')).toContainText('Library 변경에 실패했습니다.');
  await expect(input).toHaveValue('Uncommitted draft');
  await row(page,'Paper B').getByRole('button',{name:'취소',exact:true}).click();
  await expect(row(page,'Paper B').locator('.library-memo-content')).toHaveText('Keep this memo');
  await page.evaluate(()=>{(window as any).__libraryMutationFail=false; (window as any).__memoDelay=0;});
  await row(page,'Paper B').getByRole('button',{name:'Paper B 메모 편집'}).click(); await input.fill('');
  await row(page,'Paper B').getByRole('button',{name:'저장',exact:true}).click();
  await expect(row(page,'Paper B').locator('.library-memo-content')).toHaveText('메모 추가');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-papers')!).find((p:any)=>p.id==='paper-b').memo)).toBe('');
});

test('hardware back traverses one app visit per press without browser navigation or mouse-button interference', async ({ page }) => {
  await setup(page); await page.getByRole('button',{name:'Vocabulary',exact:true}).click();
  await page.evaluate(()=>{history.pushState({},'', '/mouse-back-sentinel');});
  const url=page.url();
  await page.mouse.click(600,600,{button:'middle'});
  await page.mouse.click(600,600,{button:'right'}); await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Vocabulary',exact:true})).toHaveAttribute('aria-pressed','true');
  await mouseBack(page); await expect(page.locator('.library-heading h2')).toHaveText('기본 폴더');
  await mouseBack(page); await expect(page.locator('.library-heading h2')).toHaveText('Library');
  await mouseBack(page); await expect(page.getByRole('button',{name:'PDF Reader',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(back(page)).toBeDisabled(); await mouseBack(page);
  expect(page.url()).toBe(url);
  await expect(back(page)).toBeDisabled();
  // WebKitGTK side buttons can emit Mouse events without a corresponding Pointer release.
  await library(page).click(); await folder(page,'기본 폴더').click();
  const canceled=await page.evaluate(()=>['mousedown','mouseup','auxclick'].map(type=>
    !document.body.dispatchEvent(new MouseEvent(type,{button:3,bubbles:true,cancelable:true}))));
  expect(canceled).toEqual([true,true,true]);
  await expect(page.locator('.library-heading h2')).toHaveText('Library');
  expect(page.url()).toBe(url);
});
