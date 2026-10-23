import { expect, it } from 'vitest';
import { TextEditHistory, type TextSnapshot } from './textEditHistory';
const state = (value:string,start=value.length,end=start):TextSnapshot => ({value,start,end,direction:'none'});
it('groups contiguous typing and separately restores replacement selections, delete and redo',()=>{
 const h=new TextEditHistory();h.record(state(''),state('a'),'insertText',0);h.record(state('a'),state('ab'),'insertText',50);
 h.record(state('ab',0,1),state('Xb',1),'insertFromPaste',100);
 expect(h.move(false,state('Xb',2))).toEqual(state('ab',0,1));expect(h.move(false,state('ab'))).toEqual(state(''));
 expect(h.move(true,state(''))).toEqual(state('ab'));expect(h.move(true,state('ab'))).toEqual(state('Xb',1));
 h.record(state('Xb',0,2),state(''),'deleteContentBackward',200);expect(h.move(false,state(''))).toEqual(state('Xb',0,2));
});
it('starts a new group after pauses or caret moves and clears redo after new input',()=>{
 const h=new TextEditHistory();h.record(state(''),state('ab'),'insertText',0);h.record(state('ab'),state('abc'),'insertText',1000);
 expect(h.move(false,state('abc'))?.value).toBe('ab');h.record(state('ab'),state('abd'),'insertText',1100);
 expect(h.move(true,state('abd'))).toBeUndefined();h.select(state('abd',0));h.record(state('abd',0),state('Xabd',1),'insertText',1150);
 expect(h.move(false,state('Xabd',1))?.value).toBe('abd');
});
it('records a complete IME composition as one edit and sending clears draft history',()=>{
 const h=new TextEditHistory();h.record(state(''),state('질문'),'composition');h.record(state('질문'),state('질문 한글'),'composition');
 expect(h.move(false,state('질문 한글'))?.value).toBe('질문');expect(h.move(false,state('질문'))?.value).toBe('');
 expect(h.move(true,state(''))?.value).toBe('질문');h.sync('');expect(h.move(false,state(''))).toBeUndefined();expect(h.move(true,state(''))).toBeUndefined();
});
