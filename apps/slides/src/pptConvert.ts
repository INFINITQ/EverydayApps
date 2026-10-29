// Runs the .ppt converter: office_oxide (Rust, MIT OR Apache-2.0) compiled to WebAssembly
// (apps/slides/ppt-wasm). The module computes on the bytes it's handed and nothing else:
// its only imports are three hooks wasm-bindgen leaves behind for describing types, which
// get inert stubs (nothing in the conversion calls them). A module asking for anything
// else is refused. Its memory is capped at 1 GiB when it's built.

export const ALLOWED_IMPORTS = [
  '__wbindgen_placeholder__.__wbindgen_describe',
  '__wbindgen_externref_xform__.__wbindgen_externref_table_set_null',
  '__wbindgen_externref_xform__.__wbindgen_externref_table_grow',
];

/** Old decks larger than this aren't converted (the converter holds them in memory twice). */
export const MAX_PPT_BYTES = 256 * 1024 * 1024;

type Exports = {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  convert(ptr: number, len: number): number;
  output_ptr(): number;
  output_len(): number;
};

export async function convertWith(module: WebAssembly.Module, input: Uint8Array): Promise<Uint8Array> {
  if (input.length > MAX_PPT_BYTES) throw new Error('This old PowerPoint file is too large to convert.');
  const imports: Record<string, Record<string, () => never>> = {};
  for (const wanted of WebAssembly.Module.imports(module)) {
    if (!ALLOWED_IMPORTS.includes(`${wanted.module}.${wanted.name}`)) {
      throw new Error(`The .ppt converter asks for ${wanted.module}.${wanted.name}, which Folio doesn't allow.`);
    }
    imports[wanted.module] ??= {};
    imports[wanted.module]![wanted.name] = () => {
      throw new Error('Not available to the converter.');
    };
  }
  const instance = await WebAssembly.instantiate(module, imports);
  const exports = instance.exports as unknown as Exports;
  let code: number;
  try {
    const ptr = exports.alloc(input.length);
    new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
    code = exports.convert(ptr, input.length);
  } catch {
    throw new Error("This old PowerPoint file couldn't be converted (it may be damaged or too large).");
  }
  const output = new Uint8Array(exports.memory.buffer, exports.output_ptr(), exports.output_len()).slice();
  if (code !== 0) throw new Error(`This old PowerPoint file couldn't be opened: ${new TextDecoder().decode(output)}`);
  return output;
}
