import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageTranslation, TranslatedSentence, TranslationMark } from '../types';
import { errorMessage, getPageTranslation, translatePage } from './backend';
import { extractPageWithContinuations } from './pageContinuations';
import { pdfToStyle } from './selection';

type Entry = { preview?: PageTranslation; data: PageTranslation | null; checked: boolean; error: string; phase: string; job?: Promise<void> };
function visiblePage(reader: HTMLElement) {
  const pages = reader.querySelectorAll<HTMLElement>('.pdf-page');
  const y = reader.getBoundingClientRect().top + reader.clientHeight * .3;
  let low = 0, high = pages.length;
  while (low < high) { const mid = (low + high) >>> 1; if (pages[mid].getBoundingClientRect().bottom < y) low = mid + 1; else high = mid; }
  return Number(pages[Math.min(low, pages.length - 1)]?.dataset.pageNumber ?? 1);
}
export function usePageTranslation(pdf: PDFDocumentProxy | null, paperId: string | undefined,
  reader: RefObject<HTMLElement | null>, active: boolean, onUsage: () => void) {
  const [open, setOpen] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [pinned, setPinned] = useState<{ page: number; sentence: TranslatedSentence } | null>(null);
  const [hovered, setHovered] = useState<{ page: number; sentence: TranslatedSentence; origin: 'source' | 'translation' } | null>(null);
  const [, update] = useState(0);
  const store = useMemo(() => ({ pdf, paperId, entries: new Map<number, Entry>() }), [pdf, paperId]);
  const current = useRef(store); current.current = store;
  const usage = useRef(onUsage); usage.current = onUsage;
  const refresh = useCallback(() => { if (current.current === store) update(n => n + 1); }, [store]);

  const load = useCallback(async (number: number, translate: boolean, force = false) => {
    if (!store.pdf || !store.paperId) return;
    let entry = store.entries.get(number);
    if (!entry) { entry = { data: null, checked: false, error: '', phase: '' }; store.entries.set(number, entry); }
    if (entry.job && force) return;
    while (entry.job) { await entry.job; if (!translate || entry.data || current.current !== store) return; }
    if (!force && (entry.data || (!translate && entry.checked))) return;
    const target = entry;
    target.error = ''; target.phase = '저장된 번역 확인 중…';
    const job = async () => {
      let called = false;
      try {
        if (!target.checked) { target.data = await getPageTranslation(store.paperId!, number); target.checked = true; }
        if ((!force && target.data) || !translate || current.current !== store) return;
        target.phase = '원문 문장을 읽는 중…'; refresh();
        const sentences = await extractPageWithContinuations(store.pdf!, number, force);
        if (current.current !== store) return;
        target.phase = '한국어로 번역 중…'; refresh(); called = true;
        target.preview = { pageNumber: number, sentences: [] };
        target.data = await translatePage({ paperId: store.paperId!, pageNumber: number, sentences, force }, rows => {
          if (current.current !== store || !target.phase) return;
          const translated = target.preview!.sentences;
          for (const row of rows) {
            if (row.id === translated.length && sentences[row.id] && row.translation.trim()) translated.push({ ...sentences[row.id], translation: row.translation, equations: row.equations });
          }
          target.phase = `한국어로 번역 중… ${translated.length}/${sentences.length} 문장`; refresh();
        });
        if (force && current.current === store) {
          setHovered(null); setPinned(null);
          await Promise.all([...store.entries].filter(([n, e]) => n !== number && e.data && !e.job).map(async ([n, e]) => {
            try { e.data = await getPageTranslation(store.paperId!, n) ?? e.data; } catch { /* Keep the last good page if a refresh fails. */ }
          }));
        }
      } catch (error) { target.error = errorMessage(error); }
      finally { target.preview = undefined; target.phase = ''; target.job = undefined; refresh(); if (called) usage.current(); }
    };
    target.job = job(); refresh(); await target.job;
  }, [store, refresh]);

  useEffect(() => { setOpen(false); setPageNumber(1); setPinned(null); setHovered(null); }, [store]);
  useEffect(() => { setPinned(null); setHovered(null); }, [open, active]);
  useEffect(() => {
    const root = reader.current;
    if (!open || !active || !pdf || !root) return;
    let live = true, frame = 0, sourceActive = false;
    let point: { x: number; y: number; page: HTMLElement } | null = null;
    const clear = () => { point = null; if (sourceActive) { sourceActive = false; setHovered(h => h?.origin === 'source' ? null : h); } };
    const move = (event: PointerEvent) => {
      const page = (event.target as Element).closest<HTMLElement>('.pdf-page');
      if (event.buttons || !page) { clear(); return; }
      point = { x: event.clientX, y: event.clientY, page };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const at = point; if (!at) return;
        const number = Number(at.page.dataset.pageNumber);
        const cached = store.entries.get(number);
        void Promise.all([pdf.getPage(number), cached?.data || cached?.preview ? Promise.resolve() : load(number, false)]).then(([page]) => {
          if (!live || point !== at || current.current !== store) return;
          const bounds = at.page.getBoundingClientRect(), viewport = page.getViewport({ scale: 1 });
          const [x, y] = viewport.convertToPdfPoint((at.x - bounds.left) * viewport.width / bounds.width,
            (at.y - bounds.top) * viewport.height / bounds.height);
          const entry = store.entries.get(number);
          const sentence = (entry?.data ?? entry?.preview)?.sentences.find(s => s.rects.some(r => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]));
          if (sentence) {
            sourceActive = true;
            setPageNumber(number);
            setHovered(h => h?.origin === 'source' && h.page === number && h.sentence.id === sentence.id ? h : { page: number, sentence, origin: 'source' });
          } else clear();
        }).catch(() => {});
      });
    };
    root.addEventListener('pointermove', move, { passive: true });
    root.addEventListener('pointerleave', clear);
    root.addEventListener('pointerdown', clear, { passive: true });
    root.addEventListener('scroll', clear, { passive: true });
    root.addEventListener('readerzoomstart', clear);
    return () => { live = false; cancelAnimationFrame(frame); root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', clear); root.removeEventListener('pointerdown', clear);
      root.removeEventListener('scroll', clear); root.removeEventListener('readerzoomstart', clear); };
  }, [open, active, pdf, store, reader, load]);
  useEffect(() => {
    const root = reader.current;
    if (!open || !active || !pdf || !root) return;
    const track = () => setPageNumber(visiblePage(root));
    // A thin viewport band changes only when a different page enters it. No scroll handler.
    let observer: IntersectionObserver;
    const resize = new ResizeObserver(() => {
      observer?.disconnect();
      observer = new IntersectionObserver(track, { root, rootMargin: `-${root.clientHeight * .29}px 0px -${root.clientHeight * .69}px 0px`, threshold: 0 });
      root.querySelectorAll('.pdf-page').forEach(page => observer.observe(page));
    });
    resize.observe(root);
    root.addEventListener('readerzoom', track);
    return () => { observer?.disconnect(); resize.disconnect(); root.removeEventListener('readerzoom', track); };
  }, [open, active, pdf, reader]);
  useEffect(() => { if (open && active) void load(pageNumber, false); }, [open, active, pageNumber, load]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const number = reader.current ? visiblePage(reader.current) : 1;
    setPageNumber(number); setOpen(true);
  };
  const goTo = (number: number) => {
    const root = reader.current, page = root?.querySelector<HTMLElement>(`.pdf-page[data-page-number="${number}"]`);
    if (!root || !page || !pdf || number < 1 || number > pdf.numPages) return;
    const delta = page.getBoundingClientRect().top - root.getBoundingClientRect().top;
    root.scrollTop += delta - 20; setPageNumber(number);
  };
  const select = (sentence: TranslatedSentence, number = pageNumber) => {
    setPinned({ page: number, sentence });
    setPageNumber(number);
    if (!pdf) return;
    void pdf.getPage(number).then(page => {
      if (current.current !== store) return;
      const root = reader.current, element = root?.querySelector<HTMLElement>(`.pdf-page[data-page-number="${number}"]`);
      if (!root || !element) return;
      const viewport = page.getViewport({ scale: 1 }), position = pdfToStyle(sentence.rects[0], viewport);
      const bounds = element.getBoundingClientRect(), clip = root.getBoundingClientRect();
      const x = bounds.left + position.left * bounds.width / viewport.width, y = bounds.top + position.top * bounds.height / viewport.height;
      if (y < clip.top + 30 || y > clip.bottom - 60) root.scrollTop += y - clip.top - root.clientHeight * .45;
      if (x < clip.left || x > clip.right - 40) root.scrollLeft += x - clip.left - 40;
    }).catch(() => {});
  };
  const choice = hovered ?? pinned;
  const sentence = choice?.sentence;
  const activePage = choice?.page;
  const mark = useMemo<TranslationMark[] | null>(() => open && active && sentence
    ? sentence.layout?.sources?.length ? sentence.layout.sources : [{ pageNumber: activePage!, rects: sentence.rects }] : null,
    [open, active, sentence, activePage]);
  const matches = (row: TranslatedSentence, number: number) => !!sentence &&
    (activePage === number && row.id === sentence.id || row.text === sentence.text && (row.layout?.sources?.length ?? 0) > 1 && row.layout!.sources!.some(s => s.pageNumber === activePage));
  return { reader, entries: store.entries, load, activePage, matches, open, toggle, close: () => setOpen(false), pageNumber, goTo, entry: store.entries.get(pageNumber),
    translate: () => void load(pageNumber, true), select, hover: (sentence: TranslatedSentence | null, number = pageNumber) => setHovered(sentence ? { page: number, sentence, origin: 'translation' } : null), hoverOrigin: hovered?.origin, activeId: sentence?.id, mark };
}
