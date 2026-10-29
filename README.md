# Folio

Private, offline apps for PDF, Word, Excel and PowerPoint files on Windows 11.

| App | Opens | Status |
|---|---|---|
| Folio PDF | `.pdf` | ready |
| Folio Sheets | `.xlsx`, `.csv` (old `.xls` read-only) | planned |
| Folio Docs | `.docx` (old `.doc` read-only) | planned |
| Folio Slides | `.pptx`, `.pptm` (old `.ppt` read-only) | ready for testing on Windows |

Every app is a small native Windows program (Tauri 2 + WebView2) with a Windows 11 look
(Fluent UI, Mica, your accent color). Documents never leave your PC.

## Folio PDF

- **Read:** continuous pages, one or two pages side by side, thumbnails, bookmarks, attached
  files, find, zoom, rotate, dark and sepia reading modes, full screen (F11), print, document
  properties (Ctrl+D). Password-protected files ask for their password.
- **Annotate and sign:** highlight, underline, pen, shapes, text boxes, sticky notes with a
  comments panel, stamps, pictures; fill in forms; drawn, typed or picture signatures, kept
  encrypted for reuse; save a flattened copy.
- **Organize pages:** reorder by dragging, rotate, delete, duplicate, insert blank pages,
  other PDFs or pictures, extract, split.
- **Edit content:** retype existing text, add text, move and delete pictures, whiteout, and
  true redaction (the content is removed, not covered).
- **Passwords:** protect a file, change or remove its password. Pages you extract or split
  from a protected file keep its password. When a PDF's author restricts editing or printing,
  Folio follows those limits.

Measured on a 100-page PDF: the installer is 3.4 MB; the window paints in about 0.5 s and the
first page shows in under 0.9 s; memory is about 225 MB with the file open (Task Manager's
measure, WebView2 included). Reading all 100 pages raises it to about 430 MB, mostly
WebView2's caches, and minimizing the window asks WebView2 to give memory back.

## Folio Slides

- **Read and present:** faithful slides (charts, SmartArt, tables, embedded fonts) with
  thumbnails and speaker notes. Slideshow in full screen (F5 from the start, Shift+F5 from
  the current slide): arrows, Page Down, Space or a click go on, B or W blank the screen,
  a slide number and Enter jumps, Esc ends. Hidden slides are skipped. Presenter view
  (Alt+F5) shows the current and next slide, your notes and a timer.
- **Edit in place:** click a shape to select it, drag to move, drag a handle to resize,
  double-click to edit its text where it is (formatting is kept), Delete removes it. Replace
  or insert pictures. Edit speaker notes under the slide.
- **Organize:** drag thumbnails to reorder (several at once), duplicate (Ctrl+D), delete,
  hide from the slideshow. Undo and redo everything.
- **Your file stays yours:** saving rewrites only the parts you changed. Animations,
  transitions, SmartArt, media, comments and anything Folio doesn't edit are kept exactly
  as they were. Macros in `.pptm` files never run, and are kept. Pictures and media a deck
  links to on the web are never loaded. Old `.ppt` files open read-only, converted in
  memory; Save As makes a `.pptx`.
- **Print and PDF:** print one slide per page; choose "Microsoft Print to PDF" to make a PDF.

## Privacy

Folio is built so that it *can't* send your documents anywhere:

- No network code: `cargo-deny` bans HTTP/TLS/WebSocket crates and Clippy bans `std::net`.
- The UI runs under a strict content policy that only allows the app itself and its IPC.
  Navigation, pop-ups and downloads are blocked in Rust.
- WebView2 is started with InPrivate mode, a dead-end proxy, no SmartScreen or autofill, no
  browser shortcuts, and crash dumps kept on your PC.
- **Network lock:** WebView2's own browser process talks to Microsoft outside anything an app
  controls, so Folio runs on a private copy of WebView2 that Windows Firewall blocks. Set it
  up once with `tools\network-lock.ps1 -Install` in PowerShell opened as administrator
  (hard links: no extra disk space). Folio warns you when the lock is off.
  See [ADR 0005](docs/adr/0005-webview2-runtime-telemetry.md).
- The UI can only touch files you picked, dropped or opened from Explorer. When a PDF is
  split, you pick a folder, and Folio can only create new files there (never read or
  overwrite anything in it).
- Documents are treated as untrusted. A link in a document opens only after you say so, and
  only web and email links (in your browser or mail app); links that try to start a program
  or run a script are refused. Attached files are never opened, only saved where you pick.
- No analytics, crash reporting or auto-update. Engines are bundled, never loaded from a CDN.
- `tools/check-network.ps1` proves it: it runs the built app on test files and fails on any
  network connection or DNS lookup from the app or its WebView2 processes.

## Development

Requirements: Windows 11, Rust (stable, tested on 1.99.1) with the MSVC build tools,
Node 24+, pnpm 11.

```powershell
pnpm install          # dependency install scripts are blocked unless reviewed
pnpm dev:pdf          # run Folio PDF in development mode
pnpm build:pdf        # build the release installer
pnpm dev:slides       # run Folio Slides in development mode
pnpm build:slides     # build its installer
pnpm test             # unit tests (Vitest)
pnpm e2e              # end-to-end tests (Playwright, uses your installed Edge)
cargo test --workspace
cargo deny check      # dependency, license and network-crate policy
pnpm licenses:report  # writes docs/licenses.md: every shipped package and its license
```

The end-to-end tests drive the debug build with its window hidden, and give each launch a data
folder of its own (`FOLIO_TEST_DATA_DIR`, debug builds only). Tests never touch the installed
app's settings, recent files, backups or signatures, and never hand files to a copy you have
open.

## Repo layout

```
apps/        one folder per app (React UI in src/, Tauri crate in src-tauri/)
packages/    ui (Fluent theme + window chrome) and shell (tabs, documents, save flows)
crates/      folio-core: the shared Rust core every app runs on
config/      security.json, the one master copy of the security settings
docs/adr/    architecture decision records (spike outcomes)
fixtures/    generated test documents (fixtures/real/ is git-ignored)
tools/       dev-only scripts: network audit, license report, fixture generator
```

See [docs/adr](docs/adr/README.md) for the reasoning behind non-obvious decisions.
