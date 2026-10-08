import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import type { WordSelection } from '../types';
import { pdfToStyle } from '../lib/selection';

export function BubbleConnector({ pdf, selection, bubble, reader }: {
  pdf: PDFDocumentProxy; selection: WordSelection; bubble: RefObject<HTMLDivElement | null>; reader: RefObject<HTMLElement | null>;
}) {
  const svg = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const host = reader.current, surface = bubble.current, canvas = svg.current, pages = host?.querySelector<HTMLElement>('.pages');
    if (!host || !surface || !canvas || !pages) return;
    let live = true, frame = 0;
    const viewports = new Map<number, PageViewport>();
    const paint = () => {
      frame = 0;
      const origin = pages.getBoundingClientRect(), box = surface.getBoundingClientRect();
      const lines = canvas.querySelectorAll('line');
      selection.segments.forEach((segment, i) => {
        const element = host.querySelector<HTMLElement>(`.pdf-page[data-page-number="${segment.pageNumber}"]`), viewport = viewports.get(segment.pageNumber), line = lines[i];
        if (!element || !viewport || !line || !segment.rects.length) return;
        const bounds = element.getBoundingClientRect(), scale = bounds.width / viewport.width;
        const rects = segment.rects.map(r => pdfToStyle(r, viewport));
        const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.left + r.width));
        const top = Math.min(...rects.map(r => r.top)), bottom = Math.max(...rects.map(r => r.top + r.height));
        line.setAttribute('x1', String(box.left + box.width / 2 - origin.left));
        line.setAttribute('y1', String(box.top + box.height / 2 - origin.top));
        line.setAttribute('x2', String(bounds.left - origin.left + (left + right) / 2 * scale));
        line.setAttribute('y2', String(bounds.top - origin.top + (top + bottom) / 2 * scale));
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    void Promise.all(selection.segments.map(async segment => {
      const page = await pdf.getPage(segment.pageNumber);
      if (live) viewports.set(segment.pageNumber, page.getViewport({ scale: 1 }));
    })).then(() => { if (live) schedule(); }).catch(() => {});
    const resize = new ResizeObserver(schedule); resize.observe(surface); resize.observe(pages);
    const mutation = new MutationObserver(schedule); mutation.observe(surface, { attributes: true, attributeFilter: ['style'] });
    host.addEventListener('readerzoom', schedule);
    return () => { live = false; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); host.removeEventListener('readerzoom', schedule); };
  }, [pdf, selection, bubble, reader]);
  return <svg ref={svg} className="bubble-connector" aria-hidden="true">
    {selection.segments.map((segment, i) => <line key={`${segment.pageNumber}-${i}`} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 5" />)}
  </svg>;
}
