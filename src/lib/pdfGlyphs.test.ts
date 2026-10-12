import {expect,it} from 'vitest';
import {PDFDocument,PDFName,PDFNumber} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {pdfGlyphMappings,repairGlyphText} from './pdfGlyphs';
it('recovers missing Unicode from an actual PDF encoding name, without guessing unknown bytes',async()=>{
 const doc=await PDFDocument.create();doc.addPage();
 doc.context.register(doc.context.obj({Type:'Font',Subtype:'Type1',BaseFont:'Subset+Math',Encoding:doc.context.obj({Type:'Encoding',Differences:doc.context.obj([PDFNumber.of(5),PDFName.of('followsequal')])})}));
 const bytes=await doc.save();let reads=0;
 const pdf={getData:async()=>{reads++;return bytes;}} as unknown as PDFDocumentProxy;
 const maps=await pdfGlyphMappings(pdf);expect(repairGlyphText('\u0005','Subset+Math',maps)).toBe('≽');
 expect(repairGlyphText('\u0005','OtherFont',maps)).toBe('\u0005');expect(repairGlyphText('≤','Subset+Math',maps)).toBe('≤');
 maps.get('Subset+Math')!.set(7,'𝒯');expect(repairGlyphText('\u0007','Subset+Math',maps)).toBe('\u0007');
 await pdfGlyphMappings(pdf);expect(reads).toBe(1);
});
