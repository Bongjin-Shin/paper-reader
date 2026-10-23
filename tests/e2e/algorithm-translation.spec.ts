import { expect,test } from '@playwright/test';
import { PDFDocument,StandardFonts,rgb } from 'pdf-lib';
import { installBackend,open,startPageTranslation } from './helpers';
import type { SourceSentence } from '../../src/types';

test('pseudocode is skipped while neighbouring columns, headings, inline equations and page end remain',async({page})=>{
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.TimesRoman),bold=await pdf.embedFont(StandardFonts.TimesRomanBold),symbol=await pdf.embedFont(StandardFonts.Symbol);
 const sheet=pdf.addPage([612,792]);
 const text=(value:string,x:number,y:number,f=font)=>sheet.drawText(value,{x,y,font:f,size:10});
 for(const y of [690,672,565])sheet.drawLine({start:{x:30,y},end:{x:285,y},thickness:.5,color:rgb(0,0,0)});
 text('Algorithm 1: Solve the model',30,678,bold);
 text('Input: observation data',30,658);text('for each observation do',40,640);text('return solution',40,610);text('end for',40,580);
 for(let i=0;i<8;i++)text(`The neighbouring column retains sentence ${i+1}.`,320,678-i*15);
 text('5 Vacancy Chain Approach',30,535,bold);
 text('We use ',30,510);text('x',62,510);text('=',70,510,symbol);text('2',80,510);text(' to explain the complete method.',86,510);
 text('This final sentence must also be translated.',30,480);
 await installBackend(page,undefined,await pdf.save());await open(page);
 await page.getByRole('button',{name:'본문 번역',exact:true}).click();await startPageTranslation(page);
 await expect(page.locator('.translated-sentence').first()).toBeVisible();
 const rows:SourceSentence[]=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 const prose=rows.map(r=>r.text).join(' ');
 expect(prose).not.toMatch(/Algorithm 1|Input:|for each observation|return solution|end for/);
 for(let i=1;i<=8;i++)expect(prose).toContain(`The neighbouring column retains sentence ${i}.`);
 expect(prose).toContain('This final sentence must also be translated.');
 expect(rows.find(s=>s.text==='5 Vacancy Chain Approach')?.layout?.kind).toBe('heading');
 const inline=rows.find(s=>s.text.startsWith('We use'))!;
 expect(inline.text).toContain('to explain the complete method.');expect(inline.layout?.math).toHaveLength(1);
 const math=inline.layout!.math[0];expect(inline.text).toContain(math.token);expect(math.rect[2]).toBeLessThan(100);
 await page.locator(`.translated-sentence[data-sentence-id="${inline.id}"]`).hover();
 await expect(page.locator('.translation-source-mark')).toHaveCount(inline.rects.length);
});

test('excluding a large unruled algorithm and a table does not collapse the two-column gutter',async({page})=>{
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.TimesRoman),bold=await pdf.embedFont(StandardFonts.TimesRomanBold);
 const sheet=pdf.addPage([612,792]);const text=(value:string,x:number,y:number,f=font)=>sheet.drawText(value,{x,y,font:f,size:10});
 text('Table B.1',40,710,bold);text('Model hyperparameters.',40,696);
 for(const y of [690,672,530])sheet.drawLine({start:{x:40,y},end:{x:280,y},thickness:.5});
 text('Parameter',40,678);text('Value',240,678);
 for(let i=0;i<10;i++){text('Hidden size',40,655-i*12);text(String(100+i),240,655-i*12);}
 for(let i=0;i<25;i++)text(`Left body sentence ${i+1} must remain complete.`,30,510-i*14);
 text('Declaration of competing interest',320,710,bold);text('The authors have no competing interests.',320,685);
 text('Appendix A. Pseudocode for training',320,640,bold);
 text('Input: calibrated model',320,610,bold);text('Output: recorded data',320,595,bold);text('foreach year do',320,580,bold);
 for(let i=0;i<25;i++)text('Update the temporary record;',330,565-i*14);
 text('end',330,200,bold);text('end',320,180,bold);text('Algorithm 1: Training generation',335,166,bold);
 await installBackend(page,undefined,await pdf.save());await open(page);
 await page.getByRole('button',{name:'본문 번역',exact:true}).click();await startPageTranslation(page);
 await expect(page.locator('.translated-sentence').first()).toBeVisible();
 const rows:SourceSentence[]=await page.evaluate(()=>(window as any).__calls.find((c:any)=>c.command==='translate_page').args.request.sentences);
 const caption=rows.find(s=>s.text.startsWith('Table B.1'))!;
 expect(caption.layout?.kind).toBe('caption');expect(caption.text).not.toContain('Declaration');expect(caption.rects.every(r=>r[2]<300)).toBe(true);
 const heading=rows.find(s=>s.text==='Declaration of competing interest')!;expect(heading.layout?.kind).toBe('heading');expect(heading.rects.every(r=>r[0]>300)).toBe(true);
 const prose=rows.map(s=>s.text).join(' ');expect(prose).not.toMatch(/Hidden size|Input:|Update the temporary|foreach|Algorithm 1/);
 for(let i=1;i<=25;i++)expect(prose).toContain(`Left body sentence ${i} must remain complete.`);
});
