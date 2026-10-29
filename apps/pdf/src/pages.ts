// Page operations for Folio PDF: reorder, rotate, delete, duplicate, insert (blank pages,
// other PDFs, pictures), extract and split. They work on a PDF's bytes with a PDFium instance
// of their own, from the same bundled pdfium.wasm the viewer uses (docs/adr/0006): the session
// exports the document, applies an operation here, and reloads the result.

import { init } from '@embedpdf/pdfium';

export type Wrapped = Awaited<ReturnType<typeof init>>;

/** The few Emscripten runtime pieces used here (the package ships no types for them). */
export type Runtime = {
  HEAPU8: Uint8Array;
  wasmExports: { malloc(size: number): number; free(ptr: number): void };
  getValue(ptr: number, type: 'i32' | 'float' | 'double'): number;
  setValue(ptr: number, value: number, type: 'i32' | 'float' | 'double'): void;
};

export class PageError extends Error {}

/** What a page looks like from outside: its size in points, as shown (rotation applied). */
export type PageInfo = { width: number; height: number; rotation: 0 | 1 | 2 | 3 };

export class PageTools {
  private readonly rt: Runtime;

  constructor(private readonly m: Wrapped) {
    this.rt = m.pdfium as unknown as Runtime;
  }

  /** Opens `bytes` (with its password, if it has one) for a series of changes; close it when done. */
  open(bytes: Uint8Array, password = ''): EditablePdf {
    const ptr = this.rt.wasmExports.malloc(Math.max(1, bytes.length));
    this.rt.HEAPU8.set(bytes, ptr);
    const doc = this.m.FPDF_LoadMemDocument(ptr, bytes.length, password);
    if (!doc) {
      this.rt.wasmExports.free(ptr);
      const code = this.m.FPDF_GetLastError();
      // PDFium error 4 = password needed.
      throw new PageError(code === 4 ? 'This PDF is password-protected.' : "This file isn't a PDF that can be read.");
    }
    return new EditablePdf(this.m, this.rt, doc, ptr);
  }

  /** A new, empty PDF. */
  create(): EditablePdf {
    const doc = this.m.FPDF_CreateNewDocument();
    if (!doc) throw new PageError('Could not create a PDF.');
    return new EditablePdf(this.m, this.rt, doc, 0);
  }

  /** Opens, changes and saves in one go; the document is always closed. */
  edit(bytes: Uint8Array, change: (pdf: EditablePdf) => void, password = ''): Uint8Array {
    const pdf = this.open(bytes, password);
    try {
      change(pdf);
      return pdf.save();
    } finally {
      pdf.close();
    }
  }
}

export class EditablePdf {
  private closed = false;

  constructor(
    /** PDFium itself, for content.ts (page objects); everything else goes through methods. */
    readonly m: Wrapped,
    readonly rt: Runtime,
    readonly doc: number,
    private readonly buffer: number,
  ) {}

  get pageCount(): number {
    return this.m.FPDF_GetPageCount(this.doc);
  }

  /** Whether the file is encrypted (it may have a password to open it). */
  get encrypted(): boolean {
    return this.m.EPDF_IsEncrypted(this.doc);
  }

  /** What the file allows as it was opened (PDF permission flags; all set when unrestricted). */
  get permissions(): number {
    return this.m.FPDF_GetDocPermissions(this.doc) >>> 0;
  }

  /** From the next save on, opening the file takes `password`; everything else stays allowed. */
  protect(password: string) {
    if (!password) throw new PageError('Type a password.');
    if (!this.m.EPDF_SetEncryption(this.doc, password, password, ALL_PERMISSIONS)) {
      throw new PageError("The password couldn't be set.");
    }
  }

  /**
   * From the next save on, only `allowed` (PDF permission flags) is allowed without the owner
   * password; opening takes `userPassword` ('' opens freely).
   */
  restrict(ownerPassword: string, allowed: number, userPassword = '') {
    if (!ownerPassword) throw new PageError('Type an owner password.');
    if (!this.m.EPDF_SetEncryption(this.doc, userPassword, ownerPassword, allowed)) {
      throw new PageError("The restrictions couldn't be set.");
    }
  }

  /** From the next save on, the file opens without a password. */
  unprotect() {
    if (!this.m.EPDF_RemoveEncryption(this.doc)) throw new PageError("The password couldn't be removed.");
  }

  page(index: number): PageInfo {
    this.check(index);
    const size = this.rt.wasmExports.malloc(8);
    try {
      this.m.FPDF_GetPageSizeByIndexF(this.doc, index, size);
      const width = this.rt.getValue(size, 'float');
      const height = this.rt.getValue(size + 4, 'float');
      const rotation = this.withPage(index, (page) => this.m.FPDFPage_GetRotation(page)) as PageInfo['rotation'];
      return { width, height, rotation };
    } finally {
      this.rt.wasmExports.free(size);
    }
  }

  /** Turns pages clockwise by `quarterTurns` (negative turns counter-clockwise). */
  rotate(indices: number[], quarterTurns: number) {
    for (const index of unique(indices)) {
      this.check(index);
      this.withPage(index, (page) => {
        const next = (((this.m.FPDFPage_GetRotation(page) + quarterTurns) % 4) + 4) % 4;
        this.m.FPDFPage_SetRotation(page, next);
      });
    }
  }

  /** Puts the pages in `order` (each current index exactly once). */
  reorder(order: number[]) {
    const count = this.pageCount;
    if (order.length !== count || new Set(order).size !== count || order.some((i) => i < 0 || i >= count)) {
      throw new PageError('That page order is incomplete.');
    }
    if (order.every((index, position) => index === position)) return;
    this.withInts(order, (ptr) => {
      if (!this.m.FPDF_MovePages(this.doc, ptr, order.length, 0)) throw new PageError('The pages could not be moved.');
    });
  }

  /** Moves `indices` (kept in page order) so they start at `before` in the current numbering. */
  move(indices: number[], before: number) {
    this.reorder(movedOrder(this.pageCount, indices, before));
  }

  remove(indices: number[]) {
    const doomed = unique(indices).sort((a, b) => b - a);
    if (doomed.length >= this.pageCount) throw new PageError("A PDF needs at least one page, so the last page can't be deleted.");
    for (const index of doomed) {
      this.check(index);
      this.m.FPDFPage_Delete(this.doc, index);
    }
  }

  insertBlank(at: number, width: number, height: number) {
    const page = this.m.FPDFPage_New(this.doc, clamp(at, 0, this.pageCount), width, height);
    if (!page) throw new PageError('A blank page could not be added.');
    this.m.FPDF_ClosePage(page);
  }

  /** Copies pages of `source` (all when `indices` is null) to position `at` here. */
  importFrom(source: EditablePdf, indices: number[] | null, at: number) {
    const pages = indices ?? [...Array(source.pageCount).keys()];
    if (pages.length === 0) return;
    pages.forEach((index) => source.check(index));
    this.withInts(pages, (ptr) => {
      if (!this.m.FPDF_ImportPagesByIndex(this.doc, source.doc, ptr, pages.length, clamp(at, 0, this.pageCount))) {
        throw new PageError('The pages could not be copied.');
      }
    });
  }

  save(): Uint8Array {
    const writer = this.m.PDFiumExt_OpenFileWriter();
    try {
      if (!this.m.PDFiumExt_SaveAsCopy(this.doc, writer)) throw new PageError('The PDF could not be saved.');
      const size = this.m.PDFiumExt_GetFileWriterSize(writer);
      const data = this.rt.wasmExports.malloc(Math.max(1, size));
      try {
        this.m.PDFiumExt_GetFileWriterData(writer, data, size);
        return this.rt.HEAPU8.slice(data, data + size);
      } finally {
        this.rt.wasmExports.free(data);
      }
    } finally {
      this.m.PDFiumExt_CloseFileWriter(writer);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.m.FPDF_CloseDocument(this.doc);
    // The source bytes must stay in place until the document is closed.
    if (this.buffer) this.rt.wasmExports.free(this.buffer);
  }

  private check(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.pageCount) throw new PageError(`There is no page ${index + 1}.`);
  }

  private withPage<T>(index: number, work: (page: number) => T): T {
    const page = this.m.FPDF_LoadPage(this.doc, index);
    if (!page) throw new PageError(`Page ${index + 1} could not be read.`);
    try {
      return work(page);
    } finally {
      this.m.FPDF_ClosePage(page);
    }
  }

  private withInts<T>(values: number[], work: (ptr: number) => T): T {
    const ptr = this.rt.wasmExports.malloc(4 * Math.max(1, values.length));
    try {
      values.forEach((value, i) => this.rt.setValue(ptr + 4 * i, value, 'i32'));
      return work(ptr);
    } finally {
      this.rt.wasmExports.free(ptr);
    }
  }
}

/** Printing, copying, changing, annotating, filling in, and putting pages together: all allowed. */
const ALL_PERMISSIONS = 4 | 8 | 16 | 32 | 256 | 512 | 1024 | 2048;

const unique = (values: number[]) => [...new Set(values)];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The page order after moving `indices` (in page order) to just before page `before` of the
 * current numbering (`before` = page count moves them to the end).
 */
export function movedOrder(count: number, indices: number[], before: number): number[] {
  const moving = unique(indices).filter((i) => i >= 0 && i < count).sort((a, b) => a - b);
  const set = new Set(moving);
  const staying = [...Array(count).keys()].filter((i) => !set.has(i));
  const at = staying.filter((i) => i < before).length;
  return [...staying.slice(0, at), ...moving, ...staying.slice(at)];
}

/**
 * Page ranges as people type them: "1-3, 5, 8-10" (1-based, inclusive). Returns 0-based
 * groups, or a message saying what's wrong.
 */
export function parseRanges(text: string, pageCount: number): number[][] | string {
  const parts = text.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return 'Type page ranges, for example 1-3, 4, 5-8.';
  const groups: number[][] = [];
  for (const part of parts) {
    const match = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(part);
    if (!match) return `"${part}" isn't a page or a range like 2-5.`;
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last > pageCount || first > last) return `"${part}" is outside pages 1 to ${pageCount}.`;
    groups.push([...Array(last - first + 1).keys()].map((i) => first - 1 + i));
  }
  return groups;
}

/** Groups of `every` pages: [[0..every-1], [every..], ...]. */
export function chunks(pageCount: number, every: number): number[][] {
  const size = Math.max(1, Math.floor(every));
  const groups: number[][] = [];
  for (let start = 0; start < pageCount; start += size) {
    groups.push([...Array(Math.min(size, pageCount - start)).keys()].map((i) => start + i));
  }
  return groups;
}

/** Page labels for file names: "pages 1-3, 5" or "page 4" (1-based). */
export function pagesLabel(indices: number[]): string {
  const sorted = unique(indices).sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i]! + 1) i++;
    runs.push(start === sorted[i] ? `${start + 1}` : `${start + 1}-${sorted[i]! + 1}`);
  }
  return `${sorted.length === 1 ? 'page' : 'pages'} ${runs.join(', ')}`;
}

/** Starts PDFium from the bytes of pdfium.wasm. */
export async function createPageTools(wasm: ArrayBuffer | Uint8Array): Promise<PageTools> {
  const m = await init({ wasmBinary: wasm instanceof Uint8Array ? wasm.slice().buffer : wasm });
  m.PDFiumExt_Init();
  return new PageTools(m);
}
