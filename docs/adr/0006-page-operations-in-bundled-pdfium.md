# 0006. Page operations run in the bundled PDFium; split files go to a folder grant

- Status: accepted
- Date: 2026-10-29

## Context

Phase 1c (organize pages) needs reorder, rotate, delete, duplicate, insert (blank pages,
other PDFs, pictures), extract, merge and split. EmbedPDF 2.15's engine API covers extract,
import, delete and merge, but not reorder, rotation or new pages. The plan's fallback was
pdfium-render in Rust plus a separate PDFium DLL, after a spike to see whether EmbedPDF's
own PDFium build exposes the calls.

Split also produces several files at once, while file grants cover one picked file each.

## Decision

- No PDFium DLL. `apps/pdf/src/pages.ts` runs page operations on a document's bytes with a
  second instance of the `pdfium.wasm` already bundled for the viewer, started on first use
  (`pageTools()` in `engine.ts`, which loads the wasm from the app itself). The session
  exports the document (with every annotation), applies the change, and reloads the result
  as a new EmbedPDF registry ("generation"), keeping the place and the mode.
- Undo across page changes: each page change keeps the bytes from before and after (up to
  400 MB in total, oldest let go first). Annotation edits made after a page change undo one
  by one as before; once a page change is undone, earlier annotation edits stay as part of
  the document it restored.
- Pictures become pages in `pictures.ts`: JPEGs are embedded as they are (DCTDecode),
  other formats are decoded by the browser and stored losslessly (FlateDecode, with an
  alpha mask when needed).
- Split saves through a folder grant (`crates/folio-core/src/folders.rs`): the user picks a
  folder; its token can only create new files directly in it. It can't read, list or
  overwrite; a taken name gets " (2)", " (3)"... Names are checked against path separators,
  reserved characters and Windows device names.

## Evidence

- The bundled build exports `FPDF_MovePages`, `FPDFPage_SetRotation`, `FPDFPage_New`,
  `FPDF_ImportPagesByIndex`, `FPDFPage_Delete`, image-object calls and EmbedPDF's
  `PDFiumExt_SaveAsCopy` file writer.
- `apps/pdf/src/pages.test.ts`: 14 tests against the real wasm in Node, with PDF.js reading
  every result (moves, rotation incl. shown size, delete guard, blank pages, copying between
  documents, extraction, form fields surviving moves, pictures with and without alpha,
  JPEG pass-through, range parsing).
- `crates/folio-core/src/folders.rs` tests: new files only, existing files untouched,
  names that try to leave the folder refused.
- `e2e/pdf.spec.ts` "organizes pages": rotate, drag to reorder, delete, insert a blank page
  and pages from a picture and another PDF, undo and redo, extract, split every 3 pages and
  back to reading, all in the real app, with PDF.js checking each saved file; no outside
  requests, no content-policy violations. The network audit still passes.

## Consequences

- Nothing native to ship or checksum for page work, and the operations are unit-testable
  without the app. Page work runs on the main thread; very large documents may pause the
  UI briefly. Moving `PageTools` into a worker is the fix if that shows up.
- Copying pages into another document carries their annotations and form widgets, but
  PDFium doesn't merge the AcroForm field tree, so fields in pages taken from another PDF
  may stop being fillable there. Revisit with EmbedPDF v3 or a field-merge step.
- Password-protected PDFs can't be inserted yet (they're refused with a clear message);
  this comes with password support in 1a.
