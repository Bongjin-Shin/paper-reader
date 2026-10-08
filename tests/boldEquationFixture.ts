import {PDFDocument,StandardFonts} from 'pdf-lib';
export const comparison='Comparison simulations with the game theory-based and reinforcement learning-based methods are provided to show the effectiveness of the proposed algorithm.';
export async function makeBoldAbstractPdf(columns=2) {
 const doc=await PDFDocument.create(),p=doc.addPage([612,792]),bold=await doc.embedFont(StandardFonts.TimesRomanBold),regular=await doc.embedFont(StandardFonts.TimesRoman);
 p.drawText('A Paper with a Bold Abstract',{x:40,y:738,size:18,font:bold});
 ['Abstract - We study a method that continues across lines','and is described in this paper.','Comparison simulations with the game theory-based and','reinforcement learning-based methods are provided to show the','effectiveness of the proposed algorithm.'].forEach((text,i)=>p.drawText(text,{x:40,y:690-i*12,size:9,font:bold}));
 if(columns===2)['The right column starts here with a complete sentence.','Another complete sentence follows in the right column.','Text in the other column must stay separate.'].forEach((text,i)=>p.drawText(text,{x:330,y:690-i*12,size:9,font:regular}));
 p.drawText('I. INTRODUCTION',{x:40,y:596,size:10,font:regular});p.drawText('Regular body text follows the bold abstract.',{x:40,y:574,size:10,font:regular});
 return doc.save();
}
export async function makeLabeledEquationPdf() {
 const doc=await PDFDocument.create(),p=doc.addPage([612,792]),font=await doc.embedFont(StandardFonts.TimesRoman),italic=await doc.embedFont(StandardFonts.TimesRomanItalic);
 const text=(s:string,x:number,y:number,size=10,math=false)=>p.drawText(s,{x,y,size,font:math?italic:font});
 text('The mathematical model is given below.',50,720);
 text('min f',90,675,10,true);text('cost',111,673,7);text('= N - N',130,675,10,true);text('success',162,673,7);text('(1)',450,675);
 text('N',90,655,10,true);text('success',98,653,7);text('=',127,655);text('x = 1, if t < T',175,662,10,true);text('x = 0, if t > T',175,648,10,true);
 p.drawSvgPath('M 168 0 C 155 0 164 12 156 14 C 164 16 155 28 168 28',{x:0,y:670,borderWidth:1});
 text('0 < x < max',90,632,10,true);text('(2)',450,632);
 text('The description resumes below the whole equation.',50,575);
 return doc.save();
}
