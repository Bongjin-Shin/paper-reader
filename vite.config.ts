import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  // Tauri uses the system WebView; WebKit may lack APIs used by PDF.js's modern build.
  resolve: { alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }] },
  plugins: [react(), viteStaticCopy({ targets: [
    { src: 'node_modules/pdfjs-dist/cmaps', dest: 'pdfjs' },
    { src: 'node_modules/pdfjs-dist/standard_fonts', dest: 'pdfjs' },
    { src: 'node_modules/pdfjs-dist/wasm', dest: 'pdfjs' },
  ] })],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/.tools/**', '**/src-tauri/target/**'] } },
  envPrefix: ['VITE_'],
  build: { target: 'es2022' },
});
