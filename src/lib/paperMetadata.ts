import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { PaperMetadata } from '../types';

const clean = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
const compact = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function title(value: unknown): string {
  const text = clean(value);
  if (text.length < 4 || text.length > 300 || /^(untitled|anonymous|title|paper|article|document|template)$/i.test(text)
    || /\.(pdf|docx?|tex|ps)$/i.test(text) || /^(microsoft (word|powerpoint)|latex|arxiv:|doi:|https?:)/i.test(text)) return '';
  return text;
}

/** Preserve precision; file creation/modification dates are not publication dates. */
export function publicationDate(value: unknown): string {
  const text = clean(value).replace(/\.$/, '').replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (_, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)
    .replace(/^(\d{4})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?$/, (_, y, m, d) => `${y}-${m.padStart(2, '0')}${d ? '-' + d.padStart(2, '0') : ''}`);
  const iso = text.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:$|T)/);
  if (iso) {
    const [, y, m, d] = iso, year = Number(y), month = Number(m ?? 1), day = Number(d ?? 1);
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return '';
    return [y, m, d].filter(Boolean).join('-');
  }
  const named = text.match(/^(?:(\d{1,2})\s+)?([A-Za-z]+)\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/);
  if (!named) return '';
  const word = named[2].toLowerCase();
  const month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    .findIndex(m => m === word || m.slice(0, 3) === word || (m === 'september' && word === 'sept'));
  if (month < 0 || (named[1] && named[3])) return '';
  return publicationDate(`${named[4]}-${String(month + 1).padStart(2, '0')}${named[1] || named[3] ? '-' + (named[1] || named[3]).padStart(2, '0') : ''}`);
}

type Line = { y: number; size: number; text: string };
const fontSize = (item: TextItem) => Math.hypot(item.transform[2], item.transform[3]);
function linesFrom(items: TextItem[]): Line[] {
  const rows: { y: number; size: number; items: TextItem[] }[] = [];
  for (const item of [...items].filter(i => i.str.trim() && Math.abs(i.transform[1]) < Math.abs(i.transform[0])).sort((a, b) => b.transform[5] - a.transform[5])) {
    const size = fontSize(item);
    // A large drop cap must not pull several body baselines into a single title-sized row.
    let row = rows.find(r => Math.abs(r.y - item.transform[5]) < Math.min(r.size, size) * .55);
    if (!row) { row = { y: item.transform[5], size, items: [] }; rows.push(row); }
    row.size = Math.max(row.size, size); row.items.push(item);
  }
  return rows.map(row => {
    // Use the font size of most characters, not an isolated decorative initial or symbol.
    const bySize = [...row.items].sort((a, b) => fontSize(a) - fontSize(b));
    const middle = bySize.reduce((sum, item) => sum + item.str.trim().length, 0) / 2;
    let weight = 0;
    row.size = fontSize(bySize.find(item => (weight += item.str.trim().length) >= middle)!);
    let text = '', previous: TextItem | undefined;
    for (const item of row.items.sort((a, b) => a.transform[4] - b.transform[4])) {
      const gap = previous ? item.transform[4] - previous.transform[4] - (previous.width ?? previous.str.length * row.size * .5) : 0;
      const separator = !previous || /\s$/.test(text) || /^\s/.test(item.str) ? '' : gap < row.size * .12 ? '' : gap > row.size * 2 ? '  ' : ' ';
      text += separator + item.str; previous = item;
    }
    return { y: row.y, size: row.size, text: text.trim() };
  });
}

function titleBlock(lines: Line[], height: number): Line[] {
  const sizes = lines.filter(l => l.text.length > 8).map(l => l.size).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] ?? 12;
  // In journal layouts the introduction can start halfway up page 1, in two columns.
  // Its drop caps/headings are not title candidates, even when larger than the title.
  const bodyStart = lines.find(l => /^(?:(?:[IVX]+|\d+)[.)]?\s+)?(?:abstract|introduction|keywords|index\s+terms)\b|^초록(?:\s|$)/i.test(l.text))?.y ?? 0;
  const candidates = lines.filter(l => l.y > Math.max(height * .4, bodyStart) && l.y < height * .97 && l.size >= bodySize * 1.18
    && title(l.text) && !/^(abstract|references|introduction|keywords|proceedings|journal\s+of|arxiv|doi|https?:|\d+[.\s])/i.test(l.text));
  const largest = candidates.reduce((size, l) => Math.max(size, l.size), 0);
  const block: Line[] = [];
  for (const line of candidates.filter(l => l.size >= largest * .9)) {
    if (block.length && block[block.length - 1].y - line.y > largest * 2) break;
    block.push(line);
  }
  return block;
}
export function firstPageTitle(items: TextItem[], pageHeight: number): string {
  return title(titleBlock(linesFrom(items), pageHeight).map(l => l.text).join(' '));
}

function authorLine(value: string): string {
  const text = clean(value.replace(/\s{2,}/g, ', ').replace(/^(?:authors?|저자)\s*[:：]\s*/i, '').replace(/[\d¹²³⁴⁵⁶⁷⁸⁹⁰*†‡§✉]+/g, ''));
  if (!text || text.length > 300 || /[@:/=()]/.test(text) || /\b(university|department|institute|laboratory|school|college|research|inc|corporation|google|microsoft|openai|elsevier|springer|abstract|introduction|published|publication|available|received|accepted|copyright|street|road|avenue)\b|대학교|연구소|학과/i.test(text)) return '';
  const words = text.replace(/[,;&]/g, ' ').split(/\s+/).filter(w => !/^(and|de|del|da|di|van|von|der|den|la|le)$/i.test(w));
  if ((words.length < 2 && !/^[가-힣]{2,5}$/.test(text)) || words.length > 32 || /\b(the|this|we|our|with|using|study|model|learning|approach|analysis|abstract)\b/i.test(text)) return '';
  if (!words.every(w => /^[\p{L}.'’\-]+$/u.test(w)) || words.filter(w => /^\p{Lu}|^[가-힣]/u.test(w)).length < words.length * .75) return '';
  return text.replace(/\s*,\s*/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '');
}
function firstPageAuthors(lines: Line[], paperTitle: string, height: number): string {
  const labeled = lines.find(l => /^(authors?|저자)\s*[:：]/i.test(l.text));
  if (labeled) { const authors = authorLine(labeled.text); if (authors) return authors; }
  const wanted = compact(paperTitle);
  let bottom: number | undefined;
  if (wanted) {
    for (let i = 0; i < lines.length && bottom === undefined; i++) {
      for (let n = 1; n <= 4; n++) {
        if (compact(lines.slice(i, i + n).map(l => l.text).join(' ')) === wanted) { bottom = lines[Math.min(i + n - 1, lines.length - 1)].y; break; }
      }
    }
  }
  if (bottom === undefined) bottom = titleBlock(lines, height).at(-1)?.y;
  if (bottom === undefined) return '';
  const names: string[] = [];
  for (const line of lines.filter(l => l.y < bottom! - 4 && l.y > bottom! - 150).slice(0, 8)) {
    if (/^abstract\b|^introduction\b/i.test(line.text)) break;
    const name = authorLine(line.text);
    if (name) names.push(name);
    else if (names.length) break;
  }
  return [...new Set(names)].join(', ');
}

function firstPageDate(lines: Line[]): string {
  const text = lines.map(l => l.text).join(' ');
  const label = /(?:\b(?:first\s+published(?:\s+online)?(?:\s+on)?|published(?:\s+online)?(?:\s+on)?|publication\s+date|date\s+of\s+publication|available\s+online)\b|발행일|게재일)\s*[:：]?\s*/gi;
  for (const match of text.matchAll(label)) {
    const tail = text.slice(match.index! + match[0].length);
    const date = tail.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일|(?:\d{1,2}\s+)?[A-Za-z]+\.?\s+(?:\d{1,2},?\s+)?\d{4}|\d{4})(?!\d)/);
    const parsed = publicationDate(date?.[1]);
    if (parsed) return parsed;
    const conference = tail.match(/^as\s+(?:a\s+)?conference\s+paper\s+at\s+[^.\n]{1,80}?\b((?:19|20)\d{2})\b/i);
    if (conference) return conference[1];
  }
  return '';
}

export async function extractPaperMetadata(pdf: PDFDocumentProxy): Promise<PaperMetadata> {
  const result: PaperMetadata = { title: '', authors: '', publishedDate: '' };
  try {
    const { info, metadata } = await pdf.getMetadata();
    const fields = info as Record<string, unknown>;
    result.title = title(metadata?.get('dc:title')) || title(fields.Title);
    const authors = metadata?.get('dc:creator');
    result.authors = clean(Array.isArray(authors) ? authors.join(', ') : authors) || clean(fields.Author);
    if (/^(anonymous|unknown|author|user|admin|administrator|owner|elsevier|springer)$/i.test(result.authors)) result.authors = '';
    result.authors = Array.from(result.authors).slice(0, 1000).join('');
    result.publishedDate = publicationDate(metadata?.get('prism:publicationdate')) || publicationDate(metadata?.get('prism:coverdate'))
      || publicationDate(fields.PublicationDate) || publicationDate(fields.PublishedDate);
  } catch { /* Text can still recover malformed/missing metadata. */ }
  if (!result.title || !result.authors || !result.publishedDate) {
    try {
      const page = await pdf.getPage(1), content = await page.getTextContent();
      const items = content.items.filter((i): i is TextItem => 'str' in i);
      const lines = linesFrom(items.map(item => ({ ...item, transform: [...item.transform.slice(0, 5), item.transform[5] - page.view[1]] })));
      const height = page.view[3] - page.view[1];
      if (!result.title) result.title = title(titleBlock(lines, height).map(l => l.text).join(' '));
      if (!result.authors) result.authors = Array.from(firstPageAuthors(lines, result.title, height)).slice(0, 1000).join('');
      if (!result.publishedDate) result.publishedDate = firstPageDate(lines);
    } catch { /* Scans/encrypted pages may have no readable text. Keep missing fields empty. */ }
  }
  return result;
}
