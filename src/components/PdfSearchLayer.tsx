import { useLayoutEffect, useState } from 'react';
import type { PageViewport } from 'pdfjs-dist';
import { searchClientRects, type PdfSearchMatch } from '../lib/pdfSearch';

export function PdfSearchLayer({ layer, matches, selected, viewport }: { layer: HTMLElement; matches: PdfSearchMatch[]; selected: number; viewport: PageViewport }) {
  const [marks, setMarks] = useState<{ id: number; left: number; top: number; width: number; height: number }[]>([]);
  useLayoutEffect(() => {
    const surface = layer.closest('.page-surface')?.getBoundingClientRect();
    if (!surface?.width || !surface.height) return;
    const x = viewport.width / surface.width, y = viewport.height / surface.height;
    setMarks(matches.flatMap(match => searchClientRects(layer, match).map(r => ({ id: match.id,
      left: (r.left - surface.left) * x, top: (r.top - surface.top) * y, width: r.width * x, height: r.height * y }))));
  }, [layer, matches, viewport]);
  return <div className="pdf-search-layer" aria-hidden="true">{marks.map(({ id, ...style }, i) => <span key={i}
    className={`pdf-search-mark${id === selected ? ' current' : ''}`} style={style} />)}</div>;
}
