import type { PDFDocumentProxy } from 'pdfjs-dist';

// PDFs sometimes omit individual ToUnicode entries, leaving the encoded byte
// (e.g. a control character) as extracted text. Use the PDF's own glyph names;
// never guess the symbol from its numeric character code or surrounding prose.
const glyphs: Record<string, string> = {
  followsequal: '≽', precedesequal: '≼', follows: '≻', precedes: '≺', greaterequal: '≥', lessequal: '≤',
  element: '∈', notelement: '∉', propersubset: '⊂', propersuperset: '⊃', reflexsubset: '⊆', reflexsuperset: '⊇',
  union: '∪', intersection: '∩', universal: '∀', existential: '∃', emptyset: '∅',
  summation: '∑', product: '∏', integral: '∫', radical: '√', infinity: '∞', partialdiff: '∂', nabla: '∇',
  minus: '−', plusminus: '±', multiply: '×', divide: '÷', approxequal: '≈', equivalence: '≡', notequal: '≠',
  arrowright: '→', arrowleft: '←', arrowboth: '↔', arrowdblright: '⇒', arrowdblleft: '⇐', arrowdblboth: '⇔',
};
type Mapping = Map<string, Map<number, string>>;
const cache = new WeakMap<PDFDocumentProxy, Promise<Mapping>>();
export const hasUnmappedGlyph = (text: string) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ue000-\uf8ff]/.test(text);
export async function pdfGlyphMappings(pdf: PDFDocumentProxy): Promise<Mapping> {
  let saved = cache.get(pdf);
  if (!saved) {
    saved = (async () => {
      const { PDFDocument, PDFDict, PDFName, PDFArray, PDFNumber } = await import('pdf-lib');
      const doc = await PDFDocument.load(await pdf.getData(), { ignoreEncryption: true, updateMetadata: false });
      const result: Mapping = new Map();
      for (const [, object] of doc.context.enumerateIndirectObjects()) {
        if (!(object instanceof PDFDict)) continue;
        const name = object.get(PDFName.of('BaseFont')), encoding = object.lookup(PDFName.of('Encoding'));
        if (!(name instanceof PDFName) || !(encoding instanceof PDFDict)) continue;
        const differences = encoding.lookup(PDFName.of('Differences'));
        if (!(differences instanceof PDFArray)) continue;
        let code = 0; const map = new Map<number, string>();
        for (let i=0; i<differences.size(); i++) {
          const item = differences.get(i);
          if (item instanceof PDFNumber) code = item.asNumber();
          else if (item instanceof PDFName) {
            const label = item.decodeText(), hex = /^(?:uni|u)([0-9A-Fa-f]{4,6})$/.exec(label);
            const value = glyphs[label] ?? (hex && parseInt(hex[1],16) <= 0x10ffff ? String.fromCodePoint(parseInt(hex[1],16)) : undefined);
            if (value) map.set(code,value); code++;
          }
        }
        if (map.size) result.set(name.decodeText(),map);
      }
      return result;
    })().catch(() => new Map());
    cache.set(pdf,saved);
  }
  return saved;
}
export function repairGlyphText(text: string, font: string, mappings: Mapping) {
  return [...text].map(character => {
    const replacement = hasUnmappedGlyph(character) ? mappings.get(font)?.get(character.codePointAt(0)!) : undefined;
    // TextLayer DOM ranges still index the original UTF-16 string.
    return replacement?.length === character.length ? replacement : character;
  }).join('');
}
