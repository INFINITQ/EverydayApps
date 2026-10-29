# 0010. Old .ppt files through office_oxide compiled to an import-free WebAssembly module

- Status: accepted
- Date: 2026-10-29

## Context

Old binary PowerPoint files (`.ppt`, 97-2003) must open read-only, with "Save as" a
`.pptx`. The plan named `office_oxide` (Rust, MIT or Apache-2.0) for converting old
formats in memory. Format work should be TypeScript or WebAssembly, not new Tauri
commands in the shared core, and must be testable on Linux.

## Decision

- `office_oxide` **0.1.15** (exact pin, default features off) reads the `.ppt` and writes
  a `.pptx` through its document model (`Document::from_reader` → `to_ir` →
  `create_from_ir_to_writer`). It lives in `apps/slides/ppt-wasm`, a crate with its own
  Cargo workspace (it targets wasm32 only and never links into the Windows apps), built
  by `node apps/slides/ppt-wasm/build.mjs`. The resulting `ppt.wasm` (1.2 MB, 0.55 MB
  gzipped) is committed, so building the app doesn't need Rust for wasm.
- The module exports `alloc`, `convert`, `output_ptr`, `output_len` and imports nothing it
  can use: the `zip` crate pulls in getrandom's JavaScript backend on wasm32 (and
  getrandom 0.4.3 doesn't compile with any other backend while that feature is on), which
  leaves three wasm-bindgen type-description hooks as imports. Folio gives those inert
  stubs; nothing in the conversion calls them (the converter never needs random numbers,
  so the JavaScript that would provide them isn't even linked). A module asking for any
  other import is refused (`pptConvert.ts`).
- It runs in a worker, stopped after 60 s; its memory is capped at 1 GiB at link time,
  and files over 256 MB aren't converted.
- The converted deck opens read-only (`FileTypeInfo.canSave: false` for `ppt`); Save
  writes a `.pptx` through Save As, after which the deck can be edited
  (`DocumentSession.saved`, an additive shell hook).
- `calamine` (the fallback the plan named for `.xls`) isn't relevant to slides.

## Evidence

- `ppt.test.ts`: Apache POI's public `SampleShow.ppt` converts in about 20 ms to two slides
  with their titles, formatted body text (italic, colors) and speaker notes; a file that
  isn't a PowerPoint file is reported, not crashed on; a module importing anything else is
  refused; the shipped module's imports are only the three hooks.
- The UI flow (open `.ppt`, read-only notice, Save As `.pptx`, editing enabled) was run in
  Chromium through the harness page.

## Consequences

- Converted decks keep text, tables, pictures and notes, but not the original layout,
  theme or animations (the conversion goes through a document model, not slide geometry).
  The app says so when such a file opens.
- `cargo deny` doesn't cover this separate workspace; its dependency licenses are listed
  in the license report (office_oxide, zip, flate2/zlib-rs, quick-xml, encoding_rs, serde,
  and the unused wasm-bindgen/getrandom glue), and none of them can reach the network from
  a module without imports.
- If office_oxide gains a public `.ppt`-only entry point, the module could shrink by
  dropping the other formats' readers.
