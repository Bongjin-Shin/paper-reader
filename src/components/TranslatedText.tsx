import { useEffect, useState, useRef, Fragment } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { EquationSource, TranslatedSentence } from '../types';
import { createEquationRenderer } from '../lib/equationImages';
import type { usePageTranslation } from '../lib/usePageTranslation';

type Renderer = ReturnType<typeof createEquationRenderer>;
function Equation({source,renderer}: {source:EquationSource;renderer:Renderer | undefined}) {
  const [image,setImage] = useState<string>(), [failed,setFailed] = useState(false);
  const key = source.rect.join(',');
  useEffect(() => { let live = true; setImage(undefined); setFailed(false);
    if (!renderer) return;
    void renderer.image(source.rect).then(url=>{if(live)setImage(url);},()=>{if(live)setFailed(true);});
    return ()=>{live=false;};
  },[renderer,key]);
  return image ? <img className="translation-equation" src={image} alt={`수식: ${source.text}`} draggable={false}
    style={{width:`${(source.rect[2]-source.rect[0])/source.fontSize}em`}} />
    : <span className="translation-equation-fallback" title={failed ? '원본 수식 이미지를 표시하지 못했습니다.' : '원본 수식을 불러오는 중…'}>{source.text}</span>;
}
function Sentence({sentence,renderers,t,pageNumber}: {sentence:TranslatedSentence;renderers:Map<number, Renderer>;pageNumber:number;t:ReturnType<typeof usePageTranslation>}) {
  const equations = new Map(sentence.layout?.math.map(m=>[m.token,m]) ?? []);
  const text = sentence.layout?.kind === 'equation' ? sentence.text : sentence.translation;
  return <span role="button" tabIndex={0} className="translated-sentence" data-sentence-id={sentence.id}
    aria-pressed={t.matches(sentence,pageNumber)} style={sentence.layout?.typography ? {
      fontSize: `${sentence.layout.typography.fontScale}em`, fontWeight: sentence.layout.typography.bold ? 700 : 400,
      fontStyle: sentence.layout.typography.italic ? 'italic' : 'normal',
    } : undefined} onMouseEnter={()=>t.hover(sentence,pageNumber)} onFocus={()=>t.hover(sentence,pageNumber)} onBlur={()=>t.hover(null)}
    onClick={()=>t.select(sentence,pageNumber)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();t.select(sentence,pageNumber);}}}>
    {text.split(/(\[\[PV_MATH_\d+\]\])/g).map((part,index)=> {
      const math = equations.get(part); return math ? <Equation key={index} source={math} renderer={renderers.get(math.pageNumber ?? pageNumber)} /> : <Fragment key={index}>{part}</Fragment>;
    })}
  </span>;
}
export function TranslatedText({pdf,sentences,t,pageNumber}: {pdf:PDFDocumentProxy;pageNumber:number;sentences:TranslatedSentence[];t:ReturnType<typeof usePageTranslation>}) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)),
      { root: root.current.closest('.translation-content'), rootMargin: '300px' });
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const [renderers,setRenderers] = useState(new Map<number, Renderer>());
  const pages = [...new Set(sentences.flatMap(s => s.layout?.math.map(m => m.pageNumber ?? pageNumber) ?? []))].sort().join(',');
  useEffect(()=>{ const next = new Map<number, Renderer>();
    for (const number of (visible ? pages : '').split(',').filter(Boolean).map(Number)) next.set(number, createEquationRenderer(pdf,number));
    setRenderers(next); return ()=>next.forEach(r=>r.dispose()); },[pdf,pages,visible]);
  const paragraphs: {id:number;kind:string;sentences:TranslatedSentence[]}[]=[];
  for(const sentence of sentences) {
    const id=sentence.layout?.paragraph ?? sentence.id, kind=sentence.layout?.kind ?? 'paragraph';
    if(paragraphs.at(-1)?.id!==id || paragraphs.at(-1)?.kind!==kind) paragraphs.push({id,kind,sentences:[]});
    paragraphs.at(-1)!.sentences.push(sentence);
  }
  return <div ref={root} className="translated-sentences" onMouseLeave={()=>t.hover(null)}>
    {paragraphs.map(({id,kind,sentences})=><p key={`${id}-${kind}`} className={`translation-paragraph translation-${kind}`}>
      {sentences.map((sentence,index)=><Fragment key={sentence.id}>{index>0?' ':null}<Sentence sentence={sentence} renderers={renderers} pageNumber={pageNumber} t={t}/></Fragment>)}
    </p>)}
  </div>;
}
