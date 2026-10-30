# 0010. Folio Sheets reads .xls (Excel 97-2003) with its own TypeScript BIFF8 reader

- Status: accepted
- Date: 2026-10-29

## Context

Old `.xls` workbooks must open read-only with "Save as .xlsx". The plan named `office_oxide`
(Rust, MIT/Apache) for converting them in memory, with `calamine` as a fallback. Both exist on
crates.io (`office_oxide` 0.1.15, a young crate; `calamine` 0.37, mature and widely used).
Either would have to be compiled to WebAssembly (the app crates are Windows-only and Folio
prefers TypeScript or WASM over new Tauri commands), which adds a Rust `wasm32` build step and
a binary to every app build, plus a JS glue layer.

## Decision

A TypeScript reader in `apps/sheets/src/xls/`: `cfb.ts` reads the compound-file container (every
sector chain checked for loops and bounds, size limits), `biff.ts` reads the BIFF8 records into
Univer's workbook data, and `functions.ts` is the BIFF function table. It reads values, shared
strings (including strings split across CONTINUE records), formulas (decompiled from their
tokens: operators, references, 3D references, areas, names, functions, shared and array
formulas), cell formats (fonts, colors from the palette, fills, borders, alignment, wrap,
rotation, number formats), merged cells, column widths, row heights, hidden rows and columns,
frozen panes and 1904 dates. A formula with a token it doesn't know keeps its last value, and
the app says how many. Encrypted and pre-97 (BIFF5) workbooks are refused with a message.

The `.xls` file type has `canSave: false`, so the shell's Save becomes "Save as" `.xlsx`; the new
workbook is written by patching a blank package (the same writer as `.xlsx`, ADR 0009).

## Evidence

`apps/sheets/src/xls/xls.test.ts`, on `fixtures/sheets/sample.xls` (made by LibreOffice from the
generated sample workbook): every value and formula matches what SheetJS reads (35+ cells,
three sheets), formats, merges, sizes and hidden rows come through, and the saved `.xlsx`
re-reads with its formulas, merges and number formats. In the browser harness, opening the
`.xls`, editing a cell and pressing Ctrl+S goes to Save As and writes a workbook openpyxl reads.

## Consequences

- Nothing extra to build or ship (a few KB of TypeScript instead of a WASM module).
- Not carried over from `.xls` yet: comments, pictures, charts, hyperlinks, conditional
  formatting, data validation, macros (VBA can't move to `.xlsx` anyway), and add-in functions
  (Analysis ToolPak names through `PtgNameX`), which keep their last values.
- If real-world `.xls` files show gaps, `calamine` compiled to WASM remains the fallback.
