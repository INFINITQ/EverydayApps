// Independent check of PDFs the app saves: Mozilla's PDF.js parses them, not the PDFium engine
// the app itself uses. Tests only.

import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfSummary = {
  pages: number;
  annotations: {
    page: number;
    subtype: string;
    fieldName?: string;
    fieldValue?: unknown;
    /** The annotation's note (a sticky note's text). */
    contents?: string;
  }[];
  /** Each page's text, items joined with spaces. */
  text: string[];
  /** Each page's rotation in degrees (0, 90, 180, 270). */
  rotations: number[];
  /** Each page's shown size in points, rotation applied. */
  sizes: { width: number; height: number }[];
  /** How many pictures each page draws. */
  images: number[];
};

export async function readPdf(bytes: Uint8Array, password?: string): Promise<PdfSummary> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    ...(password ? { password } : {}),
  });
  const doc = await task.promise;
  try {
    const summary: PdfSummary = {
      pages: doc.numPages,
      annotations: [],
      text: [],
      rotations: [],
      sizes: [],
      images: [],
    };
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      summary.rotations.push(page.rotate);
      const view = page.getViewport({ scale: 1 });
      summary.sizes.push({ width: Math.round(view.width), height: Math.round(view.height) });
      const ops = await page.getOperatorList();
      const pictures = [
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageMaskXObject,
      ];
      summary.images.push(ops.fnArray.filter((fn) => pictures.includes(fn)).length);
      for (const a of await page.getAnnotations()) {
        summary.annotations.push({
          page: n,
          subtype: a.subtype,
          fieldName: a.fieldName,
          fieldValue: a.fieldValue,
          contents: a.contentsObj?.str || undefined,
        });
      }
      const content = await page.getTextContent();
      summary.text.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return summary;
  } finally {
    await task.destroy();
  }
}
