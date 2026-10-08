import { AnnotationMode, type PDFDocumentProxy, type RenderTask, type PageViewport } from 'pdfjs-dist';
import type { PdfRect } from '../types';

/** One bounded raster per visible translation page; never rerender on hover/zoom/resize.
 * Formula crops preserve fractions, vectors and scripts without model reconstruction. */
export function createEquationRenderer(pdf: PDFDocumentProxy, number: number) {
  let disposed = false, render: RenderTask | undefined, canvas: HTMLCanvasElement | undefined;
  let raster: Promise<{ canvas: HTMLCanvasElement; viewport: PageViewport }> | undefined;
  const crops = new Map<string, Promise<string>>();
  const prepare = () => raster ??= (async () => {
    const page = await pdf.getPage(number);
    if (disposed) throw new Error('수식 표시 취소');
    const base = page.getViewport({scale:1,rotation:0});
    const scale = Math.min(2, Math.sqrt(4_000_000 / (base.width * base.height)));
    const viewport = page.getViewport({scale,rotation:0});
    canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    render = page.render({canvas,viewport,annotationMode:AnnotationMode.DISABLE});
    render.onContinue = (resume: () => void) => requestAnimationFrame(() => { if (!disposed) resume(); });
    try { await render.promise; } catch(error) { canvas.width = canvas.height = 0; throw error; }
    if (disposed) throw new Error('수식 표시 취소');
    return {canvas,viewport};
  })();
  return {
    image(rect: PdfRect): Promise<string> {
      const key = rect.join(','); let result = crops.get(key);
      if (!result) {
        result = prepare().then(({canvas,viewport}) => {
          if (disposed) throw new Error('수식 표시 취소');
          const points = [...viewport.convertToViewportPoint(rect[0],rect[1]), ...viewport.convertToViewportPoint(rect[2],rect[3])];
          const x = Math.max(0,Math.floor(Math.min(points[0],points[2]))), y = Math.max(0,Math.floor(Math.min(points[1],points[3])));
          const width = Math.min(canvas.width-x,Math.ceil(Math.max(points[0],points[2]))-x), height = Math.min(canvas.height-y,Math.ceil(Math.max(points[1],points[3]))-y);
          if (width <= 0 || height <= 0) throw new Error('수식 위치를 확인할 수 없습니다.');
          const crop = document.createElement('canvas'); crop.width = width; crop.height = height;
          const ctx = crop.getContext('2d'); if (!ctx) throw new Error('수식을 표시할 수 없습니다.');
          ctx.drawImage(canvas,x,y,width,height,0,0,width,height);
          const url = crop.toDataURL('image/png'); crop.width = crop.height = 0; return url;
        }); crops.set(key,result);
      }
      return result;
    },
    dispose() { disposed = true; render?.cancel(); if (canvas) canvas.width = canvas.height = 0; crops.clear(); },
  };
}
