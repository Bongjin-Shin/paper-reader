import { memo, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Highlight, WordSelection, TranslationMark } from '../types';
import { PageRenderCache } from '../lib/pageRendering';
import { PdfPage } from './PdfPage';
import type { PdfSearchMatch } from '../lib/pdfSearch';
import type { usePageTranslation } from '../lib/usePageTranslation';
import type { TranslationWidth } from './TranslationPane';
import { TranslationPage } from './PageTranslationPanel';

const empty: Highlight[] = [];
interface Props {
  pdf: PDFDocumentProxy;
  scale: number;
  renderRevision: number;
  displayScale: RefObject<number>;
  highlights: Highlight[];
  translationMark: TranslationMark[] | null;
  translation: ReturnType<typeof usePageTranslation>;
  translationWidth: TranslationWidth;
  searchMatches: Map<number, PdfSearchMatch[]>;
  selectedSearchId: number;
  onSelect: (selection: WordSelection | null, extending?: boolean) => void;
  onRendered: (pageNumber: number) => void;
  onHighlight: (highlight: Highlight, selection: WordSelection) => void;
}

export const PdfPages = memo(function PdfPages({ pdf, scale, renderRevision, displayScale, highlights, translationMark, translation, translationWidth, searchMatches, selectedSearchId, onSelect, onRendered, onHighlight }: Props) {
  const cache = useMemo(() => new PageRenderCache(), [pdf]);
  useLayoutEffect(() => cache.prepareZoom(), [cache, scale]);
  const previous = useRef(new Map<number, Highlight[]>());
  const translationByPage = useMemo(() => {
    const grouped = new Map<number, TranslationMark['rects']>();
    for (const source of translationMark ?? []) grouped.set(source.pageNumber, [...grouped.get(source.pageNumber) ?? [], ...source.rects]);
    return grouped;
  }, [translationMark]);
  const byPage = useMemo(() => {
    const grouped = new Map<number, Highlight[]>();
    for (const highlight of highlights) {
      const rows = grouped.get(highlight.pageNumber) ?? [];
      rows.push(highlight); grouped.set(highlight.pageNumber, rows);
    }
    for (const [number, rows] of grouped) {
      const old = previous.current.get(number);
      if (old?.length === rows.length && old.every((row, i) => row === rows[i])) grouped.set(number, old);
    }
    previous.current = grouped;
    return grouped;
  }, [highlights]);
  return <div className="pages">
    {Array.from({ length: pdf.numPages }, (_, index) => <div className="page-pair" data-page-number={index + 1} key={index}><PdfPage
      pdf={pdf} pageNumber={index + 1} scale={scale} renderRevision={renderRevision} displayScale={displayScale} cache={cache}
      translationRects={translationByPage.get(index + 1)}
      searchMatches={searchMatches.get(index + 1)} selectedSearchId={selectedSearchId}
      highlights={byPage.get(index + 1) ?? empty} onSelect={onSelect} onRendered={onRendered} onHighlight={onHighlight} />
      {translation.open && <TranslationPage number={index + 1} t={translation} pdf={pdf} sizing={translationWidth} />}
    </div>)}
  </div>;
});
