# Generated test documents

Made from Folio's own fixtures, never from personal files.

| File | How it was made |
|---|---|
| kitchen.doc | `node tools/fixtures/make-docx.mjs kitchen.docx --no-remote`, then LibreOffice 24.2 `soffice --headless --convert-to doc kitchen.docx` (Word 97-2003 format), for Folio Docs' `.doc` tests |
