# Architecture decision records

Short notes on decisions that aren't obvious from the code, especially the outcome of each
spike. One file per decision, numbered in order. Never rewrite an accepted record; add a new
one that supersedes it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-no-network-crates.md) | No network code in Rust; own single-instance instead of the plugin (S4) | accepted |
| [0002](0002-own-webview2-environment.md) | Folio creates its own WebView2 environment: local crash dumps, our flags (S2) | accepted |
| [0003](0003-fluent-under-csp.md) | Fluent UI under the content policy: inline styles only, scripts strict (S3) | accepted |
| [0004](0004-snap-layouts-overlay.md) | Snap Layouts via a native overlay on the HTML maximize button (S1) | accepted, hand check pending |
| [0005](0005-webview2-runtime-telemetry.md) | Network lock: a private WebView2 copy that Windows Firewall blocks | accepted |
| [0006](0006-page-operations-in-bundled-pdfium.md) | Page operations in the bundled PDFium (no DLL); split files via a create-only folder grant | accepted |
| [0007](0007-content-editing-in-bundled-pdfium.md) | Content editing in the bundled PDFium (no MuPDF), each edit checked by drawing the page | accepted |
| [0008](0008-passwords-links-and-attachments.md) | Passwords in memory only; author restrictions followed; links ask first; attachments never opened | accepted |
| [0009](0009-sheets-xlsx-bridge.md) | Folio Sheets: Univer for the grid; our own TypeScript bridge patches .xlsx files instead of regenerating them | accepted |
| [0010](0010-sheets-xls-reader.md) | Folio Sheets reads .xls (Excel 97-2003) with its own TypeScript BIFF8 reader | accepted |
| [0011](0011-sheets-charts.md) | Folio Sheets draws charts with ECharts as Univer drawings, and saves real Excel charts | accepted |

## Template

```markdown
# NNNN. Title

- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD

## Context
What problem or question forced a decision.

## Decision
What we chose, in one or two sentences.

## Evidence
What we tried and measured (pass/fail criteria from the plan, numbers, screenshots).

## Consequences
What this makes easier or harder, and what would make us revisit it.
```
