import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Unequal metadata/abstract columns, then an ordinary two-column body. */
export async function makeRegionalColumnsPdf() {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.TimesRoman);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const page = doc.addPage([612, 792]);
  const line = (text: string, x: number, y: number, size = 10) => page.drawText(text, { x, y, size, font });
  line('Detection and localization using conditional models', 30, 730, 18);
  line('A R T I C L E  I N F O', 30, 660, 9);
  line('A B S T R A C T', 205, 660, 9);
  const keywords = ['Keywords:', 'Leak', 'Anomaly detection', 'Generative adversarial networks', 'Water distribution'];
  keywords.forEach((text, i) => line(text, 30, 640 - i * 11, 8));
  const prefix = 'This paper studies ';
  line(prefix, 205, 640, 9);
  page.drawText('conditional models', { x: 205 + font.widthOfTextAtSize(prefix, 9), y: 640, size: 9, font: italic });
  const end = 205 + font.widthOfTextAtSize(prefix, 9) + italic.widthOfTextAtSize('conditional models', 9);
  line(' for image-', end, 640, 9);
  line('based detection in distribution networks. The method uses', 205, 628, 9);
  line('pressure measurements and accounts for demand uncertainty.', 205, 616, 9);
  line('The results show accurate detection across different networks.', 205, 604, 9);
  line('The proposed model is suitable for real-time monitoring.', 205, 592, 9);
  line('1. Introduction', 30, 535);
  line('1.1. Literature review', 315, 535);
  for (let i = 0; i < 8; i++) {
    line(`Left body paragraph ${i + 1} introduces the method.`, 30, 515 - i * 13);
    line(`Right body paragraph ${i + 1} reviews prior work.`, 315, 515 - i * 13);
  }
  return doc.save();
}
