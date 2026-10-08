import { invoke as tauriInvoke, isTauri, Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AiProvider, ChatgptStatus } from '../types';
import type { Highlight, HighlightColor, LookupRequest, LookupResult, Paper, PaperMetadata, TextLookupRequest, UsageSummary, VocabularyEntry, SavedHighlight, PaperLibrary, PaperImportBatch, LibraryFolder, LibraryDeletion } from '../types';

const mutations = new Set(['open_pdf', 'open_dropped_pdf', 'import_library_pdf', 'import_dropped_library_pdf',
  'lookup_word', 'lookup_text', 'remove_highlights', 'delete_vocabulary', 'create_library_folder', 'rename_library_folder',
  'move_library_folder', 'rename_library_paper', 'move_library_paper', 'move_library_papers', 'delete_library_paper',
  'delete_library_papers', 'delete_library_folder', 'update_paper_metadata', 'set_paper_importance', 'set_paper_memo', 'restore_history']);
let pendingMutations = 0;
export const dataMutationPending = () => pendingMutations > 0;
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!mutations.has(command)) return tauriInvoke<T>(command, args);
  pendingMutations++;
  try { return await tauriInvoke<T>(command, args); }
  finally { pendingMutations--; }
}
export const restoreHistory = (redo: boolean) => invoke<string | null>('restore_history', { redo });
export const getAiProvider = () => invoke<AiProvider>('get_ai_provider');
export const setAiProvider = (provider: AiProvider) => invoke<void>('set_ai_provider', { provider });
export const getChatgptStatus = () => invoke<ChatgptStatus>('get_chatgpt_status');
export const startChatgptLogin = () => invoke<void>('start_chatgpt_login');
export const cancelChatgptLogin = () => invoke<void>('cancel_chatgpt_login');
export const logoutChatgpt = () => invoke<void>('logout_chatgpt');
export const getModelPreferences = (provider: AiProvider = 'chatgpt') => invoke<import('../types').ModelPreferences>('get_model_preferences', { provider });
export const getChatProvider = () => invoke<'chatgpt' | 'claude'>('get_chat_provider');
export const setChatProvider = (provider: 'chatgpt' | 'claude') => invoke<void>('set_chat_provider', { provider });
export const getClaudeStatus = () => invoke<ChatgptStatus>('get_claude_status');
export const startClaudeLogin = () => invoke<void>('start_claude_login');
export const cancelClaudeLogin = () => invoke<void>('cancel_claude_login');
export const logoutClaude = () => invoke<void>('logout_claude');
export const installClaude = () => invoke<void>('install_claude');
export const getClaudeModels = () => invoke<import('../types').ModelInfo[]>('get_claude_models');
export const getChatgptModels = () => invoke<import('../types').ModelInfo[]>('get_chatgpt_models');
export const setModelPreference = (scope: 'translation' | 'chat', model: string, effort = '', provider: AiProvider = 'chatgpt') =>
  invoke<void>('set_model_preference', { scope, model, effort, provider });
export const getPaperChat = (paperId: string) => invoke<import('../types').ChatExchange[]>('get_paper_chat', { paperId });
export const askPaper = (request: { paperId: string; question: string; context: string; currentPage: number; totalPages: number }, requestId: string, progress: (event: import('../types').ChatEvent) => void, edit?: import('../types').ChatEdit) => {
  const onProgress = new Channel<import('../types').ChatEvent>(); onProgress.onmessage = progress;
  return invoke<import('../types').ChatExchange>('ask_paper', { request, requestId, onProgress, edit: edit ?? null });
};
export const selectChatBranch = (paperId: string, exchangeId: number) => invoke<import('../types').ChatExchange[]>('select_chat_branch', { paperId, exchangeId });
export const steerPaperChat = (requestId: string, question: string) => invoke<void>('steer_paper_chat', { requestId, question });
export const stopPaperChat = (requestId: string) => invoke<void>('stop_paper_chat', { requestId });
export const getSubscriptionUsage = (provider: 'chatgpt' | 'claude' = 'chatgpt') => invoke<import('../types').SubscriptionUsage>(provider === 'claude' ? 'get_claude_subscription_usage' : 'get_subscription_usage');

export async function openPdf(): Promise<PaperImportBatch | null> {
  if (!isTauri()) throw new Error('데스크톱 앱에서 PDF를 열 수 있습니다. npm run tauri dev로 실행해 주세요.');
  return invoke<PaperImportBatch | null>('open_pdf');
}

export async function readPdf(paperId: string): Promise<Uint8Array> {
  const bytes = await invoke<ArrayBuffer | number[]>('read_pdf', { paperId });
  return new Uint8Array(bytes);
}

export const getHighlights = (paperId: string) => invoke<Highlight[]>('get_highlights', { paperId });
export const getHighlightColor = () => isTauri() ? invoke<HighlightColor>('get_highlight_color') : Promise.resolve<HighlightColor>('yellow');
export const setHighlightColor = (color: HighlightColor) => invoke<void>('set_highlight_color', { color });
export const removeHighlights = (paperId: string, ids: number[]) => invoke<number[]>('remove_highlights', { paperId, ids });
export const exportVocabularyPdf = (bytes: Uint8Array, mode: 'simple' | 'detailed') => invoke<string | null>('export_vocabulary_pdf', { bytes: Array.from(bytes), mode });
export const printVocabularyPdf = (bytes: Uint8Array, mode: 'simple' | 'detailed', pageNumber: number) =>
  invoke<boolean>('print_vocabulary_pdf', { bytes: Array.from(bytes), mode, pageNumber });
export const getPapers = () => invoke<Paper[]>('get_papers');
export const getLibrary = () => invoke<PaperLibrary>('get_library');
export const createLibraryFolder = (parentId: number | null, name: string) => invoke<LibraryFolder>('create_library_folder', { parentId, name });
export const renameLibraryFolder = (folderId: number, name: string) => invoke<void>('rename_library_folder', { folderId, name });
export const moveLibraryFolder = (folderId: number, parentId: number | null) => invoke<void>('move_library_folder', { folderId, parentId });
export const renameLibraryPaper = (paperId: string, title: string) => invoke<Paper>('rename_library_paper', { paperId, title });
export const updatePaperMetadata = (paperId: string, metadata: PaperMetadata, automatic = false) => invoke<Paper>('update_paper_metadata', { paperId, metadata, automatic });
export const setPaperImportance = (paperId: string, importance: number) => invoke<void>('set_paper_importance', { paperId, importance });
export const setPaperMemo = (paperId: string, memo: string) => invoke<void>('set_paper_memo', { paperId, memo });
export const moveLibraryPaper = (paperId: string, folderId: number | null) => invoke<void>('move_library_paper', { paperId, folderId });
export const moveLibraryPapers = (paperIds: string[], folderId: number | null) => invoke<void>('move_library_papers', { paperIds, folderId });
export const deleteLibraryPapers = (paperIds: string[]) => invoke<LibraryDeletion>('delete_library_papers', { paperIds });
export const importLibraryPdf = (folderId: number | null) => invoke<PaperImportBatch | null>('import_library_pdf', { folderId });
export const importDroppedLibraryPdf = (paths: string[], folderId: number | null) => invoke<PaperImportBatch>('import_dropped_library_pdf', { paths, folderId });
export const deleteLibraryPaper = (paperId: string) => invoke<LibraryDeletion>('delete_library_paper', { paperId });
export const deleteLibraryFolder = (folderId: number) => invoke<LibraryDeletion>('delete_library_folder', { folderId });
export const getVocabulary = (query: string, paperId: string | null) => invoke<VocabularyEntry[]>('get_vocabulary', { query, paperId });
export const deleteVocabulary = (ids: number[]) => invoke<number[]>('delete_vocabulary', { ids });
export const getSavedHighlight = (paperId: string, highlightId: number) => invoke<SavedHighlight>('get_saved_highlight', { paperId, highlightId });
export const lookupWord = (request: LookupRequest) => invoke<LookupResult>('lookup_word', { request });
export const lookupText = (request: TextLookupRequest) => invoke<LookupResult>('lookup_text', { request });
export const openDroppedPdf = (paths: string[]) => invoke<PaperImportBatch>('open_dropped_pdf', { paths });
export const getApiUsage = () => invoke<UsageSummary>('get_api_usage');
export const setInitialCredit = (usd: string) => invoke<UsageSummary>('set_initial_credit', { usd });
export type FileDrag = { type: 'enter'; valid: boolean } | { type: 'leave' } | { type: 'drop'; paths: string[] } | { type: 'error'; message: string };
export const listenFileDrag = (handler: (event: FileDrag) => void) => isTauri()
  ? listen<FileDrag>('reader-file-drag', event => handler(event.payload)) : Promise.resolve(() => {});
export { isTauri };
export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
export const getPageTranslation = (paperId: string, pageNumber: number) =>
  invoke<import('../types').PageTranslation | null>('get_page_translation', { paperId, pageNumber });
export const translatePage = (request: import('../types').PageTranslationRequest,
  progress?: (rows: { id: number; translation: string }[]) => void) => {
  const onProgress = new Channel<{ id: number; translation: string }[]>();
  onProgress.onmessage = rows => progress?.(rows);
  return invoke<import('../types').PageTranslation>('translate_page', { request, onProgress });
};
