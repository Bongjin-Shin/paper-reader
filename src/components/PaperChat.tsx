import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ChatExchange, ChatSelection, Paper } from '../types';
import { getChatProvider, setChatProvider, errorMessage } from '../lib/backend';
import { getPaperChatSession } from '../lib/paperChatSession';
import { ClaudeConnection } from './ClaudeConnection';
import { ModelPicker } from './ModelPicker';
import { UpwardSelect } from './UpwardSelect';
import { ChatAnswer } from './ChatAnswer';
import { SubscriptionQuota } from './SubscriptionQuota';
import { ChatIcon } from './ChatIcons';
import { ChatQuestion } from './ChatQuestion';
import { TextZoomControls } from './TextZoomControls';
import type { TextZoom } from '../lib/useTextZoom';
import { useAutoSizeTextarea } from '../lib/useAutoSizeTextarea';
import { useTextUndo } from '../lib/useTextUndo';

export function PaperChat({ paper, pdf, currentPage, onPage, onClose, selectionRequest, onSelectionConsumed, zoom }: {
  paper: Paper; pdf: PDFDocumentProxy; currentPage: () => number; onPage: (number: number) => void; onClose: () => void;
  zoom: TextZoom;
  selectionRequest: ChatSelection | null; onSelectionConsumed: () => void;
}) {
  const session = useMemo(() => getPaperChatSession(paper.id), [paper.id]);
  const { messages, question, selection, loading, phase, error, contextNotice, pending, editing, editPending,
    ready, controlling, stopping, queue, sendingQueued, usageRevision } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { setQuestion, setSelection, setEditing, setError, switchBranch, editQuestion, stop } = session;
  const [provider, setProvider] = useState<'chatgpt' | 'claude'>('chatgpt'), [providerBusy, setProviderBusy] = useState(true);
  const [settings, setSettings] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null), list = useRef<HTMLDivElement>(null);
  const textUndo = useTextUndo(input, question, setQuestion, session.questionHistory);
  useAutoSizeTextarea(input, question, zoom.scale);
  useEffect(() => { let live = true; void getChatProvider().then(value => { if (live) setProvider(value); }).catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { if (live) setProviderBusy(false); }); return () => { live = false; }; }, [setError]);
  useEffect(() => { void session.load(); }, [session]);
  useEffect(() => {
    if (!selectionRequest || selectionRequest.paperId !== paper.id) return;
    setSelection(selectionRequest); onSelectionConsumed();
  }, [selectionRequest, paper.id, onSelectionConsumed, setSelection]);
  useEffect(() => {
    if (!selection || loading || editing) return;
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [selection, loading, editing]);
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = session.scrollTop; }, [session]);
  useEffect(() => { if (list.current && session.follow) list.current.scrollTop = list.current.scrollHeight; }, [session, messages, phase, pending]);
  const send = () => { if (!providerBusy) session.send(currentPage()); };
  const sendQueuedNow = (id: string) => { if (!providerBusy) void session.sendQueuedNow(id); };
  const renderQuestion = (message: ChatExchange, followupIndex: number | null) => {
    const selected = editing?.exchangeId === message.id && editing.followupIndex === followupIndex;
    return <ChatQuestion key={followupIndex ?? 'main'} text={followupIndex === null ? message.question : message.followups[followupIndex]} additional={followupIndex !== null}
      disabled={loading || !!phase || (!!editing && !selected)} editing={!!selected} draft={selected ? editing.text : ''}
      onDraft={text => setEditing(editing ? { ...editing, text } : null)} onEdit={() => editQuestion(message, followupIndex)} onCancel={() => setEditing(null)}
      onSave={() => session.saveEdit(currentPage())} />;
  };
  const visibleMessages = editPending ? messages.slice(0, messages.findIndex(row => row.id === editPending.exchangeId)) : messages;
  const showStop = !!phase && (!question.trim() || stopping);
  const sendLabel = phase ? '추가 질문 보내기' : '질문 보내기';
  const actionLabel = showStop ? '답변 중단' : sendLabel;
  const actionDisabled = loading || providerBusy || (showStop ? controlling || !ready || stopping : (!!editing && !phase) || !question.trim());
  return <aside className="paper-chat" aria-label="논문 채팅">
    <header><div><strong>논문 채팅</strong><small title={paper.title}>{paper.title}</small></div><button aria-label="논문 채팅 닫기" onClick={onClose}>×</button></header>
    <div className="chat-zoom-toolbar"><TextZoomControls zoom={zoom} label="채팅" /></div>
    <div className="chat-messages" ref={list} aria-label="대화 기록" onScroll={() => {
      const el = list.current; if (el && el.clientHeight > 0) { session.scrollTop = el.scrollTop; session.follow = el.scrollHeight - el.scrollTop - el.clientHeight < 70; }
    }}>
      {loading && <p role="status">대화를 불러오는 중…</p>}
      {!loading && !messages.length && !phase && !pending.question && <div className="chat-empty"><strong>논문을 읽다 궁금한 점이 있나요?</strong><p>개념, 수식의 의미, 실험 결과를 물어보세요.<br />답변의 페이지 번호를 누르면 원문으로 이동합니다.</p></div>}
      {visibleMessages.map(message => {
        const versions = message.variants ?? [message.id], version = versions.indexOf(message.id);
        return <article key={message.id} className="chat-exchange">
          {renderQuestion(message, null)}
          {(message.followups ?? []).map((_, i) => renderQuestion(message, i))}
          {versions.length > 1 && <nav className="chat-versions" aria-label="질문 버전">
            <button title="이전 질문 버전" aria-label="이전 질문 버전" disabled={loading || !!phase || !!editing || version <= 0} onClick={() => void switchBranch(versions[version - 1])}><ChatIcon name="previous" /></button>
            <span>{version + 1} / {versions.length}</span>
            <button title="다음 질문 버전" aria-label="다음 질문 버전" disabled={loading || !!phase || !!editing || version >= versions.length - 1} onClick={() => void switchBranch(versions[version + 1])}><ChatIcon name="next" /></button>
          </nav>}
          <ChatAnswer text={message.answer} onPage={onPage} total={pdf.numPages} /><small>{message.model} · {message.effort || '기본 effort'}{message.interrupted ? ' · 답변 중단됨' : ''}</small>
        </article>;
      })}
      {pending.question && <article className="chat-exchange"><p className="chat-question">{pending.question}</p>
        {pending.followups.map((q, i) => <p key={i} className="chat-question"><small>추가 질문</small>{q}</p>)}
        {pending.answer && <ChatAnswer text={pending.answer} onPage={onPage} total={pdf.numPages} />}
        {phase && <p role="status" className="chat-phase"><span className="spinner" />{stopping ? '답변을 중단하는 중…' : phase}</p>}
        {!phase && error && pending.answer && <small>연결이 끊겨 일부만 표시된 답변입니다.</small>}
      </article>}
    </div>
    {contextNotice && <p className="chat-context-notice" role="status">{contextNotice}</p>}
    {error && <div role="alert" className="chat-error">{error}<button disabled={!!phase} onClick={() => void session.load(true)}>대화 다시 불러오기</button></div>}
    {queue.length > 0 && <div className="chat-queue" aria-label="대기 중인 질문">{queue.map((q, i) => <div key={q.id}>
      <span title={q.text}>대기: {q.text}</span>
      <button type="button" className="chat-send-now" aria-label={`대기 질문 ${i + 1} 바로 보내기`}
        title={phase ? provider === 'claude' ? '현재 대화에 전달합니다. Claude는 현재 응답을 마친 뒤 반영합니다.' : '진행 중인 답변에 추가 질문이나 정정을 지금 반영합니다.' : '이 질문을 보냅니다.'}
        disabled={loading || providerBusy || !!editing || controlling || stopping || (!!phase && !ready)}
        onClick={() => void sendQueuedNow(q.id)}>{sendingQueued === q.id ? '전송 중…' : '바로 보내기'}</button>
      <button type="button" aria-label={`대기 질문 ${i + 1} 삭제`} disabled={sendingQueued === q.id}
        onClick={() => session.removeQueued(q.id)}>×</button>
    </div>)}</div>}
    {provider === 'claude' && <details className="chat-connection-settings" open={settings} onToggle={event => setSettings(event.currentTarget.open)}>
      <summary>Claude 연결 설정</summary><ClaudeConnection disabled={!!phase} />
    </details>}
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
      {selection && <section className="chat-selection" aria-label="AI 질문에 첨부한 원문">
        <header><button type="button" className="chat-selection-source" onClick={() => onPage(selection.pages[0])}>선택한 원문 · {selection.pages.join(', ')}페이지</button>
          <button type="button" className="chat-selection-remove" aria-label="선택한 원문 첨부 해제" onClick={() => setSelection(null)}>×</button></header>
        <blockquote>{selection.text}</blockquote>
      </section>}
      <textarea ref={input} aria-label="논문 질문" placeholder={selection ? '선택한 부분에 대해 질문하세요…' : phase ? '답변 중에도 추가 질문을 입력할 수 있어요…' : '이 논문에 대해 질문하세요…'} value={question} maxLength={8000} disabled={loading || (!!editing && !phase)}
        {...textUndo} onKeyDown={e => {
          if (textUndo.onKeyDown(e)) return;
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); }
        }} />
      <div className="chat-actions">
        <div className="chat-model-controls" aria-label="채팅 모델 설정">
          <label className="chat-provider"><span>채팅 연결</span><UpwardSelect label="채팅 연결" value={provider} disabled={!!phase || providerBusy}
            options={[{ value: 'chatgpt', label: 'ChatGPT' }, { value: 'claude', label: 'Claude' }]} onChange={async value => {
            const next = value as 'chatgpt' | 'claude'; setProviderBusy(true); setError('');
            try { await setChatProvider(next); setProvider(next); } catch (e) { setError(errorMessage(e)); } finally { setProviderBusy(false); }
          }} /></label>
          <ModelPicker key={provider} scope="chat" provider={provider} disabled={!!phase || providerBusy} compact />
        </div>
        <button type={showStop ? 'button' : 'submit'} className="chat-icon-button" aria-label={actionLabel} title={!showStop && phase ? '현재 답변이 끝나면 차례로 보냅니다.' : actionLabel}
          disabled={actionDisabled} onClick={showStop ? () => void stop() : undefined}><ChatIcon name={showStop ? 'stop' : 'send'} /></button>
      </div>
      <SubscriptionQuota key={provider} provider={provider} revision={usageRevision} />
    </form>
  </aside>;
}
