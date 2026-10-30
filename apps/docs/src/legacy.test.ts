// Old Word 97-2003 documents: office_oxide (compiled to WebAssembly, legacy/) converts them to
// .docx in memory; the result must be a sound package the engine opens, with the text in it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDocxEditor } from '@docx-editor.dev/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { openEngineDocument } from './engine';
import { convertDoc, legacyConverterVersion, startWith } from './legacy';
import { DocxPackage, checkXmlSafety } from './ooxml';
import { verifyPackage } from './patch';

const root = process.cwd();
const sample = (path: string) => new Uint8Array(readFileSync(join(root, path)));
const bodyText = (pkg: DocxPackage) =>
  [...(pkg.text(pkg.mainPart) ?? '').matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(' ');

beforeAll(() => {
  startWith(readFileSync(join(root, 'apps/docs/src/legacy-wasm/folio_doc_legacy_bg.wasm')));
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe('Word 97-2003 documents', () => {
  it('uses the pinned office_oxide', () => {
    expect(legacyConverterVersion()).toBe('0.1.15');
  });

  it.each([
    ['fixtures/generated/kitchen.doc', ['Folio test document', 'The quick brown fox', 'Cell B2', 'Second bullet']],
    ['fixtures/public/apache-poi/Lists.doc', ['Heading Level 1']],
    ['fixtures/public/apache-poi/HeaderFooterUnicode.doc', ['fairly simple word document']],
    ['fixtures/public/apache-poi/footnote.doc', ['Test text']],
    ['fixtures/public/apache-poi/hyperlink.doc', ['Hyperlink text']],
    ['fixtures/public/apache-poi/table-merges.doc', ['A']],
    ['fixtures/public/apache-poi/Word6.doc', ['The quick brown fox jumps over the lazy dog']],
  ])('%s converts to a sound .docx with its text', async (path, texts) => {
    const docx = await convertDoc(sample(path));
    const pkg = new DocxPackage(docx);
    checkXmlSafety(pkg);
    expect(() => verifyPackage(docx, null)).not.toThrow();
    const text = bodyText(pkg);
    for (const t of texts) expect(text).toContain(t);
  });

  it('the converted kitchen sink keeps its table, and the engine opens it', async () => {
    const docx = await convertDoc(sample('fixtures/generated/kitchen.doc'));
    const pkg = new DocxPackage(docx);
    expect(pkg.text(pkg.mainPart)).toContain('<w:tbl>');
    const host = document.createElement('div');
    document.body.append(host);
    const editor = await openEngineDocument(createDocxEditor, host, docx);
    expect(editor.findMatches('Cell B2')).toHaveLength(1);
  });

  it('refuses a password-protected .doc with a clear message', async () => {
    await expect(convertDoc(sample('fixtures/public/apache-poi/PasswordProtected.doc'))).rejects.toThrow(/password-protected/);
  });

  it('refuses something that is not a .doc', async () => {
    await expect(convertDoc(new TextEncoder().encode('not a document'))).rejects.toThrow(/isn't a Word 97-2003 document/);
  });
});
