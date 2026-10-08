/** Convert the LaTeX delimiters often returned by chat, preserving code examples. */
export function chatMarkdown(text: string): string {
  return text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?=\n|$)|$)|(`+)[^`]*?\2|\\\[([\s\S]*?)\\\]|\\\(([^\n]*?)\\\)/g,
    (match, fence: string | undefined, code: string | undefined, display: string | undefined, inline: string | undefined) => {
      if (fence || code) return match;
      return display !== undefined ? `\n\n$$\n${display.trim()}\n$$\n\n` : `$${inline}$`;
    });
}
