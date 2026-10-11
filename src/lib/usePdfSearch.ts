import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { findPageMatches, indexSearchPage, type PdfSearchMatch } from './pdfSearch';
import { pdfToStyle } from './selection';

export function usePdfSearch(pdf: PDFDocumentProxy | null, reader: RefObject<HTMLElement | null>, active: boolean) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [matches, setMatches] = useState<PdfSearchMatch[]>([]), [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const matchPdf = useRef<PDFDocumentProxy | null>(null);
  const cache = useMemo(() => new Map<number, Promise<ReturnType<typeof indexSearchPage>>>(), [pdf]);
  const current = useRef(pdf); current.current = pdf;
  const reveal = useCallback(() => { setOpen(true); requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); }); }, []);
  const close = useCallback(() => { setOpen(false); reader.current?.focus({ preventScroll: true }); }, [reader]);
  const navigate = useCallback((offset: number) => setSelected(n => matches.length ? (n + offset + matches.length) % matches.length : 0), [matches.length]);
  useEffect(() => { setOpen(false); setQuery(''); setMatches([]); setSelected(0); }, [pdf]);
  useEffect(() => {
    if (!pdf || !active) return;
    const key = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); reveal(); }
      else if (open && (event.key === 'F3' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g'))) { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); }
      else if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [pdf, active, open, reveal, close, navigate]);
  useEffect(() => {
    matchPdf.current = null;
    setMatches([]); setSelected(0); setError('');
    if (!pdf || !open || !active || !query.trim()) { setBusy(false); return; }
    let live = true; setBusy(true);
    const timer = setTimeout(() => void (async () => {
      const found: PdfSearchMatch[] = []; let failed = 0;
      for (let number = 1; number <= pdf.numPages && live; number++) {
        try {
          let job = cache.get(number);
          if (!job) {
            job = pdf.getPage(number).then(page => page.getTextContent()).then(content => indexSearchPage(content.items.filter(item => 'str' in item)));
            cache.set(number, job); void job.catch(() => cache.delete(number));
          }
          for (const match of findPageMatches(await job, query, number)) found.push({ ...match, id: found.length });
        } catch { failed++; }
      }
      if (live) { matchPdf.current = pdf; setMatches(found); setBusy(false); if (failed) setError(`${failed}개 페이지의 텍스트를 읽지 못했습니다.`); }
    })(), 180);
    return () => { live = false; clearTimeout(timer); };
  }, [pdf, query, open, active, cache]);
  useEffect(() => {
    const match = matches[selected], root = reader.current;
    if (!open || !active || !pdf || matchPdf.current !== pdf || !match || !root) return;
    let live = true;
    void pdf.getPage(match.pageNumber).then(page => {
      if (!live || current.current !== pdf) return;
      const element = root.querySelector<HTMLElement>(`.pdf-page[data-page-number="${match.pageNumber}"]`);
      if (!element) return;
      const viewport = page.getViewport({ scale: 1 }), box = pdfToStyle(match.anchor, viewport);
      const bounds = element.getBoundingClientRect(), clip = root.getBoundingClientRect();
      root.scrollTop += bounds.top + box.top * bounds.height / viewport.height - clip.top - root.clientHeight * .35;
      const x = bounds.left + box.left * bounds.width / viewport.width;
      if (x < clip.left || x + box.width * bounds.width / viewport.width > clip.right) root.scrollLeft += x - clip.left - 30;
    }).catch(() => {});
    return () => { live = false; };
  }, [pdf, reader, matches, selected, open, active]);
  const byPage = useMemo(() => {
    const grouped = new Map<number, PdfSearchMatch[]>();
    if (open && active && matchPdf.current === pdf) for (const match of matches) { const page = grouped.get(match.pageNumber) ?? []; page.push(match); grouped.set(match.pageNumber, page); }
    return grouped;
  }, [matches, open, active, pdf]);
  return { open, query, setQuery, busy, error, selected, matches, byPage, input, reveal, close, navigate };
}
