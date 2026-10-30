// Real PowerPoint files (public samples, see fixtures/README.md): saving without changes
// gives back the exact same bytes, and edits rewrite only the parts they must.

import { buildPresentation, parseZip } from '@aiden0z/pptx-renderer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteSlides, duplicateSlide, notesOf, setHidden, slidesOf } from './deck';
import { openPackage, savePackage } from './pkg';
import { setNotes } from './text';
import { readZip } from './zip';

// Under jsdom, import.meta.url isn't a file URL; tests run from the repository root.
const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'apps/slides/fixtures', name)));
const changedEntries = (before: Uint8Array, after: Uint8Array) => {
  const old = new Map(readZip(before).entries.map((e) => [e.name, e.raw]));
  return readZip(after)
    .entries.filter((e) => {
      const o = old.get(e.name);
      return !o || o.length !== e.raw.length || o.some((b, i) => b !== e.raw[i]);
    })
    .map((e) => e.name)
    .sort();
};

describe.each(['SampleShow.pptx', 'smartart-simple.pptx', 'pie-chart.pptx'])('%s', (name) => {
  it('saves unchanged as the exact same bytes', async () => {
    const bytes = fixture(name);
    expect(await savePackage(await openPackage(bytes))).toEqual(bytes);
  });

  it('hides a slide by rewriting only that slide', async () => {
    const bytes = fixture(name);
    const pkg = await openPackage(bytes);
    const first = slidesOf(pkg)[0]!;
    const saved = await savePackage(setHidden(pkg, first.part, true));
    expect(changedEntries(bytes, saved)).toEqual([first.part]);
    const presentation = buildPresentation(await parseZip(saved.slice().buffer));
    expect(presentation.slides[0]!.hidden).toBe(true);
  });

  it('duplicates and deletes slides into a file that reads back', async () => {
    const bytes = fixture(name);
    const pkg = await openPackage(bytes);
    const first = slidesOf(pkg)[0]!;
    const duplicated = duplicateSlide(pkg, first.part);
    const saved = await savePackage(deleteSlides(duplicated.pkg, [first.part]));
    const reopened = await openPackage(saved);
    expect(slidesOf(reopened).map((s) => s.part)).toEqual([duplicated.part, ...slidesOf(pkg).slice(1).map((s) => s.part)]);
    const presentation = buildPresentation(await parseZip(saved.slice().buffer));
    expect(presentation.slides).toHaveLength(slidesOf(pkg).length);
  });
});

describe('SampleShow.pptx', () => {
  it('edits notes, rewriting only that notes page', async () => {
    const bytes = fixture('SampleShow.pptx');
    const pkg = await openPackage(bytes);
    const slide = slidesOf(pkg).find((s) => s.notesPart)!;
    const saved = await savePackage(setNotes(pkg, slide, `${notesOf(pkg, slide)}\nOne more line.`));
    expect(changedEntries(bytes, saved)).toEqual([slide.notesPart]);
    const reopened = await openPackage(saved);
    expect(notesOf(reopened, slidesOf(reopened).find((s) => s.part === slide.part)!)).toMatch(/One more line\.$/);
  });
});
