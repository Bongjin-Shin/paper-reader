import { useEffect, useRef, type RefObject } from 'react';
import type { usePageTranslation } from './usePageTranslation';
import { copyPdfSelection } from './pdfClipboard';
import { selectedMarkdown, writeMarkdownCopy } from './clipboard';

export function usePaperClipboard(reader: RefObject<HTMLElement | null>, translation: ReturnType<typeof usePageTranslation>, active: boolean) {
  const current=useRef(translation);current.current=translation;
  useEffect(() => {
    if (!active) return;
    const warm = () => {
      const selection=window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed || !reader.current?.contains(selection.anchorNode)) return;
      // Local cache reads only; copying never starts a translation request.
      for (const node of [selection.anchorNode,selection.focusNode]) {
        const element=node instanceof Element?node:node?.parentElement;
        const number=Number(element?.closest<HTMLElement>('.pdf-page')?.dataset.pageNumber);
        if(number)void current.current.load(number,false);
      }
    };
    const copy = (event: ClipboardEvent) => {
      const target=event.target instanceof Element ? event.target : null;
      if(target?.closest('input, textarea, [contenteditable="true"]'))return;
      const selection=window.getSelection();
      if(!selection?.rangeCount || selection.isCollapsed)return;
      const range=selection.getRangeAt(0),root=reader.current;
      if(root?.contains(range.startContainer) && root.contains(range.endContainer)) {
        writeMarkdownCopy(event,copyPdfSelection(root,range,n=>current.current.entries.get(n)?.data ?? undefined));
        return;
      }
      const pane=document.querySelector('.translation-content');
      if(pane?.contains(range.startContainer) && pane.contains(range.endContainer)) writeMarkdownCopy(event,selectedMarkdown(pane,range));
    };
    document.addEventListener('selectionchange',warm);
    document.addEventListener('copy',copy);
    return () => {document.removeEventListener('selectionchange',warm);document.removeEventListener('copy',copy);};
  },[reader,active]);
}
