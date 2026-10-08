import { PDFDocument, PageSizes, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fontUrl from '../assets/fonts/NanumGothic-Regular.ttf?url';
import type { VocabularyEntry } from '../types';

export type VocabularyMode = 'simple' | 'detailed';
const ink = rgb(.14, .18, .16), muted = rgb(.39, .44, .40), rule = rgb(.83, .86, .82);

// Break words only if they cannot fit a line. Handles long selections and CJK without truncation.
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    let line = '';
    for (const token of paragraph.match(/\S+\s*|\s+/gu) ?? []) {
      if (font.widthOfTextAtSize(line + token, size) <= width) { line += token; continue; }
      if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
      for (const char of token.trimStart()) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) { lines.push(line.trimEnd()); line = ''; }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export async function createVocabularyPdf(entries: VocabularyEntry[], mode: VocabularyMode, fontBytes?: Uint8Array): Promise<Uint8Array> {
  if (!entries.length) throw new Error('내보낼 단어가 없습니다.');
  if (!fontBytes) {
    const response = await fetch(fontUrl);
    if (!response.ok) throw new Error('PDF 글꼴을 불러오지 못했습니다.');
    fontBytes = new Uint8Array(await response.arrayBuffer());
  }
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  // Keep composite Korean glyphs intact across PDF viewers.
  const font = await document.embedFont(fontBytes, { subset: false });
  document.setTitle(`Vocabulary - ${mode === 'simple' ? 'Simple' : 'Detailed'}`);
  document.setCreator('Paper Vocabulary');
  const [width, height] = PageSizes.A4;
  const margin = 38, bottom = 46, contentWidth = width - margin * 2;
  let page: PDFPage, y = 0;
  const addPage = () => {
    page = document.addPage(PageSizes.A4);
    page.drawText('Vocabulary', { x: margin, y: height - 42, font, size: 17, color: ink });
    const label = mode === 'simple' ? 'Simple View' : 'Detailed View';
    page.drawText(label, { x: width - margin - font.widthOfTextAtSize(label, 9), y: height - 40, font, size: 9, color: muted });
    page.drawLine({ start: { x: margin, y: height - 54 }, end: { x: width - margin, y: height - 54 }, color: rule, thickness: .6 });
    y = height - 76;
  };
  addPage();
  if (mode === 'simple') {
    const gap = 22, columnWidth = (contentWidth - gap) / 2, wordWidth = columnWidth * .46, meaningWidth = columnWidth - wordWidth - 8;
    let column = 0;
    const nextColumn = () => { if (column === 0) { column = 1; y = height - 76; } else { addPage(); column = 0; } };
    entries.forEach(entry => {
      const words = wrap(entry.word, font, 9, wordWidth);
      const meanings = wrap(entry.translation ?? '-', font, 9, meaningWidth);
      const lines = Math.max(words.length, meanings.length), rowHeight = lines * 14 + 9;
      if (y - rowHeight < bottom && rowHeight < height - 130) nextColumn();
      for (let i = 0; i < lines; i++) {
        if (y < bottom + 14) nextColumn();
        const x = margin + column * (columnWidth + gap);
        if (words[i]) page.drawText(words[i], { x, y, font, size: 9, color: ink });
        if (meanings[i]) page.drawText(meanings[i], { x: x + columnWidth - font.widthOfTextAtSize(meanings[i], 9), y, font, size: 9, color: ink });
        y -= 14;
      }
      const x = margin + column * (columnWidth + gap);
      page.drawLine({ start: { x, y: y + 3 }, end: { x: x + columnWidth, y: y + 3 }, color: rule, thickness: .35 });
      y -= 9;
    });
  } else {
    const line = (text: string, size = 10, color = ink, indent = 0, alignRight = false) => {
      for (const part of wrap(text, font, size, contentWidth - indent)) {
        if (y < bottom + 16) addPage();
        if (part) page.drawText(part, { x: alignRight ? width - margin - font.widthOfTextAtSize(part, size) : margin + indent, y, font, size, color });
        y -= size * 1.55;
      }
    };
    const field = (label: string, value: string, alignRight = false) => {
      if (y < bottom + 48) addPage();
      line(label, 8, muted); line(value, 10, ink, 8, alignRight); y -= 5;
    };
    entries.forEach(entry => {
      if (y < bottom + 100) addPage();
      line(entry.word, 14); line(`조회 ${entry.lookupCount}회`, 8, muted); y -= 8;
      entry.contexts.forEach((context, index) => {
        if (index) { y -= 9; if (y < bottom + 100) addPage(); }
        field('뜻', context.translation ?? '-', true);
        field('설명', context.explanation ?? '-');
        field('원문 문장', context.originalSentence);
        field('논문 / 페이지', `${context.paperTitle} / ${context.pageNumber}페이지`);
      });
      y -= 7;
      if (y > bottom) page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, color: rule, thickness: .5 });
      y -= 23;
    });
  }
  document.getPages().forEach((page, index, pages) => {
    const label = `${index + 1} / ${pages.length}`;
    page.drawText(label, { x: (width - font.widthOfTextAtSize(label, 8)) / 2, y: 25, font, size: 8, color: muted });
  });
  return document.save();
}
