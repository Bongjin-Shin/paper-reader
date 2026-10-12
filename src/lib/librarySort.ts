import type { LibraryPaper } from '../types';

const sortKeys = ['title', 'importance', 'memo', 'authors', 'publishedDate', 'uploadedAt'] as const;
export type LibrarySort = typeof sortKeys[number];
export type LibrarySortPreference = { key: LibrarySort; direction: 'asc' | 'desc' };
const preferenceKey = 'paper-vocabulary.library-sort.v1';
const compareText = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' }).compare;

export function readLibrarySortPreference(): LibrarySortPreference {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null');
    if (saved && sortKeys.includes(saved.key) && (saved.direction === 'asc' || saved.direction === 'desc')) {
      return { key: saved.key, direction: saved.direction };
    }
  } catch { /* Unavailable storage or an invalid preference uses the original default. */ }
  return { key: 'title', direction: 'asc' };
}

export function saveLibrarySortPreference(preference: LibrarySortPreference) {
  // Save at the click, rather than waiting for an effect or app shutdown.
  localStorage.setItem(preferenceKey, JSON.stringify(preference));
}

export function sortLibraryPapers(papers: LibraryPaper[], key: LibrarySort, direction: 'asc' | 'desc'): LibraryPaper[] {
  return [...papers].sort((a, b) => {
    const left = typeof a[key] === 'string' ? (a[key] as string).trim() : a[key];
    const right = typeof b[key] === 'string' ? (b[key] as string).trim() : b[key];
    // Empty metadata (including whitespace-only memos) stays last in either direction.
    if (!left !== !right) return !left ? 1 : -1;
    const order = key === 'importance' ? Number(left) - Number(right) : compareText(String(left), String(right));
    return order * (direction === 'asc' ? 1 : -1) || compareText(a.title, b.title) || a.id.localeCompare(b.id);
  });
}
