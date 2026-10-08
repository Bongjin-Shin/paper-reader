import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { createVocabularyPdf, type VocabularyMode } from '../lib/vocabularyPdf';
import { loadPdf } from '../lib/pdf';
import { errorMessage, exportVocabularyPdf, printVocabularyPdf } from '../lib/backend';
import type { VocabularyEntry } from '../types';

type Preview = { bytes: Uint8Array; pdf: PDFDocumentProxy; mode: VocabularyMode };

export default function PrintPreview({ entries, initialMode, onClose }: {
  entries: VocabularyEntry[]; initialMode: VocabularyMode; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState(initialMode), [pageNumber, setPageNumber] = useState(1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rendering, setRendering] = useState(true), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [retry, setRetry] = useState(0);
  const pending = useRef(false);
  const ready = preview?.mode === mode && !rendering;

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => { element.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  useEffect(() => {
    let current = true, task: PDFDocumentLoadingTask | undefined;
    setPreview(null); setError(''); setMessage(''); setPageNumber(1); setRendering(true);
    void createVocabularyPdf(entries, mode).then(async bytes => {
      if (!current) return;
      // PDF.js may transfer/detach its input. Preserve the original bytes for saving/printing.
      task = loadPdf(bytes.slice());
      const pdf = await task.promise;
      if (current) setPreview({ bytes, pdf, mode });
    }).catch(error => { if (current) { setError(errorMessage(error)); setRendering(false); } });
    return () => { current = false; void task?.destroy().catch(() => {}); };
  }, [entries, mode, retry]);

  useEffect(() => {
    if (!preview) return;
    let current = true, render: RenderTask | undefined;
    setRendering(true); setError('');
    void preview.pdf.getPage(pageNumber).then(async page => {
      if (!current || !canvas.current) return;
      const target = canvas.current;
      // Only the visible preview page owns a canvas; Reader canvases and zoom are independent.
      const viewport = page.getViewport({ scale: Math.min(window.devicePixelRatio || 1, 2) * 1.2 });
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      render = page.render({ canvas: target, viewport });
      await render.promise;
      if (current) setRendering(false);
    }).catch(error => { if (current) { setError(errorMessage(error)); setRendering(false); } });
    return () => { current = false; render?.cancel(); };
  }, [preview, pageNumber]);

  const output = async (print: boolean) => {
    if (!preview || !ready || pending.current || error) return;
    pending.current = true; setBusy(true); setMessage(''); setError('');
    try {
      if (print) {
        if (await printVocabularyPdf(preview.bytes, mode, pageNumber)) setMessage('인쇄 작업을 시스템에 전달했습니다.');
      } else {
        const path = await exportVocabularyPdf(preview.bytes, mode);
        if (path) setMessage(`PDF 저장 완료: ${path}`);
      }
    } catch (error) { setError(errorMessage(error)); }
    finally { pending.current = false; setBusy(false); }
  };

  return <dialog ref={dialog} className="print-preview" aria-labelledby="print-preview-title"
    onCancel={event => { event.preventDefault(); if (!pending.current) onClose(); }}>
    <header><div><h2 id="print-preview-title">인쇄 미리보기</h2><p>A4 · {entries.length}개 항목 · {mode === 'simple' ? '2단' : '상세 문맥'}</p></div>
      <button disabled={busy} aria-label="인쇄 미리보기 닫기" onClick={onClose}>닫기</button></header>
    <div className="print-preview-tools">
      <div className="view-switch" role="group" aria-label="출력 형식">
        <button disabled={busy} aria-pressed={mode === 'simple'} onClick={() => { setError(''); setMode('simple'); }}>Simple Print</button>
        <button disabled={busy} aria-pressed={mode === 'detailed'} onClick={() => { setError(''); setMode('detailed'); }}>Detailed Print</button>
      </div>
      <div><button disabled={!ready || busy || !!error} onClick={() => void output(true)}>시스템 인쇄</button>
        <button disabled={!ready || busy || !!error} onClick={() => void output(false)}>PDF 저장</button></div>
    </div>
    {error && <div className="preview-notice bubble-error" role="alert">{error} <button disabled={busy} onClick={() => { setError(''); setRetry(n => n + 1); }}>다시 시도</button></div>}
    {message && <p className="preview-notice" role="status">{message}</p>}
    <div className="preview-sheet" aria-busy={!ready && !error}>
      <canvas ref={canvas} hidden={!ready || !!error} role="img" aria-label={`${mode === 'simple' ? 'Simple' : 'Detailed'} Print ${pageNumber}페이지 미리보기`} />
      {!ready && !error && <p role="status">미리보기를 준비하는 중…</p>}
    </div>
    <footer><button aria-label="미리보기 이전 페이지" disabled={!preview || pageNumber <= 1 || busy || rendering} onClick={() => setPageNumber(n => n - 1)}>←</button>
      <span aria-live="polite">{preview ? `${pageNumber} / ${preview.pdf.numPages}페이지` : '—'}</span>
      <button aria-label="미리보기 다음 페이지" disabled={!preview || pageNumber >= preview.pdf.numPages || busy || rendering} onClick={() => setPageNumber(n => n + 1)}>→</button></footer>
  </dialog>;
}
