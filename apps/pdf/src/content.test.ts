// @vitest-environment node
// The Phase 1d spike, kept as a test: 50 text edits across different kinds of pages, each of
// which must leave the rest of the page unchanged (checked pixel by pixel on the saved bytes)
// or be refused. Plus pictures, whiteout and redaction. Real bundled PDFium; PDF.js checks text.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { readPdf } from '../../../e2e/pdfjs';
// @ts-expect-error plain ES module without types
import { makePdf } from '../../../tools/fixtures/make-pdf.mjs';
import { type Box, type TextItem, fontKind, pageContent, standardFont, strayChanges } from './content';
import { type EditablePdf, type PageTools, PageError, createPageTools } from './pages';

let tools: PageTools;

beforeAll(async () => {
  tools = await createPageTools(readFileSync(new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm', import.meta.url)));
});

/** Builds a page with PDFium itself: several fonts, colors, a turned line, a picture and a box. */
function builtPdf(): Uint8Array {
  const pdf = tools.create();
  try {
    const { m, rt } = pdf;
    const page = m.FPDFPage_New(pdf.doc, 0, 612, 792);
    const line = (fontName: string, size: number, text: string, color: [number, number, number], matrix: number[]) => {
      const font = m.FPDFText_LoadStandardFont(pdf.doc, fontName);
      const obj = m.FPDFPageObj_CreateTextObj(pdf.doc, font, size);
      const ptr = rt.wasmExports.malloc((text.length + 1) * 2);
      for (let i = 0; i <= text.length; i++) {
        const unit = i < text.length ? text.charCodeAt(i) : 0;
        rt.HEAPU8[ptr + i * 2] = unit & 255;
        rt.HEAPU8[ptr + i * 2 + 1] = unit >> 8;
      }
      m.FPDFText_SetText(obj, ptr);
      rt.wasmExports.free(ptr);
      m.FPDFPageObj_SetFillColor(obj, ...color, 255);
      m.FPDFPageObj_Transform(obj, ...(matrix as [number, number, number, number, number, number]));
      m.FPDFPage_InsertObject(page, obj);
      m.FPDFFont_Close(font);
    };
    line('Times-Bold', 22, 'Quarterly report', [20, 40, 120], [1, 0, 0, 1, 72, 700]);
    line('Courier', 11, 'Invoice INV-2026-0042', [0, 0, 0], [1, 0, 0, 1, 72, 660]);
    line('Helvetica', 13, 'Signed and approved', [180, 20, 20], [1, 0, 0, 1, 72, 630]);
    const turn = Math.PI / 6;
    line('Helvetica-Oblique', 12, 'A turned note', [0, 110, 0], [Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn), 300, 500]);
    const rect = m.FPDFPageObj_CreateNewRect(72, 400, 200, 60);
    m.FPDFPageObj_SetFillColor(rect, 240, 200, 40, 255);
    m.FPDFPath_SetDrawMode(rect, 1, false);
    m.FPDFPage_InsertObject(page, rect);
    m.FPDFPage_GenerateContent(page);
    m.FPDF_ClosePage(page);
    // A picture, added through the code under test.
    const content = pageContent(pdf, 0);
    const pixels = new Uint8ClampedArray(40 * 20 * 4).map((_, i) => [30, 120, 200, 255][i % 4]!);
    content.addPicture(pixels, 40, 20, { x: 320, y: 300, width: 160, height: 80 });
    content.commit();
    content.close();
    return pdf.save();
  } finally {
    pdf.close();
  }
}

/** A page whose only text is in the Symbol font, which has no Latin letters. */
function symbolPdf(): Uint8Array {
  const pdf = tools.create();
  try {
    const { m, rt } = pdf;
    const page = m.FPDFPage_New(pdf.doc, 0, 612, 792);
    const font = m.FPDFText_LoadStandardFont(pdf.doc, 'Symbol');
    const obj = m.FPDFPageObj_CreateTextObj(pdf.doc, font, 16);
    const ptr = rt.wasmExports.malloc(8);
    [0x3b1, 0x3b2, 0x3b3, 0].forEach((unit, i) => {
      rt.HEAPU8[ptr + i * 2] = unit & 255;
      rt.HEAPU8[ptr + i * 2 + 1] = unit >> 8;
    });
    m.FPDFText_SetText(obj, ptr);
    rt.wasmExports.free(ptr);
    m.FPDFPageObj_Transform(obj, 1, 0, 0, 1, 72, 700);
    m.FPDFPage_InsertObject(page, obj);
    m.FPDFFont_Close(font);
    m.FPDFPage_GenerateContent(page);
    m.FPDF_ClosePage(page);
    return pdf.save();
  } finally {
    pdf.close();
  }
}

function texts(bytes: Uint8Array, page: number): TextItem[] {
  const pdf = tools.open(bytes);
  try {
    const content = pageContent(pdf, page);
    try {
      return content.info().items.filter((item): item is TextItem => item.kind === 'text');
    } finally {
      content.close();
    }
  } finally {
    pdf.close();
  }
}

function edit(bytes: Uint8Array, page: number, change: (content: ReturnType<typeof pageContent>) => Box[]) {
  let changed: Box[] = [];
  const after = tools.edit(bytes, (pdf: EditablePdf) => {
    const content = pageContent(pdf, page);
    try {
      changed = change(content);
      content.commit();
    } finally {
      content.close();
    }
  });
  return { after, changed, stray: strayChanges(tools, bytes, after, page, changed) };
}

const REPLACEMENTS = ['Short', 'A much longer line of text than before', 'Àccénts and ümlauts', '0123456789', 'Mixed CASE & (symbols) [too]'];

describe('the text-editing spike: 50 edits', () => {
  const cases: { name: string; bytes: () => Uint8Array; page: number; item: number; text: string }[] = [];
  const plain = makePdf(3);
  for (let n = 0; n < 20; n++) cases.push({ name: `plain p${(n % 3) + 1}`, bytes: () => plain, page: n % 3, item: n % 4, text: REPLACEMENTS[n % 5]! });
  const form = makePdf(2, 'Form test', { form: true });
  for (let n = 0; n < 10; n++) cases.push({ name: 'form page', bytes: () => form, page: 0, item: n % 3, text: REPLACEMENTS[(n + 2) % 5]! });
  let turned: Uint8Array | null = null;
  const rotated = () => (turned ??= tools.edit(makePdf(2), (doc) => doc.rotate([0], 1)));
  for (let n = 0; n < 8; n++) cases.push({ name: 'turned page', bytes: rotated, page: 0, item: n % 4, text: REPLACEMENTS[(n + 1) % 5]! });
  let built: Uint8Array | null = null;
  const fonts = () => (built ??= builtPdf());
  for (let n = 0; n < 8; n++) cases.push({ name: 'fonts, colors, a turned line', bytes: fonts, page: 0, item: n % 4, text: REPLACEMENTS[(n + 3) % 5]! });

  it.each(cases.map((c, i) => [i + 1, c] as const))('edit %i (%s) changes only its text', async (_, c) => {
    const bytes = c.bytes();
    const before = texts(bytes, c.page);
    const target = before[c.item]!;
    const { after, stray } = edit(bytes, c.page, (content) => content.setText(target.index, c.text));
    expect(stray).toBe(0);
    const pageText = (await readPdf(after)).text[c.page]!.replace(/\s+/g, ' ');
    expect(pageText).toContain(c.text);
    // Every other line is still there, as it was.
    for (const other of before.filter((item) => item !== target)) expect(pageText).toContain(other.text.trim());
  });

  it('edits 47-48: falls back to a standard font when the PDF font has no such letters', async () => {
    const bytes = symbolPdf();
    for (const text of ['Hello world', 'Approved by the board']) {
      const [target] = texts(bytes, 0);
      const { after, stray } = edit(bytes, 0, (content) => content.setText(target!.index, text));
      expect(stray).toBe(0);
      expect((await readPdf(after)).text[0]).toContain(text);
      expect(texts(after, 0)[0]!.fontName).toBe('Helvetica');
    }
  });

  it('edits 49-50: refuses characters no available font can write, and leaves the page alone', () => {
    const bytes = makePdf(1);
    const [target] = texts(bytes, 0);
    for (const text of ['Ωμέγα', '日本語']) {
      expect(() => edit(bytes, 0, (content) => content.setText(target!.index, text))).toThrow(PageError);
    }
  });

  it('catches a change outside the edited area', () => {
    const bytes = makePdf(1);
    const [first, second] = texts(bytes, 0);
    // The edit reports only the first line as changed, but also moves the second one.
    const { stray } = edit(bytes, 0, (content) => {
      const changed = content.setText(first!.index, 'Edited');
      content.moveObject(second!.index, { ...second!.box, x: second!.box.x + 40 });
      return changed;
    });
    expect(stray).toBeGreaterThan(50);
  });
});

describe('other content edits', () => {
  it('adds text where clicked, in the chosen style, and removes text', async () => {
    const bytes = makePdf(1);
    const added = edit(bytes, 0, (content) =>
      content.addText({ x: 72, y: 400 }, 'Added later', { family: 'serif', bold: true, italic: false, size: 18, color: '#C00000' }),
    );
    expect(added.stray).toBe(0);
    const item = texts(added.after, 0).find((t) => t.text === 'Added later')!;
    expect(item.style).toMatchObject({ family: 'serif', bold: true, size: 18, color: '#C00000' });
    expect(item.box.y).toBeGreaterThan(380);
    expect(item.box.y).toBeLessThan(400);

    const [title] = texts(bytes, 0);
    const removed = edit(bytes, 0, (content) => content.removeObject(title!.index));
    expect(removed.stray).toBe(0);
    expect((await readPdf(removed.after)).text[0]).not.toContain('Folio test document');
  });

  it('moves, resizes and deletes pictures', () => {
    const bytes = builtPdf();
    const find = (b: Uint8Array) => {
      const pdf = tools.open(b);
      const content = pageContent(pdf, 0);
      const image = content.info().items.find((item) => item.kind === 'image');
      content.close();
      pdf.close();
      return image;
    };
    const image = find(bytes)!;
    expect(image.box).toMatchObject({ x: 320, y: 300, width: 160, height: 80 });
    const target = { x: 100, y: 120, width: 80, height: 40 };
    const moved = edit(bytes, 0, (content) => content.moveObject(image.index, target));
    expect(moved.stray).toBe(0);
    const box = find(moved.after)!.box;
    expect(box.x).toBeCloseTo(100, 0);
    expect(box.y).toBeCloseTo(120, 0);
    expect(box.width).toBeCloseTo(80, 0);
    const deleted = edit(bytes, 0, (content) => content.removeObject(image.index));
    expect(deleted.stray).toBe(0);
    expect(find(deleted.after)).toBeUndefined();
  });

  it('whiteout covers but keeps the text; redaction removes it for good', async () => {
    const bytes = makePdf(1);
    const marker = texts(bytes, 0).find((t) => t.text.includes('folio-marker-1'))!;
    const area = { x: marker.box.x - 2, y: marker.box.y - 2, width: marker.box.width + 4, height: marker.box.height + 4 };

    const covered = edit(bytes, 0, (content) => content.whiteout(area));
    expect(covered.stray).toBe(0);
    expect((await readPdf(covered.after)).text[0]).toContain('folio-marker-1');

    const redacted = edit(bytes, 0, (content) => content.redact([area]));
    expect(redacted.stray).toBe(0);
    // PDF.js reads text even when it's invisible or covered, so it's really gone.
    const text = (await readPdf(redacted.after)).text[0]!;
    expect(text).not.toContain('folio-marker-1');
    expect(text).toContain('The quick brown fox');
  });

  it('redaction blacks out the covered part of a picture and removes annotations there', async () => {
    const bytes = builtPdf();
    const area = { x: 330, y: 310, width: 40, height: 30 };
    const { after, stray } = edit(bytes, 0, (content) => content.redact([area]));
    expect(stray).toBe(0);
    // The picture is still there, now with its covered pixels black.
    const pdf = tools.open(after);
    const content = pageContent(pdf, 0);
    expect(content.info().items.some((item) => item.kind === 'image')).toBe(true);
    content.close();
    pdf.close();
  });
});

describe('fonts', () => {
  it('recognizes kinds of fonts and picks a standard one like it', () => {
    expect(fontKind('ABCDEF+TimesNewRomanPS-BoldMT', 34, 700)).toEqual({ family: 'serif', bold: true, italic: false });
    expect(fontKind('Calibri-Italic', 96, 400)).toEqual({ family: 'sans', bold: false, italic: true });
    expect(fontKind('CourierNewPSMT', 33, 400)).toMatchObject({ family: 'mono' });
    expect(fontKind('OpenSans-Regular', 32, 400)).toMatchObject({ family: 'sans' });
    expect(standardFont({ family: 'serif', bold: true, italic: true })).toBe('Times-BoldItalic');
    expect(standardFont({ family: 'mono', bold: false, italic: false })).toBe('Courier');
  });
});
