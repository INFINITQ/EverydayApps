# 0008. Passwords, author restrictions, links and attachments

- Status: accepted
- Date: 2026-10-29

## Context

Finishing Folio PDF meant opening password-protected files, setting and removing passwords,
following links, and showing a document's bookmarks and attached files. Each touches what a
document is allowed to make Folio do, and documents come from anywhere.

## Decision

- **Passwords** live only in memory, in the open document's session (each undo step keeps
  the password its bytes open with, so undo and redo never ask again). They never reach
  settings, recent files or recovery snapshots; a recovered protected file asks again.
  Protecting a file sets the same user and owner password with everything allowed (AES-256,
  through EmbedPDF's PDFium extension). Changing a password removes the old one first, then
  sets the new one: removal and setting on a plain file work whatever encryption the file came
  with. Saving keeps a file's encryption (PDFium re-encrypts on save).
- **Pages taken out** of a protected file (extract, split) keep its password, so protected
  content never lands unprotected in a new file without the user doing it on purpose.
- **Author restrictions** (an owner password limiting printing, editing, annotating or page
  changes) are followed, as Adobe Reader and Chrome do. EmbedPDF enforces them for its own
  tools; Folio's page and content tools ask the same flags, and the toolbar says why a button
  is off. Removing or changing the password needs the owner's rights.
- **Links** open only after the user agrees, in a dialog that shows where they go. Only
  `http`, `https` and `mailto` are offered (checked in the UI and again in Rust, which opens
  them with `ShellExecuteW`). `javascript:`, `file:` and other schemes are shown, never
  opened; Launch actions (start a program) are refused with a message. Bookmarks that are
  web links go through the same dialog.
- **Attached files** are listed with their size and description and can be saved where the
  user picks; Folio never opens them. Their names are reduced to a plain file name, and saved
  attachments stay out of recent files.

## Evidence

- Unit tests (`pages.test.ts`): protection survives page changes, PDF.js refuses the file
  without its password, extracted pages keep it, changing replaces it, restrictions read back.
- End to end (`pdf.spec.ts`): wrong then right password; a page change and save keep the
  protection; change, undo (old password, no prompt), redo, remove, protect again, each checked
  with PDF.js; a restricted file turns the editing tools off. Web link opened only after
  agreeing (logged instead of opened in tests); `javascript:` link shown but not offered;
  Launch link refused; bookmark link asks first; attachment saved byte for byte.

## Consequences

- Folio can't open a restricted file's tools without its owner password; "unlock with the
  owner password" could be added later.
- A forgotten password can't be recovered: the dialog says so.
- Saving right after a page change waits for the reloaded document instead of failing.
