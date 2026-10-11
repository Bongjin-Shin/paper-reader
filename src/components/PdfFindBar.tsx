import type { usePdfSearch } from '../lib/usePdfSearch';

export function PdfFindBar({ search }: { search: ReturnType<typeof usePdfSearch> }) {
  return <div className="pdf-find-bar" role="search" aria-label="본문 내 찾기">
    <input ref={search.input} value={search.query} aria-label="본문 검색어" placeholder="본문에서 찾기…"
      onChange={event => search.setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); search.navigate(event.shiftKey ? -1 : 1); }
      }} />
    <span role="status">{search.busy ? '찾는 중…' : search.query.trim() ? search.matches.length ? `${search.selected + 1}/${search.matches.length}` : '검색 결과 없음' : ''}</span>
    <button aria-label="이전 검색 결과" title="이전 검색 결과 (Shift+Enter)" disabled={!search.matches.length || search.busy} onClick={() => search.navigate(-1)}>↑</button>
    <button aria-label="다음 검색 결과" title="다음 검색 결과 (Enter)" disabled={!search.matches.length || search.busy} onClick={() => search.navigate(1)}>↓</button>
    <button aria-label="본문 찾기 닫기" title="닫기 (Esc)" onClick={search.close}>×</button>
    {search.error && <small role="alert">{search.error}</small>}
  </div>;
}
