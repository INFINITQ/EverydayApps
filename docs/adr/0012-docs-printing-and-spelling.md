# 0012. Folio Docs prints its own pages; PDF goes through the print dialog; no spell check yet

- Status: accepted
- Date: 2026-10-29

## Context

Folio Docs needs printing and "Export to PDF", and spell checking was on the list "only if it
provably stays on the PC".

docx-editor.dev's own print and PDF export (`runChromePrint`, `runChromeExport`) need a
converter from document to PDF that the host supplies. Its own converter
(`@docx-editor.dev/docx-to-pdf`) runs on Node and is under EigenPal's commercial licence. The
editor's view also paints only the pages near the screen (14 page frames, 2 painted, for a
14-page document), so printing the window as it is would print blank pages.

## Decision

- **Printing** (`apps/docs/src/print.ts`): Folio takes the current layout from the engine's
  surface (`surface.layout()`) and paints every page into a print-only container with the
  engine's own painter (`paintSemanticLayout`), so the print matches the screen. Each distinct
  page size gets a named `@page` rule, so a landscape section prints landscape. Print CSS
  hides everything else, and the window prints. No frames are involved; the content policy
  allows none. Ctrl+P and the "…" menu print.
- **Export as PDF**: the same print path. Folio says to pick "Microsoft Print to PDF" (Windows'
  own printer) or "Save as PDF". The PDF is written by Windows on this PC, and Folio needs
  no PDF code and no new Rust command.
- **Spell check: not in this version.** WebView2's built-in checker can't help: it only marks
  native text fields, and the engine paints its own text. A provably local checker means
  bundling Hunspell-format dictionaries with a JavaScript or WASM checker (for example
  nspell), and painting the squiggles through the engine's highlight API. That is a clean
  follow-up, with no network involved. Until then, no document text is sent anywhere for
  checking.

## Evidence

- `apps/docs/test/ui.mjs`: a generated 14-page document paints all 14 pages for printing. Chromium's
  print-to-PDF of the window (`page.pdf` with print media) gives 14 Letter sheets, with text on
  the last.
- Before the fix for inline page offsets, each page printed with a blank sheet after it. The
  painter positions pages absolutely, so print CSS resets `top`/`left`.

## Consequences

- Printing uses the browser's print dialog (margins and headers from the dialog's own options
  are off by default in Chromium's "Save as PDF"). A direct "Save as PDF" button without the
  dialog would need WebView2's `PrintToPdf` through a new folio-core command; not worth it yet.
- Very long documents are painted in full before printing. That's a few hundred milliseconds
  at a few hundred pages.
