import type { Line, TextRun } from './pageTranslation';
import { lineSize } from './translationLayout';

const captionNumber = '(?:[A-Z]\\.?\\d+|\\d+|[IVXLCDM]+)';
const captionStart = new RegExp(`^(?:Fig(?:ure)?s?\\.?|Table)\\s*${captionNumber}\\b`, 'i');
const captionLabel = new RegExp(`^(?:Fig(?:ure)?s?\\.?|Table)\\s*${captionNumber}[.:\\s]*$`, 'i');
const captionPunctuation = new RegExp(`^(?:Fig(?:ure)?s?\\.?|Table)\\s*${captionNumber}[.:]`, 'i');
const textOf = (line: Line, runs: TextRun[]) => line.runs.map(i => runs[i].text).join(' ').trim();

/** Floating captions, running furniture and notes have their own reading flows.
 * Keep the original geometry for highlights, but join the two body columns before
 * appending auxiliary regions. A caption never supplies a body sentence's tail. */
export function readingRegions(input: Line[], runs: TextRun[], pageHeight: number): Line[] {
  const lines = input.map(line => ({ ...line }));
  const sizes = lines.filter(l => /[A-Za-z]{8}/.test(textOf(l, runs))).map(l => lineSize(l, runs)).sort((a,b) => a-b);
  const body = sizes[Math.floor(sizes.length * .6)] || 10;
  let region = 0;
  for (const line of lines) {
    const size = lineSize(line, runs), text = textOf(line, runs);
    if (line.top < pageHeight * .065 && (size < body * .95 || /^\d+$/.test(text))) line.kind = 'header';
    if (line.top > pageHeight * .95 && (size < body * .95 || /^\d+$/.test(text))) line.kind = 'footer';
    if (line.top < pageHeight * .1 && /^(?:Published as a (?:conference|workshop) paper|This (?:article|paper) has been accepted|IEEE .* (?:LETTERS|TRANSACTIONS)|(?:arXiv|Preprint)[: ]|©\s*\d{4})/i.test(text)) line.kind = 'header';
    // Manuscript footers can use exactly the body font and sit well above the
    // final 5% of the sheet. Keep dates/author furniture out of continuations.
    if (line.top > pageHeight * .88 && (/^\d+$/.test(text)
      || /^(?:\d+\s+)?[A-Z][\p{L}' .-]+ et al[.,].*\b(?:19|20)\d{2}\b/u.test(text)
      || /^(?:Authorized licensed use|Downloaded on|©\s*\d{4})/i.test(text))) line.kind = 'footer';
  }
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i];
    const text = textOf(first, runs);
    if (first.kind || !captionStart.test(text)) continue;
    // "Fig. 2 shows ..." at normal body size is a reference sentence, whereas
    // caption labels usually end with punctuation or use smaller type.
    if (lineSize(first, runs) >= body * .94 && !captionLabel.test(text) && !captionPunctuation.test(text)) continue;
    const previous = lines[i-1];
    if (previous && !previous.kind && previous.column === first.column && lineSize(first,runs) >= body*.94
      && first.top-previous.bottom < body && /(?:shown in|see|in|of|as|refer to)\s*$/i.test(textOf(previous,runs))) continue;
    const size = lineSize(first, runs), id = ++region;
    first.kind = 'caption'; first.region = id;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j], previous = lines[j - 1], gap = line.top - previous.bottom;
      if (line.kind || line.column !== first.column || line.columnGroup !== first.columnGroup || captionStart.test(textOf(line, runs))
        || Math.abs(lineSize(line, runs) - size) > size * .13 || gap < -size * .5 || gap > size * .8) break;
      line.kind = 'caption'; line.region = id;
    }
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i], prev = lines[i - 1], size = lineSize(line, runs), previousSize = lineSize(prev, runs);
    if (line.kind || line.column !== prev.column || line.columnGroup !== prev.columnGroup || line.top < pageHeight * .62) continue;
    const noteStart = /^(?:Manuscript (?:received|submitted)|Received[: ]|\d*\s*(?:Authors? (?:is|are) with|Corresponding author))/i.test(textOf(line, runs));
    if (!noteStart && !(size < previousSize * .87 && line.top - prev.bottom > previousSize * .5)) continue;
    const id = ++region;
    for (let j = i; j < lines.length; j++) {
      const note = lines[j];
      if (note.kind || note.column !== line.column || note.columnGroup !== line.columnGroup || lineSize(note, runs) > size * 1.15) break;
      note.kind = 'footnote'; note.region = id;
    }
  }
  return [
    ...lines.filter(l => l.kind === 'header'), ...lines.filter(l => !l.kind),
    ...lines.filter(l => l.kind === 'caption'), ...lines.filter(l => l.kind === 'footnote'),
    ...lines.filter(l => l.kind === 'footer'),
  ];
}
