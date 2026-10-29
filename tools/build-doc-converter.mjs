// Rebuilds Folio Docs' .doc converter (apps/docs/legacy: office_oxide compiled to WebAssembly)
// into apps/docs/src/legacy-wasm/.
// Needs the wasm32-unknown-unknown target and wasm-bindgen-cli at the version Cargo.toml pins:
//   rustup target add wasm32-unknown-unknown
//   cargo install wasm-bindgen-cli --version 0.2.129 --locked
// Prints the SHA-256 of what it wrote, to compare with docs/adr/0011.
//
// Usage: node tools/build-doc-converter.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = join(import.meta.dirname, '..', 'apps', 'docs', 'legacy');
const out = join(here, '..', 'src', 'legacy-wasm');
const run = (command, args, cwd = here) => execFileSync(command, args, { cwd, stdio: 'inherit' });

run('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown']);
run('wasm-bindgen', [
  '--target',
  'web',
  '--out-dir',
  out,
  join(here, 'target', 'wasm32-unknown-unknown', 'release', 'folio_doc_legacy.wasm'),
]);
// Generated code: not linted (it's reviewed when the converter is upgraded, see docs/adr/0011).
for (const name of readdirSync(out)) {
  const path = join(out, name);
  const text = readFileSync(path, 'utf8');
  if (name.endsWith('.d.ts')) writeFileSync(path, text.replace(/^\/\* tslint:disable \*\/\n\/\* eslint-disable \*\/\n/, ''));
  else if (name.endsWith('.js')) writeFileSync(path, `/* eslint-disable */\n${text}`);
}
for (const name of readdirSync(out).sort()) {
  console.log(`${createHash('sha256').update(readFileSync(join(out, name))).digest('hex')}  ${name}`);
}
