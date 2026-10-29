// One PDFium engine (in a Web Worker) shared by every open PDF, plus a second PDFium, started
// on first use, for page operations (pages.ts).
// Airgapped: the WebAssembly binary is bundled with the app, and font fallback is off, so
// neither ever fetches anything from outside (EmbedPDF's defaults would use jsDelivr's CDN).

import type { PdfEngine } from '@embedpdf/models';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import type { PageTools } from './pages';

let engine: Promise<PdfEngine> | undefined;
let tools: Promise<PageTools> | undefined;

export function pdfEngine(): Promise<PdfEngine> {
  engine ??= import('@embedpdf/engines/pdfium-worker-engine').then(({ createPdfiumEngine }) =>
    createPdfiumEngine(new URL(wasmUrl, window.location.href).href, { fontFallback: null }),
  );
  return engine;
}

export function pageTools(): Promise<PageTools> {
  tools ??= (async () => {
    const { createPageTools } = await import('./pages');
    // eslint-disable-next-line no-restricted-globals -- reads the bundled pdfium.wasm from the app itself (same origin, allowed by the content policy), never the network
    const wasm = await fetch(new URL(wasmUrl, window.location.href)).then((response) => response.arrayBuffer());
    return createPageTools(wasm);
  })();
  // A failed start can be retried next time.
  tools.catch(() => (tools = undefined));
  return tools;
}
