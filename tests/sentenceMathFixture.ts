import {PDFDocument,StandardFonts,degrees,PDFName,PDFNumber} from 'pdf-lib';
export async function makeSentenceMathPdf(rotation=0,userUnit=1) {
  const doc=await PDFDocument.create(), regular=await doc.embedFont(StandardFonts.Helvetica), italic=await doc.embedFont(StandardFonts.TimesRomanItalic), bold=await doc.embedFont(StandardFonts.HelveticaBold),p=doc.addPage([612,792]);
  p.setRotation(degrees(rotation));if(userUnit!==1)p.node.set(PDFName.of('UserUnit'),PDFNumber.of(userUnit));
  p.drawText('Sentences and Equations',{x:50,y:742,size:18,font:bold});
  p.drawText('This is a long sentence that starts on the first line',{x:50,y:698,size:12,font:regular});
  p.drawText('continues on the second line with another font',{x:50,y:672,size:12,font:italic});
  p.drawText('and finishes on the third line. Another sentence follows.',{x:50,y:646,size:12,font:regular});
  p.drawText('As shown in Fig. 2, the equation is used.',{x:50,y:618,size:12,font:regular});
  p.drawText('E = mc',{x:100,y:571,size:14,font:italic});p.drawText('2',{x:144,y:578,size:8,font:italic});p.drawText('(1)',{x:292,y:571,size:12,font:regular});
  p.drawText('y =',{x:100,y:540,size:14,font:italic});p.drawText('1',{x:127,y:546,size:8,font:regular});p.drawLine({start:{x:125,y:543},end:{x:136,y:543},thickness:.8});p.drawText('n',{x:128,y:534,size:8,font:italic});p.drawText('(2)',{x:292,y:540,size:12,font:regular});
  p.drawText('The two expressions are preserved in the translation.',{x:50,y:500,size:12,font:regular});
  p.drawText('We use ',{x:50,y:478,size:12,font:regular});p.drawText('x = 2',{x:91,y:478,size:12,font:italic});p.drawText(' to solve this problem.',{x:124,y:478,size:12,font:regular});
  return doc.save();
}
