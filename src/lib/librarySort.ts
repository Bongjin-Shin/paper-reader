import type { LibraryPaper } from '../types';

export type LibrarySort = 'title' | 'authors' | 'publishedDate' | 'importance' | 'uploadedAt';
const compareText = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' }).compare;

export function sortLibraryPapers(papers: LibraryPaper[], key: LibrarySort, direction: 'asc' | 'desc'): LibraryPaper[] {
  return [...papers].sort((a, b) => {
    const left = a[key], right = b[key];
    // Missing dates/authors and unrated papers stay last in either direction.
    if (!left !== !right) return !left ? 1 : -1;
    const order = key === 'importance' ? Number(left) - Number(right) : compareText(String(left), String(right));
    return order * (direction === 'asc' ? 1 : -1) || compareText(a.title, b.title) || a.id.localeCompare(b.id);
  });
}
