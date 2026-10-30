# 0011. Folio Sheets draws charts with ECharts as Univer drawings, and saves real Excel charts

- Status: accepted
- Date: 2026-10-29

## Context

Univer's free edition has no charts. Phase 2b asks to draw a workbook's charts, insert and edit
bar, column, line, area, pie, doughnut and scatter charts, and save them as real Excel charts,
while keeping charts Folio can't edit untouched.

## Decision

- **Model** (`apps/sheets/src/charts/model.ts`): a chart part (`c:chartSpace`) is read into a
  small model: type, grouping, title, legend and series with their references and cached
  values. ECharts options are built from the model, with values read live from the workbook
  (the cache is the fallback when a reference can't be followed).
- **Display:** each chart is a Univer "DOM drawing" (type 8) whose `data` holds its model; Univer
  places it over the grid (scrolling, zoom, moving, resizing, deleting, undo) and Folio's
  registered `FolioChart` component draws it with ECharts (tree-shaken: bar, line, pie and
  scatter charts, the SVG renderer) and redraws when values change. Charts of other kinds are
  kept and shown as "kept as it is".
- **Saving** (through the drawing patcher of ADR 0009): a file's chart part is never rewritten
  unless its type was changed in Folio; a moved chart gets a new anchor around its original
  `graphicFrame`, a deleted one loses its anchor. A chart inserted in Folio (from the selected
  cells: text in the first row names the series, text in the first column labels categories)
  becomes a new chart part, relationship and anchor, with cached values so other apps show it
  without recalculating.
- ECharts 6.1 (Apache-2.0) has no network code of its own; the bundle audit still finds only
  same-origin loads (see ADR 0009).

## Evidence

- Unit tests read the sample's column chart (references, caches, title, legend, anchor), keep it
  byte for byte when another chart is added, and write an inserted line chart with the right
  references and cached values.
- In the browser harness the sample's chart is drawn at its anchor from the live cells; inserting
  a column chart from A1:B5 marks the tab unsaved, and saving produces `xl/charts/chart2.xml`
  with its drawing and relationships.
- Bundle: +0.8 MB of JavaScript (8.3 MB total, 2.3 MB gzipped).

## Consequences

- Chart formatting beyond type, title, legend and series colors (axis formats, data labels,
  trendlines, 3D) isn't shown; it's kept as long as the chart's type isn't changed in Folio.
- Combo charts show their first chart group only. Editing titles and series from a panel is
  left for later (insert, delete, move, resize and change type work).
