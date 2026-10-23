import {expect,it,vi} from 'vitest';
vi.mock('pdfjs-dist',()=>({TextLayer:class{}}));
import { extractTables } from './translationTables';
import { readingRegions } from './translationRegions';
import { orderedLines,type TextRun } from './pageTranslation';
const run=(text:string,left:number,y:number,width:number):TextRun=>({text,left,right:left+width,top:y-8,bottom:y+2,baseline:y,fontSize:10});
it('removes all rows of a long appendix table while preserving its caption and following prose',()=>{
 const runs=[run('Table B.1',30,60,50),run('Hyperparameters of GMAN.',30,74,150),run('Hyperparameters Value',30,92,190),
  ...Array.from({length:10},(_,i)=>[run('Parameter setting',30,112+i*13,100),run(String(100+i),190,112+i*13,20)]).flat(),
  run('The final body paragraph remains.',30,280,200)];
 const rules=[80,98,245].map(top=>({left:30,right:260,top}));
 const {used}=extractTables(runs,rules);
 expect([...used]).toEqual(Array.from({length:21},(_,i)=>i+2));
 const remaining=runs.filter((_,i)=>!used.has(i));
 const regions=readingRegions(orderedLines(remaining),remaining,792);
 expect(regions.filter(l=>l.kind==='caption').map(l=>l.runs.map(i=>remaining[i].text).join(' '))).toEqual(['Table B.1','Hyperparameters of GMAN.']);
 expect(regions.find(l=>l.runs.includes(2))?.kind).toBeUndefined();
});
