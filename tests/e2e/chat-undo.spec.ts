import { expect,test,type Page } from '@playwright/test';
import { installBackend,open } from './helpers';
async function chat(page:Page){await installBackend(page);await open(page);await page.getByRole('button',{name:'논문 채팅',exact:true}).click();}
const input=(page:Page)=>page.getByRole('textbox',{name:'논문 질문',exact:true});

test('draft typing, selected deletion and redo restore text and selection without undoing app data',async({page})=>{
 await chat(page);const box=input(page);await box.pressSequentially('First draft');await box.press('Control+z');await expect(box).toHaveValue('');
 await box.press('Control+Shift+z');await expect(box).toHaveValue('First draft');
 await box.press('Control+a');await box.press('Backspace');await expect(box).toHaveValue('');await box.press('Control+z');await expect(box).toHaveValue('First draft');
 expect(await box.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([0,11]);
 await box.press('Control+Shift+z');await expect(box).toHaveValue('');await box.press('Control+z');await box.pressSequentially('New');
 await box.press('Control+Shift+z');await expect(box).toHaveValue('New');
 expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.command==='restore_history'||c.command==='ask_paper'))).toHaveLength(0);
});

test('draft history survives closing the pane and resets after sending; question edits have independent history',async({page})=>{
 await chat(page);const box=input(page);await box.pressSequentially('First question');
 await page.getByRole('button',{name:'논문 채팅 닫기'}).click();await page.getByRole('button',{name:'논문 채팅',exact:true}).click();
 await box.press('Control+z');await expect(box).toHaveValue('');await box.press('Control+Shift+z');await expect(box).toHaveValue('First question');
 await page.getByRole('button',{name:'질문 보내기',exact:true}).click();await expect(page.locator('.chat-answer')).toHaveCount(1);
 await box.press('Control+z');await expect(box).toHaveValue('');
 await box.pressSequentially('Unsent draft');
 await page.getByRole('button',{name:'질문 수정',exact:true}).click();const edit=page.getByRole('textbox',{name:'질문 수정',exact:true});
 await edit.press('Control+a');await edit.pressSequentially('Edited question');await edit.press('Control+z');
 await expect(edit).toHaveValue('First question');await expect(box).toHaveValue('Unsent draft');
 await edit.press('Control+Shift+z');await expect(edit).not.toHaveValue('First question');
 await page.getByRole('button',{name:'취소',exact:true}).click();await box.press('Control+z');await expect(box).toHaveValue('');
 expect(await page.evaluate(()=>(window as any).__calls.filter((c:any)=>c.command==='ask_paper'))).toHaveLength(1);
});

test('Korean composition is one undo step and multiline paste restores auto-sized height',async({page})=>{
 await chat(page);const box=input(page);await box.pressSequentially('Before ');
 await box.dispatchEvent('compositionstart',{data:''});
 for(const value of ['ㅎ','하','한글']){
  await box.evaluate((el,value)=>{
   Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,'Before '+value);
   el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:value,isComposing:true}));
  },value);
 }
 await box.dispatchEvent('compositionend',{data:'한글'});await expect(box).toHaveValue('Before 한글');
 // A Korean keyboard layout can report the physical Z key as a Hangul character.
 await box.dispatchEvent('keydown',{key:'ㅋ',code:'KeyZ',ctrlKey:true});await expect(box).toHaveValue('Before ');
 await box.press('Control+Shift+z');await expect(box).toHaveValue('Before 한글');
 const height=await box.evaluate(el=>el.getBoundingClientRect().height);
 await box.evaluate(el=>{
  const text='\n긴 질문을 붙여 넣습니다.'.repeat(30);
  el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertFromPaste',data:text}));
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,el.value+text);
  el.setSelectionRange(el.value.length,el.value.length);
  el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste',data:text}));
 });
 await expect.poll(()=>box.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(height);
 await box.press('Control+z');await expect(box).toHaveValue('Before 한글');
 await expect.poll(()=>box.evaluate(el=>el.getBoundingClientRect().height)).toBeCloseTo(height,0);
 await box.press('Control+Shift+z');expect((await box.inputValue()).split('\n')).toHaveLength(31);
});
