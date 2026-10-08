import { useCallback, useReducer } from 'react';

type View = 'reader' | 'library' | 'vocabulary';
type Location = { view: View; folderId: number | null };
export type NavigationState = { current: Location; history: Location[]; future: Location[] };
type Action = { type: 'view'; view: View } | { type: 'folder'; folderId: number | null }
  | { type: 'back' } | { type: 'forward' } | { type: 'folders'; ids: number[] };
const same = (a: Location, b: Location) => a.view === b.view && (a.view !== 'library' || a.folderId === b.folderId);
export const initialNavigation: NavigationState = { current: { view: 'reader', folderId: null }, history: [], future: [] };

export function navigationReducer(state: NavigationState, action: Action): NavigationState {
  if (action.type === 'back') {
    const previous = state.history.at(-1);
    return previous ? { current: previous, history: state.history.slice(0, -1), future: [...state.future, state.current] } : state;
  }
  if (action.type === 'forward') {
    const next = state.future.at(-1);
    return next ? { current: next, history: [...state.history, state.current], future: state.future.slice(0, -1) } : state;
  }
  if (action.type === 'folders') {
    const valid = new Set(action.ids);
    const validLocation = (location: Location) => location.folderId === null || valid.has(location.folderId);
    const current = validLocation(state.current) ? state.current : { ...state.current, folderId: null };
    const prune = (locations: Location[]) => locations.filter(location => location.view !== 'library' || validLocation(location))
      .map(location => validLocation(location) ? location : { ...location, folderId: null })
      .filter((location, i, all) => !same(location, all[i + 1] ?? current));
    const history = prune(state.history), future = prune(state.future);
    const unchanged = (a: Location[], b: Location[]) => a.length === b.length && a.every((location, i) => location === b[i]);
    if (current === state.current && unchanged(history, state.history) && unchanged(future, state.future)) return state;
    return { current, history, future };
  }
  const current: Location = action.type === 'view' ? { ...state.current, view: action.view }
    : { view: 'library', folderId: action.folderId };
  return same(state.current, current) ? state : { current, history: [...state.history, state.current], future: [] };
}

/** Only explicit navigation changes history; PDF canvases and Reader scroll state stay mounted. */
export function useNavigation() {
  const [state, dispatch] = useReducer(navigationReducer, initialNavigation);
  const setView = useCallback((view: View) => dispatch({ type: 'view', view }), []);
  const setFolder = useCallback((folderId: number | null) => dispatch({ type: 'folder', folderId }), []);
  const syncFolders = useCallback((ids: number[]) => dispatch({ type: 'folders', ids }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  const forward = useCallback(() => dispatch({ type: 'forward' }), []);
  return { ...state.current, canGoBack: state.history.length > 0, canGoForward: state.future.length > 0,
    setView, setFolder, syncFolders, back, forward };
}
