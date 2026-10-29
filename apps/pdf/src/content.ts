// Editing what's printed on a page: its text, pictures, whiteout and redaction. Works on the
// page objects of a document opened with the page-operations PDFium (pages.ts, ADR 0007).
//
// Every edit is checked: `strayChanges` draws the page from the bytes before and after (the
// saved bytes, so the content stream PDFium rewrote is what gets checked) and counts pixels
// that changed outside the edited areas. The session offers to undo when there are any.

import { type EditablePdf, PageError, type PageTools, type Runtime, type Wrapped } from './pages';

/** A rectangle on the page as shown (rotation applied), in points from the top-left corner. */
export type Box = { x: number; y: number; width: number; height: number };

export type FontFamily = 'sans' | 'serif' | 'mono';
export type TextStyle = { family: FontFamily; bold: boolean; italic: boolean; size: number; color: string };

export type TextItem = { kind: 'text'; index: number; text: string; box: Box; style: TextStyle; fontName: string };
export type ImageItem = { kind: 'image'; index: number; box: Box };
export type ContentItem = TextItem | ImageItem;
export type PageContentInfo = { width: number; height: number; items: ContentItem[] };

const TEXT = 1;
const PATH = 2;
const IMAGE = 3;
/** Shown points are mapped at this many device pixels each, for sub-point precision. */
const PRECISION = 8;

type Point = { x: number; y: number };
type Matrix = [number, number, number, number, number, number];
type PageRect = { left: number; bottom: number; right: number; top: number };

/** The 14 standard PDF fonts used when a document's own font can't write what's typed. */
export function standardFont(style: Pick<TextStyle, 'family' | 'bold' | 'italic'>): string {
  const names = {
    sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
    serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
    mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
  }[style.family];
  return names[(style.bold ? 1 : 0) + (style.italic ? 2 : 0)]!;
}

/** What kind of font a PDF font is, from its name and descriptor flags. */
export function fontKind(name: string, flags: number, weight: number): Pick<TextStyle, 'family' | 'bold' | 'italic'> {
  const lower = name.replace(/^[A-Z]{6}\+/, '').toLowerCase();
  const known = flags >= 0 ? flags : 0;
  const mono = (known & 1) !== 0 || /courier|mono|consol|menlo/.test(lower);
  const serif = !mono && !/sans/.test(lower) && ((known & 2) !== 0 || /times|serif|georgia|garamond|cambria|roman|minion|book/.test(lower));
  return {
    family: mono ? 'mono' : serif ? 'serif' : 'sans',
    bold: weight >= 600 || /bold|black|heavy|semibold|demi/.test(lower),
    italic: (known & 64) !== 0 || /italic|oblique/.test(lower),
  };
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const rgb = (color: string) => {
  const value = Number.parseInt(color.replace('#', ''), 16) || 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255] as const;
};
const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
const overlaps = (a: PageRect, b: PageRect) => a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top;
const inside = (a: PageRect, b: PageRect) => a.left >= b.left && a.right <= b.right && a.bottom >= b.bottom && a.top <= b.top;

export class PageContent {
  private readonly m: Wrapped;
  private readonly rt: Runtime;
  private readonly page: number;
  private textPage = 0;
  readonly width: number;
  readonly height: number;

  constructor(
    private readonly pdf: EditablePdf,
    readonly pageIndex: number,
  ) {
    this.m = pdf.m;
    this.rt = pdf.rt;
    const info = pdf.page(pageIndex);
    this.width = info.width;
    this.height = info.height;
    this.page = this.m.FPDF_LoadPage(pdf.doc, pageIndex);
    if (!this.page) throw new PageError(`Page ${pageIndex + 1} could not be read.`);
  }

  close() {
    if (this.textPage) this.m.FPDFText_ClosePage(this.textPage);
    this.m.FPDF_ClosePage(this.page);
  }

  /** How many objects the page has (a newly added one is the last). */
  get objectCount(): number {
    return this.m.FPDFPage_CountObjects(this.page);
  }

  /** Writes the changed objects back into the page's content stream. */
  commit() {
    if (!this.m.FPDFPage_GenerateContent(this.page)) throw new PageError("The page couldn't be updated.");
  }

  info(): PageContentInfo {
    const items: ContentItem[] = [];
    const count = this.m.FPDFPage_CountObjects(this.page);
    for (let index = 0; index < count; index++) {
      const obj = this.m.FPDFPage_GetObject(this.page, index);
      const type = this.m.FPDFPageObj_GetType(obj);
      if (type === TEXT) {
        const text = this.textOf(obj);
        if (text.trim()) items.push({ kind: 'text', index, text, box: this.boxOf(obj), ...this.styleOf(obj) });
      } else if (type === IMAGE) {
        items.push({ kind: 'image', index, box: this.boxOf(obj) });
      }
    }
    return { width: this.width, height: this.height, items };
  }

  /** Replaces a text object's text (empty removes it). Returns the areas it changed. */
  setText(index: number, text: string): Box[] {
    const obj = this.object(index, TEXT);
    const before = this.boxOf(obj);
    const wanted = text.replace(/[\r\n]+/g, ' ');
    if (!wanted.trim()) return this.removeObject(index);
    this.withWide(wanted, (ptr) => this.m.FPDFText_SetText(obj, ptr));
    this.refreshText();
    if (same(this.textOf(obj), wanted)) return [before, this.boxOf(obj)];

    // The document's font can't write some of these characters (fonts are often embedded
    // with only the letters they use): a standard font of the same kind takes over.
    const { style } = this.styleOf(obj);
    const replacement = this.newText(wanted, style, this.fontSizeOf(obj), this.matrixOf(obj));
    this.m.FPDFPage_InsertObjectAtIndex(this.page, replacement, index);
    this.m.FPDFPage_RemoveObject(this.page, obj);
    this.m.FPDFPageObj_Destroy(obj);
    this.refreshText();
    if (!same(this.textOf(replacement), wanted)) {
      throw new PageError("Some of these characters can't be written in this PDF yet.");
    }
    return [before, this.boxOf(replacement)];
  }

  /** New text with its baseline starting at `at`. */
  addText(at: Point, text: string, style: TextStyle): Box[] {
    const wanted = text.replace(/[\r\n]+/g, ' ');
    if (!wanted.trim()) return [];
    const origin = this.toPage(at.x, at.y);
    const right = this.toPage(at.x + 10, at.y);
    const up = this.toPage(at.x, at.y - 10);
    const matrix: Matrix = [
      (right.x - origin.x) / 10,
      (right.y - origin.y) / 10,
      (up.x - origin.x) / 10,
      (up.y - origin.y) / 10,
      origin.x,
      origin.y,
    ];
    const obj = this.newText(wanted, style, style.size, matrix);
    this.m.FPDFPage_InsertObject(this.page, obj);
    this.refreshText();
    if (!same(this.textOf(obj), wanted)) throw new PageError("Some of these characters can't be written in this PDF yet.");
    return [this.boxOf(obj)];
  }

  /** Moves and resizes an object so it fills `to`. */
  moveObject(index: number, to: Box): Box[] {
    const obj = this.object(index);
    const from = this.boxOf(obj);
    const a = this.pageRect(from);
    const b = this.pageRect(to);
    const sx = (b.right - b.left) / Math.max(1e-6, a.right - a.left);
    const sy = (b.top - b.bottom) / Math.max(1e-6, a.top - a.bottom);
    this.m.FPDFPageObj_Transform(obj, sx, 0, 0, sy, b.left - a.left * sx, b.bottom - a.bottom * sy);
    return [from, to];
  }

  removeObject(index: number): Box[] {
    const obj = this.object(index);
    const box = this.boxOf(obj);
    if (!this.m.FPDFPage_RemoveObject(this.page, obj)) throw new PageError("That couldn't be removed.");
    this.m.FPDFPageObj_Destroy(obj);
    this.refreshText();
    return [box];
  }

  /** A picture (RGBA pixels) filling `box`, upright as the page is shown. */
  addPicture(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, box: Box): Box[] {
    const image = this.m.FPDFPageObj_NewImageObj(this.pdf.doc);
    const stride = width * 4;
    const buffer = this.rt.wasmExports.malloc(stride * height);
    try {
      const heap = this.rt.HEAPU8;
      for (let i = 0; i < width * height; i++) {
        // PDFium bitmaps are BGRA.
        heap[buffer + i * 4] = rgba[i * 4 + 2]!;
        heap[buffer + i * 4 + 1] = rgba[i * 4 + 1]!;
        heap[buffer + i * 4 + 2] = rgba[i * 4]!;
        heap[buffer + i * 4 + 3] = rgba[i * 4 + 3]!;
      }
      const bitmap = this.m.FPDFBitmap_CreateEx(width, height, 4, buffer, stride);
      try {
        if (!this.m.FPDFImageObj_SetBitmap(0, 0, image, bitmap)) throw new PageError("The picture couldn't be added.");
      } finally {
        this.m.FPDFBitmap_Destroy(bitmap);
      }
    } catch (error) {
      this.m.FPDFPageObj_Destroy(image);
      throw error;
    } finally {
      this.rt.wasmExports.free(buffer);
    }
    const origin = this.toPage(box.x, box.y + box.height);
    const across = this.toPage(box.x + box.width, box.y + box.height);
    const up = this.toPage(box.x, box.y);
    this.m.FPDFImageObj_SetMatrix(
      image,
      across.x - origin.x,
      across.y - origin.y,
      up.x - origin.x,
      up.y - origin.y,
      origin.x,
      origin.y,
    );
    this.m.FPDFPage_InsertObject(this.page, image);
    return [box];
  }

  /** Covers `box` with white. What's underneath stays in the file (see `redact`). */
  whiteout(box: Box): Box[] {
    this.insertRect(this.pageRect(box), [255, 255, 255]);
    return [box];
  }

  /**
   * Removes everything in the boxes: text (character by character), the covered pixels of
   * pictures, drawings that lie inside, and annotations that touch them; then marks each box
   * in black.
   */
  redact(boxes: Box[]): Box[] {
    const rects = boxes.map((box) => this.pageRect(box));
    const rectPtr = this.rt.wasmExports.malloc(16);
    try {
      for (const rect of rects) {
        // FS_RECTF is left, top, right, bottom.
        [rect.left, rect.top, rect.right, rect.bottom].forEach((v, i) => this.rt.setValue(rectPtr + 4 * i, v, 'float'));
        this.m.EPDFText_RedactInRect(this.page, rectPtr, true, false);
      }
    } finally {
      this.rt.wasmExports.free(rectPtr);
    }

    for (let index = this.m.FPDFPage_CountObjects(this.page) - 1; index >= 0; index--) {
      const obj = this.m.FPDFPage_GetObject(this.page, index);
      const type = this.m.FPDFPageObj_GetType(obj);
      const bounds = this.boundsOf(obj);
      if (type === IMAGE && rects.some((rect) => overlaps(bounds, rect))) {
        this.blackOut(obj, rects.filter((rect) => overlaps(bounds, rect)));
      } else if (type === PATH && rects.some((rect) => inside(bounds, rect))) {
        this.m.FPDFPage_RemoveObject(this.page, obj);
        this.m.FPDFPageObj_Destroy(obj);
      }
    }

    const annotRect = this.rt.wasmExports.malloc(16);
    try {
      for (let index = this.m.FPDFPage_GetAnnotCount(this.page) - 1; index >= 0; index--) {
        const annot = this.m.FPDFPage_GetAnnot(this.page, index);
        if (!annot) continue;
        const ok = this.m.FPDFAnnot_GetRect(annot, annotRect);
        this.m.FPDFPage_CloseAnnot(annot);
        if (!ok) continue;
        const [left, top, right, bottom] = [0, 1, 2, 3].map((i) => this.rt.getValue(annotRect + 4 * i, 'float')) as [
          number,
          number,
          number,
          number,
        ];
        const bounds = { left: Math.min(left, right), right: Math.max(left, right), bottom: Math.min(top, bottom), top: Math.max(top, bottom) };
        if (rects.some((rect) => overlaps(bounds, rect))) this.m.FPDFPage_RemoveAnnot(this.page, index);
      }
    } finally {
      this.rt.wasmExports.free(annotRect);
    }

    for (const rect of rects) this.insertRect(rect, [0, 0, 0]);
    this.refreshText();
    return boxes;
  }

  // ---- Helpers --------------------------------------------------------------------------------

  private object(index: number, type?: number): number {
    const count = this.m.FPDFPage_CountObjects(this.page);
    const obj = index >= 0 && index < count ? this.m.FPDFPage_GetObject(this.page, index) : 0;
    if (!obj || (type !== undefined && this.m.FPDFPageObj_GetType(obj) !== type)) {
      throw new PageError('That part of the page has changed. Try again.');
    }
    return obj;
  }

  private refreshText() {
    if (this.textPage) this.m.FPDFText_ClosePage(this.textPage);
    this.textPage = 0;
  }

  private textOf(obj: number): string {
    this.textPage ||= this.m.FPDFText_LoadPage(this.page);
    const bytes = this.m.FPDFTextObj_GetText(obj, this.textPage, 0, 0);
    if (bytes <= 2) return '';
    const ptr = this.rt.wasmExports.malloc(bytes);
    try {
      this.m.FPDFTextObj_GetText(obj, this.textPage, ptr, bytes);
      return new TextDecoder('utf-16le').decode(this.rt.HEAPU8.slice(ptr, ptr + bytes - 2));
    } finally {
      this.rt.wasmExports.free(ptr);
    }
  }

  private fontSizeOf(obj: number): number {
    const ptr = this.rt.wasmExports.malloc(4);
    try {
      return this.m.FPDFTextObj_GetFontSize(obj, ptr) ? this.rt.getValue(ptr, 'float') : 12;
    } finally {
      this.rt.wasmExports.free(ptr);
    }
  }

  private matrixOf(obj: number): Matrix {
    const ptr = this.rt.wasmExports.malloc(24);
    try {
      if (!this.m.FPDFPageObj_GetMatrix(obj, ptr)) return [1, 0, 0, 1, 0, 0];
      return [0, 1, 2, 3, 4, 5].map((i) => this.rt.getValue(ptr + 4 * i, 'float')) as Matrix;
    } finally {
      this.rt.wasmExports.free(ptr);
    }
  }

  private styleOf(obj: number): { style: TextStyle; fontName: string } {
    const font = this.m.FPDFTextObj_GetFont(obj);
    let fontName = '';
    if (font) {
      const size = this.m.FPDFFont_GetBaseFontName(font, 0, 0);
      if (size > 1) {
        const ptr = this.rt.wasmExports.malloc(size);
        try {
          this.m.FPDFFont_GetBaseFontName(font, ptr, size);
          fontName = new TextDecoder().decode(this.rt.HEAPU8.slice(ptr, ptr + size - 1));
        } finally {
          this.rt.wasmExports.free(ptr);
        }
      }
    }
    const kind = fontKind(fontName, font ? this.m.FPDFFont_GetFlags(font) : 0, font ? this.m.FPDFFont_GetWeight(font) : 400);
    const [, , c, d] = this.matrixOf(obj);
    const size = Math.round(this.fontSizeOf(obj) * Math.hypot(c, d) * 10) / 10;
    const color = this.rt.wasmExports.malloc(16);
    try {
      const ok = this.m.FPDFPageObj_GetFillColor(obj, color, color + 4, color + 8, color + 12);
      const [r, g, b] = ok ? [0, 1, 2].map((i) => this.rt.getValue(color + 4 * i, 'i32') & 255) : [0, 0, 0];
      return { style: { ...kind, size, color: hex(r!, g!, b!) }, fontName: fontName.replace(/^[A-Z]{6}\+/, '') };
    } finally {
      this.rt.wasmExports.free(color);
    }
  }

  private newText(text: string, style: TextStyle, fontSize: number, matrix: Matrix): number {
    const font = this.m.FPDFText_LoadStandardFont(this.pdf.doc, standardFont(style));
    if (!font) throw new PageError('A font could not be loaded.');
    try {
      const obj = this.m.FPDFPageObj_CreateTextObj(this.pdf.doc, font, fontSize);
      if (!obj) throw new PageError('The text could not be added.');
      this.withWide(text, (ptr) => this.m.FPDFText_SetText(obj, ptr));
      const [r, g, b] = rgb(style.color);
      this.m.FPDFPageObj_SetFillColor(obj, r, g, b, 255);
      const ptr = this.rt.wasmExports.malloc(24);
      try {
        matrix.forEach((v, i) => this.rt.setValue(ptr + 4 * i, v, 'float'));
        this.m.FPDFPageObj_SetMatrix(obj, ptr);
      } finally {
        this.rt.wasmExports.free(ptr);
      }
      return obj;
    } finally {
      this.m.FPDFFont_Close(font);
    }
  }

  private insertRect(rect: PageRect, [r, g, b]: readonly [number, number, number]) {
    const path = this.m.FPDFPageObj_CreateNewRect(rect.left, rect.bottom, rect.right - rect.left, rect.top - rect.bottom);
    this.m.FPDFPageObj_SetFillColor(path, r, g, b, 255);
    this.m.FPDFPath_SetDrawMode(path, 1, false);
    this.m.FPDFPage_InsertObject(this.page, path);
  }

  /** Blacks out the parts of a picture under `rects` (in the picture's own pixels). */
  private blackOut(obj: number, rects: PageRect[]) {
    const bitmap = this.m.FPDFImageObj_GetBitmap(obj);
    if (!bitmap) {
      // A picture PDFium can't decode can't be partly blacked out: it goes completely.
      this.m.FPDFPage_RemoveObject(this.page, obj);
      this.m.FPDFPageObj_Destroy(obj);
      return;
    }
    try {
      const w = this.m.FPDFBitmap_GetWidth(bitmap);
      const h = this.m.FPDFBitmap_GetHeight(bitmap);
      const [a, b, c, d, e, f] = this.matrixOf(obj);
      const det = a * d - b * c || 1e-9;
      // Page point -> picture pixel (the picture fills the unit square, top row first).
      const toPixel = (x: number, y: number) => {
        const u = ((x - e) * d - (y - f) * c) / det;
        const v = ((y - f) * a - (x - e) * b) / det;
        return { x: u * w, y: (1 - v) * h };
      };
      for (const rect of rects) {
        const corners = [
          toPixel(rect.left, rect.bottom),
          toPixel(rect.right, rect.bottom),
          toPixel(rect.left, rect.top),
          toPixel(rect.right, rect.top),
        ];
        const left = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))));
        const top = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))));
        const right = Math.min(w, Math.ceil(Math.max(...corners.map((p) => p.x))));
        const bottom = Math.min(h, Math.ceil(Math.max(...corners.map((p) => p.y))));
        if (right > left && bottom > top) this.m.FPDFBitmap_FillRect(bitmap, left, top, right - left, bottom - top, 0xff000000);
      }
      if (!this.m.FPDFImageObj_SetBitmap(0, 0, obj, bitmap)) {
        this.m.FPDFPage_RemoveObject(this.page, obj);
        this.m.FPDFPageObj_Destroy(obj);
      }
    } finally {
      this.m.FPDFBitmap_Destroy(bitmap);
    }
  }

  private boundsOf(obj: number): PageRect {
    const ptr = this.rt.wasmExports.malloc(16);
    try {
      this.m.FPDFPageObj_GetBounds(obj, ptr, ptr + 4, ptr + 8, ptr + 12);
      const [left, bottom, right, top] = [0, 1, 2, 3].map((i) => this.rt.getValue(ptr + 4 * i, 'float')) as [
        number,
        number,
        number,
        number,
      ];
      return { left, bottom, right, top };
    } finally {
      this.rt.wasmExports.free(ptr);
    }
  }

  private boxOf(obj: number): Box {
    const { left, bottom, right, top } = this.boundsOf(obj);
    const corners = [this.toShown(left, bottom), this.toShown(right, bottom), this.toShown(left, top), this.toShown(right, top)];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  /** The page-space rectangle covering a shown box. */
  private pageRect(box: Box): PageRect {
    const corners = [
      this.toPage(box.x, box.y),
      this.toPage(box.x + box.width, box.y),
      this.toPage(box.x, box.y + box.height),
      this.toPage(box.x + box.width, box.y + box.height),
    ];
    return {
      left: Math.min(...corners.map((p) => p.x)),
      right: Math.max(...corners.map((p) => p.x)),
      bottom: Math.min(...corners.map((p) => p.y)),
      top: Math.max(...corners.map((p) => p.y)),
    };
  }

  private toShown(x: number, y: number): Point {
    const out = this.rt.wasmExports.malloc(8);
    try {
      const w = Math.round(this.width * PRECISION);
      const h = Math.round(this.height * PRECISION);
      this.m.FPDF_PageToDevice(this.page, 0, 0, w, h, 0, x, y, out, out + 4);
      return { x: this.rt.getValue(out, 'i32') / PRECISION, y: this.rt.getValue(out + 4, 'i32') / PRECISION };
    } finally {
      this.rt.wasmExports.free(out);
    }
  }

  private toPage(x: number, y: number): Point {
    const out = this.rt.wasmExports.malloc(16);
    try {
      const w = Math.round(this.width * PRECISION);
      const h = Math.round(this.height * PRECISION);
      this.m.FPDF_DeviceToPage(this.page, 0, 0, w, h, 0, Math.round(x * PRECISION), Math.round(y * PRECISION), out, out + 8);
      return { x: this.rt.getValue(out, 'double'), y: this.rt.getValue(out + 8, 'double') };
    } finally {
      this.rt.wasmExports.free(out);
    }
  }

  private withWide<T>(text: string, work: (ptr: number) => T): T {
    const ptr = this.rt.wasmExports.malloc((text.length + 1) * 2);
    try {
      for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i);
        this.rt.HEAPU8[ptr + i * 2] = unit & 255;
        this.rt.HEAPU8[ptr + i * 2 + 1] = unit >> 8;
      }
      this.rt.HEAPU8[ptr + text.length * 2] = 0;
      this.rt.HEAPU8[ptr + text.length * 2 + 1] = 0;
      return work(ptr);
    } finally {
      this.rt.wasmExports.free(ptr);
    }
  }
}

/** Opens a page's content for changes. */
export function pageContent(pdf: EditablePdf, pageIndex: number): PageContent {
  return new PageContent(pdf, pageIndex);
}

/** A page drawn into pixels (BGRx rows), for comparing before and after. */
export function renderPage(pdf: EditablePdf, pageIndex: number, scale: number) {
  const info = pdf.page(pageIndex);
  const width = Math.ceil(info.width * scale);
  const height = Math.ceil(info.height * scale);
  const page = pdf.m.FPDF_LoadPage(pdf.doc, pageIndex);
  if (!page) throw new PageError(`Page ${pageIndex + 1} could not be read.`);
  const bitmap = pdf.m.FPDFBitmap_Create(width, height, 0);
  try {
    pdf.m.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
    // Flags: draw annotations (1).
    pdf.m.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 1);
    const stride = pdf.m.FPDFBitmap_GetStride(bitmap);
    const start = pdf.m.FPDFBitmap_GetBuffer(bitmap);
    return { width, height, stride, data: pdf.rt.HEAPU8.slice(start, start + stride * height) };
  } finally {
    pdf.m.FPDFBitmap_Destroy(bitmap);
    pdf.m.FPDF_ClosePage(page);
  }
}

/** How many pixels changed outside `allowed` (shown boxes) between two versions of a page. */
export function strayChanges(
  tools: PageTools,
  before: Uint8Array,
  after: Uint8Array,
  pageIndex: number,
  allowed: Box[],
  password = '',
): number {
  const scale = 1.5;
  const margin = 2;
  const draw = (bytes: Uint8Array) => {
    const pdf = tools.open(bytes, password);
    try {
      return renderPage(pdf, pageIndex, scale);
    } finally {
      pdf.close();
    }
  };
  const a = draw(before);
  const b = draw(after);
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  const zones = allowed.map((box) => ({
    left: Math.floor((box.x - margin) * scale),
    top: Math.floor((box.y - margin) * scale),
    right: Math.ceil((box.x + box.width + margin) * scale),
    bottom: Math.ceil((box.y + box.height + margin) * scale),
  }));
  let stray = 0;
  for (let y = 0; y < a.height; y++) {
    const row = y * a.stride;
    for (let x = 0; x < a.width; x++) {
      const i = row + x * 4;
      const diff = Math.max(
        Math.abs(a.data[i]! - b.data[i]!),
        Math.abs(a.data[i + 1]! - b.data[i + 1]!),
        Math.abs(a.data[i + 2]! - b.data[i + 2]!),
      );
      if (diff <= 32) continue;
      if (zones.some((z) => x >= z.left && x < z.right && y >= z.top && y < z.bottom)) continue;
      stray++;
    }
  }
  return stray;
}
