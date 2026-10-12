import type { PDFDocumentProxy } from 'pdfjs-dist';
import { BubbleConnector } from './BubbleConnector';
import { useBubblePosition, type BubblePlacement } from '../lib/useBubblePosition';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ActionType, WordSelection } from '../types';

export interface BubbleState {
  id: number;
  paperId: string;
  placement?: BubblePlacement;
  selection: WordSelection;
  status: 'actions' | 'loading' | 'result' | 'error';
  action?: ActionType;
  text?: string;
  savedHighlightId?: number;
  savedResults?: { translation: string | null; explanation: string | null };
}

export function WordBubble({ pdf, bubble, reader, onAction, onAskAI, onRemove, removing, onClose, onActivate, onDeactivate, onPlace, front }: { pdf: PDFDocumentProxy; bubble: BubbleState; reader: RefObject<HTMLElement | null>; onAction: (action: ActionType) => void; onAskAI: () => void;
  front: boolean; onPlace: (placement: BubblePlacement) => void; onRemove?: () => void; removing?: boolean; onClose: () => void; onActivate: () => void; onDeactivate: () => void }) {
  const drag = useBubblePosition(bubble, onRemove !== undefined, reader, onPlace);

  const removeButton = onRemove && <button className="remove-highlight" disabled={removing || bubble.status === 'loading'} onClick={onRemove}>
    {removing ? '취소 중…' : '하이라이트 취소'}</button>;

  const surface = <div className="reader-bubble-layer" style={{ zIndex: front ? 21 : 20 }}><div ref={drag.ref} className={`word-bubble ${bubble.status === 'actions' ? 'action-bubble' : ''}`}
    data-bubble-id={bubble.id} style={drag.position} role="dialog" tabIndex={0} aria-label={bubble.selection.isSingleWord ? `${bubble.selection.word} 단어 도구` : '선택 텍스트 도구'}
    onFocusCapture={onActivate} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDeactivate(); }}
    onPointerDown={event => { event.stopPropagation(); if (event.button === 0) { event.currentTarget.focus({ preventScroll: true }); onActivate(); drag.begin(event); } }}
    onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.cancel} onLostPointerCapture={drag.cancel}
    onMouseDown={event => { if (event.button === 0) event.preventDefault(); }}>
    {bubble.status === 'actions' ? <>
      <button onClick={() => onAction('translation')}>번역</button>
      <span className="bubble-divider" />
      <button onClick={() => onAction('explanation')}>설명</button>
      <span className="bubble-divider" />
      <button onClick={onAskAI}>AI질문</button>
      {removeButton}
    </> : <div className={`result-content ${bubble.selection.isSingleWord ? '' : 'phrase-result'}`}>
      <strong lang="en">{bubble.selection.word}</strong>
      <div aria-live="polite" role={bubble.status === 'error' ? 'alert' : 'status'}>
        {bubble.status === 'loading' ? <p className="loading-result"><span className="spinner" />{bubble.savedHighlightId !== undefined ? '저장된 결과를 불러오는 중…' : `${bubble.action === 'translation' ? '번역' : '설명'}하는 중…`}</p>
          : <p className={bubble.status === 'error' ? 'bubble-error' : ''}>{bubble.text}</p>}
      </div>
      {bubble.status === 'error' && <button className="retry-button" onClick={() => onAction(bubble.action ?? 'translation')}>다시 시도</button>}
      {bubble.status === 'result' && bubble.savedResults && <div className="saved-actions">
        {bubble.action !== 'translation' && bubble.savedResults.translation && <button onClick={() => onAction('translation')}>뜻 보기</button>}
        {bubble.action !== 'explanation' && bubble.savedResults.explanation && <button onClick={() => onAction('explanation')}>설명 보기</button>}
      </div>}
      {removeButton}
    </div>}
    <button className="bubble-close" aria-label="말풍선 닫기" title="말풍선 닫기 (말풍선 클릭 후 Esc 또는 Delete)" onClick={onClose}>×</button>
  </div>{front && <BubbleConnector pdf={pdf} selection={bubble.selection} bubble={drag.ref} reader={reader} />}</div>;
  const pages=reader.current?.querySelector('.pages');
  return pages ? createPortal(surface,pages) : null;
}
