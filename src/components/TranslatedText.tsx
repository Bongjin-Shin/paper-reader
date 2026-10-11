import { Fragment, memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { TranslatedSentence } from '../types';
import { chatMarkdown } from '../lib/chatMarkdown';
import { TranslationMath } from './TranslationMath';
import type { usePageTranslation } from '../lib/usePageTranslation';
import 'katex/dist/katex.min.css';

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: import('unified').PluggableList = [[rehypeKatex, { trust: false, throwOnError: false, strict: 'ignore', maxExpand: 1000 }]];
const SentenceContent = memo(function SentenceContent({ sentence }: { sentence: TranslatedSentence }) {
  const equations = new Map(sentence.equations?.map(m => [m.token, m.latex]) ?? []);
  const text = sentence.translation.replace(/\[\[PV_MATH_\d+\]\]/g, token => {
    if (!equations.has(token)) return sentence.layout?.math.find(m => m.token === token)?.text ?? '';
    return '`' + token + '`';
  });
  return <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={{
    p: ({ children }) => <span className="translation-markdown-paragraph">{children}</span>,
    code: ({ children }) => {
      const token = String(children), latex = equations.get(token);
      return latex ? <TranslationMath latex={latex} source={sentence.layout?.math.find(m=>m.token===token)} display={sentence.layout?.kind === 'equation'} /> : <code>{children}</code>;
    },
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
    const id=sentence.layout?.table?.id ?? sentence.layout?.paragraph ?? sentence.id, kind=sentence.layout?.kind ?? 'paragraph';
    if(paragraphs.at(-1)?.id!==id || paragraphs.at(-1)?.kind!==kind) paragraphs.push({id,kind,sentences:[]});
    paragraphs.at(-1)!.sentences.push(sentence);
  }
  const labels: Record<string, string> = { caption: '그림·표 설명', footnote: '각주', header: '머리말', footer: '꼬리말' };
  return <div className="translated-sentences" onMouseLeave={()=>t.hover(null)}>
    {paragraphs.map(({id,kind,sentences})=>kind === 'table' ? <div key={`${id}-${kind}`} className="translation-table-scroll" role="region" aria-label="표 번역" tabIndex={0}>
      <table className="translation-table"><tbody>{Array.from(new Set(sentences.map(s=>s.layout!.table!.row))).map(row=><tr key={row}>
        {Array.from({length:sentences[0].layout!.table!.columns},(_,column)=>{
          const rows=sentences.filter(s=>s.layout!.table!.row===row && s.layout!.table!.column===column), Cell=rows[0]?.layout?.table?.header ? 'th' : 'td';
          return <Cell key={column} scope={Cell==='th'?'col':undefined}>{rows.map(sentence=><Sentence key={sentence.id} sentence={sentence} pageNumber={pageNumber} t={t}/>)}</Cell>;
        })}</tr>)}</tbody></table>
    </div> : <div key={`${id}-${kind}`} className={`translation-paragraph translation-${kind}`} aria-label={labels[kind]}>
      {labels[kind] && <span className="translation-region-label" aria-hidden="true">{labels[kind]}</span>}
      {sentences.map((sentence,index)=><Fragment key={sentence.id}>{index>0?' ':null}<Sentence sentence={sentence} pageNumber={pageNumber} t={t}/></Fragment>)}
    </div>)}
  </div>;
}
