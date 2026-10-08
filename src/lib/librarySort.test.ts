import { it, expect } from 'vitest';
import type { LibraryPaper } from '../types';
import { sortLibraryPapers } from './librarySort';
const row = (id: string, publishedDate: string, importance: number, authors = ''): LibraryPaper =>
  ({ id, title: id, fileName: id + '.pdf', folderId: null, publishedDate, importance, authors, uploadedAt: '', memo: '' });
const ids = (rows: LibraryPaper[]) => rows.map(row => row.id);
it('sorts publication dates by known precision and keeps missing values last in either direction', () => {
  const papers = [row('B', '2024-03', 1), row('Missing', '', 0), row('A', '2024', 2), row('C', '2023-12-31', 3)];
  expect(ids(sortLibraryPapers(papers, 'publishedDate', 'desc'))).toEqual(['B', 'A', 'C', 'Missing']);
  expect(ids(sortLibraryPapers(papers, 'publishedDate', 'asc'))).toEqual(['C', 'A', 'B', 'Missing']);
  expect(papers[0].id).toBe('B');
});
it('sorts ratings numerically, keeps unrated last and resolves ties consistently', () => {
  const papers = [row('C', '', 0), row('B', '', 5), row('A', '', 5), row('D', '', 1)];
  expect(ids(sortLibraryPapers(papers, 'importance', 'desc'))).toEqual(['A', 'B', 'D', 'C']);
  expect(ids(sortLibraryPapers(papers, 'importance', 'asc'))).toEqual(['D', 'A', 'B', 'C']);
});
it('sorts title author and upload time without modifying paper metadata', () => {
  const papers = [row('Paper 10', '', 0, 'Bob'), row('Paper 2', '', 0, 'Alice'), row('Paper 1', '', 0)];
  papers[0].uploadedAt = '2023-01-01T02:00:00Z'; papers[1].uploadedAt = '2024-01-01T02:00:00Z';
  expect(ids(sortLibraryPapers(papers, 'title', 'asc'))).toEqual(['Paper 1', 'Paper 2', 'Paper 10']);
  expect(ids(sortLibraryPapers(papers, 'authors', 'desc'))).toEqual(['Paper 10', 'Paper 2', 'Paper 1']);
  expect(ids(sortLibraryPapers(papers, 'uploadedAt', 'desc'))).toEqual(['Paper 2', 'Paper 10', 'Paper 1']);
});
