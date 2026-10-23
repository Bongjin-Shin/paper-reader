import { expect, it, vi } from 'vitest';
vi.mock('pdfjs-dist', () => ({ TextLayer: class {} }));
import { algorithmRuns } from './translationAlgorithms';
import type { TextRun } from './pageTranslation';
const run = (text:string,left:number,y:number,width=180):TextRun => ({text,left,right:left+width,top:y-8,bottom:y+2,baseline:y,fontSize:10});
it('excludes a ruled algorithm, preserving prose beside and below it and ordinary references', () => {
 const runs=[run('Algorithm',30,80,43),run('1: A wrapped title',78,80),run('continued on this line',30,92),
  run('Input: data',30,110),run('for each item do',40,125),run('end for',40,140),
  run('Prose beside the algorithm.',320,80),run('Algorithm 1 provides a solution.',30,180)];
 const rules=[{left:25,right:285,top:70},{left:25,right:285,top:98},{left:25,right:285,top:150}];
 expect([...algorithmRuns(runs,rules)]).toEqual([0,1,2,3,4,5]);
 expect(algorithmRuns(runs,[]).size).toBe(0);
});
it('detects two separate algorithms without absorbing the prose between them',()=>{
 const runs=[run('Algorithm 1: First',30,80),run('return result',30,110),run('Normal explanation.',30,140),run('Algorithm 2: Second',30,180),run('return value',30,210)];
 const rules=[70,90,120,170,190,220].map(top=>({left:30,right:280,top}));
 expect([...algorithmRuns(runs,rules)]).toEqual([0,1,3,4]);
});
it('retains a section heading called Algorithm without a numbered box label',()=>{
 const runs=[run('Algorithm',30,80),run('We explain Algorithm 1 here.',30,110)];
 expect(algorithmRuns(runs,[70,90,120].map(top=>({left:30,right:280,top}))).size).toBe(0);
});
it('recognizes an unruled input/output block with its caption underneath, keeping adjacent prose',()=>{
 const code=['Input: calibrated model','Output: sensor data','foreach year do','Initialize records','while selected do','end','end','Algorithm 1: Training generation'];
 const runs=code.flatMap((t,i)=>[run('The other column remains intact.',30,100+i*14,250),run(t,320,100+i*14,220)]);
 expect([...algorithmRuns(runs,[])].sort((a,b)=>a-b)).toEqual([1,3,5,7,9,11,13,15]);
 const prose=runs.map(r=>r.text.startsWith('Input:')?{...r,text:'We discuss this model.'}:r);
 expect(algorithmRuns(prose,[]).size).toBe(0);
});
