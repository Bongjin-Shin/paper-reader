import { forgetPaperChatSessions } from './lib/paperChatSession';
import { usePaneZoomShortcuts } from './lib/usePaneZoomShortcuts';
import { version as appVersion } from '../package.json';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { dataMutationPending, restoreHistory, getLibrary, getPapers, deleteVocabulary, errorMessage, getHighlights, getHighlightColor, setHighlightColor, removeHighlights, getSavedHighlight, importLibraryPdf, importDroppedLibraryPdf, listenFileDrag, lookupText, lookupWord, openDroppedPdf, openPdf, readPdf, updatePaperMetadata } from './lib/backend';
import { loadPdf } from './lib/pdf';
import { extractPaperMetadata } from './lib/paperMetadata';
import { useTranslationWidth } from './components/TranslationPane';
import { ChatResizer, useChatWidth } from './components/ChatPane';
import { useTextZoom } from './lib/useTextZoom';
import { PaperChat } from './components/PaperChat';
import { TranslationNavigation } from './components/PageTranslationPanel';
import { usePageTranslation } from './lib/usePageTranslation';
import { usePaperClipboard } from './lib/usePaperClipboard';
import { usePdfSearch } from './lib/usePdfSearch';
import { PdfFindBar } from './components/PdfFindBar';
import { PdfPages } from './components/PdfPages';
import { WordBubble, type BubbleState } from './components/WordBubble';
import { AiConnection } from './components/AiConnection';
import { Vocabulary } from './components/Vocabulary';
import { Library } from './components/Library';
import { pdfToStyle, restoreTextSelection } from './lib/selection';
import { useReaderZoom } from './lib/useReaderZoom';
import { useNavigation } from './lib/useNavigation';
import { undoShortcut } from './lib/undoShortcut';
import { useMouseNavigation } from './lib/useMouseNavigation';
import type { ActionType, ChatSelection, Highlight, HighlightColor, Paper, WordSelection } from './types';
import { highlightColors } from './lib/highlights';

function PaperIcon({ large = false }: { large?: boolean }) {
  return <svg width={large ? 38 : 23} height={large ? 44 : 27} viewBox="0 0 30 36" fill="none" aria-hidden="true">
    <path d="M6 1.5h12l10.5 10.5v20a2.5 2.5 0 0 1-2.5 2.5H6a4.5 4.5 0 0 1-4.5-4.5V6A4.5 4.5 0 0 1 6 1.5Z" stroke="currentColor" strokeWidth="1.5" />
    <path d="M18 2v10h10M8 19h14M8 25h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

export default function App() {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bubbles, setBubbles] = useState<BubbleState[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMountedFor, setChatMountedFor] = useState<string>();
  const [chatSelection, setChatSelection] = useState<ChatSelection | null>(null);
  const consumeChatSelection = useCallback(() => setChatSelection(null), []);
  const [usageRevision, setUsageRevision] = useState(0);
  const [drag, setDrag] = useState<'valid' | 'invalid' | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const navigation = useNavigation();
  const { view, setView, folderId: libraryFolderId, setFolder: setLibraryFolderId } = navigation;
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyMessage, setHistoryMessage] = useState('');
  const historyBusyRef = useRef(false);
  const [libraryMessage, setLibraryMessage] = useState('');
  const libraryBusyRef = useRef(libraryBusy);
  libraryBusyRef.current = libraryBusy;
  const viewRef = useRef(view);
  viewRef.current = view;
  const [color, setColor] = useState<HighlightColor>('yellow');
  const [colorLoading, setColorLoading] = useState(true);
  const [removing, setRemoving] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);
  const readerLayoutRef = useRef<HTMLDivElement>(null), chatRef = useRef<HTMLDivElement>(null);
  const chatWidth = useChatWidth(readerLayoutRef);
  const translationZoom = useTextZoom('reader-translation-text-zoom', scrollRef, !!pdf, '.translation-page');
  const chatZoom = useTextZoom('reader-chat-text-zoom', chatRef, !!pdf && chatOpen);
  const loadingRef = useRef<PDFDocumentLoadingTask | null>(null);
  const activePaperRef = useRef<string | null>(null);
  const bubbleIdRef = useRef(0);
  const pendingRef = useRef(new Set<number>());
  const openingRef = useRef(false);
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;
  const changeBubbles = useCallback((change: (current: BubbleState[]) => BubbleState[]) => {
    const next = change(bubblesRef.current);
    bubblesRef.current = next; setBubbles(next);
  }, []);
  const updateBubble = useCallback((id: number, change: (current: BubbleState) => BubbleState) => {
    changeBubbles(current => current.map(item => item.id === id ? change(item) : item));
  }, [changeBubbles]);
  const readerKeyTarget = useRef<{ id: number; kind: 'bubble' | 'highlight' | 'selection' } | null>(null);
  const sourceSelectionId = useRef<number | null>(null);
  const [frontBubbleId, setFrontBubbleId] = useState<number | null>(null);
  const lastGesture = useRef<{ id: number; time: number; kind: 'selection' | 'highlight' } | null>(null);
  const cancelHighlightsRef = useRef<() => Promise<void>>(async () => {});
  const scaleRef = useRef(1.25);
  const pdfRef = useRef(pdf);
  pdfRef.current = pdf;

  const syncSelection = useCallback((force = false) => {
    const document = pdfRef.current, paperId = activePaperRef.current, scale = scaleRef.current;
    if (!document || !paperId || !scrollRef.current?.clientWidth) return;
    for (const current of bubblesRef.current.filter(item => item.paperId === paperId)) {
      const element = scrollRef.current?.querySelector<HTMLElement>(`.pdf-page[data-page-number="${current.selection.anchorPageNumber}"]`);
      if (!element) continue;
      void document.getPage(current.selection.anchorPageNumber).then(page => {
        if (pdfRef.current !== document || scaleRef.current !== scale) return;
        const bounds = element.getBoundingClientRect();
        const box = pdfToStyle(current.selection.anchorPdfRect, page.getViewport({ scale }));
        const anchor = { left: bounds.left + box.left, top: bounds.top + box.top,
          bottom: bounds.top + box.top + box.height, width: box.width };
        updateBubble(current.id, value => {
          const old = value.selection.anchor;
          if (!force && old.left === anchor.left && old.top === anchor.top && old.bottom === anchor.bottom && old.width === anchor.width) return value;
          return { ...value, selection: { ...value.selection, anchor } };
        });
        if (sourceSelectionId.current === current.id) restoreTextSelection(current.selection);
      }).catch(() => {});
    }
  }, [updateBubble]);
  const onZoomSettled = useCallback(() => syncSelection(true), [syncSelection]);
  const onPageRendered = useCallback((pageNumber: number) => {
    if (bubblesRef.current.some(item => item.paperId === activePaperRef.current && item.selection.segments.some(segment => segment.pageNumber === pageNumber))) syncSelection();
  }, [syncSelection]);
  const translation = usePageTranslation(pdf, paper?.id, scrollRef, view === 'reader', () => setUsageRevision(n => n + 1));
  const translationWidth = useTranslationWidth(scrollRef);
  const zoom = useReaderZoom(scrollRef, pdf, onZoomSettled, translation.open ? translationWidth.width : 0);
  const search = usePdfSearch(pdf, scrollRef, view === 'reader');
  usePaperClipboard(scrollRef, translation, view === 'reader');
  const { scale } = zoom;
  usePaneZoomShortcuts(!!pdf && view === 'reader', zoom, translationZoom, chatZoom);
  scaleRef.current = scale;

  const closeBubble = useCallback((id: number) => {
    changeBubbles(current => current.filter(item => item.id !== id));
    if (readerKeyTarget.current?.id === id) readerKeyTarget.current = null;
    if (sourceSelectionId.current === id) { sourceSelectionId.current = null; window.getSelection()?.removeAllRanges(); }
  }, [changeBubbles]);
  const dismissActionMenus = useCallback((keepId?: number) => {
    const dismissed = bubblesRef.current.filter(item => item.status === 'actions' && item.id !== keepId);
    if (!dismissed.length) return;
    const ids = new Set(dismissed.map(item => item.id));
    changeBubbles(current => current.filter(item => !ids.has(item.id)));
    if (readerKeyTarget.current && ids.has(readerKeyTarget.current.id)) readerKeyTarget.current = null;
    if (sourceSelectionId.current !== null && ids.has(sourceSelectionId.current)) sourceSelectionId.current = null;
    // Do not clear the native Range while another double/triple click or drag
    // selection is being started. Only the temporary menu is discarded.
  }, [changeBubbles]);
  useEffect(() => { dismissActionMenus(); }, [view, paper?.id, dismissActionMenus]);
  const activateBubble = (bubble: BubbleState) => {
    readerKeyTarget.current = { id: bubble.id, kind: 'bubble' };
    sourceSelectionId.current = bubble.id; setFrontBubbleId(bubble.id);
    restoreTextSelection(bubble.selection);
  };
  const goBack = () => {
    if (!navigation.canGoBack || openingRef.current || libraryBusyRef.current) return;
    readerKeyTarget.current = null; setLibraryMessage(''); navigation.back();
  };
  const goForward = () => {
    if (!navigation.canGoForward || openingRef.current || libraryBusyRef.current) return;
    readerKeyTarget.current = null; setLibraryMessage(''); navigation.forward();
  };
  useMouseNavigation(goBack, goForward);
  const handleDeleteVocabulary = useCallback(async (ids: number[]) => {
    const removed = await deleteVocabulary(ids);
    setHighlights(current => current.filter(highlight => !removed.includes(highlight.vocabularyEntryId)));
    return removed;
  }, []);
  const handleRenamedPaper = useCallback((renamed: Paper) => {
    setPaper(current => current?.id === renamed.id ? renamed : current);
    setUsageRevision(value => value + 1);
  }, []);
  const handleDeletedPapers = useCallback((ids: string[]) => {
    forgetPaperChatSessions(ids);
    if (!activePaperRef.current || !ids.includes(activePaperRef.current)) return;
    activePaperRef.current = null;
    setPaper(null); setPdf(null); setHighlights([]); readerKeyTarget.current = null;
    const previous = loadingRef.current;
    loadingRef.current = null;
    if (previous) void previous.destroy();
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const direction = undoShortcut(event, event.target);
      if (!direction || event.defaultPrevented) return;
      if (document.querySelector('.print-preview, .library-form, .library-memo form, .library-selection-box, .vocabulary-selection-box, .library-drag-ghost')) return;
      event.preventDefault();
      if (historyBusyRef.current || openingRef.current || libraryBusyRef.current || dataMutationPending()) return;
      historyBusyRef.current = true; setHistoryBusy(true); setHistoryMessage(''); setError('');
      void (async () => {
        try {
          const label = await restoreHistory(direction === 'redo');
          if (!label) { setHistoryMessage(direction === 'redo' ? '다시 실행할 작업이 없습니다.' : '실행 취소할 작업이 없습니다.'); return; }
          readerKeyTarget.current = null; setLibraryMessage('');
          setLibraryRevision(value => value + 1); setUsageRevision(value => value + 1);
          const currentPaperId = activePaperRef.current;
          const [library, papers, restoredHighlights] = await Promise.all([getLibrary(), getPapers(),
            currentPaperId ? getHighlights(currentPaperId) : Promise.resolve([])]);
          if (currentPaperId === activePaperRef.current && currentPaperId) {
            if (!library.papers.some(item => item.id === currentPaperId)) handleDeletedPapers([currentPaperId]);
            else { setHighlights(restoredHighlights); setPaper(papers.find(item => item.id === currentPaperId) ?? null); }
          }
          setHistoryMessage(`${direction === 'redo' ? '다시 실행' : '실행 취소'}: ${label}`);
        } catch (error) { setError(errorMessage(error)); }
        finally { historyBusyRef.current = false; setHistoryBusy(false); }
      })();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [closeBubble, handleDeletedPapers]);

  useEffect(() => {
    void getHighlightColor().then(setColor).catch(error => setError(errorMessage(error))).finally(() => setColorLoading(false));
  }, []);
  const changeColor = async (value: HighlightColor) => {
    setColorLoading(true);
    try { await setHighlightColor(value); setColor(value); }
    catch (error) { setError(errorMessage(error)); }
    finally { setColorLoading(false); }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        viewRef.current !== 'reader' || historyBusyRef.current || openingRef.current) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      const target = readerKeyTarget.current;
      if (!target || !bubblesRef.current.some(item => item.id === target.id && item.paperId === activePaperRef.current)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); closeBubble(target.id);
      } else if (event.key === 'Delete') {
        event.preventDefault();
        if (target.kind === 'bubble') closeBubble(target.id);
        else void cancelHighlightsRef.current();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const surface = event.target.closest<HTMLElement>('.word-bubble');
      // Clicking an action must leave its menu mounted until onClick promotes
      // it to a requested result. Other temporary menus never accumulate.
      if (!event.target.closest('.zoom-controls, .highlight-colors')) {
        dismissActionMenus(surface ? Number(surface.dataset.bubbleId) : undefined);
      }
      if (surface) return;
      readerKeyTarget.current = null;
      sourceSelectionId.current = null;
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [closeBubble, dismissActionMenus]);
  useEffect(() => () => { void loadingRef.current?.destroy(); }, []);

  const enrichPaper = async (added: Paper) => {
    let temporary: PDFDocumentLoadingTask | null = null;
    try {
      let document = added.id === activePaperRef.current ? pdfRef.current : null;
      if (!document) {
        temporary = loadPdf(await readPdf(added.id));
        temporary.onPassword = () => { throw new Error('암호로 보호된 PDF의 논문 정보는 직접 입력해 주세요.'); };
        document = await temporary.promise;
      }
      const updated = await updatePaperMetadata(added.id, await extractPaperMetadata(document), true);
      handleRenamedPaper(updated);
      return updated;
    } finally { if (temporary) await temporary.destroy(); }
  };
  const displayPaper = async (selected: Paper) => {
    if (selected.id === activePaperRef.current && pdfRef.current) {
      setPaper(selected); setView('reader'); return;
    }
    let candidate: PDFDocumentLoadingTask | null = null;
    try {
      candidate = loadPdf(await readPdf(selected.id));
      candidate.onPassword = () => { throw new Error('암호로 보호된 PDF는 열 수 없습니다. 암호가 해제된 파일을 열어 주세요.'); };
      const [document, saved] = await Promise.all([candidate.promise, getHighlights(selected.id)]);
      try {
        const updated = await updatePaperMetadata(selected.id, await extractPaperMetadata(document), true);
        selected = { ...updated, fileName: selected.fileName, title: updated.title === updated.fileName ? selected.title : updated.title };
        setLibraryRevision(value => value + 1); setUsageRevision(value => value + 1);
      } catch (error) { setError(`PDF는 열었지만 논문 정보를 저장하지 못했습니다. ${errorMessage(error)}`); }
      const previous = loadingRef.current;
      loadingRef.current = candidate; activePaperRef.current = selected.id;
      readerKeyTarget.current = null; sourceSelectionId.current = null; setPaper(selected); setPdf(document); setView('reader');
      setHighlights(current => [...saved, ...current.filter(item => item.paperId === selected.id && !saved.some(row => row.id === item.id))]);
      scrollRef.current?.scrollTo(0, 0);
      if (previous) void previous.destroy();
    } catch (error) { if (candidate) await candidate.destroy(); throw error; }
  };
  const handleFiles = async (paths: string[] | undefined, toLibrary: boolean, savedPaper?: Paper) => {
    if (openingRef.current) { setError('PDF를 처리 중입니다. 완료 후 다시 추가해 주세요.'); return; }
    if (libraryBusyRef.current) { setError('진행 중인 Library 작업이 끝난 뒤 PDF를 다시 추가해 주세요.'); return; }
    openingRef.current = true; setOpening(true); setError(''); setLibraryMessage('');
    const destination = libraryFolderId;
    try {
      if (savedPaper) { await displayPaper(savedPaper); return; }
      const batch = toLibrary
        ? paths ? await importDroppedLibraryPdf(paths, destination) : await importLibraryPdf(destination)
        : paths ? await openDroppedPdf(paths) : await openPdf();
      if (!batch) return;
      const failures = batch.failures.map(failure => `${failure.fileName}: ${failure.message}`);
      const notices: string[] = [];
      let opened = false;
      for (let i = 0; i < batch.papers.length; i++) {
        const added = batch.papers[i];
        if (batch.papers.length > 1) setLibraryMessage(`논문 정보 확인 중… ${i + 1} / ${batch.papers.length}`);
        try {
          if (!toLibrary && !opened) { await displayPaper(added); opened = true; }
          else {
            batch.papers[i] = await enrichPaper(added);
            if (batch.papers[i].title === batch.papers[i].fileName) notices.push(`${added.fileName}: 논문 제목을 찾지 못해 파일명을 사용했습니다.`);
          }
        } catch (error) {
          notices.push(`${added.fileName}: 논문 정보를 읽거나 저장하지 못했습니다. 논문 정보 수정에서 입력해 주세요. ${errorMessage(error)}`);
        }
      }
      if (!toLibrary && batch.papers.length && !opened) failures.push(`PDF를 열지 못했습니다. Library에서 파일을 확인해 주세요.\n${notices.join('\n')}`);
      setLibraryRevision(value => value + 1);
      const stored = batch.papers.length === 1 ? `저장 완료: ${batch.papers[0].title}` : `${batch.papers.length}개 PDF 저장 완료`;
      setLibraryMessage(`${stored}${batch.failures.length ? ` · ${batch.failures.length}개 실패` : ''}${notices.length ? `\n${notices.join('\n')}` : ''}`);
      if (failures.length) setError(`PDF를 저장하지 못했습니다.\n${failures.join('\n')}`);
      else if (!toLibrary && notices.length) setError(notices.join('\n'));
    } catch (error) { setError(`${toLibrary ? 'PDF를 저장하지 못했습니다.' : 'PDF를 열지 못했습니다.'} ${errorMessage(error)}`); }
    finally { openingRef.current = false; setOpening(false); }
  };
  const handleOpen = (paths?: string[], savedPaper?: Paper) => handleFiles(paths, false, savedPaper);
  const importToLibrary = (paths?: string[]) => handleFiles(paths, true);
  const openRef = useRef(handleOpen); openRef.current = handleOpen;
  const openLibraryPaper = useCallback((paper: Paper) => { void openRef.current(undefined, paper); }, []);
  const importLibraryRef = useRef(importToLibrary); importLibraryRef.current = importToLibrary;
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listenFileDrag(event => {
      if (!active) return;
      if (event.type === 'enter') setDrag(event.valid ? 'valid' : 'invalid');
      else {
        setDrag(null);
        if (event.type === 'error') setError(event.message);
        if (event.type === 'drop') {
          if (!event.paths.some(path => /\.pdf$/i.test(path))) setError('PDF 파일만 열 수 있습니다.');
          else if (viewRef.current === 'library') void importLibraryRef.current(event.paths);
          else void openRef.current(event.paths);
        }
      }
    }).then(stop => { if (active) unlisten = stop; else stop(); }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; unlisten?.(); };
  }, []);

  const handleSelect = useCallback((selection: WordSelection | null, extending = false) => {
    const paperId = activePaperRef.current;
    if (!selection || !paperId) { dismissActionMenus(); return; }
    const sameSource = (item: BubbleState) => item.paperId === paperId && item.selection.word === selection.word &&
      item.selection.segments.length === selection.segments.length && item.selection.segments.every((part, i) => {
        const other = selection.segments[i];
        return part.pageNumber === other.pageNumber && part.startOffset === other.startOffset && part.endOffset === other.endOffset;
      });
    const gesture = lastGesture.current;
    const previous = gesture && performance.now() - gesture.time < 600 ? bubblesRef.current.find(item => item.id === gesture.id) : undefined;
    // A double/triple click is one selection gesture, not two independent lookups.
    const replace = previous && ((gesture?.kind === 'highlight' && sameSource(previous)) ||
      (extending && previous.status === 'actions' && previous.selection.pageNumber === selection.pageNumber));
    const existing = bubblesRef.current.find(item => item.status === 'actions' && sameSource(item));
    const id = existing?.id ?? (replace ? previous.id : ++bubbleIdRef.current);
    changeBubbles(current => [...current.filter(item => item.id !== id && item.status !== 'actions'), { id, paperId, selection, status: 'actions', placement: existing?.placement }]);
    readerKeyTarget.current = { id, kind: 'selection' }; sourceSelectionId.current = id; setFrontBubbleId(id);
    lastGesture.current = { id, time: performance.now(), kind: 'selection' };
  }, [changeBubbles, dismissActionMenus]);

  const showSavedHighlight = useCallback(async (highlightId: number, selection: WordSelection, retryId?: number) => {
    const paperId = activePaperRef.current;
    if (!paperId) return;
    const existing = bubblesRef.current.find(item => item.paperId === paperId && item.savedHighlightId === highlightId);
    const id = retryId ?? existing?.id ?? ++bubbleIdRef.current;
    readerKeyTarget.current = { id, kind: 'highlight' }; sourceSelectionId.current = id; setFrontBubbleId(id);
    if (existing && retryId === undefined) { restoreTextSelection(existing.selection); return; }
    lastGesture.current = { id, time: performance.now(), kind: 'highlight' };
    if (retryId !== undefined) updateBubble(id, current => ({ ...current, status: 'loading' }));
    else changeBubbles(current => [...current, { id, paperId, selection, status: 'loading', savedHighlightId: highlightId }]);
    try {
      const result = await getSavedHighlight(paperId, highlightId);
      updateBubble(id, current => current.savedHighlightId !== highlightId ? current : { ...current, status: 'result', action: result.action, text: result.text,
        selection: { ...current.selection, originalSentence: result.originalSentence },
        savedResults: { translation: result.translation, explanation: result.explanation } });
    } catch (error) {
      updateBubble(id, current => current.savedHighlightId !== highlightId ? current : { ...current, status: 'error', text: errorMessage(error) });
    }
  }, [changeBubbles, updateBubble]);
  const handleHighlight = useCallback((highlight: Highlight, selection: WordSelection) => {
    void showSavedHighlight(highlight.id, selection);
  }, [showSavedHighlight]);

  const askAboutSelection = (bubble: BubbleState) => {
    if (bubble.paperId !== activePaperRef.current) return;
    setChatSelection({ id: crypto.randomUUID(), paperId: bubble.paperId, text: bubble.selection.word,
      pages: [...new Set(bubble.selection.segments.map(segment => segment.pageNumber))] });
    setChatMountedFor(bubble.paperId); setChatOpen(true); closeBubble(bubble.id);
  };

  const handleAction = async (id: number, action: ActionType) => {
    const bubble = bubblesRef.current.find(item => item.id === id);
    if (!bubble || pendingRef.current.has(id) || bubble.status === 'loading') return;
    if (bubble.savedHighlightId !== undefined) {
      if (bubble.status === 'error') await showSavedHighlight(bubble.savedHighlightId, bubble.selection, id);
      else {
        const text = bubble.savedResults?.[action];
        if (text) updateBubble(id, current => ({ ...current, action, text }));
      }
      return;
    }
    const { selection, paperId } = bubble;
    pendingRef.current.add(id);
    updateBubble(id, current => ({ ...current, status: 'loading', action }));
    try {
      const result = selection.isSingleWord
        ? await lookupWord({ paperId, pageNumber: selection.pageNumber, word: selection.word,
          originalSentence: selection.originalSentence, position: selection.position, action, color })
        : await lookupText({ paperId, pageNumber: selection.pageNumber, selectedText: selection.word,
          context: selection.originalSentence, action });
      const highlight = result.highlight;
      if (highlight && activePaperRef.current === paperId) {
        setHighlights(current => [...current.filter(item => item.id !== highlight.id), highlight]);
      }
      updateBubble(id, current => ({ ...current, status: 'result', text: result.text }));
    } catch (error) {
      updateBubble(id, current => ({ ...current, status: 'error', text: errorMessage(error) }));
    } finally { pendingRef.current.delete(id); setUsageRevision(value => value + 1); }
  };

  const removableIds = (bubble: BubbleState) => bubble.savedHighlightId !== undefined
    ? highlights.filter(h => h.id === bubble.savedHighlightId).map(h => h.id)
    : [];
  const cancelHighlights = async (id: number) => {
    const bubble = bubblesRef.current.find(item => item.id === id);
    if (!paper || !bubble || removing) return;
    const ids = removableIds(bubble), paperId = paper.id;
    if (!ids.length) return;
    setRemoving(true);
    try {
      const removed = await removeHighlights(paperId, ids);
      if (activePaperRef.current === paperId) setHighlights(current => current.filter(h => !removed.includes(h.id)));
      // Removing a saved mark never dismisses its open result.
    } catch (error) { setError(errorMessage(error)); }
    finally { setRemoving(false); }
  };
  cancelHighlightsRef.current = async () => { if (readerKeyTarget.current) await cancelHighlights(readerKeyTarget.current.id); };

  return <div className="app-shell" onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()}>
    <header className="toolbar" inert={historyBusy}>
      <div className="brand"><PaperIcon /><span className="brand-name">Paper Vocabulary</span><small className="app-version" aria-label="앱 버전" title={`Paper Vocabulary ${appVersion}`}>v{appVersion}</small></div>
      <div className="history-navigation" role="group" aria-label="방문 기록">
        <button className="history-button" aria-label="뒤로가기" title="뒤로가기" disabled={!navigation.canGoBack || opening || libraryBusy}
          onClick={goBack}>←</button>
        <button className="history-button" aria-label="앞으로가기" title="앞으로가기" disabled={!navigation.canGoForward || opening || libraryBusy}
          onClick={goForward}>→</button>
      </div>
      <nav className="page-navigation" aria-label="화면 선택">
        <button disabled={opening} aria-pressed={view === 'reader'} onClick={() => { setView('reader'); }}>PDF Reader</button>
        <button disabled={opening} aria-pressed={view === 'library'} onClick={() => { readerKeyTarget.current = null; setLibraryMessage(''); setView('library'); }}>Library</button>
        <button disabled={opening} aria-pressed={view === 'vocabulary'} onClick={() => { setView('vocabulary'); }}>Vocabulary</button>
      </nav>
      <div className="document-title" title={paper?.fileName}>{paper?.title ?? ''}</div>
      <div className="toolbar-actions">
        {view === 'reader' && <div className="highlight-colors" role="group" aria-label="하이라이트 색상" onMouseDown={event => event.preventDefault()}>
          {highlightColors.map(item => <button key={item.value} aria-label={`${item.label} 하이라이트`} aria-pressed={color === item.value}
            title={`${item.label}: 새 하이라이트에 적용`} disabled={colorLoading} style={{ background: item.css }} onClick={() => void changeColor(item.value)} />)}
        </div>}
        {pdf && view === 'reader' && <div className="zoom-controls" aria-label="PDF 확대 및 축소" onMouseDown={event => event.preventDefault()}>
          <button aria-label="축소" disabled={scale <= .1} onClick={() => zoom.step(-1)}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button aria-label="확대" disabled={scale >= 4} onClick={() => zoom.step(1)}>+</button>
          <button className="fit-width" aria-label="페이지 너비 맞춤" aria-pressed={zoom.fitting} onClick={zoom.fitWidth}>너비 맞춤</button>
        </div>}
        {pdf && view === 'reader' && <button className="find-toggle" aria-label="본문 내 찾기" title="본문 내 찾기 (Ctrl+F)" onClick={search.reveal}>⌕</button>}
        {pdf && view === 'reader' && <button className="body-translation-toggle" aria-pressed={translation.open}
          onClick={translation.toggle}>본문 번역</button>}
        {pdf && view === 'reader' && <button aria-pressed={chatOpen} onClick={() => { setChatMountedFor(paper?.id); setChatOpen(v => !v); }}>논문 채팅</button>}
        <button className="open-button" onClick={() => void (view === 'library' ? importToLibrary() : handleOpen())} disabled={opening || libraryBusy}>
          {opening ? '처리 중…' : view === 'library' ? 'PDF 추가' : 'PDF 열기'}</button>
        <AiConnection revision={usageRevision} />
      </div>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="오류 메시지 닫기" onClick={() => setError('')}>×</button></div>}
    <div className="workspace" inert={historyBusy}>
    {pdf && view === 'reader' && search.open && <PdfFindBar search={search} />}
    {pdf && translation.open && view === 'reader' && <TranslationNavigation translation={translation} pageCount={pdf.numPages} zoom={translationZoom} />}
    <div className="reader-layout" ref={readerLayoutRef}>
    <main ref={scrollRef} style={{ '--translation-width': `${translationWidth.width}px`, '--translation-font-size': `${15 * translationZoom.scale}px` } as CSSProperties} className={`reader ${translation.open ? 'reader-with-translation' : ''} ${pdf ? 'has-pdf' : ''} ${view !== 'reader' ? 'reader-inactive' : ''}`}
      tabIndex={-1} inert={view !== 'reader'} aria-hidden={view !== 'reader'}>
      {pdf ? <PdfPages key={pdf.loadingTask.docId} pdf={pdf} scale={zoom.renderScale} renderRevision={zoom.renderRevision} displayScale={zoom.scaleRef} highlights={highlights}
        translationMark={translation.mark} translation={translation} translationWidth={translationWidth} searchMatches={search.byPage} selectedSearchId={search.selected}
        onSelect={handleSelect} onRendered={onPageRendered} onHighlight={handleHighlight} /> : <div className="empty-state">
        <div className="empty-icon"><PaperIcon large /></div>
        <p className="eyebrow">읽기의 흐름을 이어가세요</p>
        <h1>논문 속 낯선 단어를,<br />이해로 바꾸는 순간.</h1>
        <p className="empty-description">PDF를 열고 단어를 더블클릭하거나 텍스트를 드래그하세요.<br />번역한 단어와 문장이 단어장에 자동으로 저장됩니다.</p>
        <button className="primary-button" disabled={opening} onClick={() => void handleOpen()}>
          {opening ? 'PDF를 여는 중…' : 'PDF 파일 열기'}<span aria-hidden="true">↗</span>
        </button>
        <div className="drop-zone">또는 이 창에 PDF 파일을 끌어다 놓으세요</div>
        <p className="local-note"><span />PDF와 단어 기록은 이 기기에 보관됩니다.</p>
      </div>}
    </main>
    {pdf && paper && (chatOpen || chatMountedFor === paper.id) && <div className="chat-container" ref={chatRef}
      style={{ '--chat-width': `${chatWidth.width}px`, '--chat-font-size': `${13 * chatZoom.scale}px` } as CSSProperties}
      hidden={!chatOpen || view !== 'reader'} inert={!chatOpen || view !== 'reader'} aria-hidden={!chatOpen || view !== 'reader'}>
      <ChatResizer sizing={chatWidth} />
      <PaperChat key={paper.id} paper={paper} pdf={pdf} zoom={chatZoom} selectionRequest={chatSelection?.paperId === paper.id ? chatSelection : null}
        onSelectionConsumed={consumeChatSelection} currentPage={() => {
        const host = scrollRef.current;
        const y = (host?.getBoundingClientRect().top ?? 0) + (host?.clientHeight ?? 0) * .3;
        return Number([...host?.querySelectorAll<HTMLElement>('.pdf-page') ?? []].find(p => p.getBoundingClientRect().bottom >= y)?.dataset.pageNumber ?? 1);
      }} onPage={translation.goTo} onClose={() => setChatOpen(false)} />
    </div>}
    </div>
    <Vocabulary active={view === 'vocabulary'} revision={usageRevision} onDelete={handleDeleteVocabulary} />
    <Library active={view === 'library'} revision={libraryRevision} folderId={libraryFolderId} onFolderChange={setLibraryFolderId}
      onFoldersChange={navigation.syncFolders}
      opening={opening} importMessage={libraryMessage} onOpen={openLibraryPaper} onRenamed={handleRenamedPaper}
      onDeleted={handleDeletedPapers} onBusyChange={setLibraryBusy} />
    </div>
    {drag && <div className={`drop-overlay ${drag}`} role="status">
      <PaperIcon large /><strong>{drag === 'valid' ? view === 'library' ? '현재 폴더에 PDF 추가' : 'PDF를 놓아 열기' : 'PDF 파일을 놓아 주세요'}</strong>
    </div>}
    <footer className="statusbar"><span role="status">{historyBusy ? '실행 취소/다시 실행 중…' : historyMessage || (view === 'library' ? 'Library' : view === 'vocabulary' ? 'Vocabulary' : pdf ? '단어 더블클릭 또는 텍스트 드래그 → 번역 · 설명 · AI질문' : 'PDF Reader')}</span>
      <span>{pdf && view === 'reader' ? `${pdf.numPages} 페이지` : '로컬 보관'}</span></footer>
    {pdf && bubbles.filter(bubble => bubble.paperId === paper?.id).map(bubble => <WordBubble pdf={pdf} key={bubble.id} bubble={bubble} reader={scrollRef}
      front={frontBubbleId === bubble.id} onAction={action => void handleAction(bubble.id, action)} onClose={() => closeBubble(bubble.id)}
      onAskAI={() => askAboutSelection(bubble)}
      onPlace={placement => updateBubble(bubble.id, current => ({ ...current, placement }))}
      onActivate={() => activateBubble(bubble)} onDeactivate={() => { if (readerKeyTarget.current?.id === bubble.id && readerKeyTarget.current.kind === 'bubble') readerKeyTarget.current = null; }}
      onRemove={removableIds(bubble).length ? () => void cancelHighlights(bubble.id) : undefined} removing={removing} />)}
  </div>;
}
