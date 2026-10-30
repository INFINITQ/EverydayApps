// Converts one .ppt in a worker, so a large or hostile file can't freeze the window and
// can be stopped (see ppt.ts).
import { convertWith } from './pptConvert';

self.onmessage = async (event: MessageEvent<{ module: WebAssembly.Module; input: Uint8Array }>) => {
  try {
    const output = await convertWith(event.data.module, event.data.input);
    self.postMessage({ output }, { transfer: [output.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "The file couldn't be converted." });
  }
};
