import { buildPresentation, parseZip } from '@aiden0z/pptx-renderer';
import { describe, expect, it } from 'vitest';
import {
  collectGarbage,
  deleteSlides,
  duplicateSlide,
  hasMacros,
  notesOf,
  reachable,
  reorderSlides,
  setHidden,
  slidesOf,
} from './deck';
import { type Package, openPackage, related, relationships, resolveTarget, savePackage, textOf } from './pkg';
import { SAMPLE, makePptx } from './testing/makePptx';
import { ZipError, readZip, writeZip } from './zip';

const sample = () => makePptx(SAMPLE);

/** Re-reads a saved file with JSZip and the renderer's own parser (not Folio's code). */
async function independently(bytes: Uint8Array) {
  const files = await parseZip(bytes.slice().buffer);
  const presentation = buildPresentation(files);
  return { files, presentation };
}

/** Each entry's exact compressed bytes and headers, by name. */
const rawEntries = (bytes: Uint8Array) => new Map(readZip(bytes).entries.map((e) => [e.name, e.raw]));

/** Every internal relationship points at a part that exists. */
function danglingRelationships(pkg: Package): string[] {
  const out: string[] = [];
  for (const name of pkg.parts.keys()) {
    if (!name.endsWith('.rels')) continue;
    const source = name === '_rels/.rels' ? '' : name.replace(/_rels\/([^/]*)\.rels$/, '$1');
    for (const rel of relationships(pkg, source)) {
      if (!rel.external && !pkg.parts.has(resolveTarget(source, rel.target))) out.push(`${name} -> ${rel.target}`);
    }
  }
  return out;
}

const titles = (presentation: ReturnType<typeof buildPresentation>) =>
  presentation.slides.map((slide) => slide.slidePath);

describe('zip', () => {
  it('copies untouched entries byte for byte', async () => {
    const bytes = await sample();
    const archive = readZip(bytes);
    const again = await writeZip(archive.entries.map((entry) => ({ entry })), archive.comment);
    expect(again).toEqual(bytes);
  });

  it('refuses entries that inflate past their declared size', async () => {
    const big = new Uint8Array(2_000_000);
    const bytes = await writeZip([{ name: 'bomb.xml', data: big }]);
    // Lie about the size in both headers, as a zip bomb does.
    const archive = readZip(bytes);
    const entry = { ...archive.entries[0]!, size: 1000 };
    const { inflateEntry } = await import('./zip');
    await expect(inflateEntry(entry)).rejects.toThrow(ZipError);
  });

  it('refuses archives with too many entries', async () => {
    const bytes = await writeZip(Array.from({ length: 5 }, (_, i) => ({ name: `a${i}.xml`, data: new Uint8Array(1) })));
    expect(() => readZip(bytes, { maxEntries: 4, maxEntryBytes: 1e9, maxTotalBytes: 1e9 })).toThrow(/too many parts/);
  });
});

describe('package', () => {
  it('saves an unchanged deck byte for byte', async () => {
    const bytes = await sample();
    const pkg = await openPackage(bytes);
    expect(await savePackage(pkg)).toEqual(bytes);
  });

  it('refuses XML with a DTD (entity expansion)', async () => {
    const bytes = await sample();
    const archive = readZip(bytes);
    const items = await Promise.all(
      archive.entries.map(async (entry) => {
        if (entry.name !== 'ppt/slides/slide1.xml') return { entry };
        const bomb = '<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY lol "lol">]><p:sld xmlns:p="x">&lol;</p:sld>';
        return { name: entry.name, data: new TextEncoder().encode(bomb) };
      }),
    );
    const pkg = await openPackage(await writeZip(items));
    expect(() => slidesOf(pkg)).toThrow(/DTD/);
  });

  it('refuses password-protected (OLE) files with a clear message', async () => {
    const ole = new Uint8Array(512);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(openPackage(ole)).rejects.toThrow(/password-protected/);
  });
});

describe('deck', () => {
  it('lists slides, hidden slides and notes', async () => {
    const pkg = await openPackage(await sample());
    const slides = slidesOf(pkg);
    expect(slides.map((s) => s.part)).toEqual([1, 2, 3, 4].map((n) => `ppt/slides/slide${n}.xml`));
    expect(slides.map((s) => s.hidden)).toEqual([false, false, true, false]);
    expect(notesOf(pkg, slides[0]!)).toBe('Welcome everyone.\nKeep it short.');
    expect(notesOf(pkg, slides[3]!)).toBe('');
    expect(hasMacros(pkg)).toBe(false);
    expect(hasMacros(await openPackage(await makePptx({ ...SAMPLE, macros: true })))).toBe(true);
  });

  it('reorders slides, rewriting only presentation.xml', async () => {
    const bytes = await sample();
    const pkg = await openPackage(bytes);
    const [a, b, c, d] = slidesOf(pkg).map((s) => s.part) as [string, string, string, string];
    const saved = await savePackage(reorderSlides(pkg, [c, a, b, d]));

    const { presentation } = await independently(saved);
    expect(titles(presentation)).toEqual([c, a, b, d]);
    const before = rawEntries(bytes);
    const after = rawEntries(saved);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, raw] of after) {
      if (name === 'ppt/presentation.xml') expect(raw).not.toEqual(before.get(name));
      else expect(raw, name).toEqual(before.get(name));
    }
  });

  it('hides and shows slides', async () => {
    const pkg = await openPackage(await sample());
    const hidden = setHidden(pkg, 'ppt/slides/slide1.xml', true);
    expect(slidesOf(hidden)[0]!.hidden).toBe(true);
    const shown = setHidden(hidden, 'ppt/slides/slide3.xml', false);
    expect(slidesOf(shown).map((s) => s.hidden)).toEqual([true, false, false, false]);
    const { presentation } = await independently(await savePackage(shown));
    expect(presentation.slides.map((s) => Boolean(s.hidden))).toEqual([true, false, false, false]);
  });

  it('deletes a slide with the parts only it used', async () => {
    const bytes = await sample();
    const pkg = await openPackage(bytes);
    const next = deleteSlides(pkg, ['ppt/slides/slide2.xml']);
    expect(slidesOf(next).map((s) => s.part)).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide3.xml', 'ppt/slides/slide4.xml']);
    for (const gone of ['ppt/slides/slide2.xml', 'ppt/notesSlides/notesSlide2.xml', 'ppt/tags/tag1.xml', 'ppt/media/image1.png']) {
      expect(next.parts.has(gone), gone).toBe(false);
    }
    expect(textOf(next, '[Content_Types].xml')).not.toContain('slide2.xml');
    expect(textOf(next, '[Content_Types].xml')).not.toContain('tag1.xml');
    expect(danglingRelationships(next)).toEqual([]);
    // Parts nothing refers to were the author's: they stay.
    expect(next.parts.has('customXml/item1.xml')).toBe(true);

    const saved = await savePackage(next);
    const { presentation } = await independently(saved);
    expect(presentation.slides).toHaveLength(3);
    const before = rawEntries(bytes);
    for (const [name, raw] of rawEntries(saved)) {
      if (['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', '[Content_Types].xml'].includes(name)) continue;
      expect(raw, name).toEqual(before.get(name));
    }
  });

  it('removes links to a deleted slide from other slides', async () => {
    const pkg = await openPackage(await sample());
    // Slide 4 links to slide 2 (a "jump to slide" link).
    const rels = textOf(pkg, 'ppt/slides/_rels/slide4.xml.rels')!.replace(
      '</Relationships>',
      '<Relationship Id="rIdJump" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slide2.xml"/></Relationships>',
    );
    const slide = textOf(pkg, 'ppt/slides/slide4.xml')!.replace(
      '<a:t>Questions?</a:t>',
      '<a:t>Questions?</a:t></a:r><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="rIdJump" action="ppaction://hlinksldjump"/></a:rPr><a:t> Back</a:t>',
    );
    const { withParts } = await import('./pkg');
    const linked = withParts(pkg, { 'ppt/slides/_rels/slide4.xml.rels': rels, 'ppt/slides/slide4.xml': slide });
    const next = deleteSlides(linked, ['ppt/slides/slide2.xml']);
    expect(danglingRelationships(next)).toEqual([]);
    expect(textOf(next, 'ppt/slides/slide4.xml')).not.toContain('rIdJump');
    expect(textOf(next, 'ppt/slides/slide4.xml')).toContain('Back');
  });

  it('duplicates a slide with its own notes and tags, sharing its picture', async () => {
    const pkg = await openPackage(await sample());
    const { pkg: next, part } = duplicateSlide(pkg, 'ppt/slides/slide2.xml');
    expect(part).toBe('ppt/slides/slide5.xml');
    const slides = slidesOf(next);
    expect(slides.map((s) => s.part)).toEqual([1, 2, 5, 3, 4].map((n) => `ppt/slides/slide${n}.xml`));
    expect(new Set(slides.map((s) => s.id)).size).toBe(5);
    const copy = slides[2]!;
    // notesSlide3 is free: the third slide has no notes.
    expect(copy.notesPart).toBe('ppt/notesSlides/notesSlide3.xml');
    expect(notesOf(next, copy)).toBe('Mention the new office.');
    // The copied notes point back at the copy, not the original.
    expect(related(next, copy.notesPart!, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide')[0]!.part).toBe(part);
    expect(related(next, part).map((r) => r.part)).toContain('ppt/media/image1.png');
    expect(related(next, part).map((r) => r.part)).toContain('ppt/tags/tag2.xml');
    expect(danglingRelationships(next)).toEqual([]);

    const { presentation, files } = await independently(await savePackage(next));
    expect(presentation.slides).toHaveLength(5);
    expect(files.slides.get('ppt/slides/slide5.xml')).toContain('Revenue up');
  });

  it('keeps unreachable parts and collects only what an edit orphaned', async () => {
    const pkg = await openPackage(await sample());
    const before = reachable(pkg);
    expect(before.has('customXml/item1.xml')).toBe(false);
    expect(collectGarbage(pkg, before)).toBe(pkg);
  });

  it('keeps macros (vbaProject.bin) untouched through edits', async () => {
    const bytes = await makePptx({ ...SAMPLE, macros: true });
    const pkg = await openPackage(bytes);
    const saved = await savePackage(deleteSlides(reorderSlides(pkg, slidesOf(pkg).map((s) => s.part).reverse()), ['ppt/slides/slide1.xml']));
    expect(rawEntries(saved).get('ppt/vbaProject.bin')).toEqual(rawEntries(bytes).get('ppt/vbaProject.bin'));
  });
});
