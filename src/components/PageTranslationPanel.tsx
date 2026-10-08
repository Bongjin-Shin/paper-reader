import { useEffect, useRef } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { TranslatedText } from './TranslatedText';
import type { usePageTranslation } from '../lib/usePageTranslation';
import { useTranslationScroll } from '../lib/useTranslationScroll';

type Translation = ReturnType<typeof usePageTranslation>;
function TranslationPage({ number, t, pdf }: { number: number; t: Translation; pdf: PDFDocumentProxy }) {
  const ref = useRef<HTMLElement>(null);
  const entry = t.entries.get(number), data = entry?.data ?? entry?.preview;
  useEffect(() => {
    const item = ref.current;
    if (!item) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) void t.load(number, false);
    }, { root: item.parentElement, rootMargin: '400px' });
    observer.observe(item); return () => observer.disconnect();
  }, [number, t.load]);
  return <section ref={ref} className="translation-page" data-page-number={number} aria-label={`${number}페이지 번역`}>
    <h3>{number} 페이지</h3>
    {entry?.phase && <p role="status">{entry.phase}</p>}
    {entry?.error && <p role="alert">{entry.error}</p>}
    {!entry?.phase && !entry?.data && <>
      {!entry?.error && <p className="translation-help">이 페이지의 본문을 한국어로 번역합니다.</p>}
      <button className="translate-page-button" onClick={() => void t.load(number, true)}>{entry?.error ? '다시 시도' : '이 페이지 번역'}</button>
    </>}
    {data && <TranslatedText pdf={pdf} pageNumber={number} sentences={data.sentences} t={t} />}
  </section>;
}
export function PageTranslationPanel({ translation: t, pageCount, pdf }: { translation: Translation; pageCount: number; pdf: PDFDocumentProxy }) {
  const content = useRef<HTMLDivElement>(null);
  useTranslationScroll(t.reader, content);
  useEffect(() => {
    if (t.hoverOrigin !== 'source' || t.activeId === undefined || !content.current) return;
    const container = content.current, item = container.querySelector<HTMLElement>(`[data-page-number="${t.activePage}"] [data-sentence-id="${t.activeId}"]`);
    if (!item) return;
    const bounds = container.getBoundingClientRect(), rect = item.getBoundingClientRect();
    if (rect.top < bounds.top) container.scrollTop += rect.top - bounds.top - 8;
    else if (rect.bottom > bounds.bottom) container.scrollTop += Math.min(rect.top - bounds.top - 8, rect.bottom - bounds.bottom + 8);
  }, [t.activeId, t.hoverOrigin, t.activePage]);
  return <aside className="page-translation-panel" aria-label="본문 번역">
    <header><strong>본문 번역</strong><button aria-label="본문 번역 닫기" onClick={t.close}>×</button></header>
    <div className="translation-pagination" aria-label="번역 페이지">
      <button aria-label="이전 번역 페이지" disabled={t.pageNumber <= 1} onClick={() => t.goTo(t.pageNumber - 1)}>←</button>
      <span>{t.pageNumber} / {pageCount} 페이지 · 스크롤 연동</span>
      <button aria-label="다음 번역 페이지" disabled={t.pageNumber >= pageCount} onClick={() => t.goTo(t.pageNumber + 1)}>→</button>
    </div>
    <div ref={content} className="translation-content">
      {Array.from({ length: pageCount }, (_, i) => <TranslationPage key={i} number={i + 1} t={t} pdf={pdf} />)}
    </div>
  </aside>;
}
