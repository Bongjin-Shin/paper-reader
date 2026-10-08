import { test, expect, type Page } from '@playwright/test';
import { installBackend, open, select } from './helpers';
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
const folder=(page:Page,name:string)=>page.getByRole('navigation',{name:'Library 폴더',exact:true}).getByRole('button',{name,exact:true});
const undo=async(page:Page)=>{await page.keyboard.press('Control+z');};
const redo=async(page:Page)=>{await page.keyboard.press('Control+Shift+z');};
const message=(page:Page)=>page.locator('.statusbar [role="status"]');
async function saved(page:Page) {
  await installBackend(page);await open(page);await select(page);await button(page,'번역').click();
  await expect(page.locator('.word-highlight')).toHaveCount(1);await page.keyboard.press('Escape');
}
async function makeFolder(page:Page,name:string) {
  await button(page,'새 폴더').click();await page.getByLabel('폴더 이름',{exact:true}).fill(name);await button(page,'만들기').click();
  await expect(page.locator('.library-heading h2')).toHaveText(name);
}

test('Vocabulary deletion undo/redo restores highlights and cached results, preserving canvas and API charges',async({page})=>{
  await saved(page);
  const cost=await page.evaluate(()=>localStorage.getItem('test-cost'));
  await page.evaluate(()=>{(window as any).__oldCanvas=document.querySelector('.pdf-page canvas');});
  await button(page,'Vocabulary').click();await page.getByRole('checkbox',{name:'asymptotic 선택',exact:true}).check();await button(page,'선택 삭제 (1)').click();
  await expect(page.locator('.vocabulary-word')).toHaveCount(0);
  await undo(page);await expect(page.locator('.vocabulary-word')).toHaveText('asymptotic');await expect(message(page)).toContainText('실행 취소: Vocabulary 삭제');await expect(page.getByText('1개 항목을 삭제했습니다.',{exact:true})).toHaveCount(0);
  await redo(page);await expect(page.locator('.vocabulary-word')).toHaveCount(0);
  await undo(page);await expect(page.locator('.vocabulary-word')).toHaveCount(1);
  await button(page,'PDF Reader').click();await expect(page.locator('.word-highlight')).toHaveCount(1);
  expect(await page.evaluate(()=>(window as any).__oldCanvas===document.querySelector('.pdf-page canvas'))).toBe(true);
  await select(page);await button(page,'번역').click();await expect(page.getByRole('dialog')).toContainText('점근적인');
  expect(await page.evaluate(()=>(window as any).__apiCalls)).toBe(1);expect(await page.evaluate(()=>localStorage.getItem('test-cost'))).toBe(cost);
});

test('highlight-only deletion can be undone and redone without changing Vocabulary or zoom',async({page})=>{
  await saved(page);const words=await page.evaluate(()=>localStorage.getItem('test-lookups'));
  await select(page);await button(page,'하이라이트 취소').click();await expect(page.locator('.word-highlight')).toHaveCount(0);
  await undo(page);await expect(page.locator('.word-highlight')).toHaveCount(1);await expect(message(page)).toContainText('하이라이트 삭제');
  await redo(page);await expect(page.locator('.word-highlight')).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('test-lookups'))).toBe(words);await expect(page.locator('.zoom-controls span')).toHaveText('125%');
});

test('batch paper move is one history step and deleted folder trees can be restored and reopened',async({page})=>{
  await saved(page);await button(page,'Library').click();await makeFolder(page,'Research');await makeFolder(page,'Child');
  await folder(page,'Library 홈').click();
  await page.getByRole('checkbox',{name:'test-paper.pdf 선택',exact:true}).check();await button(page,'선택 이동').click();
  await page.getByLabel('이동할 폴더').selectOption('3');await button(page,'이동').click();await expect(page.locator('.library-papers > li')).toHaveCount(0);
  await undo(page);await expect(page.locator('.library-papers > li')).toHaveCount(1);
  await redo(page);await expect(page.locator('.library-papers > li')).toHaveCount(0);
  await folder(page,'Research').click();await button(page,'폴더 삭제').click();await button(page,'삭제하기').click();
  await expect(folder(page,'Child')).toHaveCount(0);await undo(page);await expect(folder(page,'Child')).toBeVisible();
  await folder(page,'Child').click();await button(page,'test-paper.pdf').click();await expect(page.locator('.word-highlight')).toHaveCount(1);
  await redo(page);await expect(page.locator('.empty-state')).toBeVisible();
  await button(page,'Library').click();await expect(folder(page,'Child')).toHaveCount(0);
});

test('saved memo and importance undo independently, metadata title updates the open Reader',async({page})=>{
  await saved(page);await button(page,'Library').click();
  await button(page,'논문 정보 수정').click();await page.getByLabel('논문 이름',{exact:true}).fill('Renamed Paper');
  await page.getByLabel('저자명',{exact:true}).fill('Author Name');await page.getByLabel('발행일',{exact:true}).fill('2020-01-01');await button(page,'저장').click();
  await expect(page.locator('.document-title')).toHaveText('Renamed Paper');
  await button(page,'Renamed Paper 메모 편집').click();await page.getByRole('textbox',{name:'Renamed Paper 메모',exact:true}).fill('한글 메모');await button(page,'저장').click();
  await page.getByRole('radio',{name:'중요도 5점',exact:true}).check();
  await undo(page);await expect(message(page)).toContainText('중요도 변경');
  await undo(page);await expect(page.locator('.library-memo-content')).toHaveText('메모 추가');
  await undo(page);await expect(page.locator('.document-title')).toHaveText('test-paper.pdf');
  await redo(page);await expect(page.locator('.document-title')).toHaveText('Renamed Paper');
  await redo(page);await expect(page.locator('.library-memo-content')).toHaveText('한글 메모');
});

test('text editing, IME, Alt and key repeat do not dispatch app undo',async({page})=>{
  await saved(page);await button(page,'Library').click();await button(page,'test-paper.pdf 메모 편집').click();
  const input=page.getByRole('textbox',{name:'test-paper.pdf 메모',exact:true});await input.pressSequentially('draft');await undo(page);await expect(input).not.toHaveValue('draft');await redo(page);
  await input.dispatchEvent('keydown',{key:'z',ctrlKey:true,isComposing:true});await button(page,'취소').click();
  await page.locator('.library-heading h2').click();
  await page.locator('body').dispatchEvent('keydown',{key:'z',ctrlKey:true,isComposing:true});
  await page.locator('body').dispatchEvent('keydown',{key:'z',ctrlKey:true,keyCode:229});
  await page.locator('body').dispatchEvent('keydown',{key:'z',ctrlKey:true,repeat:true});
  await page.locator('body').dispatchEvent('keydown',{key:'z',ctrlKey:true,altKey:true});
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.command==='restore_history'))).toHaveLength(0);
});

test('failed undo can retry, duplicate shortcuts are blocked and new edits clear redo',async({page})=>{
  await saved(page);await button(page,'Library').click();await button(page,'이름 변경').click();await page.getByLabel('논문 이름',{exact:true}).fill('Changed');await button(page,'저장').click();
  await page.evaluate(()=>{(window as any).__historyFail=true;});await undo(page);await expect(page.getByRole('alert')).toContainText('실행 취소에 실패');
  await expect(button(page,'Changed')).toBeVisible();
  await page.evaluate(()=>{(window as any).__historyFail=false;(window as any).__historyDelay=350;});await undo(page);await redo(page);await undo(page);
  await expect(button(page,'test-paper.pdf')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.command==='restore_history'))).toHaveLength(2);
  await button(page,'test-paper.pdf 메모 편집').click();await page.getByRole('textbox',{name:'test-paper.pdf 메모',exact:true}).fill('New branch');await button(page,'저장').click();
  await redo(page);await expect(message(page)).toHaveText('다시 실행할 작업이 없습니다.');
  await page.reload();await button(page,'PDF Reader').click();await page.keyboard.press('Control+z');await expect(message(page)).toHaveText('실행 취소할 작업이 없습니다.');
});

test('a pending deletion cannot be undone before its transaction finishes',async({page})=>{
  await saved(page);await button(page,'Vocabulary').click();await page.getByRole('checkbox',{name:'asymptotic 선택',exact:true}).check();
  await page.evaluate(()=>{(window as any).__deleteDelay=500;});await button(page,'선택 삭제 (1)').click();await undo(page);
  expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.command==='restore_history'))).toHaveLength(0);
  await expect(page.locator('.vocabulary-word')).toHaveCount(0);await undo(page);await expect(page.locator('.vocabulary-word')).toHaveCount(1);
});
