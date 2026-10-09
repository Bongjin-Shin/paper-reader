import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { TranslatedText } from './TranslatedText';
import type { usePageTranslation } from '../lib/usePageTranslation';

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
  useEffect(() => {
    let live = true;
    void pdf.getPage(number).then(page => {
      const viewport = page.getViewport({ scale: 1 });
      if (live) ref.current?.style.setProperty('--page-aspect', String(viewport.width / viewport.height));
    });
    return () => { live = false; };
  }, [number, pdf]);
  return <section ref={ref} className="translation-page" data-page-number={number} aria-label={`${number}페이지 번역`}>
    <div className="translation-page-header"><h3>{number} 페이지</h3>
      {entry?.data && <button className="retranslate-page-button" disabled={!!entry.phase}
        aria-label={`${number}페이지 재번역`} title="저장된 번역 대신 이 페이지를 새로 번역합니다."
        onClick={() => void t.load(number, true, true)}>
        <span aria-hidden="true" className={entry.phase ? 'translation-refresh spinning' : 'translation-refresh'}>↻</span> 재번역
      </button>}
    </div>
    <div className="translation-page-content" role="region" aria-label={`${number}페이지 번역 내용`} tabIndex={0}>
      {entry?.phase && <p role="status">{entry.phase}</p>}
      {entry?.error && <p role="alert">{entry.error}</p>}
      {!entry?.phase && !entry?.data && <>
        {!entry?.error && <p className="translation-help">이 페이지의 본문을 한국어로 번역합니다.</p>}
        <button className="translate-page-button" onClick={() => void t.load(number, true)}>{entry?.error ? '다시 시도' : '이 페이지 번역'}</button>
      </>}
      {data && <TranslatedText pageNumber={number} sentences={data.sentences} t={t} />}
    </div>
  </section>;
}
export function PageTranslationPanel({ translation: t, pageCount, pdf }: { translation: Translation; pageCount: number; pdf: PDFDocumentProxy }) {
  const content = useRef<HTMLDivElement>(null);
  const [pageNumber, setPageNumber] = useState(t.pageNumber);
  const initialPage = useRef(t.pageNumber);
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const first = root.querySelector<HTMLElement>(`[data-page-number="${initialPage.current}"]`);
    if (first && initialPage.current > 1) root.scrollTop = first.offsetTop - root.offsetTop - 12;
    let frame = 0;
    const track = () => {
      frame = 0;
      const top = root.getBoundingClientRect().top + 32;
      const pages = [...root.querySelectorAll<HTMLElement>('.translation-page')];
      setPageNumber(Number(pages.find(p => p.getBoundingClientRect().bottom > top)?.dataset.pageNumber ?? pageCount));
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(track); };
    root.addEventListener('scroll', scroll, { passive: true }); track();
    return () => { cancelAnimationFrame(frame); root.removeEventListener('scroll', scroll); };
  }, [pageCount]);
  const goTo = (number: number) => {
    const root = content.current, page = root?.querySelector<HTMLElement>(`[data-page-number="${number}"]`);
    if (!root || !page) return;
    root.scrollTop = number === 1 ? 0 : root.scrollTop + page.getBoundingClientRect().top - root.getBoundingClientRect().top - 12;
    setPageNumber(number);
  };
  return <aside className="page-translation-panel" aria-label="본문 번역">
    <div className="translation-pagination" aria-label="번역 페이지">
      <button aria-label="이전 번역 페이지" disabled={pageNumber <= 1} onClick={() => goTo(pageNumber - 1)}>←</button>
      <span>{pageNumber} / {pageCount} 페이지</span>
      <button aria-label="다음 번역 페이지" disabled={pageNumber >= pageCount} onClick={() => goTo(pageNumber + 1)}>→</button>
      <button className="translation-close" aria-label="본문 번역 닫기" onClick={t.close}>×</button>
    </div>
    <div ref={content} className="translation-content">
      {Array.from({ length: pageCount }, (_, i) => <TranslationPage key={i} number={i + 1} t={t} pdf={pdf} />)}
    </div>
  </aside>;
}
