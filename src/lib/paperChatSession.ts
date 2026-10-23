import type { ChatEdit, ChatExchange, ChatSelection } from '../types';
import { askPaper, errorMessage, getPaperChat, readPdf, selectChatBranch, steerPaperChat, stopPaperChat } from './backend';
import { loadPdf } from './pdf';
import { paperContext, readPaperText, type PaperPageText } from './paperContext';
import { TextEditHistory } from './textEditHistory';

type QueuedQuestion = { id: string; text: string; pageNumber: number };
type Editing = ChatEdit & { text: string };
interface ChatState {
  messages: ChatExchange[]; question: string; selection: ChatSelection | null;
  loading: boolean; phase: string; error: string; contextNotice: string;
  pending: { question: string; answer: string; followups: string[] };
  editing: Editing | null; editPending: ChatEdit | null;
  ready: boolean; controlling: boolean; stopping: boolean;
  queue: QueuedQuestion[]; sendingQueued: string | null; usageRevision: number;
}
const emptyPending = () => ({ question: '', answer: '', followups: [] as string[] });

/** Own requests independently of mounted panels. Navigating never cancels a conversation. */
export class PaperChatSession {
  readonly questionHistory = new TextEditHistory();
  private state: ChatState = { messages: [], question: '', selection: null, loading: true, phase: '', error: '', contextNotice: '',
    pending: emptyPending(), editing: null, editPending: null, ready: false, controlling: false, stopping: false,
    queue: [], sendingQueued: null, usageRevision: 0 };
  private listeners = new Set<() => void>();
  private active = '';
  private controlLock = false;
  private queuePaused = false;
  private disposed = false;
  private loaded = false;
  private loadTask?: Promise<void>;
  private pagesTask?: Promise<PaperPageText[]>;
  follow = true;
  scrollTop = 0;
  constructor(readonly paperId: string) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(values: Partial<ChatState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...values }; this.listeners.forEach(listener => listener());
  }
  setQuestion = (question: string) => this.patch({ question });
  setSelection = (selection: ChatSelection | null) => this.patch({ selection });
  setEditing = (editing: Editing | null) => this.patch({ editing });
  setError = (error: string) => this.patch({ error });
  removeQueued = (id: string) => {
    if (id !== this.state.sendingQueued) this.patch({ queue: this.state.queue.filter(q => q.id !== id) });
  };
  load = (force = false): Promise<void> => {
    if (this.loadTask) return this.loadTask;
    if (this.disposed || this.active || (this.loaded && !force)) return Promise.resolve();
    this.patch({ loading: true, ...(force ? { pending: emptyPending(), editing: null, error: '' } : {}) });
    this.loadTask = getPaperChat(this.paperId).then(messages => {
      this.loaded = true; this.patch({ messages });
    }).catch(error => this.patch({ error: errorMessage(error) })).finally(() => {
      this.loadTask = undefined; this.patch({ loading: false });
    });
    return this.loadTask;
  };
  private pages() {
    if (!this.pagesTask) {
      // A separate loading task survives disposal of the Reader's PDF when another paper opens.
      this.pagesTask = (async () => {
        const task = loadPdf(await readPdf(this.paperId));
        try { return await readPaperText(await task.promise); }
        finally { await task.destroy(); }
      })();
      void this.pagesTask.catch(() => { this.pagesTask = undefined; });
    }
    return this.pagesTask;
  }
  private drainQueue() {
    if (this.disposed || this.active || this.controlLock || this.queuePaused) return;
    const [next, ...rest] = this.state.queue;
    if (next) { this.patch({ queue: rest }); void this.run(next.text, next.pageNumber, undefined, next); }
  }
  private async run(value: string, page: number, edit?: ChatEdit, queued?: QueuedQuestion): Promise<void> {
    if (this.active || this.disposed) return;
    this.queuePaused = false; this.follow = true;
    const id = crypto.randomUUID(); this.active = id;
    const original = edit ? this.state.messages.find(row => row.id === edit.exchangeId) : undefined;
    const firstQuestion = original && edit?.followupIndex != null ? original.question : value;
    const followups = original && edit?.followupIndex != null ? [...original.followups.slice(0, edit.followupIndex), value] : [];
    this.patch({ editPending: edit ?? null, pending: { question: firstQuestion, answer: '', followups },
      ready: false, stopping: false, phase: '논문 본문을 읽는 중…', error: '', contextNotice: '' });
    let completed = false;
    try {
      const pages = await this.pages();
      if (this.disposed) return;
      const context = paperContext(pages, [firstQuestion, ...followups].join('\n'), page);
      this.patch({ phase: '모델 응답을 기다리는 중…' });
      const answer = await askPaper({ paperId: this.paperId, question: value, context, currentPage: page, totalPages: pages.length }, id, event => {
        if (this.disposed || this.active !== id) return;
        if (event.type === 'ready') this.patch({ ready: true, phase: '답변을 준비하는 중…' });
        if (event.type === 'thinking') this.patch({ phase: '생각하는 중…' });
        if (event.type === 'answer') this.patch({ pending: { ...this.state.pending, answer: event.text }, phase: '답변을 작성하는 중…' });
        if (event.type === 'accepted') this.patch({ pending: { ...this.state.pending, followups: [...this.state.pending.followups, event.question] } });
        if (event.type === 'context') this.patch({ contextNotice: event.message, ...(!this.state.ready ? { phase: event.message } : {}) });
      }, edit);
      if (this.disposed) return;
      this.patch({ messages: [...(edit ? this.state.messages.slice(0, this.state.messages.findIndex(row => row.id === edit.exchangeId)) : this.state.messages), answer],
        editing: null, pending: emptyPending() });
      completed = !answer.interrupted;
    } catch (error) {
      this.patch({ error: errorMessage(error), ...(edit ? { pending: emptyPending() }
        : queued ? { queue: [queued, ...this.state.queue] } : { question: this.state.question || value }) });
    } finally {
      this.active = '';
      this.patch({ phase: '', ready: false, stopping: false, editPending: null, usageRevision: this.state.usageRevision + 1 });
      if (!completed) this.queuePaused = true;
      this.drainQueue();
    }
  }
  send = (page: number) => {
    const { question, selection, loading, editing } = this.state, draft = question.trim();
    if (!draft || loading || (editing && !this.active)) return;
    const value = selection ? `선택한 원문 (PDF ${selection.pages.join(', ')}페이지):\n${selection.text}\n\n질문: ${draft}` : draft;
    if (Array.from(value).length > 8000) { this.setError('선택한 원문과 질문을 합쳐 8,000자 이내로 입력해 주세요. 원문을 더 짧게 선택하거나 첨부를 해제할 수 있습니다.'); return; }
    this.patch({ question: '', selection: null });
    const sourcePage = selection?.pages[0] ?? page;
    if (!this.active && !this.controlLock) { void this.run(value, sourcePage); return; }
    this.patch({ queue: [...this.state.queue, { id: crypto.randomUUID(), text: value, pageNumber: sourcePage }] });
  };
  sendQueuedNow = async (queuedId: string) => {
    const { loading, editing, stopping, ready } = this.state;
    if (loading || editing || this.controlLock || stopping || (this.active && !ready)) return;
    const queued = this.state.queue.find(item => item.id === queuedId);
    if (!queued) return;
    if (!this.active) {
      this.removeQueued(queuedId); void this.run(queued.text, queued.pageNumber, undefined, queued); return;
    }
    this.controlLock = true; this.patch({ controlling: true, sendingQueued: queuedId, error: '' });
    const id = this.active;
    try {
      await steerPaperChat(id, queued.text);
      this.patch({ queue: this.state.queue.filter(item => item.id !== queuedId) });
      if (this.active === id) this.queuePaused = false;
    } catch (error) { this.queuePaused = true; this.setError(errorMessage(error)); }
    finally { this.controlLock = false; this.patch({ controlling: false, sendingQueued: null }); this.drainQueue(); }
  };
  stop = async () => {
    if (!this.active || this.controlLock) return;
    this.controlLock = true; this.patch({ controlling: true, stopping: true });
    try { await stopPaperChat(this.active); }
    catch (error) { this.patch({ error: errorMessage(error), stopping: false }); }
    finally { this.controlLock = false; this.patch({ controlling: false }); this.drainQueue(); }
  };
  switchBranch = async (id: number) => {
    if (this.active || this.state.loading || this.state.editing) return;
    this.active = 'branch-switch'; this.follow = false; this.patch({ loading: true, error: '' });
    try { this.patch({ messages: await selectChatBranch(this.paperId, id), pending: emptyPending(), contextNotice: '' }); }
    catch (error) { this.setError(errorMessage(error)); }
    finally { this.active = ''; this.patch({ loading: false }); }
  };
  editQuestion = (message: ChatExchange, followupIndex: number | null) => {
    if (this.active || this.state.loading) return;
    this.follow = false;
    this.patch({ error: '', editing: { exchangeId: message.id, followupIndex, text: followupIndex === null ? message.question : message.followups[followupIndex] } });
  };
  saveEdit = (page: number) => {
    const edit = this.state.editing;
    if (edit?.text.trim()) void this.run(edit.text.trim(), page, { exchangeId: edit.exchangeId, followupIndex: edit.followupIndex });
  };
  dispose() {
    if (this.active && this.state.ready) void stopPaperChat(this.active).catch(() => {});
    this.disposed = true; this.listeners.clear(); this.pagesTask = undefined;
  }
}

const sessions = new Map<string, PaperChatSession>();
export function getPaperChatSession(paperId: string) {
  let session = sessions.get(paperId);
  if (!session) { session = new PaperChatSession(paperId); sessions.set(paperId, session); }
  return session;
}
export function forgetPaperChatSessions(ids: string[]) {
  for (const id of ids) { sessions.get(id)?.dispose(); sessions.delete(id); }
}
