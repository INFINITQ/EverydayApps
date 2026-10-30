# 0010. Folio Docs saves by patching the original file, part by part

- Status: accepted
- Date: 2026-10-29

## Context

The plan's rule is "patch, don't regenerate": keep the original file and, on save, rewrite only
what changed, carrying everything Folio doesn't understand over untouched. docx-editor.dev
(ADR 0009) keeps unknown XML well, but it writes a whole new package on every save. Every XML
part comes out reserialized: the XML declaration dropped, namespaces reordered,
`xml:space="preserve"` removed where it isn't needed, and `w14:paraId` added to paragraphs.
The content is the same, but the bytes are not.

## Decision

`apps/docs/src/patch.ts` builds each saved file from three inputs: the original package, the
engine's output for the document as it opened (the baseline, taken right after loading), and
the engine's output now.

- A part whose content the engine reproduced unchanged keeps its **original bytes**, compressed
  data included (`zip.ts` copies the entry as stored). "Unchanged" means the same canonical XML:
  namespace URIs instead of prefixes, sorted attributes, no layout whitespace, and none of
  `xml:space`, `w14:paraId`, `w14:textId`; the prefixes in `mc:Ignorable` compare as a set.
- A part the edits changed comes from the engine, with Word's XML declaration put back.
- A part the engine never writes is carried over as it was. Its relationships go back into
  the relationship files the engine rewrote, and its content type into `[Content_Types].xml`.
  A `.docm` keeps its macro content type.
- A part the engine wrote at the baseline but not now was removed by an edit (a deleted
  picture, say), so it goes.
- Before anything is written, the result is read back on its own and checked. Every part must
  unpack (CRC) and parse, every internal relationship must point at a part that exists, every
  part must have a content type, and every `r:id` in a changed part must have its
  relationship. Problems the original already had are tolerated. If a check fails, Folio
  saves the engine's own package instead (after the same check) and says so. If that fails
  too, nothing is written.
- After a save, the saved file becomes the new original, so the next save is patched against
  what's on disk.
- When the document opens, Folio compares the original with the baseline. Anything the
  engine dropped (content controls, fields, unknown elements...) is reported through the
  shell's `lossy()`, so the user is warned before saving and offered a copy.
- "Unsaved changes" uses the same outputs. After typing pauses, the engine's package is
  fingerprinted; returning to a fingerprint seen before (undo, or retyping the same text)
  returns its state id, so the tab reads "Saved" again.

Also in place for untrusted files (`zip.ts`, `ooxml.ts`): at most 10,000 entries, 1 GiB in
total and 512 MiB per entry, and entries over 16 MiB may not expand more than 200 times. Inflating
never allocates more than the declared size, and a CRC mismatch is refused. Parts that declare a
DTD or entities are refused before anything parses them (Word never writes them).
Password-protected files (OLE containers) get a clear message.

## Evidence

- `apps/docs/src/patch.test.ts` (16 tests): untouched parts byte for byte; carried-over unknown
  parts, macro project, relationships and content types; a removed picture; an added picture; a
  dangling `r:id` refused; damage the original already had tolerated; loss reporting; zip-bomb,
  lying-size and CRC cases.
- `apps/docs/src/roundtrip.test.ts`: the real engine, headless in jsdom. On the generated
  kitchen sink (`.docm`), the edit lands and every part except `word/document.xml` is byte for
  byte the original. Unknown element and attribute, tracked changes, unknown part, macro
  project and macro content type all survive. Saving without edits gives back every original
  entry. On 9 public Apache POI samples, the edit lands and every untouched part survives,
  with no engine losses reported.
- `apps/docs/test/ui.mjs` (Chromium, the whole app on the shell's in-memory backend): typing
  and Ctrl+S leave 19 of 19 other parts byte for byte the same; deleting the typed text returns
  the tab to "Saved".

## Consequences

- An edit anywhere in the body rewrites `word/document.xml` in the engine's style (no
  declaration differences once restored, but reordered namespaces, `w14:paraId`s). Word reads it
  fine. Patching inside a part (paragraph by paragraph) would need the engine to report which
  elements changed; not needed so far.
- The check after patching costs one extra parse of every XML part per save (milliseconds for
  typical documents).
- If a new engine version starts transforming a part's content on load, that part simply stops
  matching and comes from the engine, which is always consistent. If it drops content, the
  open-time loss check reports it.
