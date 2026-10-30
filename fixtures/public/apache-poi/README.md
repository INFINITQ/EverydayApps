# Public sample documents from Apache POI

Word documents from the Apache POI project's test data
(<https://github.com/apache/poi/tree/trunk/test-data/document>), used unchanged by Folio Docs'
round-trip tests. Apache POI is licensed under the Apache License 2.0.

| File | Why it's here |
|---|---|
| comment.docx | a comment |
| delins.docx | tracked insertions and deletions, fields |
| footnotes.docx, endnotes.docx | notes |
| Bug54849.docx | content controls, spelling marks |
| IllustrativeCases.docx | tables with cell margins |
| DiffFirstPageHeadFoot.docx | a different first-page header and footer |
| checkboxes.docx | legacy check boxes and content-control check boxes |
| TestTableCellAlign.docx | table cell alignment |
| ExternalEntityInText.docx | declares an external XML entity; must be refused |
| bug53475-password-is-pass.docx | password-protected (encrypted); must be refused with a clear message |
| Lists.doc, HeaderFooterUnicode.doc, footnote.doc, hyperlink.doc, table-merges.doc | old Word 97-2003 files: lists, headers and footers, a footnote, a link, merged cells |
| Word6.doc | an even older Word 6 file |
| PasswordProtected.doc | a password-protected Word 97-2003 file; must be refused with a clear message |
