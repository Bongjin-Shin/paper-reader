import type { RefObject } from 'react';
import { useListSelection } from './useListSelection';

export { selectListRange as selectLibraryRange } from './useListSelection';

export function useLibrarySelection(active: boolean, disabled: boolean, scope: number | null, ids: string[],
  host: RefObject<HTMLDivElement | null>) {
  return useListSelection(active, disabled, scope, ids, host, '.library-columns, .library-tools, .library-selection-tools');
}
