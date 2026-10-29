# 0009. Folio Slides: pptx-renderer on Folio's own package layer, saving by patching

- Status: accepted
- Date: 2026-10-29

## Context

Phase 4 is Folio Slides: faithful slides, a slideshow and presenter view, editing text
and pictures, and organizing slides, for `.pptx` (and `.pptm`). The plan named two
engines: pptx-renderer (HTML/SVG slides, charts through ECharts, SmartArt; Apache-2.0)
and pptxtojson (a slide model with speaker notes; MIT). Saving must follow "patch, don't
regenerate": keep the original package and rewrite only what changed, so animations,
transitions, SmartArt, media, macros and anything Folio doesn't understand survive.

## Decision

- **Renderer: `@aiden0z/pptx-renderer` 1.4.0** (Apache-2.0), exact-pinned. It brings
  ECharts 6.1.0 (Apache-2.0, only the bar/line/pie/radar/scatter/candlestick charts and
  the canvas renderer), JSZip 3.10.2 (MIT or GPL-3.0) and mtx-decompressor 1.8.0
  (MPL-2.0, for embedded EOT fonts). It is used headless (`buildPresentation`,
  `renderSlide`); Folio draws thumbnails, the editor, the slideshow and the presenter view
  around it.
- **Folio reads and writes the package itself** (`apps/slides/src/zip.ts`, `pkg.ts`) and
  hands the renderer the parts it needs (`render.ts`, the same layout the renderer's own
  unzip produces). So a file is unzipped once, edits redraw without re-zipping, and only
  the slides whose parts changed redraw.
- **Saving patches the original:** every part is either the very object read from the
  file or new contents from an edit. Untouched parts are copied byte for byte, local
  header, compressed data and central directory record included; only changed or new
  parts are compressed again (with the platform's `CompressionStream`). Edits rewrite
  the smallest set of parts: hiding a slide rewrites that slide's XML; reordering rewrites
  `presentation.xml`; editing text rewrites only the runs whose text changed.
- **pptxtojson is not used.** Its model would be a second parse of every file (a second
  unzip and XML pass) and ~430 KB more, only for speaker notes, which Folio reads from the
  notes slides directly (`deck.ts`).
- **Safety for untrusted files:** at most 10,000 parts; declared sizes are checked before
  anything is inflated (1 GiB per part, 2 GiB in all); inflating stops as soon as a part
  produces more than it declared, and its CRC must match; any XML part with a DTD makes
  the file refuse to open (Office never writes DTDs, so no entity expansion can happen in
  Folio's parser or the renderer's). Encrypted (OLE) files get a clear message.
- **Airgapped:** the renderer is audited (no `fetch`, XHR, WebSocket, beacon, CDN or
  telemetry code in it or its dependencies; ECharts' one `fetch` is a local function).
  External pictures and media are never loaded (`externalMedia: 'block'`), and the
  PDF.js fallback for EMF previews is off (`pdfjs: false`), so no worker is fetched.
  Embedded fonts load from bytes (`FontFace`), pictures from `blob:` URLs, both allowed
  by the content policy. Links ask first and go through `DocHost.openLink`.
- **Edits that could break what Folio doesn't edit** are handled, not just warned about:
  deleting a shape also deletes the animations that target it (and the timeline if it
  empties), so PowerPoint never finds an animation pointing at nothing; deleting a slide
  removes links to it from other slides and its entries in sections and custom shows;
  duplicating a slide copies the parts it owns (notes, charts and their workbooks, SmartArt
  data, tags, embedded objects) and gives the copy its own creation id, while layouts,
  pictures and media stay shared. Parts that become unreachable after an edit are removed;
  parts that were unreachable to begin with are left alone. Saving a `.pptm` keeps its
  macros (never run); saving it as `.pptx` would remove them, as PowerPoint requires.

## Evidence

- Real PowerPoint files (Apache POI's public test decks: notes, SmartArt, a chart with
  its embedded workbook) save back byte-identical when unchanged; hiding a slide changes
  exactly one part; editing notes changes exactly the notes part; duplicating and
  deleting slides gives files that JSZip and the renderer's own parser read back
  (`samples.test.ts`). Generated decks cover reorder, delete, duplicate, sections, macros,
  text edits keeping formatting run by run, pictures and animations (`*.test.ts`, 50+
  tests).
- Rendering was checked in Chromium on the samples: charts, SmartArt (from its drawing
  part), tables, gradients and fonts match PowerPoint closely. A SmartArt shape with a
  picture fill draws black; the renderer's own pipeline does the same, so it's the
  renderer's limit, not Folio's adapter.
- Bundle: the start screen's chunk is 536 KB; the deck chunk (renderer, ECharts, editor)
  is 1.56 MB and loads with the first file. All assets: 3.2 MB, 1.1 MB gzipped.

## Consequences

- Rendering fidelity is the renderer's: animations and transitions don't play in the
  slideshow (they are kept in the file), EMF/WMF vector pictures don't draw unless they
  carry a bitmap preview, and slide notes are Folio's own.
- Text editing is plain text per paragraph (formatting kept where the text didn't
  change; new text takes the formatting before it). Rich formatting tools would be a
  separate feature.
- A renderer bump means re-checking the audit above and the adapter's file layout
  (`render.ts` mirrors the renderer's unzip rules).
