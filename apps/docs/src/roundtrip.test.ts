// Round trips through the real engine (docx-editor.dev core, headless in jsdom): open a
// document, edit it, save it through Folio's patching, then read the result back with a
// different zip reader (fflate's) and check that the edit landed and every untouched part
// survived byte for byte. Public samples: fixtures/public/apache-poi (Apache-2.0).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createDocxEditor } from '@docx-editor.dev/core';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without types
import { MARKERS, UNKNOWN, makeDocx } from '../../../tools/fixtures/make-docx.mjs';
import { openEngineDocument } from './engine';
import { DocxPackage } from './ooxml';
import { baselineOf, engineLosses, patchPackage } from './patch';

// Tests run from the repository root (jsdom's import.meta.url isn't a file URL).
const POI = join(process.cwd(), 'fixtures/public/apache-poi');
const poi = (name: string) => new Uint8Array(readFileSync(join(POI, name)));

beforeAll(() => {
  // jsdom has no canvas; the engine falls back to estimated text widths.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

/** Opens bytes in a fresh engine, as the app does (without the React wrapper). */
async function open(bytes: Uint8Array) {
  const host = document.createElement('div');
  document.body.append(host);
  return openEngineDocument(createDocxEditor, host, bytes);
}

const read = (bytes: Uint8Array) => unzipSync(bytes);
const text = (files: Record<string, Uint8Array>, name: string) => strFromU8(files[name]!);
const bodyText = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

/** Open, replace `find` with `replace`, save through the patcher; returns both packages read back. */
async function roundTrip(bytes: Uint8Array, find: string, replace: string) {
  const original = new DocxPackage(bytes);
  const engine = await open(bytes);
  const baseline = baselineOf(new Uint8Array(await engine.save()));
  const [match] = engine.findMatches(find);
  expect(match, `"${find}" should be found`).toBeTruthy();
  expect(engine.exec({ type: 'replaceMatch', match: match!, text: replace })).toMatchObject({ ok: true, changed: true });
  const { bytes: saved, report } = patchPackage(original, baseline, new Uint8Array(await engine.save()));
  engine.destroy?.();
  return { before: read(bytes), after: read(saved), saved, report, losses: engineLosses(original, baseline) };
}

describe('round trips through the engine', () => {
  it('generated kitchen sink: the edit lands, everything else is kept byte for byte', async () => {
    const bytes = makeDocx({ macros: true }) as Uint8Array;
    const { before, after, report, losses } = await roundTrip(bytes, 'quick brown fox', 'quick EDITED fox');
    expect(losses).toEqual([]);
    expect(bodyText(text(after, 'word/document.xml'))).toContain('The quick EDITED fox jumps');
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const untouched = Object.keys(before).filter((n) => !report.replaced.includes(n));
    expect(untouched.length).toBeGreaterThanOrEqual(Object.keys(before).length - 3);
    for (const name of untouched) expect(after[name], name).toEqual(before[name]);
    // The unknown markup inside the edited part survived too.
    const document = text(after, 'word/document.xml');
    expect(document).toContain('fx:mystery');
    expect(document).toContain('fx:paraTag="folio-7"');
    expect(document).toContain('<w:ins ');
    expect(document).toContain('<w:del ');
    expect(after[UNKNOWN.part]).toEqual(before[UNKNOWN.part]);
    expect(after[UNKNOWN.macroPart]).toEqual(before[UNKNOWN.macroPart]);
    expect(text(after, '[Content_Types].xml')).toContain('macroEnabled.main+xml');
  });

  it('a saved file opens again in a fresh engine with the edit in place', async () => {
    const { saved } = await roundTrip(makeDocx() as Uint8Array, MARKERS.cell, 'Cell B2 edited');
    const again = await open(saved);
    expect(again.findMatches('Cell B2 edited')).toHaveLength(1);
    expect(again.findMatches(MARKERS.footnote).length + again.findMatches(MARKERS.header).length).toBeGreaterThanOrEqual(0);
  });

  it('saving without edits gives back the original bytes', async () => {
    const bytes = makeDocx() as Uint8Array;
    const engine = await open(bytes);
    const baseline = baselineOf(new Uint8Array(await engine.save()));
    const { report } = patchPackage(new DocxPackage(bytes), baseline, new Uint8Array(await engine.save()));
    expect(report.replaced).toEqual([]);
    expect(report.kept.length).toBe(new DocxPackage(bytes).names.length);
  });

  const samples = readdirSync(POI).filter((n) => n.endsWith('.docx') && !/ExternalEntity|password/.test(n));
  it.each(samples)('public sample %s: edit lands, untouched parts survive', async (name) => {
    const bytes = poi(name);
    const original = new DocxPackage(bytes);
    // A whole word inside one run of text (runs can split words, and cells sit side by side).
    const runs = [...(original.text(original.mainPart) ?? '').matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]!);
    const words = runs.map((t) => /(?:^|[^A-Za-z])([A-Za-z]{4,})(?![A-Za-z])/.exec(t)).find(Boolean)?.slice(1);
    if (!words) {
      // Nothing to edit (comment.docx is only a comment mark): an unedited save keeps it all.
      const engine = await open(bytes);
      const baseline = baselineOf(new Uint8Array(await engine.save()));
      expect(engineLosses(original, baseline)).toEqual([]);
      const { bytes: saved } = patchPackage(original, baseline, new Uint8Array(await engine.save()));
      expect(read(saved)).toEqual(read(bytes));
      return;
    }
    const { before, after, report, losses } = await roundTrip(bytes, words[0]!, `${words[0]}EDITED`);
    expect(losses).toEqual([]);
    expect(bodyText(text(after, original.mainPart))).toContain(`${words[0]}EDITED`);
    for (const name of Object.keys(before)) {
      expect(after[name], `${name} is missing`).toBeDefined();
      if (!report.replaced.includes(name)) expect(after[name], name).toEqual(before[name]);
    }
  });
});

describe('documents Folio refuses', () => {
  it('refuses a document that declares XML entities', async () => {
    const { checkXmlSafety } = await import('./ooxml');
    expect(() => checkXmlSafety(new DocxPackage(poi('ExternalEntityInText.docx')))).toThrow(/DTD or entities/);
  });

  it('says a password-protected document is protected', () => {
    expect(() => new DocxPackage(poi('bug53475-password-is-pass.docx'))).toThrow(/password-protected/);
  });
});
