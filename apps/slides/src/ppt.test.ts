// The bundled .ppt converter on a public sample (fixtures/README.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { notesOf, paragraphsOf, slidesOf } from './deck';
import { openPackage, xmlOf } from './pkg';
import { ALLOWED_IMPORTS, convertWith } from './pptConvert';
import { NS, descendants } from './xml';

const read = (path: string) => new Uint8Array(readFileSync(join(process.cwd(), 'apps/slides', path)));
const module = new WebAssembly.Module(read('ppt-wasm/ppt.wasm'));

describe('.ppt converter', () => {
  it('imports nothing beyond the inert wasm-bindgen hooks', () => {
    for (const wanted of WebAssembly.Module.imports(module)) {
      expect(ALLOWED_IMPORTS).toContain(`${wanted.module}.${wanted.name}`);
    }
  });

  it('converts an old deck with its text and notes', async () => {
    const pkg = await openPackage(await convertWith(module, read('fixtures/SampleShow.ppt')));
    const slides = slidesOf(pkg);
    expect(slides).toHaveLength(2);
    const text = slides.flatMap((s) => descendants(xmlOf(pkg, s.part)!, NS.p, 'sp').flatMap((sp) => paragraphsOf(sp)));
    expect(text).toContain('Title of the first slide');
    expect(text).toContain('This bit is in italic green');
    expect(slides.some((s) => notesOf(pkg, s).length > 0)).toBe(true);
  });

  it('reports a file that isn\'t a PowerPoint file instead of crashing', async () => {
    await expect(convertWith(module, new Uint8Array(4096).fill(7))).rejects.toThrow(/couldn't/);
  });

  it('refuses a module that asks for more', async () => {
    // A tiny module importing env.fetch.
    const bytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 13, 1, 3, 101, 110, 118, 5, 102, 101, 116, 99, 104, 0, 0]);
    await expect(convertWith(new WebAssembly.Module(bytes), new Uint8Array(1))).rejects.toThrow(/doesn't allow/);
  });
});
