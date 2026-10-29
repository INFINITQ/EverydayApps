// Old PowerPoint 97-2003 (.ppt) files: converted in memory to a .pptx (text, pictures,
// tables and notes; layout may differ), shown read-only. Save As writes a .pptx.
import wasmUrl from '../ppt-wasm/ppt.wasm?url';

/** A conversion that takes longer than this is stopped. */
const TIMEOUT_MS = 60_000;

let compiled: Promise<WebAssembly.Module> | undefined;

function converter(): Promise<WebAssembly.Module> {
  compiled ??= (async () => {
    // eslint-disable-next-line no-restricted-globals -- reads the bundled ppt.wasm from the app itself (same origin, allowed by the content policy), never the network
    const response = await fetch(new URL(wasmUrl, window.location.href));
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  compiled.catch(() => (compiled = undefined));
  return compiled;
}

export async function convertPpt(bytes: Uint8Array): Promise<Uint8Array> {
  const module = await converter();
  const worker = new Worker(new URL('./pptWorker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Converting this old PowerPoint file took too long, so it was stopped.')), TIMEOUT_MS);
      worker.onmessage = (event: MessageEvent<{ output?: Uint8Array; error?: string }>) => {
        clearTimeout(timer);
        if (event.data.output) resolve(event.data.output);
        else reject(new Error(event.data.error ?? "The file couldn't be converted."));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        reject(new Error("This old PowerPoint file couldn't be converted."));
      };
      worker.postMessage({ module, input: bytes });
    });
  } finally {
    worker.terminate();
  }
}
