import { Fragment, memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { TranslatedSentence } from '../types';
import { chatMarkdown } from '../lib/chatMarkdown';
import type { usePageTranslation } from '../lib/usePageTranslation';
import 'katex/dist/katex.min.css';

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: import('unified').PluggableList = [[rehypeKatex, { trust: false, throwOnError: false, strict: 'ignore', maxExpand: 1000 }]];
const SentenceContent = memo(function SentenceContent({ sentence }: { sentence: TranslatedSentence }) {
  const equations = new Map(sentence.equations?.map(m => [m.token, m.latex]) ?? []);
  const text = sentence.translation.replace(/\[\[PV_MATH_\d+\]\]/g, token => {
    const latex = equations.get(token)?.trim().replace(/^\$\$?\s*|\s*\$\$?$/g, '');
    if (!latex) return sentence.layout?.math.find(m => m.token === token)?.text ?? '';
    return sentence.layout?.kind === 'equation' ? `\n\n$$\n${latex}\n$$\n\n` : `$${latex}$`;
  });
  return <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={{
    p: ({ children }) => <span className="translation-markdown-paragraph">{children}</span>,
    a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt}</span>,
  }}>{chatMarkdown(text)}</Markdown>;
});
function Sentence({sentence,t,pageNumber}: {sentence:TranslatedSentence;pageNumber:number;t:ReturnType<typeof usePageTranslation>}) {
  return <div role="button" tabIndex={0} className="translated-sentence" data-sentence-id={sentence.id}
    aria-pressed={t.matches(sentence,pageNumber)} style={sentence.layout?.typography ? {
      fontSize: `${sentence.layout.typography.fontScale}em`, fontWeight: sentence.layout.typography.bold ? 700 : 400,
      fontStyle: sentence.layout.typography.italic ? 'italic' : 'normal',
    } : undefined} onMouseEnter={()=>t.hover(sentence,pageNumber)} onFocus={()=>t.hover(sentence,pageNumber)} onBlur={()=>t.hover(null)}
    onClick={()=>{if (window.getSelection()?.isCollapsed !== false) t.select(sentence,pageNumber);}}
    onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();t.select(sentence,pageNumber);}}}>
    <SentenceContent sentence={sentence} />
  </div>;
}
export function TranslatedText({sentences,t,pageNumber}: {pageNumber:number;sentences:TranslatedSentence[];t:ReturnType<typeof usePageTranslation>}) {
  const paragraphs: {id:number;kind:string;sentences:TranslatedSentence[]}[]=[];
  for(const sentence of sentences) {
    const id=sentence.layout?.paragraph ?? sentence.id, kind=sentence.layout?.kind ?? 'paragraph';
    if(paragraphs.at(-1)?.id!==id || paragraphs.at(-1)?.kind!==kind) paragraphs.push({id,kind,sentences:[]});
    paragraphs.at(-1)!.sentences.push(sentence);
  }
  const labels: Record<string, string> = { caption: '그림·표 설명', footnote: '각주', header: '머리말', footer: '꼬리말' };
  return <div className="translated-sentences" onMouseLeave={()=>t.hover(null)}>
    {paragraphs.map(({id,kind,sentences})=><div key={`${id}-${kind}`} className={`translation-paragraph translation-${kind}`} aria-label={labels[kind]}>
      {labels[kind] && <span className="translation-region-label" aria-hidden="true">{labels[kind]}</span>}
      {sentences.map((sentence,index)=><Fragment key={sentence.id}>{index>0?' ':null}<Sentence sentence={sentence} pageNumber={pageNumber} t={t}/></Fragment>)}
    </div>)}
  </div>;
}
