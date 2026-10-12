import {expect,it,vi} from 'vitest';
vi.mock('pdfjs-dist',()=>({TextLayer:class{},Util:{}}));
import {orderedLines,sentenceRanges,type TextRun} from './pageTranslation';
import {textBlocks,mathGroups,isEquation,clipInlineEquation,lineNumberRuns} from './translationLayout';
import {readingRegions} from './translationRegions';
const run=(text:string,x:number,y:number,size=12,extra:Partial<TextRun>={}):TextRun=>({text,left:x,right:x+text.length*5,top:y-size*.8,bottom:y+size*.2,fontSize:size,baseline:y,...extra});
it('keeps unfinished prose across leading and font-height changes, splitting only complete sentences',()=>{
 const runs=[run('This long sentence is wrapped',30,20),run('onto a differently spaced line',30,47,12,{top:31,bottom:50}),run('and ends here. Next sentence.',30,74)];
 const blocks=textBlocks(orderedLines(runs),runs);expect(blocks).toHaveLength(1);
 expect(sentenceRanges(blocks[0].lines.map(l=>l.runs.map(i=>runs[i].text).join('')).join('\n')).map(s=>s.text)).toEqual(['This long sentence is wrapped onto a differently spaced line and ends here.','Next sentence.']);
});
it('does not turn italics or a raised citation into paragraph breaks',()=>{
 const runs=[run('A sentence with citation',30,20),run('1',145,16,7),run('continues in italic text.',30,37,12,{top:22,bottom:41})];
 const lines=orderedLines(runs);expect(lines).toHaveLength(2);expect(lines[0].runs).toEqual([0,1]);expect(textBlocks(lines,runs)).toHaveLength(1);
});
it('preserves short headings while joining prose across columns',()=>{
 const runs=[run('Section',30,10,15,{bold:true}),run('The last left-column sentence',30,35),run('continues at the right.',320,10),run('Second left line without punctuation',30,50),run('Next right sentence.',320,35),run('Final right sentence.',320,50)];
 const ordered=orderedLines(runs);const blocks=textBlocks(ordered,runs);expect(blocks[0].kind).toBe('heading');
 expect(blocks[1].lines.flatMap(l=>l.runs)).toEqual([1,3,2]);
});
it('recognizes math runs while leaving surrounding prose translatable',()=>{
 const runs=[run('We use ',30,20),run('x = 2',75,20),run(' to solve this problem.',112,20)];
 const line=orderedLines(runs)[0];expect(mathGroups(line,runs)).toEqual([[1]]);expect(isEquation(line,runs)).toBe(false);
 const eq=[run('E = mc',30,20),run('2',61,14,7),run('(1)',180,20)];expect(isEquation(orderedLines(eq)[0],eq)).toBe(true);
});
it('academic abbreviations and decimal numbers do not split one sentence',()=>{
 expect(sentenceRanges('As shown in Fig. 2 and Eq. (3), the value is 1.25, e.g. here. Another result follows.').map(s=>s.text)).toEqual(['As shown in Fig. 2 and Eq. (3), the value is 1.25, e.g. here.','Another result follows.']);
});
it('clips oversized inline symbol boxes before adjacent prose without cutting same-line scripts',()=>{
 const runs=[run('Previous line',30,20,10,{inkBottom:22}),run('x',30,32,10,{math:true}),run('2',38,28,7,{math:true}),run('Next line',30,44,10,{inkTop:37}),run('Other column',330,31)];
 const line={runs:[1,2],left:30,right:43,top:14,bottom:39,column:1};
 expect(clipInlineEquation({left:29,right:44,top:14,bottom:39},line,runs)).toEqual({left:29,right:44,top:22.4,bottom:36.6});
});
it('keeps an all-bold abstract sentence and its final line in one prose block',()=>{
 const runs=[run('Comparison simulations with the game theory-based and',30,100,10,{bold:true}),
  run('reinforcement learning-based methods are provided to show the',30,112,10,{bold:true}),
  run('effectiveness of the proposed algorithm.',30,124,10,{bold:true})];
 const blocks=textBlocks(orderedLines(runs),runs);expect(blocks).toHaveLength(1);expect(blocks[0].kind).toBe('paragraph');
 expect(sentenceRanges(blocks[0].lines.map(l=>l.runs.map(i=>runs[i].text).join('')).join('\n'))).toHaveLength(1);
});
it('keeps descriptive subscripts in a single multiline equation block',()=>{
 const runs=[run('min',30,20,10),run('f',48,20,10,{math:true}),run('cost',55,22,7),run('=',74,20,10),run('N',87,20,10,{math:true}),run('success',94,22,7),
  run('N',30,39,10,{math:true}),run('success',37,41,7),run('=',67,39,10),run('sum',80,39,10,{math:true}),
  run('psi = 1 if t < T',105,34,10,{math:true}),run('psi = 0 if t > T',105,47,10,{math:true})];
 const blocks=textBlocks(orderedLines(runs),runs);expect(blocks).toHaveLength(1);expect(blocks[0].kind).toBe('equation');expect(blocks[0].lines.flatMap(l=>l.runs).sort((a,b)=>a-b)).toEqual(runs.map((_,i)=>i));
});
it('keeps small footnote lines in reading order without inserting them into a cross-column sentence',()=>{
 const runs=[run('The sentence continues',30,530,10),run('at the next column.',330,100,10),run('Other body line.',330,115,10),
  run('Manuscript received on a certain date.',30,580,8),run('18 April 2023. Notes continue.',30,590,8)];
 const lines=runs.map((r,i)=>({runs:[i],left:r.left,right:r.right,top:r.top,bottom:r.bottom,column:i===1||i===2?2:1}));
 const ordered=readingRegions([lines[0],lines[3],lines[4],lines[1],lines[2]],runs,792);
 expect(ordered.flatMap(l=>l.runs)).toEqual([0,1,2,3,4]);
 const body=textBlocks(ordered,runs)[0];expect(body.lines.flatMap(l=>l.runs)).toEqual([0,1,2]);
 expect(sentenceRanges(body.lines.map(l=>l.runs.map(i=>runs[i].text).join('')).join('\n'))[0].text).toBe('The sentence continues at the next column.');
});

it('separates same-size manuscript headings and removes a sequential line-number gutter',()=>{
 const runs=Array.from({length:8},(_,i)=>[run(String(26+i),20,40+i*25),run(i===3?'INTRODUCTION':i===2?'The prior paragraph ends.':'This manuscript line continues',62,40+i*25,12,{bold:i===3})]).flat();
 const numbers=lineNumberRuns(runs); expect([...numbers]).toEqual([0,2,4,6,8,10,12,14]);
 const prose=runs.filter((_,i)=>!numbers.has(i)), blocks=textBlocks(orderedLines(prose),prose);
 const heading=blocks.find(b=>b.kind==='heading'); expect(heading).toBeDefined();
 expect(heading!.lines.flatMap(l=>l.runs).map(i=>prose[i].text)).toEqual(['INTRODUCTION']);
 expect(blocks.at(-1)!.kind).toBe('paragraph');
});
it('retains numeric data which is not a sequential manuscript gutter',()=>{
 const runs=[run('Heading',10,10),...Array.from({length:6},(_,i)=>[run(String(i+1),30,40+i*20),run('Table entry',70,40+i*20)]).flat()];
 expect(lineNumberRuns(runs).size).toBe(0);
});

it('keeps affiliation braces and author daggers as text while retaining math in notes', () => {
 const runs = [run('{',30,20,10,{math:true}),run('author@email.edu',36,20),run('}',115,20,10,{math:true}),
  run('dagger',140,20),run('†',175,17,7,{math:true}),run('We use ',30,40),run('x = 2',75,40,10,{math:true})];
 const lines=orderedLines(runs);
 expect(mathGroups(lines[0],runs)).toEqual([]);
 expect(mathGroups(lines[1],runs)).toEqual([[6]]);
});
it('keeps nested superscripts with their base despite staggered lines in the other column',()=>{
 const runs=[run('Prior prose covers the exponent area.',30,20,10),run('T',30,32,10,{math:true}),run('t',36,28.4,7,{math:true}),
  run('in',42,32,10,{math:true}),run('R',54,32,10,{math:true}),run('(',60,28.4,7),run('k',64,28.4,7,{math:true}),run('m',68,29.4,5,{math:true}),
  run('+1)',73,28.4,7),run('x',86,28.4,7,{math:true}),run('k',92,28.4,7,{math:true}),run('g',97,29.4,5,{math:true}),run('is a feature vector.',104,32,10),
  run('Right column text.',320,22.4,10),run('Right column continues.',320,34.4,10),run('Left next sentence.',30,44,10),run('Right final sentence.',320,46.4,10)];
 const lines=orderedLines(runs), formula=lines.find(l=>l.runs.includes(1))!;
 for(let i=1;i<=12;i++)expect(formula.runs).toContain(i);
 expect(lines.find(l=>l.runs.includes(0))!.runs).not.toContain(2);
});
it('keeps an entire cases equation together and separates equations in opposite columns',()=>{
 const runs=[run('W = 1',(30),720,10,{math:true}),run('(1)',200,720,10),
  run('⎧',360,60,10,{math:true}),run('sum',370,70,7,{math:true}),run('abs(x)',400,70,7),
  run('w =',330,85,10,{math:true}),run('if x > 0',460,77,10,{math:true}),run('(2)',550,85,10),
  run('eta',370,98,10,{math:true}),run('otherwise,',460,98,10),run('where the coefficient is defined.',320,115,10)];
 const lines=[[0,1],[2],[3,4],[5,6,7],[8,9],[10]].map(ids=>({runs:ids,left:Math.min(...ids.map(i=>runs[i].left)),right:Math.max(...ids.map(i=>runs[i].right)),top:Math.min(...ids.map(i=>runs[i].top)),bottom:Math.max(...ids.map(i=>runs[i].bottom)),column:ids[0]<2?1:2}));
 const blocks=textBlocks(lines,runs);expect(blocks.map(b=>b.kind)).toEqual(['equation','equation','paragraph']);
 expect(blocks[1].lines.flatMap(l=>l.runs)).toEqual([2,3,4,5,6,7,8,9]);
});
it('does not classify a body reference to Fig. 2 as a floating caption',()=>{
 const runs=[run('The network is shown in',320,100,10),run('Fig. 2. It can handle arbitrary inputs.',320,112,10),run('The model learns features.',320,124,10)];
 const lines=orderedLines(runs);expect(readingRegions(lines,runs,792).every(l=>l.kind!=='caption')).toBe(true);
});
