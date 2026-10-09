import { mathMarkdown } from './mathClipboard';

export function selectedText(node: Text, range: Range): string {
  if (!range.intersectsNode(node)) return '';
  return node.data.slice(range.startContainer === node ? range.startOffset : 0,
    range.endContainer === node ? range.endOffset : node.length);
}
const blockTags = new Set(['P','DIV','SECTION','ARTICLE','BLOCKQUOTE','UL','OL','PRE']);
/** Serialize selected content against the original DOM so a partial selection
 * inside KaTeX can still reach its complete, authoritative TeX annotation. */
export function selectedMarkdown(root: Element, range: Range): string {
  const visit = (node: Node): string => {
    if (!range.intersectsNode(node)) return '';
    if (node.nodeType === Node.TEXT_NODE) return selectedText(node as Text, range);
    if (!(node instanceof Element)) return '';
    if (node.matches('.katex-display, .katex')) {
      const latex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      return latex ? mathMarkdown(latex, node.matches('.katex-display') || !!node.closest('.katex-display')) : '';
    }
    if (node.matches('[aria-hidden="true"], .translation-page-header, .translation-region-label, [role="status"], [role="alert"], button, script, style')) return '';
    if (node.tagName === 'BR') return '\n';
    const content = [...node.childNodes].map(visit).join('');
    if (!content.trim()) return content;
    if (node.tagName === 'STRONG' || node.tagName === 'B') return `**${content}**`;
    if (node.tagName === 'EM' || node.tagName === 'I') return `*${content}*`;
    if (node.tagName === 'DEL') return `~~${content}~~`;
    if (node.tagName === 'CODE') return node.closest('pre') ? content : '`' + content + '`';
    if (node.tagName === 'PRE') return '\n\n```\n' + content.trim() + '\n```\n\n';
    if (node.tagName === 'LI') return `\n- ${content.trim()}\n`;
    if (/^H[1-6]$/.test(node.tagName)) return `\n\n${'#'.repeat(Number(node.tagName[1]))} ${content.trim()}\n\n`;
    if (node.classList.contains('translation-heading')) return `\n\n## ${content.trim()}\n\n`;
    if (node.classList.contains('translated-sentence') || node.classList.contains('translation-markdown-paragraph')) return content;
    return blockTags.has(node.tagName) ? `\n\n${content.trim()}\n\n` : content;
  };
  return [...root.childNodes].map(visit).join('').replace(/\n{3,}/g,'\n\n').trim();
}
export function writeMarkdownCopy(event: ClipboardEvent, markdown: string) {
  if (!event.clipboardData || !markdown.trim()) return;
  event.preventDefault();
  event.clipboardData.clearData();
  event.clipboardData.setData('text/plain', markdown);
  event.clipboardData.setData('text/markdown', markdown);
}
