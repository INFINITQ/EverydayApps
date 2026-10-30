# 0009. Folio Sheets: Univer for the grid, our own TypeScript bridge that patches .xlsx files

- Status: accepted
- Date: 2026-10-29

## Context

Phase 2 needs .xlsx and .csv open, edit and save. The plan picked Univer (Apache-2.0) for the
grid, formulas, conditional formatting, validation, sort/filter, comments and pictures. Univer's
free edition can't import or export .xlsx (that's a paid server feature), so the bridge is ours.
The plan named umya-spreadsheet (Rust) for reading and writing, but the hard rule is "patch,
don't regenerate": keep the original package and rewrite only what changed, carrying pivot
tables, charts, drawings, `vbaProject.bin`, external links and custom XML byte for byte.

## Decision

- **The bridge is TypeScript, in `apps/sheets/src/xlsx/`**, on our own small zip, XML and OPC
  layers (`zip.ts`, `xml.ts`, `opc.ts`) with `fflate` for inflate/deflate. Reading builds
  Univer's workbook data and keeps a source model (each sheet's text, each row's and cell's
  original XML). Saving (`write.ts`) compares two Univer snapshots, the workbook as opened and
  as it is now, and patches:
  - nothing changed: the original bytes, as they were;
  - parts nobody touched keep their compressed bytes (the zip entry is copied, not re-deflated);
  - in a changed sheet, unchanged rows keep their XML; a changed cell is written from its
    original `<c>` (unknown attributes and extensions stay while its content does); only the
    elements that changed (`sheetData`, `cols`, `mergeCells`, the pane, `tabColor`) are replaced,
    in schema order when they're new;
  - new cell formats are appended to `styles.xml`, derived from the cell's previous format
    (theme colors, font schemes, protection and cell styles carry over); new text is appended to
    `sharedStrings.xml`; existing records never move;
  - shared formula groups stay as written unless an edit breaks one, which is then written out
    cell by cell; Excel's `_xlfn.` prefixes are removed for Univer and added back on save;
  - when formulas or their results change, `calcChain.xml` is dropped and `fullCalcOnLoad` set,
    so Excel recalculates on open (Univer's results are written as the cached values);
  - added, renamed, moved and deleted sheets update `workbook.xml` (sheet-local defined names
    follow their sheet), references to renamed sheets in defined names, charts and pivot
    caches, and parts only a deleted sheet used are removed (an unreachable-part sweep).
- **Why not umya-spreadsheet or another Rust crate:** they load a workbook into their own model
  and write a new package, which loses what they don't model and breaks byte identity; the app
  crates are Windows-only (can't be tested here) and Folio prefers TypeScript/WASM over new
  Tauri commands. The TypeScript bridge is unit-tested in Node against generated workbooks.
- **Univer setup** (`engine.ts`): one instance per open workbook; its ribbon is off (Folio's
  Fluent toolbar runs Univer's commands instead), its formula bar, sheet tabs, context menus and
  side panels stay. Cached results from the file are shown as they are
  (`CalculationMode.WHEN_EMPTY`). "Unsaved" follows Univer's undo steps: each step gets an id,
  re-numbered when an edit lands on it, so undoing back to the saved step clears the marker.
- **Airgapped:** the built bundle was scanned: no network calls of Univer's own except its
  picture loader (`URLImageService.downloadImage`, which `fetch`es picture addresses) and Vite's
  preload of the app's own chunks. The formula engine's `IMAGE()` is removed; `WEBSERVICE`,
  `RTD` and `CALL` aren't implemented by Univer. `@univerjs/telemetry` is only an interface (no
  implementation is registered). `@univerjs/protocol` lists the gRPC client `@grpc/grpc-js`
  (and `protobufjs`, which has an install script) but imports nothing in the browser; a scoped
  pnpm override removes them, so `allowBuilds` stays empty.

## Evidence

- `apps/sheets/src/xlsx/xlsx.test.ts`: round-trips on workbooks from
  `tools/fixtures/make-xlsx.mjs` (values of every type, shared and array formulas, an
  `_xlfn.XLOOKUP`, formats with theme colors and tints, merges, widths, heights, a frozen
  pane, a hidden row, comments, validation, conditional formatting, a filter, a hyperlink, a
  chart, a picture, a pivot table, an external link, custom XML, macros). SheetJS (dev only)
  re-reads every result; tests check which parts changed and that the rest are byte-identical.
- The same saved files open in openpyxl and LibreOffice (checked by hand here).
- Browser harness (`apps/sheets/harness`, app CSP as a meta tag, shell fake backend): the
  sample opens with no console errors, no content-policy violations and no outside requests;
  typing 999 into B3 and pressing Ctrl+S changes exactly two rows of one sheet (B3, its
  shared-formula dependant and a SUM), keeps the shared formula as written, and leaves every
  other part byte-identical.
- Bundle: 7.4 MB of JavaScript (2 MB gzipped, about 2.1 MB xz-compressed for the whole
  `dist`), well inside the 15 MB installer budget.

## Consequences

- A changed rich-text cell is saved as plain text (unchanged ones keep their runs).
- Inserting or deleting rows moves cells; moved cells are rewritten from Univer's data, so
  attributes Folio doesn't know (dynamic-array metadata, phonetic hints) are dropped for them.
  Tables, pivot tables and chart ranges aren't moved with them yet: Folio warns first (to do).
- `docProps/app.xml` (sheet names for Explorer's details pane) isn't updated when sheets change;
  Excel ignores it on open.
- Revisit if Univer's free edition gains .xlsx support that patches, or if very large
  workbooks make the snapshot comparison slow (it's linear in the number of cells).
