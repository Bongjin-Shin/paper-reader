import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import { errorMessage } from '../lib/backend';
import { isSingleEnglishWord, pdfToStyle, readDragSelection, readWordSelection, registerTextLayer } from '../lib/selection';
import { highlightCss } from '../lib/highlights';
import type { Highlight, WordSelection, PdfRect } from '../types';
import { canvasSize, type PageRenderCache } from '../lib/pageRendering';
import { registerPdfCopyLayer } from '../lib/pdfClipboard';

interface Props {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  renderRevision: number;
  displayScale: RefObject<number>;
  highlights: Highlight[];
  translationRects?: PdfRect[];
  onSelect: (selection: WordSelection | null, extending?: boolean) => void;
  onRendered?: (pageNumber: number) => void;
  cache: PageRenderCache;
  onHighlight: (highlight: Highlight, selection: WordSelection) => void;
}

export const PdfPage = memo(function PdfPageView({ pdf, pageNumber, scale, renderRevision, displayScale, highlights, translationRects, onSelect, onRendered, cache, onHighlight }: Props) {
  const renderScale = scale;
  const hostRef = useRef<HTMLElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const textHostRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [resident, setResident] = useState(false);
  const [ready, setReady] = useState(false);
  const [renderedScale, setRenderedScale] = useState<number | null>(null);
  const [noText, setNoText] = useState(false);
  const [error, setError] = useState('');
  const viewport = useMemo(() => page?.getViewport({ scale }), [page, scale]);
  const paintedViewport = useMemo(() => page?.getViewport({ scale: renderedScale ?? renderScale }), [page, renderedScale, renderScale]);
  const surface = useRef<{ canvas: HTMLCanvasElement; layer: HTMLDivElement; text: HTMLDivElement; textScale: number; scale: number } | null>(null);
  const textContentRef = useRef<ReturnType<PDFPageProxy['getTextContent']> | null>(null);
  const renderCallbackRef = useRef(onRendered);
  renderCallbackRef.current = onRendered;
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    const finishDrag = (event: MouseEvent) => {
      const origin = pointerOrigin.current;
      pointerOrigin.current = null;
      if (!origin || event.button !== 0 || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 3) return;
      dragged.current = true;
      const layer = textHostRef.current?.querySelector<HTMLDivElement>('.textLayer');
      if (ready && renderedScale === displayScale.current && layer && viewport) onSelect(readDragSelection(layer, viewport, pageNumber));
    };
    document.addEventListener('mouseup', finishDrag);
    return () => document.removeEventListener('mouseup', finishDrag);
  }, [ready, renderedScale, displayScale, viewport, pageNumber, onSelect]);

  useEffect(() => {
    let active = true;
    pdf.getPage(pageNumber).then(value => { if (active) setPage(value); })
      .catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [pdf, pageNumber]);

  useEffect(() => {
    const host = hostRef.current;
    setResident(false);
    if (host) return cache.observe(host, setResident);
  }, [cache]);

  useEffect(() => { textContentRef.current = null; }, [page]);
  useEffect(() => {
    if (!resident) setRenderedScale(null);
    return () => {
      const old = surface.current; surface.current = null;
      if (old) { old.canvas.remove(); old.canvas.width = old.canvas.height = 0; old.text.remove(); }
    };
  }, [page, resident]);
  useEffect(() => {
    if (!page || !resident || !canvasHostRef.current || !textHostRef.current) {
      setReady(false);
      textContentRef.current = null;
      page?.cleanup();
      return;
    }
    if (surface.current?.scale === renderScale) {
      if (renderScale === displayScale.current) hostRef.current!.dataset.renderedScale = String(renderScale);
      setReady(true);
      cache.rendered(hostRef.current!, surface.current.canvas.width * surface.current.canvas.height);
      renderCallbackRef.current?.(pageNumber);
      return;
    }
    let active = true;
    let committed = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let layer: HTMLDivElement | undefined;
    let text: HTMLDivElement | undefined;
    setReady(false);
    setError('');
    cache.rendering(hostRef.current!);
    const viewport = page.getViewport({ scale: renderScale });
    const job = cache.queue.enqueue(async () => {
      if (!active) return;
      // Render offscreen, keeping the previous complete canvas/text visible during zoom.
      canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      const existing = surface.current;
      layer = existing?.layer ?? document.createElement('div');
      text = existing?.text ?? document.createElement('div');
      if (!existing) {
        text.className = 'text-surface';
        Object.assign(text.style, { width: `${viewport.width}px`, height: `${viewport.height}px`, transformOrigin: '0 0' });
        layer.className = 'textLayer';
        layer.style.setProperty('--scale-factor', String(renderScale));
        layer.style.setProperty('--total-scale-factor', `calc(var(--scale-factor) * ${page.userUnit})`);
        text.append(layer);
      }
      const size = canvasSize(viewport.width, viewport.height, window.devicePixelRatio);
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = page.render({ canvas, viewport, transform: size.ratio === 1 ? undefined : [size.ratio, 0, 0, size.ratio, 0, 0] });
      renderTask.onContinue = (resume: () => void) => {
        if (active && cache.continueRendering(hostRef.current!)) resume();
        else renderTask?.cancel();
      };
      const renderText = async () => {
        const content = await (textContentRef.current ??= page.getTextContent());
        if (!active || !cache.continueRendering(hostRef.current!)) { renderTask!.cancel(); return; }
        if (!existing) {
          textLayer = new TextLayer({ textContentSource: content, container: layer!, viewport });
          await textLayer.render();
        }
        return content;
      };
      // Cancellation frees the queue even while the worker is still extracting text.
      const [, content] = await Promise.all([renderTask.promise, renderText()]);
      if (active && content) {
        const old = surface.current;
        const textScale = existing?.textScale ?? renderScale;
        surface.current = { canvas, layer, text, textScale, scale: renderScale };
        canvasHostRef.current!.replaceChildren(canvas);
        // Keep text nodes (and the user's Range) stable across zoom. The wrapper
        // scales PDF.js's original rotated text geometry, without overriding its
        // own rotation transform or remeasuring every glyph at each zoom stop.
        text.style.transform = `scale(${renderScale / textScale})`;
        registerTextLayer(layer, viewport);
        if (textLayer) registerPdfCopyLayer(layer, page, content, textLayer.textDivs);
        if (!existing) textHostRef.current!.replaceChildren(text);
        if (old) { old.canvas.width = old.canvas.height = 0; }
        committed = true;
        setNoText(!content.items.some(item => 'str' in item && item.str.trim().length));
        setReady(true);
        setRenderedScale(renderScale);
        cache.rendered(hostRef.current!, canvas.width * canvas.height);
        renderCallbackRef.current?.(pageNumber);
      }
    }, () => cache.priority(hostRef.current!));
    const reader = hostRef.current!.closest('.reader');
    const cancelPreview = () => {
      if (committed) return;
      // A new gesture makes this staging render obsolete, even before its final
      // scale is known. Keep the complete live surface and restart after quiet.
      active = false; job.cancel(); renderTask?.cancel(); textLayer?.cancel();
    };
    reader?.addEventListener('readerzoomstart', cancelPreview);
    void job.promise.catch(error => {
      if (active && !['RenderingCancelledException', 'AbortException', 'AbortError'].includes(error?.name)) {
        textContentRef.current = null;
        setError(errorMessage(error));
      }
    });
    return () => {
      reader?.removeEventListener('readerzoomstart', cancelPreview);
      active = false; job.cancel(); renderTask?.cancel(); textLayer?.cancel();
      if (canvas && surface.current?.canvas !== canvas) { canvas.remove(); canvas.width = canvas.height = 0; }
      if (text && surface.current?.text !== text) text.remove();
    };
  }, [page, resident, renderScale, renderRevision, cache, pageNumber]);

  return <article ref={hostRef} className="pdf-page" aria-label={`${pageNumber}페이지`}
    onPointerDownCapture={() => { if (hostRef.current) hostRef.current.dataset.pageVisible = 'true'; }}
    data-page-number={pageNumber}
    data-pdf-width={viewport ? viewport.width / scale : 612}
    data-pdf-height={viewport ? viewport.height / scale : 792}
    data-rendered-scale={ready && renderedScale === displayScale.current ? renderedScale : undefined}
    style={{ width: (viewport ? viewport.width / scale : 612) * displayScale.current,
      height: (viewport ? viewport.height / scale : 792) * displayScale.current,
      '--scale-factor': scale, '--user-unit': page?.userUnit ?? 1 } as React.CSSProperties}>
    <div className="page-surface" data-painted-scale={renderedScale ?? renderScale} style={{ width: paintedViewport?.width, height: paintedViewport?.height,
      transform: `scale(${displayScale.current / (renderedScale ?? renderScale)})`, '--scale-factor': renderedScale ?? renderScale,
      '--total-scale-factor': 'calc(var(--scale-factor) * var(--user-unit))' } as React.CSSProperties}>
    <div ref={canvasHostRef} className="canvas-layer" />
    {resident && paintedViewport && <HighlightLayer viewport={paintedViewport} highlights={highlights} />}
    {resident && paintedViewport && translationRects && <div className="translation-source-layer" aria-hidden="true">
      {translationRects.map((rect, index) => <span key={index} className="translation-source-mark" style={pdfToStyle(rect, paintedViewport)} />)}
    </div>}
    <div ref={textHostRef} className="text-host" onMouseDown={event => {
      if (event.button === 0) { pointerOrigin.current = { x: event.clientX, y: event.clientY }; dragged.current = false; }
    }} onClick={event => {
      if (event.detail >= 3 && ready && renderedScale === displayScale.current && viewport) {
        const layer = textHostRef.current?.querySelector<HTMLDivElement>('.textLayer');
        onSelect(layer ? readDragSelection(layer, viewport, pageNumber) : null, true);
        return;
      }
      // The Text Layer keeps pointer events so dragging/double-clicking still selects text.
      // Hit-test saved PDF coordinates only on a completed single click, never on scroll.
      if (event.detail !== 1 || dragged.current || !ready || renderedScale !== displayScale.current || !viewport || !hostRef.current) return;
      const bounds = hostRef.current.getBoundingClientRect();
      const [x, y] = viewport.convertToPdfPoint((event.clientX - bounds.left) * viewport.width / bounds.width,
        (event.clientY - bounds.top) * viewport.height / bounds.height);
      const highlight = highlights.find(h => h.position.rects.some(r => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]));
      if (!highlight) return;
      const rect = highlight.position.rects.find(r => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3])!;
      const box = pdfToStyle(rect, viewport);
      onHighlight(highlight, { word: highlight.selectedText, originalSentence: '', isSingleWord: isSingleEnglishWord(highlight.selectedText),
        pageNumber, position: highlight.position,
        segments: [{ pageNumber, startOffset: highlight.position.startOffset, endOffset: highlight.position.endOffset, rects: highlight.position.rects }],
        anchorPageNumber: pageNumber, anchorPdfRect: rect,
        anchor: { left: bounds.left + box.left, top: bounds.top + box.top, bottom: bounds.top + box.top + box.height, width: box.width } });
    }} onDoubleClick={() => {
      const layer = textHostRef.current?.querySelector<HTMLDivElement>('.textLayer');
      onSelect(ready && renderedScale === displayScale.current && layer && viewport ? readWordSelection(layer, viewport, pageNumber) : null);
    }} />
    </div>
    {error && <div className="page-message" role="alert">페이지를 표시하지 못했습니다.<br />{error}</div>}
    {!error && !ready && resident && renderedScale === null && <div className="page-message">페이지를 불러오는 중…</div>}
    {ready && noText && <div className="no-text-note">선택할 수 있는 텍스트가 없는 페이지입니다.</div>}
  </article>;
});

const HighlightLayer = memo(function HighlightLayer({ viewport, highlights }: {
  viewport: ReturnType<PDFPageProxy['getViewport']>; highlights: Highlight[];
}) {
  return <div className="highlight-layer" aria-hidden="true">
    {highlights.map(highlight => highlight.position.rects.map((rect, index) =>
      <span key={`${highlight.id}-${index}`} className="word-highlight" data-highlight-id={highlight.id}
        data-color={highlight.color ?? 'yellow'} style={{ ...pdfToStyle(rect, viewport), background: highlightCss(highlight.color) }} />))}
  </div>;
});
