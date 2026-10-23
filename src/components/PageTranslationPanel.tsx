import { useEffect, useLayoutEffect, useRef } from 'react';
import { TranslationResizer, type TranslationWidth } from './TranslationPane';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { TranslatedText } from './TranslatedText';
import type { usePageTranslation } from '../lib/usePageTranslation';
import type { TextZoom } from '../lib/useTextZoom';
import { TextZoomControls } from './TextZoomControls';

type Translation = ReturnType<typeof usePageTranslation>;
export function TranslationPage({ number, t, pdf, sizing }: { number: number; t: Translation; pdf: PDFDocumentProxy; sizing: TranslationWidth }) {
  const ref = useRef<HTMLElement>(null);
  const entry = t.entries.get(number), data = entry?.preview ?? entry?.data;
  useLayoutEffect(() => {
    if (entry?.run?.translate) ref.current?.querySelector('.translation-page-content')?.scrollTo({ top: 0 });
  }, [entry?.run]);
  useEffect(() => {
    const item = ref.current;
    if (!item) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) void t.load(number, false);
    }, { root: item.closest('.reader'), rootMargin: '400px' });
    observer.observe(item); return () => observer.disconnect();
  }, [number, t.load]);
  return <aside ref={ref} className="translation-page" data-page-number={number} aria-label={`${number}페이지 번역`}>
    <TranslationResizer sizing={sizing} pageNumber={number} />
    <div className="translation-page-header"><h3>{number}/{pdf.numPages} 페이지</h3>
      <div className="translation-page-actions">{(entry?.data || entry?.started) && <button className="retranslate-page-button"
        aria-label={`${number}페이지 재번역`} title="이 페이지를 처음부터 다시 번역합니다."
        onClick={() => void t.load(number, true, true)}>
        <span aria-hidden="true" className={entry.phase ? 'translation-refresh spinning' : 'translation-refresh'}>↻</span> 재번역
      </button>}
      {entry?.run?.translate && <button className="stop-page-button" aria-label={`${number}페이지 번역 중단`} onClick={() => void t.stop(number)}><span aria-hidden="true">■</span> 중단</button>}
      </div>
    </div>
    <div className="translation-page-content" role="region" aria-label={`${number}페이지 번역 내용`} tabIndex={0}>
      {entry?.phase && <p role="status">{entry.phase}</p>}
      {entry?.stopped && <p role="status">번역을 중단했습니다.</p>}
      {entry?.error && <p role="alert">{entry.error}</p>}
      {!entry?.phase && !entry?.data && !entry?.stopped && <>
        {!entry?.error && <p className="translation-help">이 페이지의 본문을 한국어로 번역합니다.</p>}
        <button className="translate-page-button" onClick={() => void t.load(number, true)}>{entry?.error ? '다시 시도' : '이 페이지 번역'}</button>
      </>}
      {data && <TranslatedText pageNumber={number} sentences={data.sentences} t={t} />}
      {!!entry?.preview?.sentences.length && <p className="translation-help">
        {entry.phase || (entry.stopped ? '여기까지 번역했습니다. 재번역으로 처음부터 다시 시작할 수 있습니다.'
          : entry.error ? '번역이 끝까지 완료되지 않았습니다. 재번역 버튼으로 다시 시도해 주세요.' : '')}
      </p>}
    </div>
  </aside>;
}
export function TranslationNavigation({ translation: t, pageCount, zoom }: { translation: Translation; pageCount: number; zoom: TextZoom }) {
  return <div className="reader-navigation"><TextZoomControls zoom={zoom} label="번역" /><nav className="translation-pagination" aria-label="번역 페이지">
    <button aria-label="이전 번역 페이지" disabled={t.pageNumber <= 1} onClick={() => t.goTo(t.pageNumber - 1)}>←</button>
    <span>{t.pageNumber} / {pageCount} 페이지</span>
    <button aria-label="다음 번역 페이지" disabled={t.pageNumber >= pageCount} onClick={() => t.goTo(t.pageNumber + 1)}>→</button>
    <button className="translation-close" aria-label="본문 번역 닫기" onClick={t.close}>×</button>
  </nav></div>;
}
