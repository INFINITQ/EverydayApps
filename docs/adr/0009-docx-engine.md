# 0009. Folio Docs runs on docx-editor.dev 2.x core, with Folio's own part-level patching

- Status: accepted
- Date: 2026-10-29

## Context

Phase 3 (Folio Docs) needs an engine that lays out and edits Word documents in the webview:
real pages, styles, lists, tables, pictures, sections, headers and footers. It must also keep
what it doesn't understand when it saves. The plan named two candidates for a one-hour test:
docx-editor.dev 2.x core (Apache-2.0) and SuperDoc 1.47 in its fully open AGPL build.
SuperDoc 2.x was ruled out beforehand (closed engine, telemetry on by default).

## Decision

- **docx-editor.dev 2.x**: `@docx-editor.dev/core`, `@docx-editor.dev/react` and
  `@docx-editor.dev/i18n`, all exact-pinned at **2.32.0**. 2.33.0 (two days old) is held back
  by the 3-day release-age rule. None of the Pro packages are used (`pro`, `editor-api`,
  `docx-to-pdf`, `telemetry`): they're under EigenPal's commercial licence, and `telemetry`
  is the only package that reports anything.
- Its own toolbar and menus are off (`chrome={false}`). Folio draws a Fluent toolbar and drives
  the engine through its command API.
- **Patch, don't regenerate** is Folio's job, not the engine's (see ADR 0010): the engine
  rewrites every XML part it saves, so Folio keeps the original bytes of every part the
  user's edits didn't touch.
- Comments and tracked changes: the free core draws tracked insertions and deletions in the
  text. Comment threads and accept/reject are Pro features, so Folio lists a file's comments
  in its own read-only panel, read straight from the package. Both are kept on save.

## Evidence

Method: both engines in Chromium 1243 (Playwright), each in a minimal Vite 8 build, fed the
same bytes; every request leaving `localhost` was logged and aborted. Samples: 24 public files
from Apache POI's `test-data/document` (Apache-2.0) and generated files from
`tools/fixtures/make-docx.mjs`. The generated "kitchen sink" has headings and a contents field,
lists, a table, an embedded and a web-linked picture, a link, a footnote, a comment, an
insertion and a deletion, a header, a footer with `PAGE`/`NUMPAGES`, a landscape second
section, plus unknown content: a part of an unknown type, a custom XML part, and an element
and an attribute from an unknown namespace. Its `.docm` twin carries a stand-in macro
project. LibreOffice (headless) rendered the reference.

| | docx-editor.dev core 2.32.0 | SuperDoc 1.47.2 (AGPL) |
|---|---|---|
| Opens the 24 public samples | 22, and cleanly refuses the XXE test file and the encrypted file | 22; hangs (30 s timeout) on the XXE test file and the encrypted file |
| Elements lost from `document.xml` on open + save, all samples | **0** | **1,859** (content controls, text boxes, comment and endnote references, field codes, table cell margins) |
| Text changed on open + save | none (only `'`/`"` re-escaped) | 5 files |
| Kitchen sink: unknown element, custom XML, unknown part | all kept | all kept |
| Kitchen sink: unknown attribute | kept | **lost** |
| `.docm`: macro project and macro content type | both kept | project kept, **content type lost** (the file stops being a .docm) |
| Untouched parts kept byte for byte | 2 of 19 (pictures; the XML is reserialized, XML declaration dropped) | 2 of 19 (also adds directory entries, `custom.xml`, `commentsExtended.xml`) |
| Layout of the kitchen sink | real pages; lists, table, fields ("Page 1 of 2"), landscape section, header and footer as in LibreOffice; linked picture shown as "External image not loaded" | real pages; **bullets and numbers missing** from both lists |
| Typing into a paragraph, then save | edit lands in `document.xml` | edit lands in `document.xml` |
| Network use | none observed. The code has no telemetry; only the font shaper's same-origin `harfbuzz.wasm` load, and the React adapter's `fetch` for a URL document (Folio passes bytes) | **telemetry on by default**: `POST https://ingest.superdoc.dev/v1/collect` on every document open (off with `telemetry: { enabled: false }`). The bundle also contains an AI "insights" endpoint and a cdnjs pdf.js worker URL. Depends on `y-websocket` |
| Production bundle (JS + CSS + WASM) | 4.9 MB (1.5 MB gzipped) | 5.9 MB (1.7 MB gzipped), and brings Vue, Pinia and Konva into a React app |
| Licence | Apache-2.0 (core, react, i18n) | AGPL-3.0 |

Text is measured with the browser's canvas, so on Windows the installed fonts (Calibri,
Cambria...) are used and nothing is downloaded. Missing fonts get metric-compatible
substitutes and a notice.

## Consequences

- The engine's free core has no comment threads or accept/reject. Showing and keeping both is
  covered; resolving them inside Folio would need our own work or the Pro licence.
- docx-editor.dev is young and moves fast (2.22 to 2.33 in about six weeks). Its 1.x line lived
  under `@eigenpal/*` and was briefly offline in June 2026 before 2.x appeared under the new
  scope. Pin exactly, upgrade on purpose, and keep the save path (patching, checks) in
  Folio's own code so that a change of engine stays possible.
- Revisit if the core drops behaviour into Pro, starts depending on `@docx-editor.dev/telemetry`,
  or if `tools/check-network.ps1` ever sees a connection from Folio Docs.
