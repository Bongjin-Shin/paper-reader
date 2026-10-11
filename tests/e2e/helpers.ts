import { expect, type Page } from '@playwright/test';
import { makeTestPdf } from '../fixture';

export async function installBackend(page: Page, options = { delay: 0, fail: false, rotation: 0, userUnit: 1 }, pdfBytes?: Uint8Array) {
  await page.addInitScript(({ bytes, options }) => {
    const state = window as unknown as {
      __TAURI_INTERNALS__: unknown;
      isTauri: boolean;
      __calls: { command: string; args: any }[];
      __fail: boolean;
    };
    state.isTauri = true;
    state.__calls = [];
    state.__fail = options.fail;
    const callbacks = new Map<number, (event: any) => void>();
    const listeners = new Set<number>();
    let nextCallback = 0;
    const rows = (key: string): any[] => JSON.parse(localStorage.getItem(key) ?? '[]');
    const chatHead = (paperId: string) => Number(localStorage.getItem('test-chat-head-' + paperId)) || null;
    const selectedChat = (paperId: string) => {
      const all = rows('test-chat-' + paperId), selected: any[] = [];
      let id = chatHead(paperId);
      while (id !== null) {
        const row = all.find(r => r.id === id); if (!row) break;
        selected.unshift({ ...row, variants: all.filter(r => r.parentId === row.parentId).map(r => r.id) }); id = row.parentId;
      }
      return selected;
    };
    if (localStorage.getItem('test-library-folders') === null) localStorage.setItem('test-library-folders', JSON.stringify([{ id: 1, parentId: null, name: '기본 폴더' }]));
    const memberships = (): any[] => JSON.parse(localStorage.getItem('test-library-memberships') ?? JSON.stringify(rows('test-papers').map(p => ({ paperId: p.id, folderId: null }))));
    const wordKey = (word: string) => /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(word) ? word.replaceAll('’', "'").toLowerCase() : word;
    const registerPaper = (id: string, fileName: string) => {
      const papers = rows('test-papers');
      const members = memberships();
      const paper = papers.find(p => p.id === id) ?? { id, fileName, title: fileName, authors: '', publishedDate: '', importance: 0, uploadedAt: '2026-09-22T01:02:03Z', metadataChecked: false };
      if (!papers.some(p => p.id === id)) localStorage.setItem('test-papers', JSON.stringify([...papers, paper]));
      if (!members.some(p => p.paperId === id)) localStorage.setItem('test-library-memberships', JSON.stringify([...members, { paperId: id, folderId: null }]));
      return { ...paper, fileName, title: paper.title === paper.fileName ? fileName : paper.title };
    };
    (state as any).__apiCalls = 0;
    (state as any).__emitFileDrag = (payload: any) => listeners.forEach(id => callbacks.get(id)?.({ payload }));
    (state as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, id: number) => listeners.delete(id) };
    const summary = () => {
      const totalCostUsd = Number(localStorage.getItem('test-cost') ?? 0);
      const initial = localStorage.getItem('test-credit');
      return { initialCreditUsd: initial === null ? null : Number(initial), totalCostUsd,
        estimatedBalanceUsd: initial === null ? null : Number(initial) - totalCostUsd, estimatedCalls: 0,
        pricing: { model: 'gpt-5.6-luna', inputNanoUsdPerToken: 200, cachedInputNanoUsdPerToken: 20, cacheWriteNanoUsdPerToken: 250, outputNanoUsdPerToken: 1200 } };
    };
    const labels: Record<string, string> = { remove_highlights: '하이라이트 삭제', delete_vocabulary: 'Vocabulary 삭제',
      create_library_folder: '폴더 생성', rename_library_folder: '폴더 이름 변경', move_library_folder: '폴더 이동',
      rename_library_paper: '논문 이름 변경', move_library_paper: '논문 이동', move_library_papers: '논문 일괄 이동',
      delete_library_paper: '논문 삭제', delete_library_papers: '논문 삭제', delete_library_folder: '폴더 삭제',
      update_paper_metadata: '논문 정보 수정', set_paper_importance: '중요도 변경', set_paper_memo: '메모 수정' };
    type RecordState = { label: string; before: [string, string | null][]; after: [string, string | null][] };
    const undo: RecordState[] = [], redo: RecordState[] = [];
    const snapshot = (keys: string[]): [string, string | null][] => keys.map(key => [key, localStorage.getItem(key)]);
    state.__TAURI_INTERNALS__ = {
      unregisterCallback: (id: number) => callbacks.delete(id),
      transformCallback: (callback: (event: any) => void) => { const id = ++nextCallback; callbacks.set(id, callback); return id; },
      invoke: async (command: string, args: any) => {
        state.__calls.push({ command, args });
        if (command === 'get_history_state') return { undo: undo.at(-1)?.label ?? null, redo: redo.at(-1)?.label ?? null };
        if (command === 'restore_history') {
          if ((state as any).__historyDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__historyDelay));
          if ((state as any).__historyFail) throw new Error('실행 취소에 실패했습니다.');
          const source = args.redo ? redo : undo, target = args.redo ? undo : redo;
          const item = source.pop(); if (!item) return null;
          for (const [key, value] of args.redo ? item.after : item.before) {
            if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
          }
          target.push(item); return item.label;
        }
        const label = command === 'update_paper_metadata' && args.automatic ? undefined : labels[command];
        const keys = command === 'remove_highlights' ? ['test-highlights'] : command === 'delete_vocabulary' ? ['test-lookups', 'test-highlights'] :
          ['test-papers', 'test-library-folders', 'test-library-memberships'];
        const before = label ? snapshot(keys) : [];
        const run = async () => {
        if (command === 'plugin:event|listen') { listeners.add(args.handler); return args.handler; }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        if (command === 'get_highlight_color') return localStorage.getItem('test-color') ?? 'yellow';
        if (command === 'set_highlight_color') { localStorage.setItem('test-color', args.color); return; }
        if (command === 'remove_highlights') {
          if ((state as any).__removeFail) throw new Error('하이라이트를 취소하지 못했습니다.');
          const saved = rows('test-highlights');
          const removed = saved.filter(h => h.paperId === args.paperId && args.ids.includes(h.id)).map(h => h.id);
          localStorage.setItem('test-highlights', JSON.stringify(saved.filter(h => !removed.includes(h.id))));
          return removed;
        }
        if (command === 'export_vocabulary_pdf') {
          if ((state as any).__exportFail) throw new Error('PDF 저장 실패');
          return (state as any).__exportCancel ? null : '/exports/vocabulary_' + args.mode + '.pdf';
        }
        if (command === 'print_vocabulary_pdf') {
          if ((state as any).__printDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__printDelay));
          if ((state as any).__printFail) throw new Error('프린터 연결 실패');
          return !(state as any).__printCancel;
        }
        if (command === 'delete_vocabulary') {
          if ((state as any).__deleteDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__deleteDelay));
          if ((state as any).__deleteFail) throw new Error('단어를 삭제하지 못했습니다.');
          const all = rows('test-lookups');
          const removed = [...new Set(all.filter(row => args.ids.includes(row.entryId)).map(row => row.entryId))];
          const remaining = all.filter(row => !removed.includes(row.entryId));
          const highlights = rows('test-highlights').filter(h => !removed.includes(h.vocabularyEntryId))
            .map(h => ({ ...h, lookupIndex: remaining.indexOf(all[h.lookupIndex]) }));
          localStorage.setItem('test-lookups', JSON.stringify(remaining));
          localStorage.setItem('test-highlights', JSON.stringify(highlights));
          return removed;
        }
        if (command === 'get_chat_provider') return localStorage.getItem('test-chat-provider') ?? 'chatgpt';
        if (command === 'set_chat_provider') { localStorage.setItem('test-chat-provider', args.provider); return; }
        if (command === 'get_claude_status') return { installed: !(state as any).__claudeMissing, connected: localStorage.getItem('test-claude-connected') === 'true', planType: 'pro', loginPending: !!(state as any).__claudeLoginPending && localStorage.getItem('test-claude-connected') !== 'true', error: null };
        if (command === 'install_claude') { (state as any).__claudeMissing = false; return; }
        if (command === 'start_claude_login') { (state as any).__claudeLoginPending = true; return; }
        if (command === 'cancel_claude_login') { (state as any).__claudeLoginPending = false; return; }
        if (command === 'logout_claude') { localStorage.removeItem('test-claude-connected'); return; }
        if (command === 'get_claude_models') {
          if ((state as any).__claudeMissing) throw new Error('Claude 연결 도구를 설치해 주세요.');
          return [{ model: 'sonnet', displayName: 'Claude · Sonnet', efforts: ['low', 'medium', 'high'], defaultEffort: '', isDefault: true }, { model: 'opus[1m]', displayName: 'Claude · Opus', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: '', isDefault: false }, { model: 'haiku', displayName: 'Claude · Haiku', efforts: [], defaultEffort: '', isDefault: false }];
        }
        if (command === 'get_model_preferences' && args?.provider === 'claude') return JSON.parse(localStorage.getItem('test-claude-models') ?? '{"translationModel":"sonnet","translationEffort":"","chatModel":"","chatEffort":""}');
        if (command === 'get_model_preferences') return JSON.parse(localStorage.getItem('test-models') ?? '{"translationModel":"gpt-5.6-luna","translationEffort":"","chatModel":"","chatEffort":""}');
        if (command === 'get_chatgpt_models') return [
          { model: 'gpt-5.6-luna', displayName: 'Luna', efforts: ['none', 'low', 'medium'], defaultEffort: 'low', isDefault: true },
          { model: 'test-reasoner', displayName: 'Test Reasoner', efforts: ['medium', 'high'], defaultEffort: 'medium', isDefault: false }
        ];
        if (command === 'set_model_preference') {
          const key = args.provider === 'claude' ? 'test-claude-models' : 'test-models';
          const p = JSON.parse(localStorage.getItem(key) ?? '{"translationModel":"gpt-5.6-luna","translationEffort":"","chatModel":"","chatEffort":""}');
          if (args.scope === 'translation') { p.translationModel = args.model; p.translationEffort = args.effort; } else { p.chatModel = args.model; p.chatEffort = args.effort; }
          localStorage.setItem(key, JSON.stringify(p)); return;
        }
        if (command === 'get_paper_chat') return selectedChat(args.paperId);
        if (command === 'select_chat_branch') {
          const all = rows('test-chat-' + args.paperId), ids = new Set([args.exchangeId]);
          if (!all.some(r => r.id === args.exchangeId)) throw new Error('다른 논문의 대화입니다.');
          all.forEach(r => { if (ids.has(r.parentId)) ids.add(r.id); });
          localStorage.setItem('test-chat-head-' + args.paperId, String(Math.max(...ids))); return selectedChat(args.paperId);
        }
        if (command === 'get_claude_subscription_usage') {
          if ((state as any).__claudeQuotaError) throw new Error('Usage unavailable');
          return { updatedAt: Math.floor(Date.now() / 1000), buckets: localStorage.getItem('test-claude-connected') !== 'true' ? [] : [{ id: 'claude', name: 'Claude', primary: { usedPercent: 23.5, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 86400 } }] };
        }
        if (command === 'get_subscription_usage') return { updatedAt: Math.floor(Date.now() / 1000), buckets: [{ id: 'codex', name: 'Codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 86400 } }] };
        if (command === 'steer_paper_chat') {
          const live = (state as any).__liveChat;
          if (!live || live.id !== args.requestId || (state as any).__steerFail) throw new Error('추가 질문을 반영하지 못했습니다.');
          live.followups.push(args.question); live.emit({ type: 'accepted', question: args.question }); return;
        }
        if (command === 'stop_paper_chat') {
          const live = (state as any).__liveChat;
          if (!live || live.id !== args.requestId) throw new Error('진행 중인 답변이 없습니다.');
          live.interrupted = true; live.finish?.(); return;
        }
        if (command === 'ask_paper') {
          if ((state as any).__chatFail) throw new Error('채팅 연결 실패');
          const before = selectedChat(args.request.paperId), expectedHead = chatHead(args.request.paperId);
          const original = args.edit ? before.find(r => r.id === args.edit.exchangeId) : null;
          if (args.edit && !original) throw new Error('수정할 질문을 찾지 못했습니다.');
          const parentId = original ? original.parentId : expectedHead;
          const firstQuestion = original && args.edit.followupIndex !== null ? original.question : args.request.question;
          const initialFollowups = original && args.edit.followupIndex !== null ? [...original.followups.slice(0, args.edit.followupIndex), args.request.question] : [];
          let index = 0;
          const emit = (message: any) => callbacks.get(args.onProgress.id)?.({ index: index++, message });
          const live = { id: args.requestId, emit, followups: [] as string[], interrupted: false, finish: null as (() => void) | null };
          (state as any).__liveChat = live;
          emit({ type: 'ready' }); emit({ type: 'thinking' });
          const text = (state as any).__chatMarkdown ?? '논문에서는 복잡도를 분석합니다. [p. 2]';
          if ((state as any).__chatStreaming) emit({ type: 'answer', text });
          if ((state as any).__chatDelay) await new Promise<void>(resolve => { const timer = setTimeout(resolve, (state as any).__chatDelay); live.finish = () => { clearTimeout(timer); resolve(); }; });
          const p = JSON.parse(localStorage.getItem(localStorage.getItem('test-chat-provider') === 'claude' ? 'test-claude-models' : 'test-models') ?? '{}');
          const items = rows('test-chat-' + args.request.paperId);
          if (chatHead(args.request.paperId) !== expectedHead) throw new Error('대화가 변경되었습니다.');
          const id = Math.max(0, ...items.map(r => r.id)) + 1;
          const result = { id, parentId, variants: [...items.filter(r => r.parentId === parentId).map(r => r.id), id], question: firstQuestion, answer: text, model: p.chatModel || 'gpt-5.6-luna', effort: p.chatEffort || 'low', followups: [...initialFollowups, ...live.followups], interrupted: live.interrupted };
          emit({ type: 'answer', text }); (state as any).__liveChat = null;
          localStorage.setItem('test-chat-' + args.request.paperId, JSON.stringify([...items, result])); localStorage.setItem('test-chat-head-' + args.request.paperId, String(result.id)); return result;
        }
        if (command === 'get_ai_provider') return localStorage.getItem('test-provider') ?? 'api';
        if (command === 'set_ai_provider') { localStorage.setItem('test-provider', args.provider); return; }
        if (command === 'get_chatgpt_status') return { installed: !(state as any).__codexMissing,
          connected: localStorage.getItem('test-chatgpt-connected') === 'true', planType: 'plus',
          loginPending: !!(state as any).__loginPending && localStorage.getItem('test-chatgpt-connected') !== 'true', error: null };
        if (command === 'start_chatgpt_login') { (state as any).__loginPending = true; return; }
        if (command === 'cancel_chatgpt_login') { (state as any).__loginPending = false; return; }
        if (command === 'logout_chatgpt') { localStorage.removeItem('test-chatgpt-connected'); (state as any).__loginPending = false; return; }
        if (command === 'get_page_translation') {
          if ((state as any).__pageCacheDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__pageCacheDelay));
          return rows('test-page-translations').find(r => r.layoutVersion === 7 && r.paperId === args.paperId && r.pageNumber === args.pageNumber) ?? null;
        }
        if (command === 'translate_page') {
          const req = args.request;
          const saved = rows('test-page-translations').find(r => r.layoutVersion === 7 && r.paperId === req.paperId && r.pageNumber === req.pageNumber);
          if (saved && !req.force) return saved;
          (state as any).__pageApiCalls = ((state as any).__pageApiCalls ?? 0) + 1;
          if ((state as any).__pageStreaming) {
            callbacks.get(args.onProgress.id)?.({ index: 0, message: [{ id: 0, translation: '먼저 도착한 번역 문장입니다.' }] });
          }
          if ((state as any).__pageDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__pageDelay));
          if ((state as any).__pageFail) throw new Error('본문 번역 연결에 실패했습니다.');
          const equation = (text: string) => text.includes('E = mc')
            ? String.raw`\begin{aligned} E &= mc^2 \quad (1) \\ y &= \frac{1}{n} \quad (2) \end{aligned}`
            : text.includes('success') ? String.raw`\begin{aligned} \min f_{\mathrm{cost}} &= N-N_{\mathrm{success}} \quad (1) \\ N_{\mathrm{success}} &= \begin{cases} x=1, & t<T \\ x=0, & t>T \end{cases} \\ 0 &< x < \max \quad (2) \end{aligned}`
            : text.includes('x = 2') ? 'x = 2' : String.raw`\mathrm{x}`;
          const result = { layoutVersion: 7, paperId: req.paperId, pageNumber: req.pageNumber, sentences: req.sentences.map((s: any) => ({ ...s, equations: (s.layout?.math ?? []).map((m: any) => ({ token: m.token, latex: equation(m.text) })), translation: s.layout?.kind === 'equation' ? s.text : ((state as any).__longPageTranslation ?? `한국어 번역 ${req.pageNumber}-${s.id + 1}: 문장에 대응하는 번역입니다.`) + (s.layout?.math ?? []).map((m: any) => ' ' + m.token).join('') })) };
          localStorage.setItem('test-page-translations', JSON.stringify([...rows('test-page-translations').filter(r => r.paperId !== req.paperId || r.pageNumber !== req.pageNumber), result]));
          if (!['chatgpt', 'claude'].includes(localStorage.getItem('test-provider') ?? '')) localStorage.setItem('test-cost', String(summary().totalCostUsd + .002));
          return result;
        }
        if (command === 'get_api_usage') return summary();
        if (command === 'set_initial_credit') { localStorage.setItem('test-credit', args.usd); return summary(); }
        if (command === 'get_library') {
          if ((state as any).__libraryDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__libraryDelay));
          if ((state as any).__libraryFail) throw new Error('Library를 읽지 못했습니다.');
          return { folders: rows('test-library-folders'), papers: memberships().map(m => ({ authors: '', publishedDate: '', importance: 0, memo: '', uploadedAt: '2026-09-22T01:02:03Z', ...rows('test-papers').find(p => p.id === m.paperId), folderId: m.folderId })) };
        }
        if (['open_pdf', 'open_dropped_pdf', 'import_library_pdf', 'import_dropped_library_pdf'].includes(command)) {
          const library = command.startsWith('import_');
          if (library && (state as any).__libraryMutationFail) throw new Error('Library 변경에 실패했습니다.');
          if ((state as any).__importCancel) return null;
          if ((state as any).__importDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__importDelay));
          const paths: string[] = args?.paths ?? (state as any).__importPaths ?? ['/papers/test-paper.pdf'];
          const papers: any[] = [], failures: any[] = [];
          for (const path of [...new Set(paths)]) {
            const fileName = path.split('/').at(-1)!;
            if (!/\.pdf$/i.test(path) || (state as any).__importFailNames?.includes(fileName)) { failures.push({ fileName, message: 'PDF 파일을 읽을 수 없습니다.' }); continue; }
            const id = paths.length === 1 && !(state as any).__importPaths ? (args?.paths ? 'paper-b' : 'paper-a') : `batch-${fileName}`;
            const paper = registerPaper(id, fileName);
            if (library) localStorage.setItem('test-library-memberships', JSON.stringify(memberships().map(m => m.paperId === id ? { ...m, folderId: args.folderId } : m)));
            papers.push(paper);
          }
          return { papers, failures };
        }
        if (['create_library_folder', 'rename_library_folder', 'move_library_folder', 'rename_library_paper', 'move_library_paper', 'move_library_papers', 'delete_library_papers',
          'update_paper_metadata', 'set_paper_importance', 'set_paper_memo', 'delete_library_folder', 'delete_library_paper', 'import_library_pdf', 'import_dropped_library_pdf'].includes(command)) {
          if (['move_library_papers', 'delete_library_papers'].includes(command) && (state as any).__libraryBatchDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__libraryBatchDelay));
          if (command === 'set_paper_memo' && (state as any).__memoDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__memoDelay));
          if ((state as any).__libraryMutationFail) throw new Error('Library 변경에 실패했습니다.');
          const folders = rows('test-library-folders'), members = memberships();
          if (command === 'create_library_folder' || command === 'rename_library_folder') {
            const parentId = command === 'create_library_folder' ? args.parentId : folders.find(f => f.id === args.folderId)?.parentId;
            const name = args.name.trim();
            if (!name || /[/\\]/.test(name)) throw new Error('폴더 이름을 확인해 주세요.');
            if (folders.some(f => f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase() && f.id !== args.folderId)) throw new Error('같은 위치에 같은 이름의 폴더가 있습니다.');
            if (command === 'create_library_folder') {
              const folder = { id: Math.max(0, ...folders.map(f => f.id)) + 1, parentId, name };
              localStorage.setItem('test-library-folders', JSON.stringify([...folders, folder])); return folder;
            }
            localStorage.setItem('test-library-folders', JSON.stringify(folders.map(f => f.id === args.folderId ? { ...f, name } : f))); return;
          }
          if (command === 'move_library_folder') {
            localStorage.setItem('test-library-folders', JSON.stringify(folders.map(f => f.id === args.folderId ? { ...f, parentId: args.parentId } : f))); return;
          }
          if (command === 'update_paper_metadata' || command === 'set_paper_importance' || command === 'set_paper_memo') {
            const papers = rows('test-papers');
            const paper = papers.find(p => p.id === args.paperId);
            if (!paper) throw new Error('논문을 찾을 수 없습니다.');
            if (command === 'set_paper_importance') paper.importance = args.importance;
            else if (command === 'set_paper_memo') paper.memo = args.memo;
            else {
              if (!args.automatic || (!paper.titleManual && args.metadata.title)) paper.title = args.metadata.title.trim();
              if (!args.automatic || (!paper.metadataManual && !paper.authors)) paper.authors = args.metadata.authors.trim();
              if (!args.automatic || (!paper.metadataManual && !paper.publishedDate)) paper.publishedDate = args.metadata.publishedDate.trim();
              if (!args.automatic) { paper.metadataManual = true; paper.titleManual = true; }
              paper.metadataChecked = true;
            }
            localStorage.setItem('test-papers', JSON.stringify(papers)); return paper;
          }
          if (command === 'rename_library_paper') {
            const papers = rows('test-papers').map(p => p.id === args.paperId ? { ...p, title: args.title.trim(), titleManual: true } : p);
            localStorage.setItem('test-papers', JSON.stringify(papers)); return papers.find(p => p.id === args.paperId);
          }
          if (command === 'move_library_paper') {
            localStorage.setItem('test-library-memberships', JSON.stringify(members.map(m => m.paperId === args.paperId ? { ...m, folderId: args.folderId } : m))); return;
          }
          if (command === 'move_library_papers') {
            if (args.paperIds.some((id: string) => !members.some(m => m.paperId === id))) throw new Error('논문을 찾을 수 없습니다.');
            localStorage.setItem('test-library-memberships', JSON.stringify(members.map(m => args.paperIds.includes(m.paperId) ? { ...m, folderId: args.folderId } : m))); return;
          }
          const removedFolders = new Set<number>();
          if (command === 'delete_library_folder') {
            removedFolders.add(args.folderId);
            let size = -1;
            while (size !== removedFolders.size) { size = removedFolders.size; folders.forEach(f => { if (removedFolders.has(f.parentId)) removedFolders.add(f.id); }); }
          }
          const paperIds = members.filter(m => command === 'delete_library_folder' ? removedFolders.has(m.folderId) : command === 'delete_library_papers' ? args.paperIds.includes(m.paperId) : m.paperId === args.paperId).map(m => m.paperId);
          localStorage.setItem('test-library-folders', JSON.stringify(folders.filter(f => !removedFolders.has(f.id))));
          localStorage.setItem('test-library-memberships', JSON.stringify(members.filter(m => !paperIds.includes(m.paperId))));
          return { paperIds, cleanupPending: false };
        }
        if (command === 'read_pdf') { if ((state as any).__readFail || (state as any).__readFailIds?.includes(args.paperId)) throw new Error('저장된 PDF를 읽지 못했습니다.'); return (state as any).__pdfBytesById?.[args.paperId] ?? bytes; }
        if (command === 'get_papers') return rows('test-papers');
        if (command === 'get_vocabulary') {
          if ((state as any).__vocabularyDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__vocabularyDelay));
          if ((state as any).__vocabularyFail) throw new Error('로컬 단어장을 읽지 못했습니다.');
          const grouped = new Map<string, any>();
          const all = rows('test-lookups');
          for (const row of all) {
            const key = wordKey(row.word);
            if (!grouped.has(key)) grouped.set(key, { id: row.entryId, word: key, lookupCount: 0,
              translation: null, explanation: null, contexts: [] });
            const entry = grouped.get(key);
            entry.lookupCount++;
            if (args.paperId && args.paperId !== row.paperId) continue;
            entry[row.action] = row.text;
            let context = entry.contexts.find((c: any) => c.paperId === row.paperId && c.pageNumber === row.pageNumber && c.originalSentence === row.originalSentence);
            if (!context) {
              context = { paperId: row.paperId, paperTitle: rows('test-papers').find(p => p.id === row.paperId)?.title ?? row.paperId,
                pageNumber: row.pageNumber, originalSentence: row.originalSentence, translation: null, explanation: null };
              entry.contexts.push(context);
            }
            context[row.action] = row.text;
          }
          const query = args.query.trim();
          return [...grouped.values()].filter(e => e.contexts.length && (!query || e.word.toLowerCase().includes(query.toLowerCase()) ||
            all.some(r => wordKey(r.word) === e.word && (!args.paperId || args.paperId === r.paperId) && r.action === 'translation' && r.text.includes(query))))
            .sort((a, b) => a.word.localeCompare(b.word));
        }
        if (command === 'get_saved_highlight') {
          if ((state as any).__savedDelay) await new Promise(resolve => setTimeout(resolve, (state as any).__savedDelay));
          if ((state as any).__savedFail) throw new Error('저장된 결과를 읽지 못했습니다.');
          const h = rows('test-highlights').find(h => h.id === args.highlightId && h.paperId === args.paperId);
          const all = rows('test-lookups');
          const lookup = all[h?.lookupIndex];
          if (!lookup) throw new Error('저장된 결과를 찾을 수 없습니다.');
          const matching = [...all, ...rows('test-explanation-cache')].filter(r => wordKey(r.word) === wordKey(lookup.word) && r.originalSentence === lookup.originalSentence);
          return { originalSentence: lookup.originalSentence, action: lookup.action, text: lookup.text,
            translation: matching.findLast(r => r.action === 'translation')?.text ?? null,
            explanation: matching.findLast(r => r.action === 'explanation')?.text ?? null };
        }
        if (command === 'get_highlights') return JSON.parse(localStorage.getItem('test-highlights') ?? '[]').filter((h: any) => h.paperId === args.paperId);
        if (command === 'lookup_word' || command === 'lookup_text') {
          const request = command === 'lookup_text' ? { ...args.request, word: args.request.selectedText, originalSentence: args.request.context } : args.request;
          const lookups = rows('test-lookups');
          const cache = request.action === 'explanation' ? [...lookups, ...rows('test-explanation-cache')] : lookups;
          const cached = cache.findLast(r => wordKey(r.word) === wordKey(request.word) &&
            r.originalSentence === request.originalSentence && r.action === request.action);
          if (!cached) {
            const chatgpt = localStorage.getItem('test-provider') === 'chatgpt';
            if (chatgpt) {
              if (localStorage.getItem('test-chatgpt-connected') !== 'true') throw new Error('ChatGPT 계정으로 먼저 로그인해 주세요.');
              (state as any).__chatgptCalls = ((state as any).__chatgptCalls ?? 0) + 1;
              if ((state as any).__chatgptLimit) throw new Error('ChatGPT 구독 사용 한도에 도달했습니다. API로 자동 전환하지 않습니다.');
            } else (state as any).__apiCalls++;
            await new Promise(resolve => setTimeout(resolve, options.delay));
            if (state.__fail) throw new Error('OpenAI 연결 실패');
            if (!chatgpt) localStorage.setItem('test-cost', String(summary().totalCostUsd + .01));
          }
          const text = cached?.text ?? (command === 'lookup_text' ? ((state as any).__phraseResult ?? (request.action === 'translation' ? '선택한 전체 문장의 번역입니다.' : '선택한 문맥 전체에 대한 설명입니다.')) : (request.action === 'translation' ? '점근적인' : '극한에서 어떤 성질에 가까워진다는 의미입니다.'));
          if (request.action === 'explanation') {
            if (!cached) localStorage.setItem('test-explanation-cache', JSON.stringify([...rows('test-explanation-cache'), { ...request, text }]));
            return { text, highlight: null };
          }
          const entryId = lookups.find(r => wordKey(r.word) === wordKey(request.word))?.entryId ?? Math.max(0, ...lookups.map(r => r.entryId)) + 1;
          if (command === 'lookup_text') {
            lookups.push({ ...request, text, entryId });
            localStorage.setItem('test-lookups', JSON.stringify(lookups));
            return { text, highlight: null };
          }
          const saved = rows('test-highlights');
          const old = saved.find(h => h.paperId === request.paperId && h.pageNumber === request.pageNumber && JSON.stringify(h.position) === JSON.stringify(request.position));
          const highlight = { id: old?.id ?? Math.max(0, ...saved.map(h => h.id)) + 1, paperId: request.paperId, vocabularyEntryId: entryId,
            selectedText: request.word, color: old?.color ?? request.color ?? 'yellow', pageNumber: request.pageNumber, position: request.position, lookupIndex: lookups.length };
          lookups.push({ ...request, text, entryId });
          localStorage.setItem('test-lookups', JSON.stringify(lookups));
          if (old) saved[saved.indexOf(old)] = highlight; else saved.push(highlight);
          localStorage.setItem('test-highlights', JSON.stringify(saved));
          return { text, highlight };
        }
        throw new Error(`Unexpected command: ${command}`);
        };
        const result = await run();
        if (label) {
          const after = snapshot(keys);
          if (JSON.stringify(before) !== JSON.stringify(after)) {
            undo.push({ label, before, after }); if (undo.length > 50) undo.shift(); redo.length = 0;
          }
        } else if (['lookup_word', 'lookup_text', 'open_pdf', 'open_dropped_pdf', 'import_library_pdf', 'import_dropped_library_pdf'].includes(command) && result) redo.length = 0;
        return result;
      },
    };
  }, { bytes: [...(pdfBytes ?? makeTestPdf(options.rotation, options.userUnit))], options });
}

export async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'PDF 파일 열기' }).click();
  await expect(page.locator('.pdf-page').first().locator('.textLayer span').first()).toBeVisible();
  await expect(page.locator('.page-message')).toHaveCount(0);
}

/** Opening the pane is read-only; request a new translation from its page button. */
export async function startPageTranslation(page: Page, pageNumber = 1) {
  await page.getByRole('region', { name: `${pageNumber}페이지 번역 내용`, exact: true })
    .getByRole('button', { name: '이 페이지 번역', exact: true }).click();
}

export async function wordBox(page: Page, word = 'asymptotic', occurrence = 0, pageNumber = 1) {
  // Highlight rectangles and text nodes can attach before the page's render promise settles.
  // Measure only after the Reader enables selection/hit testing at the requested scale.
  await expect.poll(() => page.locator(`.pdf-page[data-page-number="${pageNumber}"]`).evaluate(element =>
    Number(element.getAttribute('data-rendered-scale')) === Number(element.closest<HTMLElement>('.reader')!.dataset.displayScale)
      && element.hasAttribute('data-rendered-scale'))).toBe(true);
  // A cached offscreen Text Layer can finish materializing its layout one frame
  // after scrolling into view. Don't synthesize a mouse click from a zero rect.
  await expect(page.locator(`.pdf-page[data-page-number="${pageNumber}"]`)).toHaveAttribute('data-page-visible', 'true');
  await expect(page.locator(`.pdf-page[data-page-number="${pageNumber}"] .textLayer span`).first()).toBeVisible();
  return page.locator(`.pdf-page[data-page-number="${pageNumber}"]`).locator('.textLayer').evaluate((layer, { word, occurrence }) => {
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let seen = 0;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      let index = text.indexOf(word);
      while (index >= 0) {
        if (seen++ === occurrence) {
          const range = document.createRange();
          range.setStart(node, index); range.setEnd(node, index + word.length);
          const rect = range.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }
        index = text.indexOf(word, index + word.length);
      }
    }
    throw new Error('Word not found');
  }, { word, occurrence });
}

export async function select(page: Page, word = 'asymptotic', occurrence = 0, pageNumber = 1) {
  const box = await wordBox(page, word, occurrence, pageNumber);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog', { name: `${word} 단어 도구`, exact: true }).filter({ has: page.getByRole('button', { name: '번역', exact: true }) })).toBeVisible();
}
