import { Util, type PDFPageProxy } from 'pdfjs-dist';
import type { PageTranslation } from '../types';
import { orderedLines, type TextRun } from './pageTranslation';
import { mathFont, mathGroups, textBlocks, lineNumberRuns } from './translationLayout';
import { readingRegions } from './translationRegions';
import { selectedText } from './clipboard';
import { glyphsToLatex, mathMarkdown, type CopyGlyph } from './mathClipboard';

type IndexedCopy = { runs: TextRun[]; nodes: Text[]; blocks: ReturnType<typeof textBlocks> };
const layers = new WeakMap<HTMLElement, () => IndexedCopy>();
/** Register existing PDF.js text nodes; no hidden page render or network request. */
export function registerPdfCopyLayer(layer: HTMLElement, page: PDFPageProxy,
  content: Awaited<ReturnType<PDFPageProxy['getTextContent']>>, divs: HTMLElement[]) {
  let index: IndexedCopy | undefined;
  layers.set(layer, () => {
    if (index) return index;
    const viewport = page.getViewport({ scale:1, rotation:0 }), items = content.items.filter(item => 'str' in item);
    const runs: TextRun[] = [], nodes: Text[] = [];
    for (const [i, div] of divs.entries()) {
      const item = items[i], node = div.firstChild;
      if (!item?.str.trim() || node?.nodeType !== Node.TEXT_NODE) continue;
      const matrix = Util.transform(viewport.transform,item.transform), size = Math.hypot(matrix[2],matrix[3]);
      const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null, name = String(font?.name ?? '');
      const style = content.styles[item.fontName];
      const baseline = matrix[5] + (/^[√∑∏⋃⋂∫]$/.test(item.str) && style.ascent === 0 ? size*.84 : 0);
      nodes.push(node as Text);
      runs.push({text:item.str,left:matrix[4],right:matrix[4]+item.width*page.userUnit,top:baseline-size*.8,bottom:baseline+size*.2,
        baseline,fontSize:size,math:mathFont.test(name),bold:/bold|semibold/i.test(name),italic:/italic|oblique/i.test(name)});
    }
    for (const i of [...lineNumberRuns(runs)].sort((a,b)=>b-a)) {runs.splice(i,1);nodes.splice(i,1);}
    const blocks = textBlocks(readingRegions(orderedLines(runs),runs,viewport.height),runs);
    return index = { runs,nodes,blocks };
  });
}
const normalize = (text: string) => text.replace(/\s+/g,'');
export function copyPdfSelection(reader: HTMLElement, range: Range, saved: (page: number) => PageTranslation | undefined): string {
  const pages: string[] = [];
  for (const layer of reader.querySelectorAll<HTMLElement>('.textLayer')) {
    if (!range.intersectsNode(layer)) continue;
    const data = layers.get(layer)?.(); if (!data) continue;
    const { runs,nodes,blocks } = data, selected = new Map<number,string>();
    nodes.forEach((node,i) => { const text=selectedText(node,range); if(text)selected.set(i,text); });
    if (!selected.size) continue;
    const pageNumber = Number(layer.closest<HTMLElement>('.pdf-page')?.dataset.pageNumber);
    const known = (saved(pageNumber)?.sentences ?? []).flatMap(s => (s.layout?.math ?? []).filter(m => (m.pageNumber ?? pageNumber)===pageNumber)
      .map(source=>({source,latex:s.equations?.find(e=>e.token===source.token)?.latex}))).filter(e=>e.latex);
    const formula = (ids: number[], display: boolean) => {
      const chosen = ids.filter(i=>selected.has(i));
      if (!chosen.length) return '';
      const text = chosen.map(i=>selected.get(i)!).join(' ');
      const knownFormula = known.find(e=>normalize(e.source.text)===normalize(text));
      const glyphs: CopyGlyph[] = chosen.map(i=>{
        const r=runs[i],value=selected.get(i)!;
        return {text:value,x:r.left+(r.text.indexOf(value)/Math.max(1,r.text.length))*(r.right-r.left),y:r.baseline ?? r.bottom,
          size:r.fontSize ?? 10,width:(r.right-r.left)*value.length/Math.max(1,r.text.length)};
      });
      return mathMarkdown(knownFormula?.latex ?? glyphsToLatex(glyphs),display);
    };
    const mathematical = new Set<number>(), display = new Set<number>();
    for (const block of blocks) for (const line of block.lines) {
      const ids = block.kind === 'equation' ? line.runs : mathGroups(line,runs).flat();
      ids.forEach(i=>mathematical.add(i));
      if(block.kind==='equation')ids.forEach(i=>display.add(i));
    }
    // PDF content order keeps a summation's limits beside its operator even when
    // visual line detection assigned a raised limit to the preceding prose line.
    const clusters: number[][] = [];let cluster: number[]=[];
    let baseY=0,baseSize=10;
    const flush=()=>{if(cluster.length)clusters.push(cluster);cluster=[];};
    for (let i=0;i<runs.length;i++) {
      const r=runs[i],size=r.fontSize??10,y=r.baseline??r.bottom;
      if(!mathematical.has(i)){flush();continue;}
      const operator=/^[∑∏∫∮⋃⋂]$/.test(r.text.trim());
      if(cluster.length && !operator && size>=baseSize*.85 && Math.abs(y-baseY)>baseSize*.75)flush();
      if(!cluster.length){baseY=y;baseSize=size;}
      cluster.push(i);
    }
    flush();
    const byRun=new Map(clusters.flatMap(ids=>ids.map(i=>[i,ids] as const)));
    const selectedIds=[...selected.keys()];
    const exact = selectedIds.every(i=>mathematical.has(i)) && known.find(e=>normalize(e.source.text)===normalize(selectedIds.map(i=>selected.get(i)!).join(' ')));
    if(exact){pages.push(mathMarkdown(exact.latex!,selectedIds.some(i=>display.has(i))));continue;}
    const paragraphs: string[] = [];
    for (const block of blocks) {
      const lines: string[] = [];
      for (const line of block.lines) {
        const pieces: string[] = [];
        for (const i of line.runs) {
          const ids=byRun.get(i);
          if(ids) {if(ids[0]===i){const math=formula(ids,display.has(i));if(math)pieces.push(math);}}
          else if(selected.has(i))pieces.push(selected.get(i)!);
        }
        if(pieces.length)lines.push(pieces.join(' ').replace(/ +([,.;!?])/g,'$1'));
      }
      const text=lines.join(' ').replace(/[ \t]+/g,' ').trim();
      if(text)paragraphs.push((block.kind==='heading'?'## ':'')+text);
    }
    if(paragraphs.length)pages.push(paragraphs.join('\n\n'));
  }
  return pages.join('\n\n').replace(/\n{3,}/g,'\n\n').trim();
}
