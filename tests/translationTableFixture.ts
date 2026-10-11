import { PDFDocument, StandardFonts } from 'pdf-lib';
/** Ruled table with long formula cells above a two-column body. */
export async function makeTranslationTablePdf() {
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.TimesRoman),math=await doc.embedFont(StandardFonts.Symbol);
 const page=doc.addPage([612,792]);
 const text=(s:string,x:number,y:number,size=10)=>page.drawText(s,{x,y,size,font});
 text('Table 1',50,700); text('Model inputs and outputs are listed below.',50,685);
 for(const y of [674,648,548])page.drawLine({start:{x:50,y},end:{x:560,y},thickness:.5});
 text('Model',55,660);text('Input',220,660);text('Output',490,660);
 ['Predictor','Reconstructor','Residual Compensator'].forEach((label,i)=>{
  const y=626-i*30; text(label,55,y); text('[P(t) ',220,y); page.drawText('α',{x:250,y,size:10,font:math}); text(']; G',265,y);
  text('P(t)',490,y);page.drawText('β',{x:510,y,size:7,font:math});
 });
 text('Results',50,520,13);text('The model predicts future measurements.',50,494);text('Body sentences stay outside the table.',50,480);
 text('Other studies compare different models.',325,494);text('The experiments confirm the results.',325,480);
 doc.addPage([612,792]).drawText('The next page continues the discussion.',{x:50,y:700,size:10,font});
 return doc.save();
}
