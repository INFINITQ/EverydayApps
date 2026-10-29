// Rebuilds ppt.wasm from this crate (needs Rust with the wasm32-unknown-unknown target:
// `rustup target add wasm32-unknown-unknown`). The app bundles the committed ppt.wasm, so
// this is only needed after changing the crate or bumping office_oxide.
//
// Usage: node apps/slides/ppt-wasm/build.mjs
/* global URL, WebAssembly, console -- a Node script */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown'], { cwd: here, stdio: 'inherit' });
const built = new URL('target/wasm32-unknown-unknown/release/folio_ppt_wasm.wasm', import.meta.url);
const out = new URL('ppt.wasm', import.meta.url);
copyFileSync(built, out);
const bytes = readFileSync(out);
const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes)).map((i) => `${i.module}.${i.name}`);
console.log(`ppt.wasm: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`);
console.log(`imports: ${imports.join(', ') || 'none'}`);
