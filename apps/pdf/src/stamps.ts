// Folio's built-in rubber stamps ("Approved", "Draft"...). EmbedPDF places stamps from a stamp
// library: a PDF with one stamp per page. Folio draws that PDF itself, so nothing is downloaded
// (EmbedPDF's own library comes from a CDN, which Folio turns off).

import { PdfAnnotationName } from '@embedpdf/models';
import type { StampLibraryConfig } from '@embedpdf/plugin-stamp/react';

type Rgb = readonly [number, number, number];

const GREEN: Rgb = [0.11, 0.5, 0.2];
const RED: Rgb = [0.78, 0.13, 0.11];
const BLUE: Rgb = [0.13, 0.33, 0.72];

export const STAMPS: { id: string; text: string; label: string; name: PdfAnnotationName; color: Rgb }[] = [
  { id: 'approved', text: 'APPROVED', label: 'Approved', name: PdfAnnotationName.Approved, color: GREEN },
  { id: 'not-approved', text: 'NOT APPROVED', label: 'Not approved', name: PdfAnnotationName.NotApproved, color: RED },
  { id: 'draft', text: 'DRAFT', label: 'Draft', name: PdfAnnotationName.Draft, color: BLUE },
  { id: 'final', text: 'FINAL', label: 'Final', name: PdfAnnotationName.Final, color: GREEN },
  { id: 'confidential', text: 'CONFIDENTIAL', label: 'Confidential', name: PdfAnnotationName.Confidential, color: RED },
  { id: 'for-comment', text: 'FOR COMMENT', label: 'For comment', name: PdfAnnotationName.ForComment, color: BLUE },
  { id: 'completed', text: 'COMPLETED', label: 'Completed', name: PdfAnnotationName.Completed, color: GREEN },
  { id: 'void', text: 'VOID', label: 'Void', name: PdfAnnotationName.Void, color: RED },
];

/** Helvetica-Bold advance widths (thousandths of the font size) for capitals and space. */
const WIDTHS: Record<string, number> = {
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  ' ': 278,
};
const FONT_SIZE = 20;
const CAP_HEIGHT = 0.718 * FONT_SIZE;
const PAD = 16;
const HEIGHT = 40;
const LINE = 2.5;
const RADIUS = 7;

const num = (n: number) => String(Math.round(n * 100) / 100);

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = 0.5523 * r;
  const [x1, y1] = [x + w, y + h];
  return [
    `${num(x + r)} ${num(y)} m`,
    `${num(x1 - r)} ${num(y)} l`,
    `${num(x1 - r + k)} ${num(y)} ${num(x1)} ${num(y + r - k)} ${num(x1)} ${num(y + r)} c`,
    `${num(x1)} ${num(y1 - r)} l`,
    `${num(x1)} ${num(y1 - r + k)} ${num(x1 - r + k)} ${num(y1)} ${num(x1 - r)} ${num(y1)} c`,
    `${num(x + r)} ${num(y1)} l`,
    `${num(x + r - k)} ${num(y1)} ${num(x)} ${num(y1 - r + k)} ${num(x)} ${num(y1 - r)} c`,
    `${num(x)} ${num(y + r)} l`,
    `${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c`,
    'h',
  ].join('\n');
}

/** One page per stamp, each page exactly the stamp's size: a rounded frame around bold text. */
export function stampLibraryPdf(): ArrayBuffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add(''); // 1: catalog
  add(''); // 2: pages
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'); // 3
  const kids: number[] = [];
  for (const stamp of STAMPS) {
    const textWidth = ([...stamp.text].reduce((sum, c) => sum + (WIDTHS[c] ?? 722), 0) / 1000) * FONT_SIZE;
    const width = textWidth + 2 * PAD;
    const [r, g, b] = stamp.color.map(num);
    const inset = LINE / 2;
    const content = [
      'q',
      `${r} ${g} ${b} RG ${num(LINE)} w`,
      roundedRect(inset, inset, width - LINE, HEIGHT - LINE, RADIUS),
      'S',
      `BT /F1 ${FONT_SIZE} Tf ${r} ${g} ${b} rg ${num(PAD)} ${num((HEIGHT - CAP_HEIGHT) / 2)} Td (${stamp.text}) Tj ET`,
      'Q',
    ].join('\n');
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${HEIGHT}] ` +
          `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  // Everything above is ASCII, so string length equals byte length.
  let pdf = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf).buffer as ArrayBuffer;
}

/**
 * The library for one open document. EmbedPDF opens each library as its own document in the
 * shared engine, so every open PDF needs a library id of its own.
 */
export function stampLibrary(id: string): StampLibraryConfig {
  return {
    id,
    name: 'Stamps',
    readonly: true,
    pdf: stampLibraryPdf(),
    stamps: STAMPS.map((stamp, pageIndex) => ({
      id: stamp.id,
      pageIndex,
      name: stamp.name,
      subject: stamp.label,
      label: stamp.label,
    })),
  };
}
