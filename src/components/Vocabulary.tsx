import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react';
import { errorMessage, exportVocabularyPdf, getPapers, getVocabulary } from '../lib/backend';
import { useListSelection } from '../lib/useListSelection';
import type { Paper, VocabularyEntry } from '../types';

const PrintPreview = lazy(() => import('./PrintPreview'));

export const Vocabulary = memo(function Vocabulary({ active, revision, onDelete }: {
  active: boolean;
  revision: number;
  onDelete: (ids: number[]) => Promise<number[]>;
}) {
  const [mode, setMode] = useState<'simple' | 'detailed'>('simple');
  const [query, setQuery] = useState('');
  const [paperId, setPaperId] = useState('');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteMessage, setDeleteMessage] = useState('');
  const [preview, setPreview] = useState<{ entries: VocabularyEntry[]; mode: 'simple' | 'detailed' } | null>(null);
  const pageRef = useRef<HTMLElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const ids = useMemo(() => entries.map(entry => entry.id), [entries]);
  const selectionDisabled = loading || !!error || deleting || exporting || !!preview;
  const selection = useListSelection(active, selectionDisabled, JSON.stringify([query, paperId]), ids, pageRef,
    '.vocabulary-heading, .vocabulary-tools, .vocabulary-filters, .selection-note, .export-message, .vocabulary-message, [role="dialog"]', `${mode}:${zoom}`);
  const { selected } = selection;
  const selectRow = (event: MouseEvent<HTMLElement>, id: number) => {
    if ((event.target as Element).closest('input, button, label')) return;
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && window.getSelection()?.isCollapsed === false) return;
    selection.select(id, event.ctrlKey || event.metaKey, event.shiftKey);
  };
  const selectWithKey = (event: KeyboardEvent<HTMLElement>, id: number) => {
    if (event.target !== event.currentTarget || event.key !== ' ') return;
    event.preventDefault(); selection.select(id, event.ctrlKey || event.metaKey, event.shiftKey);
  };
  const selectCheckbox = (event: MouseEvent<HTMLInputElement>, id: number) => {
    event.stopPropagation(); selection.select(id, !event.shiftKey || event.ctrlKey || event.metaKey, event.shiftKey);
  };
  const allSelected = entries.length > 0 && entries.every(entry => selected.has(entry.id));

  useEffect(() => { setDeleteMessage(''); setDeleteError(''); }, [revision]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selected.size > 0 && !allSelected;
  }, [active, allSelected, selected.size]);

  useEffect(() => {
    if (!active) { setPreview(null); return; }
    const host = pageRef.current;
    if (!host) return;
    let frame = 0, delta = 0;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      // Handle only this view, including at the limits, so WebView page zoom cannot leak through.
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1;
      delta += Math.max(-100, Math.min(100, event.deltaY * unit));
      if (!frame) frame = requestAnimationFrame(() => {
        const change = delta;
        delta = 0; frame = 0;
        setZoom(value => Math.max(75, Math.min(200, Math.round(value * Math.exp(-change * .002) * 100) / 100)));
      });
    };
    host.addEventListener('wheel', wheel, { passive: false });
    return () => { host.removeEventListener('wheel', wheel); cancelAnimationFrame(frame); };
  }, [active]);

  const resetSelection = () => { selection.clear(); setDeleteError(''); setDeleteMessage(''); };
  const shuffleEntries = () => {
    if (loading || error || deleting || exporting || entries.length < 2) return;
    const shuffled = [...entries];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // A click should visibly change the order, including a list with only two entries.
    if (shuffled.every((entry, i) => entry.id === entries[i].id)) {
      [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    }
    setEntries(shuffled);
  };
  const deleteSelected = async () => {
    if (deleting || exporting || loading || error || !selected.size) return;
    setDeleting(true); setDeleteError(''); setDeleteMessage('');
    try {
      const removed = await onDelete([...selected]);
      setEntries(current => current.filter(entry => !removed.includes(entry.id)));
      selection.clear();
      setDeleteMessage(`${removed.length}개 항목을 삭제했습니다.`);
      setRetry(value => value + 1);
    } catch (error) { setDeleteError(errorMessage(error)); }
    finally { setDeleting(false); }
  };

  const exportPdf = async () => {
    if (exporting || deleting || loading || error || !entries.length) return;
    setExporting(true); setExportMessage(''); setExportError('');
    try {
      // PDF/font code loads only when requested, leaving the reader startup/scroll path unchanged.
      const { createVocabularyPdf } = await import('../lib/vocabularyPdf');
      const path = await exportVocabularyPdf(await createVocabularyPdf(entries, mode), mode);
      if (path) setExportMessage(`PDF 저장 완료: ${path}`);
    } catch (error) { setExportError(errorMessage(error)); }
    finally { setExporting(false); }
  };

  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoading(true); setError('');
    void Promise.all([getPapers(), getVocabulary(query, paperId || null)]).then(([papers, entries]) => {
      if (current) {
        setPapers(papers); setEntries(entries);
      }
    }).catch(error => { if (current) setError(errorMessage(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, revision, query, paperId, retry]);

  // Preserve filters/mode in state without reconciling a large hidden word list
  // each time a reader bubble opens or a lookup completes.
  if (!active) return null;
  return <section ref={pageRef} className="vocabulary-page" aria-label="Vocabulary"
    onPointerDownCapture={() => { selection.suppressClick.current = false; }}
    onPointerDown={selection.begin}
    onMouseDown={event => { if ((event.ctrlKey || event.metaKey || event.shiftKey) &&
      (event.target as Element).closest('[data-selection-id]')) event.preventDefault(); }}
    onClickCapture={event => { if (selection.suppressClick.current) {
      event.preventDefault(); event.stopPropagation(); selection.suppressClick.current = false;
    } }}>
    <div className="vocabulary-heading">
      <h1>Vocabulary</h1>
      <div className="view-switch" aria-label="단어장 보기 방식">
        <button aria-pressed={mode === 'simple'} onClick={() => setMode('simple')}>Simple View</button>
        <button aria-pressed={mode === 'detailed'} onClick={() => setMode('detailed')}>Detailed View</button>
      </div>
    </div>
    <div className="vocabulary-tools">
      <div className="vocabulary-selection-controls">
        <label title="현재 검색 및 논문 필터 결과 전체 선택">
          <input ref={selectAllRef} type="checkbox" checked={allSelected} disabled={selectionDisabled || !entries.length}
            onChange={event => selection.assign(new Set(event.target.checked ? ids : []))} />
          전체 선택
        </label>
        <button className="delete-vocabulary" disabled={!selected.size || loading || !!error || deleting || exporting}
          onClick={() => void deleteSelected()}>{deleting ? '삭제 중…' : `선택 삭제 (${selected.size})`}</button>
      </div>
      <button className="open-button" disabled={loading || !!error || deleting || exporting || entries.length < 2}
        onClick={shuffleEntries}>순서 섞기</button>
      <div className="zoom-controls" aria-label="Vocabulary 확대 및 축소">
        <button aria-label="Vocabulary 축소" disabled={zoom <= 75} onClick={() => setZoom(n => Math.max(75, n - 25))}>−</button>
        <span>{Math.round(zoom)}%</span>
        <button aria-label="Vocabulary 확대" disabled={zoom >= 200} onClick={() => setZoom(n => Math.min(200, n + 25))}>+</button>
      </div>
      <button className="open-button" disabled={loading || !!error || !entries.length || exporting || deleting}
        onClick={() => setPreview({ entries, mode })}>인쇄 미리보기</button>
      <button className="open-button" disabled={loading || !!error || !entries.length || exporting || deleting} onClick={() => void exportPdf()}>
        {exporting ? 'PDF 만드는 중…' : 'PDF 내보내기'}</button>
    </div>
    <p className="selection-note">Ctrl 클릭: 개별 선택 · Shift 클릭: 범위 선택 · 빈 영역 드래그: 여러 개 선택
      <span className="vocabulary-delete-note" style={{ visibility: selected.size ? 'visible' : 'hidden' }}>선택한 항목의 모든 논문 문맥과 하이라이트도 함께 삭제됩니다.</span>
    </p>
    {deleteError && <p className="export-message bubble-error" role="alert">{deleteError}</p>}
    {deleteMessage && <p className="export-message" role="status">{deleteMessage}</p>}
    {exportError && <p className="export-message bubble-error" role="alert">{exportError}</p>}
    {exportMessage && <p className="export-message" role="status">{exportMessage}</p>}
    <div className="vocabulary-filters">
      <label>단어 검색<input type="search" value={query} disabled={deleting} onChange={event => { resetSelection(); setQuery(event.target.value); }} placeholder="영어 단어 또는 한국어 뜻" /></label>
      <label>논문<select aria-label="논문" value={paperId} disabled={deleting} onChange={event => { resetSelection(); setPaperId(event.target.value); }}>
        <option value="">전체 논문</option>
        {papers.map(paper => <option key={paper.id} value={paper.id}>{paper.title || paper.fileName}</option>)}
      </select></label>
    </div>
    <div className="vocabulary-content" style={{ '--vocabulary-scale': zoom / 100 } as React.CSSProperties}>
    {error ? <div className="vocabulary-message" role="alert"><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>다시 시도</button></div>
      : loading ? <p className="vocabulary-message" role="status">단어장을 불러오는 중…</p>
      : !entries.length ? <p className="vocabulary-message" role="status">{query || paperId ? '검색 조건에 맞는 단어가 없습니다.' : '저장된 단어가 없습니다. PDF에서 단어나 문장을 번역해 보세요.'}</p>
      : mode === 'simple' ? <dl className="vocabulary-simple" aria-label="Simple View">
        {entries.map(entry => <div key={entry.id} data-selection-id={entry.id} data-selected={selected.has(entry.id)} tabIndex={0}
          onClick={event => selectRow(event, entry.id)} onKeyDown={event => selectWithKey(event, entry.id)}><dt><div className="vocabulary-word">
          <input type="checkbox" aria-label={`${entry.word} 선택`} checked={selected.has(entry.id)} disabled={selectionDisabled}
            onChange={() => {}} onClick={event => selectCheckbox(event, entry.id)} /><span lang="en">{entry.word}</span>
        </div></dt><dd>{entry.translation ?? '—'}</dd></div>)}
      </dl> : <div className="vocabulary-detailed" aria-label="Detailed View">
        {entries.map(entry => <article key={entry.id} className="vocabulary-entry" data-selection-id={entry.id} data-selected={selected.has(entry.id)} tabIndex={0}
          onClick={event => selectRow(event, entry.id)} onKeyDown={event => selectWithKey(event, entry.id)}>
          <header><div className="vocabulary-word"><input type="checkbox" aria-label={`${entry.word} 선택`}
            checked={selected.has(entry.id)} disabled={selectionDisabled} onChange={() => {}} onClick={event => selectCheckbox(event, entry.id)} />
            <h2 lang="en">{entry.word}</h2></div><span>조회 {entry.lookupCount}회</span></header>
          {entry.contexts.map(context => <section className="vocabulary-context" key={JSON.stringify([context.paperId, context.pageNumber, context.originalSentence])}>
            <dl><div className="context-meaning"><dt>뜻</dt><dd>{context.translation ?? '—'}</dd></div>
              <div><dt>설명</dt><dd>{context.explanation ?? '—'}</dd></div>
              <div><dt>원문 문장</dt><dd lang="en">{context.originalSentence}</dd></div>
              <div><dt>논문</dt><dd>{context.paperTitle} <span className="context-page">· {context.pageNumber}페이지</span></dd></div>
            </dl>
          </section>)}
        </article>)}
      </div>}
    </div>
    {selection.dragging && <div ref={selection.overlay} className="vocabulary-selection-box" aria-hidden="true" />}
    {preview && <Suspense fallback={<p role="status">미리보기를 준비하는 중…</p>}>
      <PrintPreview entries={preview.entries} initialMode={preview.mode} onClose={() => setPreview(null)} />
    </Suspense>}
  </section>;
});
