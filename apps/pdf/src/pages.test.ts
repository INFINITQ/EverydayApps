// @vitest-environment node
// Page operations against the real bundled PDFium; PDF.js (a different parser) checks results.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { readPdf } from '../../../e2e/pdfjs';
// @ts-expect-error plain ES module without types
import { makePdf } from '../../../tools/fixtures/make-pdf.mjs';
import { type PageTools, PageError, chunks, createPageTools, movedOrder, pagesLabel, parseRanges } from './pages';
import { jpegInfo, pageFor, picturesPdf } from './pictures';

let tools: PageTools;

beforeAll(async () => {
  tools = await createPageTools(readFileSync(new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm', import.meta.url)));
});

const pdf = (pages: number): Uint8Array => makePdf(pages);
/** Which fixture page each page is, from its "folio-marker-N" line. */
async function markers(bytes: Uint8Array): Promise<number[]> {
  const { text } = await readPdf(bytes);
  return text.map((t) => Number(/folio-marker-(\d+)/.exec(t)?.[1] ?? 0));
}

describe('page operations', () => {
  it('moves pages, keeping the moved ones in order', async () => {
    const moved = tools.edit(pdf(5), (doc) => doc.move([0, 2], 5));
    expect(await markers(moved)).toEqual([2, 4, 5, 1, 3]);
    const toFront = tools.edit(pdf(5), (doc) => doc.move([3], 0));
    expect(await markers(toFront)).toEqual([4, 1, 2, 3, 5]);
  });

  it('rotates pages both ways, and their shown size turns with them', async () => {
    const turned = tools.edit(pdf(3), (doc) => {
      doc.rotate([1], 1);
      doc.rotate([2], -1);
    });
    const summary = await readPdf(turned);
    expect(summary.rotations).toEqual([0, 90, 270]);
    expect(summary.sizes[1]).toEqual({ width: 792, height: 612 });
    const doc = tools.open(turned);
    expect(doc.page(1)).toMatchObject({ rotation: 1, width: 792, height: 612 });
    doc.close();
  });

  it('deletes pages, but never the last one', async () => {
    expect(await markers(tools.edit(pdf(4), (doc) => doc.remove([1, 2])))).toEqual([1, 4]);
    expect(() => tools.edit(pdf(2), (doc) => doc.remove([0, 1]))).toThrow(PageError);
  });

  it('adds blank pages and copies pages between documents', async () => {
    const blank = await readPdf(tools.edit(pdf(2), (doc) => doc.insertBlank(1, 595, 842)));
    expect(blank.pages).toBe(3);
    expect(blank.sizes[1]).toEqual({ width: 595, height: 842 });
    expect(blank.text[1]?.trim()).toBe('');

    const other = tools.open(pdf(3));
    const merged = tools.edit(pdf(2), (doc) => doc.importFrom(other, [2, 0], 1));
    other.close();
    expect(await markers(merged)).toEqual([1, 3, 1, 2]);
  });

  it('extracts pages into a new document', async () => {
    const source = tools.open(pdf(4));
    const part = tools.create();
    part.importFrom(source, [1, 2], 0);
    const bytes = part.save();
    part.close();
    source.close();
    expect(await markers(bytes)).toEqual([2, 3]);
  });

  it('keeps form fields and their values when pages move', async () => {
    const form: Uint8Array = makePdf(2, 'Form', { form: true });
    const moved = await readPdf(tools.edit(form, (doc) => doc.move([0], 2)));
    expect(moved.annotations.filter((a) => a.fieldName === 'full_name').map((a) => a.page)).toEqual([2]);
  });

  it('refuses files that are not PDFs', () => {
    expect(() => tools.open(new TextEncoder().encode('not a pdf'))).toThrow(PageError);
  });
});

describe('pictures as pages', () => {
  it('stores pixels losslessly, with a transparency mask when needed, shaped like the picture', async () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 0]);
    const bytes = await picturesPdf([{ kind: 'pixels', rgba, width: 2, height: 2 }], { width: 612, height: 792 });
    const summary = await readPdf(bytes);
    expect(summary.pages).toBe(1);
    expect(summary.sizes[0]).toEqual({ width: 612, height: 612 });
    // The result is a normal PDF PDFium can take pages from.
    const picture = tools.open(bytes);
    const merged = tools.edit(pdf(1), (doc) => doc.importFrom(picture, null, 1));
    picture.close();
    expect((await readPdf(merged)).pages).toBe(2);
  });

  it('reads JPEG sizes from the frame header and keeps the JPEG data as it is', async () => {
    // SOI, an APP0 segment, then SOF0 with height 30, width 60 and 3 channels.
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x1e, 0x00, 0x3c, 0x03,
      0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
    ]);
    expect(jpegInfo(jpeg)).toEqual({ width: 60, height: 30, components: 3 });
    expect(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    const bytes = await picturesPdf([{ kind: 'jpeg', bytes: jpeg, width: 60, height: 30, components: 3 }], {
      width: 612,
      height: 792,
    });
    expect(Buffer.from(bytes).includes(Buffer.from(jpeg))).toBe(true);
    expect((await readPdf(bytes)).sizes[0]).toEqual({ width: 792, height: 396 });
  });

  it('turns the page box to match the picture', () => {
    expect(pageFor(400, 300, { width: 612, height: 792 })).toEqual({ width: 792, height: 594 });
    expect(pageFor(300, 400, { width: 612, height: 792 })).toEqual({ width: 594, height: 792 });
  });
});

describe('page numbers people type', () => {
  it('reads ranges and says what is wrong', () => {
    expect(parseRanges('1-3, 5 ,7–8', 8)).toEqual([[0, 1, 2], [4], [6, 7]]);
    expect(parseRanges('', 5)).toMatch(/Type page ranges/);
    expect(parseRanges('2-9', 5)).toMatch(/outside pages 1 to 5/);
    expect(parseRanges('x', 5)).toMatch(/isn't a page/);
    expect(parseRanges('4-2', 5)).toMatch(/outside/);
  });

  it('splits every N pages', () => {
    expect(chunks(7, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(chunks(2, 0)).toEqual([[0], [1]]);
  });

  it('works out where moved pages land', () => {
    expect(movedOrder(5, [1, 3], 0)).toEqual([1, 3, 0, 2, 4]);
    expect(movedOrder(5, [0], 3)).toEqual([1, 2, 0, 3, 4]);
    expect(movedOrder(5, [4], 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('labels pages for file names', () => {
    expect(pagesLabel([0, 1, 2, 4])).toBe('pages 1-3, 5');
    expect(pagesLabel([3])).toBe('page 4');
  });
});

describe('passwords', () => {
  const opens = (bytes: Uint8Array, password = '') => {
    try {
      tools.open(bytes, password).close();
      return true;
    } catch {
      return false;
    }
  };

  it('protects a PDF with a password, and the protection survives later changes', async () => {
    const locked = tools.edit(pdf(3), (doc) => doc.protect('s3cret!'));
    expect(opens(locked)).toBe(false);
    expect(opens(locked, 'wrong')).toBe(false);
    expect(opens(locked, 's3cret!')).toBe(true);
    // PDF.js agrees: it needs the password.
    await expect(readPdf(locked)).rejects.toThrow(/password/i);

    // Moving pages in the protected file keeps it protected.
    const moved = tools.edit(locked, (doc) => doc.move([0], 3), 's3cret!');
    expect(opens(moved)).toBe(false);
    const doc = tools.open(moved, 's3cret!');
    expect(doc.encrypted).toBe(true);
    expect(doc.pageCount).toBe(3);
    doc.close();
  });

  it('removes the password', async () => {
    const locked = tools.edit(pdf(2), (doc) => doc.protect('s3cret!'));
    const open = tools.edit(locked, (doc) => doc.unprotect(), 's3cret!');
    expect(opens(open)).toBe(true);
    expect(await markers(open)).toEqual([1, 2]);
  });

  it('says so when a file needs a password', () => {
    const locked = tools.edit(pdf(1), (doc) => doc.protect('s3cret!'));
    expect(() => tools.open(locked)).toThrow('This PDF is password-protected.');
  });

  it('protects pages taken into a new file (extract and split keep the password)', async () => {
    const source = tools.open(tools.edit(pdf(3), (doc) => doc.protect('s3cret!')), 's3cret!');
    const part = tools.create();
    part.importFrom(source, [1, 2], 0);
    part.protect('s3cret!');
    const bytes = part.save();
    part.close();
    source.close();
    expect(opens(bytes)).toBe(false);
    const doc = tools.open(bytes, 's3cret!');
    expect(doc.pageCount).toBe(2);
    doc.close();
    await expect(readPdf(bytes)).rejects.toThrow(/password/i);
  });

  it("restricts a file with an owner password, and opening it without one keeps the author's limits", () => {
    const [PRINT, MODIFY, ANNOTATE, ASSEMBLE] = [4, 8, 32, 1024];
    const restricted = tools.edit(pdf(1), (doc) => doc.restrict('owner-only', PRINT));
    // No password is needed to open it, but only printing is allowed...
    const doc = tools.open(restricted);
    expect(doc.encrypted).toBe(true);
    expect(doc.permissions & PRINT).toBe(PRINT);
    expect(doc.permissions & (MODIFY | ANNOTATE | ASSEMBLE)).toBe(0);
    doc.close();
    // ...and the owner password unlocks everything.
    const owner = tools.open(restricted, 'owner-only');
    expect(owner.permissions & (MODIFY | ANNOTATE | ASSEMBLE)).toBe(MODIFY | ANNOTATE | ASSEMBLE);
    owner.close();
  });

  it('changes a password: the old one is removed first, then the new one set', () => {
    const locked = tools.edit(pdf(2), (doc) => doc.protect('old-one'));
    const plain = tools.edit(locked, (doc) => doc.unprotect(), 'old-one');
    const changed = tools.edit(plain, (doc) => doc.protect('new-one'));
    expect(opens(changed)).toBe(false);
    expect(opens(changed, 'old-one')).toBe(false);
    expect(opens(changed, 'new-one')).toBe(true);
  });
});
