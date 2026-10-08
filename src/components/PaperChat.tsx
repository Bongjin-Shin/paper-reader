import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ChatEdit, ChatExchange, Paper } from '../types';
import { askPaper, getChatProvider, setChatProvider, errorMessage, getPaperChat, steerPaperChat, stopPaperChat, selectChatBranch } from '../lib/backend';
import { paperContext, readPaperText } from '../lib/paperContext';
import { ClaudeConnection } from './ClaudeConnection';
import { ModelPicker } from './ModelPicker';
import { ChatAnswer } from './ChatAnswer';
import { SubscriptionQuota } from './SubscriptionQuota';
import { ChatIcon } from './ChatIcons';
import { ChatQuestion } from './ChatQuestion';

export function PaperChat({ paper, pdf, currentPage, onPage, onClose }: {
  paper: Paper; pdf: PDFDocumentProxy; currentPage: () => number; onPage: (number: number) => void; onClose: () => void;
}) {
  const [provider, setProvider] = useState<'chatgpt' | 'claude'>('chatgpt'), [providerBusy, setProviderBusy] = useState(true);
  useEffect(() => { let live = true; void getChatProvider().then(value => { if (live) setProvider(value); }).catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { if (live) setProviderBusy(false); }); return () => { live = false; }; }, []);
  const [messages, setMessages] = useState<ChatExchange[]>([]), [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(true), [phase, setPhase] = useState(''), [error, setError] = useState('');
  const [pending, setPending] = useState({ question: '', answer: '', followups: [] as string[] });
  const [editing, setEditing] = useState<(ChatEdit & { text: string }) | null>(null), [editPending, setEditPending] = useState<ChatEdit | null>(null);
  const [ready, setReady] = useState(false), [controlling, setControlling] = useState(false), [stopping, setStopping] = useState(false);
  const [queue, setQueue] = useState<string[]>([]), queueRef = useRef<string[]>([]);
  const [settings, setSettings] = useState(true), [revision, reload] = useState(0), [usageRevision, refreshUsage] = useState(0);
  const active = useRef(''), alive = useRef(true), controlLock = useRef(false), list = useRef<HTMLDivElement>(null), follow = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    void getPaperChat(paper.id).then(rows => { if (live) setMessages(rows); })
      .catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [paper.id, revision]);
  useEffect(() => { if (list.current && follow.current) list.current.scrollTop = list.current.scrollHeight; }, [messages, phase, pending]);
  const updateQueue = (values: string[]) => { queueRef.current = values; setQueue(values); };
  const run = async (value: string, edit?: ChatEdit) => {
    if (active.current || !alive.current) return;
    const id = crypto.randomUUID(); active.current = id; follow.current = true;
    if (!edit) setQuestion(draft => draft.trim() === value ? '' : draft);
    const original = edit ? messages.find(row => row.id === edit.exchangeId) : undefined;
    const firstQuestion = original && edit?.followupIndex != null ? original.question : value;
    const initialFollowups = original && edit?.followupIndex != null ? [...original.followups.slice(0, edit.followupIndex), value] : [];
    setEditPending(edit ?? null);
    setPending({ question: firstQuestion, answer: '', followups: initialFollowups }); setReady(false); setStopping(false);
    setPhase('논문 본문을 읽는 중…'); setError('');
    const page = currentPage(); let completed = false;
    try {
      const pages = await readPaperText(pdf);
      if (!alive.current) return;
      const context = paperContext(pages, [firstQuestion, ...initialFollowups].join('\n'), page);
      setPhase('모델 응답을 기다리는 중…');
      const answer = await askPaper({ paperId: paper.id, question: value, context, currentPage: page, totalPages: pdf.numPages }, id, event => {
        if (!alive.current || active.current !== id) return;
        if (event.type === 'ready') { setReady(true); setPhase('답변을 준비하는 중…'); }
        if (event.type === 'thinking') setPhase('생각하는 중…');
        if (event.type === 'answer') { setPending(p => ({ ...p, answer: event.text })); setPhase('답변을 작성하는 중…'); }
        if (event.type === 'accepted') setPending(p => ({ ...p, followups: [...p.followups, event.question] }));
      }, edit);
      if (alive.current) {
        setMessages(rows => [...(edit ? rows.slice(0, rows.findIndex(row => row.id === edit.exchangeId)) : rows), answer]);
        setEditing(null); setPending({ question: '', answer: '', followups: [] });
        completed = !answer.interrupted;
      }
    } catch (e) {
      if (alive.current) { setError(errorMessage(e)); if (edit) setPending({ question: '', answer: '', followups: [] }); else setQuestion(draft => draft || value); }
    } finally {
      active.current = '';
      if (alive.current) {
        setPhase(''); setReady(false); setStopping(false); setEditPending(null); refreshUsage(n => n + 1);
        if (completed && queueRef.current.length) {
          const [next, ...rest] = queueRef.current; updateQueue(rest); void run(next);
        }
      }
    }
  };
  const send = async () => {
    const value = question.trim();
    if (!value || loading || providerBusy || controlLock.current || (editing && !active.current)) return;
    if (!active.current) { void run(value); return; }
    if (!ready || stopping) { updateQueue([...queueRef.current, value]); setQuestion(''); return; }
    controlLock.current = true; setControlling(true); setError(''); const id = active.current;
    try { await steerPaperChat(id, value); if (alive.current) setQuestion(draft => draft.trim() === value ? '' : draft); }
    catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { controlLock.current = false; if (alive.current) setControlling(false); }
  };
  const stop = async () => {
    if (!active.current || controlLock.current) return;
    controlLock.current = true; setControlling(true); setStopping(true);
    try { await stopPaperChat(active.current); }
    catch (e) { if (alive.current) { setError(errorMessage(e)); setStopping(false); } }
    finally { controlLock.current = false; if (alive.current) setControlling(false); }
  };
  const switchBranch = async (id: number) => {
    if (active.current || loading || editing) return;
    active.current = 'branch-switch'; setLoading(true); setError(''); follow.current = false;
    try { const rows = await selectChatBranch(paper.id, id); if (alive.current) { setMessages(rows); setPending({ question: '', answer: '', followups: [] }); } }
    catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { active.current = ''; if (alive.current) setLoading(false); }
  };
  const editQuestion = (message: ChatExchange, followupIndex: number | null) => {
    if (active.current || loading) return;
    follow.current = false; setError('');
    setEditing({ exchangeId: message.id, followupIndex, text: followupIndex === null ? message.question : message.followups[followupIndex] });
  };
  const renderQuestion = (message: ChatExchange, followupIndex: number | null) => {
    const selected = editing?.exchangeId === message.id && editing.followupIndex === followupIndex;
    return <ChatQuestion key={followupIndex ?? 'main'} text={followupIndex === null ? message.question : message.followups[followupIndex]} additional={followupIndex !== null}
      disabled={loading || !!phase || (!!editing && !selected)} editing={!!selected} draft={selected ? editing.text : ''}
      onDraft={text => setEditing(old => old ? { ...old, text } : null)} onEdit={() => editQuestion(message, followupIndex)} onCancel={() => setEditing(null)}
      onSave={() => { if (editing) void run(editing.text.trim(), { exchangeId: editing.exchangeId, followupIndex: editing.followupIndex }); }} />;
  };
  const visibleMessages = editPending ? messages.slice(0, messages.findIndex(row => row.id === editPending.exchangeId)) : messages;
  const showStop = !!phase && (!question.trim() || stopping);
  const sendLabel = phase ? ready && !stopping ? '추가 질문 보내기' : '질문 예약' : '질문 보내기';
  const actionLabel = showStop ? '답변 중단' : sendLabel;
  const actionDisabled = loading || providerBusy || controlling || (showStop ? !ready || stopping : (!!editing && !phase) || !question.trim());
  return <aside className="paper-chat" aria-label="논문 채팅">
    <header><div><strong>논문 채팅</strong><small title={paper.title}>{paper.title}</small></div><button aria-label="논문 채팅 닫기" onClick={onClose}>×</button></header>
    <div className="chat-settings">
      <button aria-expanded={settings} onClick={() => setSettings(v => !v)}>{provider === 'claude' ? 'Claude' : 'ChatGPT'} 구독 · 모델 / effort {settings ? '▴' : '▾'}</button>
      {settings && <>
        <label>채팅 연결<select aria-label="채팅 연결" value={provider} disabled={!!phase || providerBusy} onChange={async e => {
          const next = e.target.value as 'chatgpt' | 'claude'; setProviderBusy(true); setError('');
          try { await setChatProvider(next); setProvider(next); } catch (e) { setError(errorMessage(e)); } finally { setProviderBusy(false); }
        }}><option value="chatgpt">ChatGPT 구독</option><option value="claude">Claude 구독</option></select></label>
        {provider === 'claude' && <ClaudeConnection disabled={!!phase} />}
        <ModelPicker key={provider} scope="chat" provider={provider} disabled={!!phase || providerBusy} />
        <p>{provider === 'claude' ? '번역과 별도로 설정합니다. 답변 중 보낸 추가 질문은 순서대로 처리합니다.' : '번역 모델과 별도로 설정합니다. 번역 연결에서 ChatGPT에 로그인해 주세요.'}</p>
      </>}
    </div>
    <div className="chat-messages" ref={list} aria-label="대화 기록" onScroll={() => {
      const el = list.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
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
    {error && <div role="alert" className="chat-error">{error}<button disabled={!!phase} onClick={() => { setPending({ question: '', answer: '', followups: [] }); setEditing(null); reload(n => n + 1); }}>대화 다시 불러오기</button></div>}
    {queue.length > 0 && <div className="chat-queue" aria-label="예약된 질문">{queue.map((q, i) => <div key={i}><span>다음 질문: {q}</span><button type="button" aria-label={`예약 질문 ${i + 1} 삭제`} onClick={() => updateQueue(queueRef.current.filter((_, n) => n !== i))}>×</button></div>)}
      {!phase && <button disabled={loading || !!editing} onClick={() => { const [next, ...rest] = queueRef.current; updateQueue(rest); void run(next); }}>예약 질문 보내기</button>}
    </div>}
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
      <textarea aria-label="논문 질문" placeholder={phase ? '답변 중에도 추가 질문을 입력할 수 있어요…' : '이 논문에 대해 질문하세요…'} value={question} maxLength={8000} disabled={loading || (!!editing && !phase)}
        onChange={e => setQuestion(e.target.value)} onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); }
        }} />
      <div className="chat-actions">
        <button type={showStop ? 'button' : 'submit'} className="chat-icon-button" aria-label={actionLabel} title={actionLabel}
          disabled={actionDisabled} onClick={showStop ? () => void stop() : undefined}><ChatIcon name={showStop ? 'stop' : 'send'} /></button>
      </div>
      <SubscriptionQuota key={provider} provider={provider} revision={usageRevision} />
    </form>
  </aside>;
}
