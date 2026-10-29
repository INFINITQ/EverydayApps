# 0007. Editing page content in the bundled PDFium, checked by drawing the page

- Status: accepted
- Date: 2026-10-29

## Context

Phase 1d edits what's printed on a page: existing text, new text, pictures (add, move,
resize, delete), whiteout and true redaction. The plan started it with a spike: 50 text edits
across the fixture set must each leave the rest of the page unchanged, or be caught by a
before/after check. The fallback engine was MuPDF (AGPL).

## Decision

- Content edits work on page objects through the page-operations PDFium (ADR 0006), in
  `apps/pdf/src/content.ts`: `FPDFText_SetText`, `FPDFPageObj_CreateTextObj`,
  `FPDFPageObj_Transform`, image objects, rectangle paths, `FPDFPage_GenerateContent`.
  No MuPDF.
- Text keeps the document's own font when it can write the new characters (checked by
  reading the text back). Otherwise a standard PDF font of the same kind (sans, serif or
  mono; bold and italic kept) takes over. Characters neither can write are refused with a
  message, and the page stays as it was. Editing is per text object (a line or a run).
- Every edit is checked: the page is drawn from the saved bytes before and after (so the
  content stream PDFium rewrote is what's checked), and pixels that changed outside the
  edited areas are counted. More than a few means Folio warns and offers to undo.
- Redaction removes text character by character (`EPDFText_RedactInRect`, EmbedPDF's
  PDFium extension, including text inside form XObjects). It also blacks out the covered
  pixels of pictures in the pictures themselves, removes drawings that lie inside and
  annotations that touch the area, then draws a black box. Whiteout only covers.
- Pictures added as page content are stored at up to 200 dpi of their placed size.
- After a reload the view returns to its zoom and page while hidden. EmbedPDF drops a zoom
  asked for before the view has its size, so the session asks until it holds.

## Evidence

- `apps/pdf/src/content.test.ts`: 50 text edits across plain pages, a form page, a turned
  page and a page PDFium built (Times-Bold, Courier, colors, a turned line, a picture, a
  filled box). 46 changed only their text, with zero stray pixels; 2 needed the
  standard-font fallback (Symbol font, no Latin letters), also with zero stray pixels; 2
  (Greek, Japanese) were refused. A deliberately bad edit (a second line moved but not
  reported) is caught. Also covered: adding and removing text, moving, resizing and
  deleting pictures, whiteout keeping text, redaction removing it (PDF.js, which reads
  invisible text too, no longer finds it), and pictures partly blacked out.
- `e2e/pdf.spec.ts` "edits page content": retype a line, add text, whiteout, redact with the
  confirmation, add a picture, delete it, undo; PDF.js checks each saved file; no stray-
  change warnings, no outside requests, no content-policy violations.

## Consequences

- Real-world PDFs often embed fonts with only the letters they use, so new letters fall
  back to a standard font, which can look slightly different. Embedding a matching Windows
  font (CID) would need a font-bytes capability from Rust; revisit if the fallback shows.
- Text that's split into many small objects (common with some exporters) is edited piece
  by piece. Grouping objects into lines and paragraphs, as the plan describes, is still to
  come.
- Redaction doesn't reach pictures inside form XObjects, or text drawn as vector outlines.
  Both are rare in documents people redact, and the result can be checked with Find.
