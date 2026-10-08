export type ActionType = 'translation' | 'explanation';
export type AiProvider = 'api' | 'chatgpt' | 'claude';
export interface ChatgptStatus { installed: boolean; connected: boolean; planType: string | null; loginPending: boolean; error: string | null }
export interface ModelInfo { model: string; displayName: string; efforts: string[]; defaultEffort: string; isDefault: boolean }
export interface ModelPreferences { translationModel: string; translationEffort: string; chatModel: string; chatEffort: string }
export interface ChatExchange { id: number; question: string; answer: string; model: string; effort: string; followups: string[]; interrupted: boolean; parentId: number | null; variants: number[] }
export type PdfRect = [number, number, number, number];
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface Paper {
  id: string;
  fileName: string;
  title: string;
}

export interface PaperImportBatch { papers: Paper[]; failures: { fileName: string; message: string }[] }

export interface LibraryFolder { id: number; parentId: number | null; name: string }
export interface PaperMetadata { title: string; authors: string; publishedDate: string }
export interface LibraryPaper extends Paper { folderId: number | null; authors: string; publishedDate: string; importance: number; uploadedAt: string; memo: string }
export interface PaperLibrary { folders: LibraryFolder[]; papers: LibraryPaper[] }
export interface LibraryDeletion { paperIds: string[]; cleanupPending: boolean }

export interface PositionData {
  version: 1;
  rects: PdfRect[];
  startOffset: number;
  endOffset: number;
}

export interface Highlight {
  id: number;
  paperId: string;
  vocabularyEntryId: number;
  pageNumber: number;
  selectedText: string;
  position: PositionData;
  color: HighlightColor;
}

export interface WordSelection {
  word: string;
  originalSentence: string;
  pageNumber: number;
  position: PositionData;
  anchor: { left: number; top: number; bottom: number; width: number };
  isSingleWord: boolean;
  segments: { pageNumber: number; startOffset: number; endOffset: number; rects: PdfRect[] }[];
  anchorPageNumber: number;
  anchorPdfRect: PdfRect;
}

export interface LookupRequest {
  paperId: string;
  pageNumber: number;
  word: string;
  originalSentence: string;
  position: PositionData;
  action: ActionType;
  color: HighlightColor;
}

export interface LookupResult {
  text: string;
  highlight: Highlight | null;
}

export interface TextLookupRequest {
  paperId: string;
  pageNumber: number;
  selectedText: string;
  context: string;
  action: ActionType;
}

export interface UsageSummary {
  initialCreditUsd: number | null;
  totalCostUsd: number;
  estimatedBalanceUsd: number | null;
  estimatedCalls: number;
  pricing: { model: string; inputNanoUsdPerToken: number; cachedInputNanoUsdPerToken: number;
    cacheWriteNanoUsdPerToken: number; outputNanoUsdPerToken: number };
}

export interface VocabularyContext {
  paperId: string;
  paperTitle: string;
  pageNumber: number;
  originalSentence: string;
  translation: string | null;
  explanation: string | null;
}

export interface VocabularyEntry {
  id: number;
  word: string;
  translation: string | null;
  explanation: string | null;
  lookupCount: number;
  contexts: VocabularyContext[];
}

export interface SavedHighlight {
  originalSentence: string;
  action: ActionType;
  text: string;
  translation: string | null;
  explanation: string | null;
}

export interface EquationSource { token: string; text: string; rect: PdfRect; fontSize: number; pageNumber?: number }
export interface SentenceTypography { fontScale: number; bold: boolean; italic: boolean }
export interface SentenceLayout { paragraph: number; kind: 'paragraph' | 'heading' | 'equation'; math: EquationSource[];
  sources?: TranslationMark[]; typography?: SentenceTypography }
export interface SourceSentence { id: number; text: string; rects: PdfRect[]; layout?: SentenceLayout }
export interface TranslatedSentence extends SourceSentence { translation: string }
export interface PageTranslation { pageNumber: number; sentences: TranslatedSentence[] }
export interface PageTranslationRequest { paperId: string; pageNumber: number; sentences: SourceSentence[] }
export interface TranslationMark { pageNumber: number; rects: PdfRect[] }

export type ChatEvent = { type: 'ready' | 'thinking' } | { type: 'answer'; text: string } | { type: 'accepted'; question: string };
export interface QuotaWindow { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }
export interface SubscriptionUsage { updatedAt: number | null; buckets: { id: string; name: string; primary: QuotaWindow | null; secondary: QuotaWindow | null }[] }

export interface ChatEdit { exchangeId: number; followupIndex: number | null }
