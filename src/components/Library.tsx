import { memo, useEffect, useMemo, useState, useCallback, useRef, type FormEvent, type MouseEvent } from 'react';
import { createLibraryFolder, deleteLibraryFolder, deleteLibraryPaper, errorMessage, getLibrary,
  moveLibraryFolder, moveLibraryPaper, moveLibraryPapers, deleteLibraryPapers, renameLibraryFolder, renameLibraryPaper, updatePaperMetadata, setPaperImportance, setPaperMemo } from '../lib/backend';
import { readLibrarySortPreference, saveLibrarySortPreference, sortLibraryPapers, type LibrarySort, type LibrarySortPreference } from '../lib/librarySort';
import { LibraryMenu } from './LibraryMenu';
import { PaperMemo } from './PaperMemo';
import { useLibraryDrag, type LibraryDragItem } from '../lib/useLibraryDrag';
import { useLibrarySelection } from '../lib/useLibrarySelection';
import type { LibraryFolder, LibraryPaper, Paper, PaperLibrary } from '../types';

type Edit = { kind: 'create'; parentId: number | null } | { kind: 'renameFolder'; folder: LibraryFolder }
  | { kind: 'moveFolder'; folder: LibraryFolder } | { kind: 'deleteFolder'; folder: LibraryFolder }
  | { kind: 'renamePaper'; paper: LibraryPaper } | { kind: 'movePaper'; paper: LibraryPaper }
  | { kind: 'deletePaper'; paper: LibraryPaper } | { kind: 'metadata'; paper: LibraryPaper }
  | { kind: 'movePapers'; papers: LibraryPaper[] } | { kind: 'deletePapers'; papers: LibraryPaper[] };
type Menu = { x: number; y: number; target: { kind: 'root' } | { kind: 'folder'; folder: LibraryFolder } | { kind: 'paper'; paper: LibraryPaper } };
const titles = { create: '새 폴더', renameFolder: '폴더 이름 변경', moveFolder: '폴더 이동', deleteFolder: '폴더 삭제',
  renamePaper: '논문 이름 변경', movePaper: '논문 이동', deletePaper: '논문 삭제', metadata: '논문 정보 수정', movePapers: '선택한 논문 이동', deletePapers: '선택한 논문 삭제' };

function ancestors(folders: LibraryFolder[], id: number | null) {
  const path: LibraryFolder[] = [], seen = new Set<number>();
  while (id !== null && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find(folder => folder.id === id);
    if (!folder) break;
    path.unshift(folder); id = folder.parentId;
  }
  return path;
}

export const Library = memo(function Library({ active, revision, folderId, onFolderChange, opening, importMessage,
  onOpen, onRenamed, onDeleted, onBusyChange, onFoldersChange }: {
  active: boolean; revision: number; folderId: number | null; onFolderChange: (id: number | null) => void;
  opening: boolean; importMessage: string; onOpen: (paper: Paper) => void; onRenamed: (paper: Paper) => void;
  onDeleted: (ids: string[]) => void; onBusyChange: (busy: boolean) => void;
  onFoldersChange: (ids: number[]) => void;
}) {
  const [data, setData] = useState<PaperLibrary>({ folders: [], papers: [] });
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0), [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null), [name, setName] = useState(''), [destination, setDestination] = useState('');
  const [authors, setAuthors] = useState(''), [publishedDate, setPublishedDate] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const paths = useMemo(() => new Map(data.folders.map(folder => [folder.id, ancestors(data.folders, folder.id)])), [data.folders]);
  const folder = data.folders.find(folder => folder.id === folderId);
  const [{ key: sort, direction }, setSort] = useState(readLibrarySortPreference);
  const papers = useMemo(() => sortLibraryPapers(data.papers.filter(paper => paper.folderId === folderId), sort, direction), [data.papers, folderId, sort, direction]);
  const disabled = loading || !!loadError || busy || opening;
  const main = useRef<HTMLDivElement>(null), selectAll = useRef<HTMLInputElement>(null);
  const paperIds = useMemo(() => papers.map(paper => paper.id), [papers]);
  const selection = useLibrarySelection(active, disabled || !!edit, folderId, paperIds, main);
  const selectedPapers = papers.filter(paper => selection.selected.has(paper.id));
  const allSelected = papers.length > 0 && selectedPapers.length === papers.length;
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selectedPapers.length > 0 && !allSelected; }, [active, selectedPapers.length, allSelected]);
  const deleting = edit?.kind === 'deleteFolder' || edit?.kind === 'deletePaper' || edit?.kind === 'deletePapers';
  const moving = edit?.kind === 'moveFolder' || edit?.kind === 'movePaper' || edit?.kind === 'movePapers';
  const affectedFolders = edit?.kind === 'deleteFolder' ? data.folders.filter(folder => paths.get(folder.id)?.some(parent => parent.id === edit.folder.id)) : [];
  const affectedPapers = edit?.kind === 'deleteFolder' ? data.papers.filter(paper => affectedFolders.some(folder => folder.id === paper.folderId)) : [];

  useEffect(() => {
    if (!active) { setEdit(null); setMenu(null); return; }
    let current = true;
    setLoading(true); setLoadError('');
    void getLibrary().then(data => { if (current) setData(data); })
      .catch(error => { if (current) setLoadError(errorMessage(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, revision, retry]);
  useEffect(() => {
    if (active && !loading && !loadError) onFoldersChange(data.folders.map(folder => folder.id));
  }, [active, loading, loadError, data.folders, onFoldersChange]);
  useEffect(() => { setEdit(null); setMenu(null); }, [folderId]);
  useEffect(() => { setMessage(''); setError(''); }, [revision]);

  const navigate = (id: number | null) => { closeMenu(); onFolderChange(id); setEdit(null); setError(''); setMessage(''); };
  const start = (edit: Edit) => {
    closeMenu(); setEdit(edit); setError(''); setMessage('');
    setAuthors(edit.kind === 'metadata' ? edit.paper.authors : '');
    setPublishedDate(edit.kind === 'metadata' ? edit.paper.publishedDate : '');
    setName(edit.kind === 'renameFolder' ? edit.folder.name : edit.kind === 'renamePaper' || edit.kind === 'metadata' ? edit.paper.title : '');
    setDestination(edit.kind === 'moveFolder' ? String(edit.folder.parentId ?? '') : edit.kind === 'movePaper' ? String(edit.paper.folderId ?? '') : edit.kind === 'movePapers' ? String(folderId ?? '') : '');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!edit || disabled) return;
    setBusy(true); onBusyChange(true); setError(''); setMessage('');
    try {
      if (edit.kind === 'create') {
        const created = await createLibraryFolder(edit.parentId, name);
        // Update together to avoid treating the newly selected folder as missing before reload.
        setData(current => ({ ...current, folders: [...current.folders, created] }));
        onFolderChange(created.id);
      } else if (edit.kind === 'renameFolder') await renameLibraryFolder(edit.folder.id, name);
      else if (edit.kind === 'metadata') onRenamed(await updatePaperMetadata(edit.paper.id, { title: name, authors, publishedDate }));
      else if (edit.kind === 'renamePaper') onRenamed(await renameLibraryPaper(edit.paper.id, name));
      else if (edit.kind === 'moveFolder') await moveLibraryFolder(edit.folder.id, destination ? Number(destination) : null);
      else if (edit.kind === 'movePaper') await moveLibraryPaper(edit.paper.id, destination ? Number(destination) : null);
      else if (edit.kind === 'movePapers') { await moveLibraryPapers(edit.papers.map(paper => paper.id), destination ? Number(destination) : null); selection.clear(); }
      else {
        const result = edit.kind === 'deleteFolder' ? await deleteLibraryFolder(edit.folder.id)
          : edit.kind === 'deletePapers' ? await deleteLibraryPapers(edit.papers.map(paper => paper.id)) : await deleteLibraryPaper(edit.paper.id);
        onDeleted(result.paperIds);
        if (edit.kind === 'deletePapers') selection.clear();
        if (edit.kind === 'deleteFolder' && affectedFolders.some(folder => folder.id === folderId)) onFolderChange(edit.folder.parentId);
        if (result.cleanupPending) setMessage('Library에서 삭제했습니다. PDF 사본 정리는 다음 실행 때 다시 시도합니다.');
        else setMessage('삭제했습니다. Vocabulary 기록은 유지됩니다.');
      }
      setEdit(null); setRetry(value => value + 1);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); onBusyChange(false); }
  };
  const mutate = async (operation: () => Promise<unknown>) => {
    if (disabled) return;
    closeMenu(); setBusy(true); onBusyChange(true); setError(''); setMessage('');
    try { await operation(); setRetry(value => value + 1); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); onBusyChange(false); }
  };
  const saveMemo = async (paperId: string, memo: string) => {
    if (disabled) throw new Error('진행 중인 Library 작업이 끝난 뒤 다시 저장해 주세요.');
    setBusy(true); onBusyChange(true);
    try {
      await setPaperMemo(paperId, memo);
      setData(current => ({ ...current, papers: current.papers.map(paper => paper.id === paperId ? { ...paper, memo } : paper) }));
    } finally { setBusy(false); onBusyChange(false); }
  };
  const sortColumn = (key: LibrarySort, label: string) => <button aria-label={`${label} 정렬`} aria-pressed={sort === key}
    data-sort-direction={sort === key ? direction : undefined}
    title={sort === key ? `현재 ${direction === 'asc' ? '오름차순' : '내림차순'} · 클릭하면 방향 변경` : `${label} 기준으로 정렬`}
    onClick={() => {
      const next: LibrarySortPreference = { key,
        direction: sort === key ? direction === 'asc' ? 'desc' : 'asc' : key === 'title' || key === 'authors' || key === 'memo' ? 'asc' : 'desc' };
      setSort(next);
      try { saveLibrarySortPreference(next); }
      catch { setError('정렬 설정을 저장하지 못했습니다. 다음 실행 시 정렬이 초기화될 수 있습니다.'); }
    }}>{label}<span aria-hidden="true">{sort === key ? direction === 'asc' ? '↑' : '↓' : '↕'}</span></button>;
  const canDrop = (item: LibraryDragItem, target: number | null) => {
    if (disabled || !!edit || (target !== null && !data.folders.some(folder => folder.id === target))) return false;
    return item.kind === 'paper' ? item.ids.length > 0 && item.ids.every(id => data.papers.some(paper => paper.id === id && paper.folderId !== target))
      : data.folders.some(folder => folder.id === item.id && folder.parentId !== target)
        && !(paths.get(target ?? -1) ?? []).some(folder => folder.id === item.id);
  };
  const drag = useLibraryDrag(active, disabled || !!edit, canDrop, (item, target) => {
    setEdit(null);
    void mutate(async () => {
      if (item.kind === 'folder') await moveLibraryFolder(item.id, target);
      else { await (item.ids.length === 1 ? moveLibraryPaper(item.ids[0], target) : moveLibraryPapers(item.ids, target)); selection.clear(); }
    });
  }, item => {
    if (item.kind === 'paper' && !selection.selected.has(item.ids[0])) selection.select(item.ids[0], false, false);
  });
  const context = (event: MouseEvent<HTMLElement>, target: Menu['target']) => {
    event.preventDefault(); event.stopPropagation();
    if (disabled || drag.item) return;
    if (target.kind === 'paper' && !selection.selected.has(target.paper.id)) selection.select(target.paper.id, false, false);
    event.currentTarget.focus();
    setMenu({ x: event.clientX || 12, y: event.clientY || 12, target });
  };
  const menuItems = () => {
    if (!menu) return [];
    const target = menu.target;
    if (target.kind === 'root') return [{ label: '새 폴더', run: () => start({ kind: 'create', parentId: null }) }];
    if (target.kind === 'folder') return [
      { label: '새 하위 폴더', run: () => start({ kind: 'create', parentId: target.folder.id }) },
      { label: '이름 변경', run: () => start({ kind: 'renameFolder', folder: target.folder }) },
      { label: '폴더 이동', run: () => start({ kind: 'moveFolder', folder: target.folder }) },
      { label: '삭제', danger: true, run: () => start({ kind: 'deleteFolder', folder: target.folder }) },
    ];
    if (selectedPapers.length > 1 && selection.selected.has(target.paper.id)) return [
      { label: `선택한 ${selectedPapers.length}개 논문 이동`, run: () => start({ kind: 'movePapers', papers: selectedPapers }) },
      { label: `선택한 ${selectedPapers.length}개 논문 삭제`, danger: true, run: () => start({ kind: 'deletePapers', papers: selectedPapers }) },
    ];
    return [
      { label: '열기', run: () => onOpen(target.paper) },
      { label: '이름 변경', run: () => start({ kind: 'renamePaper', paper: target.paper }) },
      { label: '논문 정보 수정', run: () => start({ kind: 'metadata', paper: target.paper }) },
      { label: '새 폴더', run: () => start({ kind: 'create', parentId: target.paper.folderId }) },
      { label: '폴더로 이동', run: () => start({ kind: 'movePaper', paper: target.paper }) },
      { label: '삭제', danger: true, run: () => start({ kind: 'deletePaper', paper: target.paper }) },
    ];
  };
  const renderFolders = (parentId: number | null, seen = new Set<number>()): React.ReactNode => <ul>
    {data.folders.filter(folder => folder.parentId === parentId && !seen.has(folder.id)).map(folder => <li key={folder.id}>
      <button disabled={disabled} aria-current={folderId === folder.id ? 'page' : undefined} title={folder.name}
        data-folder-drop={folder.id} data-drop-active={drag.item && drag.target === folder.id ? 'true' : undefined}
        onPointerDown={event => { closeMenu(); drag.begin(event, { kind: 'folder', id: folder.id, label: folder.name }); }}
        onContextMenu={event => context(event, { kind: 'folder', folder })}
        onClick={() => navigate(folder.id)}><span aria-hidden="true">▱</span>{folder.name}</button>
      {renderFolders(folder.id, new Set([...seen, folder.id]))}
    </li>)}
  </ul>;

  if (!active) return null;
  return <section className="library-page" aria-label="Library" onDragStart={event => event.preventDefault()}
    onPointerDownCapture={() => { drag.suppressClick.current = false; selection.suppressClick.current = false; }}
    onClickCapture={event => { if (drag.suppressClick.current || selection.suppressClick.current) {
      event.preventDefault(); event.stopPropagation(); drag.suppressClick.current = false; selection.suppressClick.current = false;
    } }}>
    <aside className="library-sidebar">
      <h1>Library</h1><p>논문을 폴더로 정리하세요.</p>
      <button className="library-sidebar-create" disabled={disabled} onClick={() => start({ kind: 'create', parentId: folderId })}>＋ 폴더 생성</button>
      <nav aria-label="Library 폴더">
        <button className="library-root" disabled={disabled} aria-current={folderId === null ? 'page' : undefined}
          data-folder-drop="root" data-drop-active={drag.item && drag.target === null ? 'true' : undefined}
          onContextMenu={event => context(event, { kind: 'root' })} onClick={() => navigate(null)}>Library 홈</button>
        {renderFolders(null)}
      </nav>
    </aside>
    <div ref={main} className="library-main" onPointerDown={selection.begin}>
      <nav className="library-breadcrumb" aria-label="현재 폴더 경로">
        <button disabled={disabled} onClick={() => navigate(null)}>Library 홈</button>
        {(paths.get(folderId ?? -1) ?? []).map(folder => <span key={folder.id}> / <button disabled={disabled} onClick={() => navigate(folder.id)}>{folder.name}</button></span>)}
      </nav>
      <div className="library-heading"><h2>{folder?.name ?? 'Library'}</h2><span>{papers.length}개 논문</span></div>
      <div className="library-tools">
        <button className="open-button" disabled={disabled} onClick={() => start({ kind: 'create', parentId: folderId })}>새 폴더</button>
        {folder && <>
          <button disabled={disabled} onClick={() => start({ kind: 'renameFolder', folder })}>폴더 이름 변경</button>
          <button disabled={disabled} onClick={() => start({ kind: 'moveFolder', folder })}>폴더 이동</button>
          <button className="library-delete" disabled={disabled} onClick={() => start({ kind: 'deleteFolder', folder })}>폴더 삭제</button>
        </>}
      </div>
      <div className="library-selection-tools">
        <label><input ref={selectAll} type="checkbox" checked={allSelected} disabled={disabled || !!edit || !papers.length}
          onChange={event => selection.assign(new Set(event.target.checked ? paperIds : []))} />전체 선택</label>
        <span aria-live="polite">{selectedPapers.length}개 선택</span>
        <button disabled={disabled || !!edit || !selectedPapers.length} onClick={() => start({ kind: 'movePapers', papers: selectedPapers })}>선택 이동</button>
        <button className="library-delete" disabled={disabled || !!edit || !selectedPapers.length} onClick={() => start({ kind: 'deletePapers', papers: selectedPapers })}>선택 삭제</button>
      </div>
      <p className="library-selection-hint">Ctrl 클릭: 개별 선택 · Shift 클릭: 범위 선택 · 빈 영역 드래그: 여러 개 선택</p>
      {importMessage && <p className="library-message" role="status">{importMessage}</p>}
      {message && <p className="library-message" role="status">{message}</p>}
      {!edit && error && <p className="library-message" role="alert">{error}</p>}
      {loadError && <div className="library-message" role="alert">{loadError} <button onClick={() => setRetry(value => value + 1)}>다시 시도</button></div>}
      {edit && <form key={edit.kind} className="library-form" aria-label={titles[edit.kind]} onSubmit={event => void submit(event)}
        onKeyDown={event => { if (event.key === 'Escape' && !busy) setEdit(null); }}>
        <h3>{titles[edit.kind]}</h3>
        {(edit.kind === 'movePapers' || edit.kind === 'deletePapers') && <><p>선택한 논문 {edit.papers.length}개</p>
          <ul className="library-batch-names">{edit.papers.map(paper => <li key={paper.id}>{paper.title}</li>)}</ul></>}
        {edit.kind === 'create' && <p>위치: Library{(paths.get(edit.parentId ?? -1) ?? []).map(folder => ` / ${folder.name}`).join('')}</p>}
        {deleting ? <>
          <p>{edit.kind === 'deleteFolder' ? `“${edit.folder.name}” 폴더와 하위 폴더 ${Math.max(0, affectedFolders.length - 1)}개, 논문 ${affectedPapers.length}개를 삭제합니다.`
            : edit.kind === 'deletePapers' ? `선택한 ${edit.papers.length}개 논문을 삭제합니다.` : `“${edit.kind === 'deletePaper' ? edit.paper.title : ''}” 논문을 삭제합니다.`}</p>
          <p>앱에 저장한 PDF 사본을 삭제합니다. 원본 파일과 Vocabulary 기록은 유지됩니다.</p>
          <p>Ctrl+Z로 되돌릴 수 있도록 PDF 사본은 실행 취소 기록이 유지되는 동안 임시 보관됩니다.</p>
        </> : moving ? <label>이동할 폴더<select autoFocus value={destination} disabled={busy} onChange={event => setDestination(event.target.value)}>
          <option value="">Library 홈</option>
          {data.folders.filter(folder => edit.kind !== 'moveFolder' || !paths.get(folder.id)?.some(parent => parent.id === edit.folder.id))
            .map(folder => <option key={folder.id} value={folder.id}>{paths.get(folder.id)?.map(folder => folder.name).join(' / ')}</option>)}
        </select></label> : <label>{edit.kind === 'renamePaper' || edit.kind === 'metadata' ? '논문 이름' : '폴더 이름'}<input autoFocus value={name} required
          maxLength={edit.kind === 'renamePaper' || edit.kind === 'metadata' ? 300 : 100} disabled={busy} onChange={event => setName(event.target.value)} /></label>}
        {edit.kind === 'metadata' && <>
          <label>저자명<input value={authors} maxLength={1000} disabled={busy} onChange={event => setAuthors(event.target.value)} /></label>
          <label>발행일<input value={publishedDate} placeholder="YYYY-MM-DD (연도 또는 연월만 입력 가능)" maxLength={10} disabled={busy} onChange={event => setPublishedDate(event.target.value)} /></label>
        </>}
        {error && <p className="bubble-error" role="alert">{error}</p>}
        <div><button type="submit" className={deleting ? 'library-delete' : 'open-button'} disabled={disabled || (!deleting && !moving && !name.trim())}>
          {busy ? '처리 중…' : deleting ? '삭제하기' : edit.kind === 'create' ? '만들기' : moving ? '이동' : '저장'}</button>
          <button type="button" disabled={busy} onClick={() => setEdit(null)}>취소</button></div>
      </form>}
      {loading ? <p className="library-message" role="status">Library를 불러오는 중…</p> : !loadError && <>
        {!papers.length ? <div className="library-empty"><strong>이 위치에 저장된 논문이 없습니다.</strong>
          <p>상단의 PDF 추가 버튼을 누르거나<br />PDF 파일을 이 창에 끌어다 놓으세요.</p></div>
          : <div className="library-list-scroll"><div className="library-columns">
            {sortColumn('title', '논문 제목')}{sortColumn('importance', '중요도')}{sortColumn('memo', '메모')}
            {sortColumn('authors', '저자명')}{sortColumn('publishedDate', '발행일')}{sortColumn('uploadedAt', '업로드 날짜')}</div>
            <ul className="library-papers" aria-label="저장된 논문">{papers.map(paper => <li key={paper.id} tabIndex={0}
              data-paper-id={paper.id} data-selection-id={paper.id} data-selected={selection.selected.has(paper.id)}
              onContextMenu={event => context(event, { kind: 'paper', paper })}
              onClickCapture={event => {
                if (!(event.ctrlKey || event.metaKey || event.shiftKey) || (event.target as Element).closest('.library-paper-actions, .library-rating, .library-memo, input')) return;
                event.preventDefault(); event.stopPropagation(); selection.select(paper.id, event.ctrlKey || event.metaKey, event.shiftKey);
              }}
              onClick={event => { if (!(event.target as Element).closest('button, input, textarea, select, label')) selection.select(paper.id, false, false); }}
              onKeyDown={event => { if (event.target === event.currentTarget && event.key === ' ') {
                event.preventDefault(); selection.select(paper.id, event.ctrlKey || event.metaKey, event.shiftKey);
              } }}
              onPointerDown={event => {
                if (disabled || edit || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey ||
                  (event.target as Element).closest('.library-paper-actions, .library-rating, .library-memo, input')) return;
                const ids = selection.selected.has(paper.id) ? selectedPapers.map(paper => paper.id) : [paper.id];
                closeMenu(); drag.begin(event, { kind: 'paper', ids, label: ids.length > 1 ? `${ids.length}개 논문` : paper.title });
              }}>
            <div className="library-paper-details">
            <div className="library-paper-title"><input className="library-paper-select" type="checkbox" aria-label={`${paper.title} 선택`}
              disabled={disabled || !!edit} checked={selection.selected.has(paper.id)} onChange={() => {}}
              onClick={event => { event.stopPropagation(); selection.select(paper.id, !event.shiftKey || event.ctrlKey || event.metaKey, event.shiftKey); }} />
              <span className="library-pdf-icon" aria-hidden="true">PDF</span>
              <div><button className="library-open-paper" disabled={disabled} onClick={() => onOpen(paper)}>{paper.title}</button>
                {paper.title !== paper.fileName && <small>{paper.fileName}</small>}</div></div>
            <div className="library-rating" role="radiogroup" aria-label={`${paper.title} 중요도${paper.importance ? '' : ' (미지정)'}`}>
              {[1, 2, 3, 4, 5].map(value => <label key={value} title={paper.importance === value ? `중요도 ${value}점 · 다시 누르면 해제` : `중요도 ${value}점`} data-filled={value <= paper.importance}>
                <input type="radio" name={`importance-${paper.id}`} aria-label={`중요도 ${value}점`} value={value} checked={paper.importance === value}
                  disabled={disabled} onClick={() => { if (paper.importance === value) void mutate(() => setPaperImportance(paper.id, 0)); }}
                  onKeyDown={event => { if (event.key === ' ' && paper.importance === value) {
                    event.preventDefault(); if (!event.repeat) void mutate(() => setPaperImportance(paper.id, 0));
                  } }}
                  onChange={() => void mutate(() => setPaperImportance(paper.id, value))} /><span aria-hidden="true">★</span>
              </label>)}
            </div>
            <PaperMemo title={paper.title} memo={paper.memo} disabled={disabled} onSave={memo => saveMemo(paper.id, memo)} />
            <span className="library-authors" title={paper.authors}>{paper.authors || '—'}</span>
            <span className="library-published">{paper.publishedDate || '—'}</span>
            <time className="library-uploaded" dateTime={paper.uploadedAt} title={paper.uploadedAt}>{paper.uploadedAt ? new Date(paper.uploadedAt).toLocaleDateString('sv-SE') : '—'}</time>
            </div>
            <div className="library-paper-actions"><button disabled={disabled} onClick={() => start({ kind: 'renamePaper', paper })}>이름 변경</button>
              <button disabled={disabled} onClick={() => start({ kind: 'metadata', paper })}>논문 정보 수정</button>
              <button disabled={disabled} onClick={() => start({ kind: 'movePaper', paper })}>폴더로 이동</button>
              <button className="library-delete" disabled={disabled} onClick={() => start({ kind: 'deletePaper', paper })}>삭제</button></div>
          </li>)}</ul></div>}
      </>}
    </div>
    {menu && !disabled && <LibraryMenu x={menu.x} y={menu.y} items={menuItems()} onClose={closeMenu} />}
    {drag.item && <div ref={drag.ghost} className="library-drag-ghost" role="status">{drag.item.label}</div>}
    {selection.dragging && <div ref={selection.overlay} className="library-selection-box" aria-hidden="true" />}
  </section>;
});
