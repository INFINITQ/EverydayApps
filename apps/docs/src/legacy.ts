// Old Word 97-2003 documents (.doc): converted to .docx in memory by office_oxide, compiled to
// WebAssembly (legacy/, docs/adr/0011), started on first use. The .doc itself is never written:
// it opens read-only, and Save as makes a new .docx.

import wasmUrl from './legacy-wasm/folio_doc_legacy_bg.wasm?url';
import { converterVersion, docToDocx, initSync } from './legacy-wasm/folio_doc_legacy.js';
import { isCompoundFile } from './zip';

let started: Promise<void> | undefined;

function start(): Promise<void> {
  started ??= (async () => {
    // eslint-disable-next-line no-restricted-globals -- reads the bundled converter from the app itself (same origin, allowed by the content policy), never the network
    const wasm = await fetch(new URL(wasmUrl, window.location.href)).then((response) => response.arrayBuffer());
    initSync({ module: wasm });
  })();
  // A failed start can be retried next time.
  started.catch(() => (started = undefined));
  return started;
}

/** For tests (Node): starts the converter from the WebAssembly bytes. */
export function startWith(wasm: BufferSource): void {
  initSync({ module: wasm });
  started = Promise.resolve();
}

/** Most bytes a .doc may have (Word 97-2003 files are limited to 2 GB; real ones are far smaller). */
const MAX_DOC_BYTES = 256 * 1024 * 1024;

export async function convertDoc(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isCompoundFile(bytes)) throw new Error("This file isn't a Word 97-2003 document, or it's damaged.");
  if (bytes.length > MAX_DOC_BYTES) throw new Error('This document is too large for Folio Docs.');
  await start();
  try {
    return docToDocx(bytes);
  } catch (error) {
    const reason = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
    if (/encrypt|password/i.test(reason)) throw new Error('This document is password-protected. Folio Docs can’t open it.', { cause: error });
    throw new Error(`This Word 97-2003 document couldn’t be read${reason ? ` (${reason})` : ''}.`, { cause: error });
  }
}

export const legacyConverterVersion = () => converterVersion();
