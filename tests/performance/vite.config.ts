import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config';

// Test server only: count executed work without adding instrumentation to shipped code.
export default mergeConfig(base, defineConfig({
  server: { port: 1421 },
  plugins: [{ name: 'reader-profile', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/pdfjs-dist/build/pdf.mjs')) {
      // Native test builds only: distinguish PDF.js paint slices from React work.
      return code.replace(/(  executeOperatorList\(operatorList,[^\n]+\) \{)([\s\S]*?)(\n  \}\n  #restoreInitialState)/,
        "$1 const profileStart = performance.now(); try {$2 } finally { globalThis.__readerProfile?.span?.('canvasSlice', performance.now() - profileStart); }$3");
    }
    if (!id.includes('/src/') || !/\.[jt]sx?$/.test(id)) return;
    const hit = (name: string) => `(globalThis as any).__readerProfile?.hit('${name}');`;
    if (id.endsWith('/App.tsx')) code = code.replace(/(export default function App\(\) \{)/, `$1${hit('appRender')}`);
    if (id.endsWith('/PdfPage.tsx')) {
      code = code.replace(/(function (?:PdfPage|PdfPageView)\([^\n]+\) \{)/, `$1${hit('pageRender')}`);
      const pageHit = (name: string) => `(globalThis as any).__readerProfile?.hit('${name}', pageNumber);`;
      code = code.replace(/(renderTask = page\.render\()/, `${pageHit('canvasRender')}$1`);
      code = code.replace(/(textLayer = new TextLayer\()/, `${pageHit('textLayerRender')}$1`);
      code = code.replace('await textLayer.render();', "const profileStart = performance.now(); await textLayer.render(); (globalThis as any).__readerProfile?.span?.('textRender', performance.now() - profileStart);");
      code = code.replace('setNoText(!content.items.', `${pageHit('pageReady')}setNoText(!content.items.`);
    }
    if (id.endsWith('/selection.ts')) code = code.replace(/(export function pdfToStyle\([^\n]+\) \{)/, `$1${hit('highlightTransform')}`);
    return code;
  } }],
}));
