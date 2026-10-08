import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Root, RootContent, Text } from 'mdast';
import { chatMarkdown } from '../lib/chatMarkdown';
import 'katex/dist/katex.min.css';

function citations() {
  return (tree: Root) => {
    const visit = (parent: { children: RootContent[] }) => {
      parent.children = parent.children.flatMap(node => {
        if (node.type === 'text') {
          const pieces: RootContent[] = []; let start = 0;
          for (const match of node.value.matchAll(/\[p\.\s*(\d+)\]/g)) {
            if (match.index > start) pieces.push({ type: 'text', value: node.value.slice(start, match.index) });
            pieces.push({ type: 'link', url: `#paper-page-${match[1]}`, children: [{ type: 'text', value: match[0] } as Text] });
            start = match.index + match[0].length;
          }
          pieces.push({ type: 'text', value: node.value.slice(start) }); return pieces;
        }
        if ('children' in node && node.type !== 'link' && node.type !== 'linkReference') visit(node as { children: RootContent[] });
        return [node];
      });
    };
    visit(tree);
  };
}
const remarkPlugins = [remarkGfm, remarkMath, citations];
const rehypePlugins: import('unified').PluggableList = [[rehypeKatex, { trust: false, throwOnError: false, strict: 'ignore', maxExpand: 1000 }]];
export const ChatAnswer = memo(function ChatAnswer({ text, onPage, total }: { text: string; onPage: (page: number) => void; total: number }) {
  return <div className="chat-answer"><Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}
    components={{
      a: ({ href, children }) => {
        const page = Number(/^#paper-page-(\d+)$/.exec(href ?? '')?.[1]);
        return page > 0 && page <= total ? <button className="chat-citation" onClick={() => onPage(page)}>{children}</button>
          : <span>{children}</span>;
      },
      img: ({ alt }) => <span>{alt}</span>,
    }}>{chatMarkdown(text)}</Markdown></div>;
});
