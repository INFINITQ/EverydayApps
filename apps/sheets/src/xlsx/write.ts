// Univer -> .xlsx, by patching the original package (patch, don't regenerate).
//
// The writer compares two Univer snapshots: `baseline` (the workbook as opened, or as last
// saved) and `current`. Nothing changed: the original bytes come back as they are. Otherwise
// only what changed is rewritten:
// - a sheet nobody touched keeps its part byte for byte (zip compression included);
// - in a changed sheet, unchanged rows keep their XML, changed cells are written from their
//   original XML (attributes Folio doesn't know survive), and only the elements that changed
//   (sheet data, column widths, merged cells, frozen panes, tab color) are replaced;
// - new cell formats and strings are appended to styles.xml and sharedStrings.xml;
// - everything else (pivot tables, charts, drawings, macros, external links, custom XML...)
//   is copied as it is.

import { BooleanNumber, CellValueType, type ICellData, type IStyleData, type IWorkbookData, type IWorksheetData } from '@univerjs/core';
import { type DrawingData, type ThreadComment, writeComments, writePictures } from './annotations';
import type { Resolve } from '../charts/model';
import { type AutoFilter, type CfRule, type DvRule, RESOURCE, autoFilterXml, conditionalFormattingXml, dataValidationsXml } from './features';
import { formulaToFile, shiftFormula } from './formula';
import { CONTENT, Package, REL } from './opc';
import { type SourceBook, type SourceCell, type SourceSheet, attrOf } from './read';
import { type Range, cellName, parseRange, quoteSheet, rangeName } from './refs';
import { StyleSheet } from './styles';
import { type XmlElement, attrsText, encodeOfficeText, escapeAttr, escapeText, parseXml, patchText } from './xml';

/** Error values Excel stores as errors (t="e"); other "#..." text is just text. */
const EXCEL_ERRORS = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CALC!', '#FIELD!', '#BLOCKED!', '#UNKNOWN!', '#CONNECT!', '#BUSY!']);

/** Worksheet elements in the order the schema requires. */
const SHEET_ORDER = [
  'sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetCalcPr', 'sheetProtection', 'protectedRanges',
  'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr', 'conditionalFormatting',
  'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
  'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'drawingHF',
  'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst',
];

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

type Edit = { start: number; end: number; text: string };

/** What Univer's snapshot of a sheet holds that ends up in the file. */
function sheetContent(sheet: Partial<IWorksheetData> | undefined, styles: IWorkbookData['styles']) {
  if (!sheet) return null;
  return {
    name: sheet.name,
    tabColor: sheet.tabColor || '',
    hidden: sheet.hidden ? 1 : 0,
    freeze: freezeOf(sheet),
    merges: [...(sheet.mergeData ?? [])].map((m) => rangeName(m)).sort(),
    cells: cellsContent(sheet.cellData, styles),
    rows: rowsContent(sheet.rowData),
    columns: columnsContent(sheet.columnData),
    gridlines: sheet.showGridlines === BooleanNumber.FALSE ? 0 : 1,
  };
}

function cellsContent(cells: IWorksheetData['cellData'] | undefined, styles: IWorkbookData['styles']) {
  const out: Record<string, unknown> = {};
  for (const [r, row] of Object.entries(cells ?? {})) {
    for (const [c, cell] of Object.entries(row ?? {})) {
      const key = cellKey(cell as ICellData, styles);
      if (key) out[`${r},${c}`] = key;
    }
  }
  return out;
}

const truthy = (v: unknown) => v === true || v === 1 || v === '1' || (typeof v === 'string' && v.toUpperCase() === 'TRUE');

/** A cell's content in a comparable form (style resolved to its properties). */
export function cellKey(cell: ICellData | null | undefined, styles: IWorkbookData['styles']): string {
  if (!cell) return '';
  const style = styleOf(cell.s, styles);
  const parts: unknown[] = [
    cell.v === undefined || cell.v === null ? null : cell.t === CellValueType.BOOLEAN ? (truthy(cell.v) ? 1 : 0) : cell.t === CellValueType.NUMBER ? Number(cell.v) : cell.v,
    cell.f ?? null,
    cell.si ?? null,
    cell.p ? JSON.stringify(cell.p.body) : null,
    style && Object.keys(style).length ? stableJson(style) : null,
    cell.ref ?? null,
  ];
  return parts.every((p) => p === null) ? '' : JSON.stringify(parts);
}

function styleOf(s: ICellData['s'], styles: IWorkbookData['styles']): IStyleData | undefined {
  if (!s) return undefined;
  return typeof s === 'string' ? (styles[s] ?? undefined) : s;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

function rowsContent(rows: IWorksheetData['rowData'] | undefined) {
  const out: Record<string, string> = {};
  for (const [r, row] of Object.entries(rows ?? {})) {
    const key = rowKey(row);
    if (key) out[r] = key;
  }
  return out;
}

const rowKey = (row: Partial<{ h: number; hd: number; ia: number }> | undefined) =>
  row ? `${row.h ?? ''}|${row.hd ? 1 : 0}|${row.ia === BooleanNumber.FALSE ? 'custom' : ''}` : '';

function columnsContent(columns: IWorksheetData['columnData'] | undefined) {
  const out: Record<string, string> = {};
  for (const [c, column] of Object.entries(columns ?? {})) {
    if (column && (column.w !== undefined || column.hd)) out[c] = `${column.w ?? ''}|${column.hd ? 1 : 0}`;
  }
  return out;
}

function freezeOf(sheet: Partial<IWorksheetData>) {
  const f = sheet.freeze;
  if (!f) return '';
  const rows = f.startRow > 0 ? f.ySplit : 0;
  const columns = f.startColumn > 0 ? f.xSplit : 0;
  return rows || columns ? `${rows},${columns},${f.startRow},${f.startColumn}` : '';
}

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** A plugin's data for every sheet (Univer keeps it as JSON in the snapshot's resources). */
function resource<T>(data: IWorkbookData, name: string): Record<string, T> {
  const found = data.resources?.find((r) => r.name === name)?.data;
  if (!found) return {};
  try {
    const parsed = JSON.parse(found) as Record<string, T> | null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** A sheet's conditional formatting, validation and filter. */
type SheetFeatures = { cf: CfRule[]; dv: DvRule[]; filter: AutoFilter | null; comments: ThreadComment[]; drawings: DrawingData | null };

function featuresOf(data: IWorkbookData, id: string): SheetFeatures {
  return {
    cf: resource<CfRule[]>(data, RESOURCE.cf)[id] ?? [],
    dv: resource<DvRule[]>(data, RESOURCE.dv)[id] ?? [],
    filter: resource<AutoFilter>(data, RESOURCE.filter)[id] ?? null,
    comments: resource<ThreadComment[]>(data, RESOURCE.comments)[id] ?? [],
    drawings: resource<DrawingData>(data, RESOURCE.drawings)[id] ?? null,
  };
}

/** Rows a filter hides are written as hidden rows, like Excel does. */
function withFilteredRows(sheet: Partial<IWorksheetData>, filter: AutoFilter | null): Partial<IWorksheetData> {
  const rows = filter?.cachedFilteredOut ?? [];
  if (rows.length === 0) return sheet;
  const rowData = { ...(sheet.rowData ?? {}) };
  for (const r of rows) rowData[r] = { ...(rowData[r] ?? {}), hd: BooleanNumber.TRUE };
  return { ...sheet, rowData };
}

/** Strings added on save, appended to sharedStrings.xml. */
class StringTable {
  private readonly index = new Map<string, number>();
  readonly added: string[] = [];
  constructor(private readonly book: SourceBook) {
    book.sst.strings.forEach((s, i) => {
      if (!book.sst.rich.has(i) && !this.index.has(s)) this.index.set(s, i);
    });
  }
  indexOf(text: string): number {
    let i = this.index.get(text);
    if (i === undefined) {
      i = this.book.sst.strings.length + this.added.length;
      this.added.push(text);
      this.index.set(text, i);
    }
    return i;
  }
}

type Context = {
  book: SourceBook;
  pkg: Package;
  styles: StyleSheet;
  strings: StringTable;
  baseline: IWorkbookData;
  current: IWorkbookData;
  /** A formula or a formula's result changed somewhere: Excel should recalculate on open. */
  formulas: boolean;
};

/** The workbook's bytes with `current`'s changes patched into the original package. */
export type WriteOptions = {
  /** Pivot caches Folio refreshed: Excel refreshes them again when it opens the file. */
  refreshCaches?: string[];
};

export function writeWorkbook(book: SourceBook, baseline: IWorkbookData, current: IWorkbookData, options: WriteOptions = {}): Uint8Array {
  const contentOf = (data: IWorkbookData) => ({
    order: data.sheetOrder,
    sheets: data.sheetOrder.map((id) => sheetContent(data.sheets[id], data.styles)),
    resources: (data.resources ?? []).map((r) => [r.name, r.data]).sort(),
  });
  if (same(contentOf(baseline), contentOf(current))) return book.pkg.bytes;

  const pkg = new Package(book.pkg.bytes);
  const ctx: Context = { book, pkg, styles: book.styles.fork(), strings: new StringTable(book), baseline, current, formulas: false };

  // Sheets: patch the changed ones, create new ones.
  const placed: { id: string; source: SourceSheet | undefined; part: string; relId: string }[] = [];
  for (const id of current.sheetOrder) {
    const sheet = current.sheets[id];
    if (!sheet) continue;
    let source = book.sheets.find((s) => s.id === id);
    const features = { base: featuresOf(baseline, id), cur: featuresOf(current, id) };
    const base = withFilteredRows(baseline.sheets[id] ?? {}, features.base.filter);
    const cur = withFilteredRows(sheet, features.cur.filter);
    if (source) {
      const before = { ...sheetContent(base, baseline.styles), name: 0, hidden: 0, features: features.base };
      const after = { ...sheetContent(cur, current.styles), name: 0, hidden: 0, features: features.cur };
      if (!same(before, after)) pkg.set(source.part, patchSheet(ctx, source, base, cur, features));
      placed.push({ id, source, part: source.part, relId: source.relId });
    } else {
      const part = freePart(pkg, 'xl/worksheets/sheet', '.xml');
      source = blankSheet(id, sheet.name ?? 'Sheet', part);
      pkg.set(part, patchSheet(ctx, source, {}, cur, { base: { cf: [], dv: [], filter: null, comments: [], drawings: null }, cur: features.cur }), CONTENT.worksheet);
      const relId = pkg.addRel(book.workbookPart, REL.worksheet, part);
      placed.push({ id, source: undefined, part, relId });
    }
  }

  const removed = book.sheets.filter((s) => !current.sheetOrder.includes(s.id));
  for (const sheet of removed) pkg.removeRel(book.workbookPart, sheet.relId);

  patchWorkbook(ctx, placed, removed);
  renameReferences(ctx);

  if (ctx.styles.changed) {
    const part = book.stylesPart ?? 'xl/styles.xml';
    pkg.set(part, ctx.styles.toXml(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml');
    if (!book.stylesPart) pkg.addRel(book.workbookPart, REL.styles, part);
  }
  if (ctx.strings.added.length) writeStrings(ctx);
  if (ctx.formulas) dropCalcChain(ctx);
  for (const part of options.refreshCaches ?? []) {
    const text = pkg.text(part);
    if (!text) continue;
    const root = parseXml(text);
    const open = text.slice(root.start, root.innerStart === root.end ? root.end : root.innerStart);
    const next = /\srefreshOnLoad="[^"]*"/.test(open) ? open.replace(/\srefreshOnLoad="[^"]*"/, ' refreshOnLoad="1"') : open.replace(/(\/?>)$/, ' refreshOnLoad="1"$1');
    if (next !== open) pkg.set(part, text.slice(0, root.start) + next + text.slice(root.start + open.length));
  }
  if (removed.length) pkg.collectGarbage();
  return pkg.toBytes();
}

function freePart(pkg: Package, stem: string, ext: string): string {
  for (let n = 1; ; n++) if (!pkg.has(`${stem}${n}${ext}`)) return `${stem}${n}${ext}`;
}

/** A worksheet with nothing in it, to patch new sheets into. */
function blankSheet(id: string, name: string, part: string): SourceSheet {
  const text =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    '<dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
    '<sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  const root = parseXml(text, ['sheetData']);
  return {
    id, name, part, relId: '', entry: root, text, root, sheetData: root.child('sheetData')!, rows: new Map(), cells: new Map(), cols: [],
    defaultRowHeight: 20, defaultColumnWidth: 64, digitWidth: 7, sharedFormulas: new Map(), cf: new Map(), dv: new Map(), filter: null,
    comments: { threaded: false }, pictures: { anchors: new Map() },
  };
}

// ---- Worksheets -------------------------------------------------------------------------------

function patchSheet(
  ctx: Context,
  source: SourceSheet,
  base: Partial<IWorksheetData>,
  cur: Partial<IWorksheetData>,
  features: { base: SheetFeatures; cur: SheetFeatures },
): string {
  const edits: Edit[] = [];
  const { root, text } = source;
  const p = root.prefix;
  /** Replaces element `local` (or inserts it where the schema wants it, or removes it). */
  const put = (local: string, xml: string | null) => {
    const el = root.child(local);
    if (el) edits.push({ start: el.start, end: el.end, text: xml ?? '' });
    else if (xml) {
      const later = SHEET_ORDER.slice(SHEET_ORDER.indexOf(local) + 1);
      const next = root.elements().find((child) => later.includes(child.local));
      const at = next ? next.start : root.innerEnd;
      edits.push({ start: at, end: at, text: xml });
    }
  };

  const baseCells = cellsContent(base.cellData, ctx.baseline.styles);
  const curCells = cellsContent(cur.cellData, ctx.current.styles);
  const cellsChanged = !same(baseCells, curCells) || !same(rowsContent(base.rowData), rowsContent(cur.rowData));
  if (cellsChanged) {
    const { xml, used } = sheetDataXml(ctx, source, base, cur);
    edits.push({ start: source.sheetData.start, end: source.sheetData.end, text: xml });
    const dimension = root.child('dimension');
    const ref = used ? rangeName(used) : 'A1';
    if (dimension) edits.push({ start: dimension.start, end: dimension.end, text: `<${p}dimension ref="${ref}"/>` });
  }

  if (!same(columnsContent(base.columnData), columnsContent(cur.columnData))) put('cols', colsXml(source, base, cur));

  const merges = (s: Partial<IWorksheetData>) => [...(s.mergeData ?? [])].map(rangeName).sort();
  if (!same(merges(base), merges(cur))) {
    const list = merges(cur);
    put('mergeCells', list.length ? `<${p}mergeCells count="${list.length}">${list.map((r) => `<${p}mergeCell ref="${r}"/>`).join('')}</${p}mergeCells>` : null);
  }

  if (freezeOf(base) !== freezeOf(cur) || (base.showGridlines === BooleanNumber.FALSE) !== (cur.showGridlines === BooleanNumber.FALSE)) {
    sheetViewEdits(source, cur, edits, put);
  }

  // Conditional formatting: all of the sheet's blocks are replaced together, where the first was.
  if (!same(features.base.cf, features.cur.cf)) {
    const blocks = root.elements('conditionalFormatting');
    for (const block of blocks) edits.push({ start: block.start, end: block.end, text: '' });
    const xml = conditionalFormattingXml(p, features.cur.cf, features.base.cf, source.cf, ctx.styles);
    if (xml) {
      if (blocks[0]) edits.push({ start: blocks[0].start, end: blocks[0].start, text: xml });
      else put('conditionalFormatting', xml);
    }
  }
  if (!same(features.base.dv, features.cur.dv)) put('dataValidations', dataValidationsXml(p, features.cur.dv, features.base.dv, source.dv, root.child('dataValidations')));
  const filterKey = (f: AutoFilter | null) => (f ? { ...f, cachedFilteredOut: undefined } : null);
  if (!same(filterKey(features.base.filter), filterKey(features.cur.filter))) put('autoFilter', autoFilterXml(p, features.cur.filter, source.filter));

  // Comments and pictures live in parts of their own; the sheet only points at them.
  const commentKey = (list: ThreadComment[]) => list.map((c) => [c.ref, c.text?.dataStream, c.authorName, (c.children ?? []).map((r) => r.text?.dataStream)]);
  if (!same(commentKey(features.base.comments), commentKey(features.cur.comments))) {
    const element = writeComments(ctx.pkg, source.part, cur, features.cur.comments, source.comments, p, root.child('legacyDrawing'));
    if (element !== undefined) put('legacyDrawing', element);
  }
  const drawingKey = (d: DrawingData | null) =>
    d ? d.order.map((id) => { const item = d.data[id] as { sheetTransform?: { from: unknown; to: unknown }; source?: string; data?: { chart?: { part?: string } } } | undefined; return [id, item?.sheetTransform?.from, item?.sheetTransform?.to, item?.source?.length ?? item?.data?.chart]; }) : [];
  if (!same(drawingKey(features.base.drawings), drawingKey(features.cur.drawings))) {
    const element = writePictures(ctx.pkg, source.part, features.base.drawings, features.cur.drawings, source.pictures, p, snapshotResolver(ctx.current));
    if (element) put('drawing', element);
  }

  if ((base.tabColor || '') !== (cur.tabColor || '')) {
    const sheetPr = root.child('sheetPr');
    const tab = cur.tabColor ? `<${p}tabColor rgb="FF${cur.tabColor.replace('#', '').toUpperCase().slice(0, 6)}"/>` : '';
    const existing = sheetPr?.child('tabColor');
    if (existing) edits.push({ start: existing.start, end: existing.end, text: tab });
    else if (sheetPr && tab) {
      if (sheetPr.innerStart === sheetPr.end) edits.push({ start: sheetPr.start, end: sheetPr.end, text: text.slice(sheetPr.start, sheetPr.end).replace(/\/>$/, `>${tab}</${sheetPr.name}>`) });
      else edits.push({ start: sheetPr.innerStart, end: sheetPr.innerStart, text: tab });
    } else if (tab) put('sheetPr', `<${p}sheetPr>${tab}</${p}sheetPr>`);
  }
  return patchText(text, edits);
}

function sheetViewEdits(source: SourceSheet, cur: Partial<IWorksheetData>, edits: Edit[], put: (local: string, xml: string | null) => void) {
  const { root, text } = source;
  const p = root.prefix;
  const f = cur.freeze;
  const rows = f && f.startRow > 0 ? f.ySplit : 0;
  const columns = f && f.startColumn > 0 ? f.xSplit : 0;
  const active = rows && columns ? 'bottomRight' : rows ? 'bottomLeft' : 'topRight';
  const pane =
    rows || columns
      ? `<${p}pane${columns ? ` xSplit="${columns}"` : ''}${rows ? ` ySplit="${rows}"` : ''} topLeftCell="${cellName(rows ? f!.startRow : 0, columns ? f!.startColumn : 0)}" activePane="${active}" state="frozen"/>`
      : '';
  const view = root.path('sheetViews/sheetView');
  if (!view) {
    const grid = cur.showGridlines === BooleanNumber.FALSE ? ' showGridLines="0"' : '';
    put('sheetViews', `<${p}sheetViews><${p}sheetView${grid} workbookViewId="0">${pane}</${p}sheetView></${p}sheetViews>`);
    return;
  }
  // The view's own attributes, with gridlines as they are now.
  const attrs = view.attrs.filter(([k]) => k !== 'showGridLines');
  if (cur.showGridlines === BooleanNumber.FALSE) attrs.unshift(['showGridLines', '0']);
  // Old panes and the selections that belong to them go; the top-left selection stays.
  let children = '';
  for (const child of view.elements()) {
    if (child.local === 'pane') continue;
    if (child.local === 'selection' && child.attr('pane') && child.attr('pane') !== 'topLeft') continue;
    children += text.slice(child.start, child.end);
  }
  edits.push({ start: view.start, end: view.end, text: `<${view.name}${attrsText(attrs)}>${pane}${children}</${view.name}>` });
}

function colsXml(source: SourceSheet, base: Partial<IWorksheetData>, cur: Partial<IWorksheetData>): string | null {
  const p = source.root.prefix;
  const per = new Map<number, [string, string][]>();
  for (const col of source.cols) {
    const min = Number(col.attr('min') ?? 1);
    const max = Number(col.attr('max') ?? min);
    for (let c = min; c <= max && c <= 16_384; c++) per.set(c - 1, col.attrs.filter(([k]) => k !== 'min' && k !== 'max'));
  }
  const keys = new Set([...Object.keys(base.columnData ?? {}), ...Object.keys(cur.columnData ?? {})].map(Number));
  for (const c of keys) {
    const before = base.columnData?.[c];
    const after = cur.columnData?.[c];
    if ((before?.w ?? null) === (after?.w ?? null) && Boolean(before?.hd) === Boolean(after?.hd)) continue;
    const attrs = new Map(per.get(c) ?? []);
    if (after?.w !== undefined && after.w !== null) {
      attrs.set('width', String(Math.round((after.w / source.digitWidth) * 256) / 256));
      attrs.set('customWidth', '1');
    } else {
      attrs.delete('width');
      attrs.delete('customWidth');
    }
    if (after?.hd) attrs.set('hidden', '1');
    else attrs.delete('hidden');
    if (!attrs.has('width') && attrs.size === 0) per.delete(c);
    else {
      if (!attrs.has('width')) attrs.set('width', String(Math.round((source.defaultColumnWidth / source.digitWidth) * 256) / 256));
      per.set(c, [...attrs]);
    }
  }
  const columns = [...per.keys()].sort((a, b) => a - b);
  if (columns.length === 0) return null;
  let out = '';
  for (let i = 0; i < columns.length; ) {
    const start = columns[i]!;
    const key = JSON.stringify(per.get(start));
    let end = start;
    while (i + 1 < columns.length && columns[i + 1] === end + 1 && JSON.stringify(per.get(columns[i + 1]!)) === key) end = columns[++i]!;
    i++;
    out += `<${p}col min="${start + 1}" max="${end + 1}"${attrsText(per.get(start)!)}/>`;
  }
  return `<${p}cols>${out}</${p}cols>`;
}

// ---- Cells -------------------------------------------------------------------------------------

type CellAt = { row: number; column: number; cell: ICellData };

function sheetDataXml(ctx: Context, source: SourceSheet, base: Partial<IWorksheetData>, cur: Partial<IWorksheetData>): { xml: string; used: Range | null } {
  const p = source.root.prefix;
  const baseStyles = ctx.baseline.styles;
  const curStyles = ctx.current.styles;
  const curCell = (r: number, c: number) => cur.cellData?.[r]?.[c] as ICellData | undefined;
  const baseCell = (r: number, c: number) => base.cellData?.[r]?.[c] as ICellData | undefined;
  const unchanged = (r: number, c: number) => cellKey(curCell(r, c), curStyles) === cellKey(baseCell(r, c), baseStyles);
  /** The formula itself (not its result or format) is as it was. */
  const sameFormula = (r: number, c: number) => {
    const a = curCell(r, c);
    const b = baseCell(r, c);
    return (a?.f ?? null) === (b?.f ?? null) && (a?.si ?? null) === (b?.si ?? null) && (a?.ref ?? null) === (b?.ref ?? null);
  };

  // Shared formula groups from the file stay as they are unless an edit broke one; a broken
  // group is written out cell by cell.
  const broken = new Set<string>();
  const members = new Map<string, SourceCell[]>();
  for (const byRow of source.cells.values()) {
    for (const cell of byRow.values()) {
      if (attrOf(cell.f?.attrs ?? [], 't') !== 'shared') continue;
      const si = attrOf(cell.f!.attrs, 'si') ?? '';
      members.set(si, [...(members.get(si) ?? []), cell]);
    }
  }
  for (const [si, cells] of members) {
    if (cells.some((cell) => !curCell(cell.row, cell.column) || !sameFormula(cell.row, cell.column))) broken.add(si);
  }
  // Univer's own groups: the cell that has the formula, by group id. A group whose formula
  // cell was edited away keeps the formula it had when the file was opened.
  const masters = new Map<string, CellAt>();
  for (const cells of [base.cellData, cur.cellData]) {
    for (const [r, row] of Object.entries(cells ?? {})) {
      for (const [c, cell] of Object.entries(row ?? {})) {
        const data = cell as ICellData;
        if (data.si && data.f) masters.set(data.si, { row: Number(r), column: Number(c), cell: data });
      }
    }
  }

  const rows = new Set<number>([...Object.keys(cur.cellData ?? {}).map(Number), ...Object.keys(cur.rowData ?? {}).map(Number)]);
  for (const r of source.rows.keys()) if (rows.has(r) || base.rowData?.[r]) rows.add(r);
  let used: Range | null = null;
  let out = '';
  for (const r of [...rows].sort((a, b) => a - b)) {
    const sourceRow = source.rows.get(r);
    const rowSame = rowKey(base.rowData?.[r]) === rowKey(cur.rowData?.[r]);
    const columns = Object.keys(cur.cellData?.[r] ?? {})
      .map(Number)
      .filter((c) => cellKey(curCell(r, c), curStyles))
      .sort((a, b) => a - b);
    for (const c of columns) used = used ? grow(used, r, c) : { startRow: r, endRow: r, startColumn: c, endColumn: c };

    const sourceColumns = sourceRow ? sourceRow.cells.map((cell) => cell.column) : [];
    const rawRow =
      sourceRow &&
      rowSame &&
      sourceRow.raw &&
      columns.every((c) => unchanged(r, c) && !brokenAt(r, c)) &&
      sourceColumns.every((c) => unchanged(r, c) && !brokenAt(r, c));
    if (rawRow) {
      out += sourceRow.raw;
      continue;
    }
    let cells = '';
    for (const c of columns) {
      const cell = curCell(r, c)!;
      const src = source.cells.get(r)?.get(c);
      if (src && unchanged(r, c) && !brokenAt(r, c)) {
        cells += src.raw;
        continue;
      }
      if (cell.f || cell.si || baseCell(r, c)?.f || baseCell(r, c)?.si || src?.f) ctx.formulas = true;
      cells += cellXml(ctx, source, r, c, cell, src, {
        keepFormula: Boolean(src?.f) && sameFormula(r, c) && !brokenAt(r, c),
        keepExtras: src !== undefined && sameFormula(r, c) && sameValue(cell, baseCell(r, c)),
        formula: formulaFor(r, c, cell),
      });
    }
    // Row attributes: as written when the row's size didn't change, else Folio's.
    let attrs: [string, string][];
    if (sourceRow && rowSame) attrs = sourceRow.attrs.filter(([k]) => k !== 'spans');
    else {
      attrs = (sourceRow?.attrs ?? []).filter(([k]) => !['r', 'spans', 'ht', 'customHeight', 'hidden'].includes(k));
      const data = cur.rowData?.[r];
      attrs.unshift(['r', String(r + 1)]);
      if (data?.h !== undefined && data.h !== null && (data.ia === BooleanNumber.FALSE || Math.abs(data.h - source.defaultRowHeight) > 0.5)) {
        attrs.push(['ht', String(Math.round(data.h * 0.75 * 100) / 100)], ['customHeight', '1']);
      }
      if (data?.hd) attrs.push(['hidden', '1']);
    }
    if (!attrs.some(([k]) => k === 'r')) attrs.unshift(['r', String(r + 1)]);
    if (!cells && attrs.length === 1) continue;
    out += cells ? `<${p}row${attrsText(attrs)}>${cells}</${p}row>` : `<${p}row${attrsText(attrs)}/>`;
  }
  const name = source.sheetData.name;
  return { xml: out ? `<${name}>${out}</${name}>` : `<${name}/>`, used };

  function brokenAt(r: number, c: number): boolean {
    const f = source.cells.get(r)?.get(c)?.f;
    return f !== undefined && attrOf(f.attrs, 't') === 'shared' && broken.has(attrOf(f.attrs, 'si') ?? '');
  }

  /** The formula a regenerated cell gets (written out in full; Folio adds no shared groups). */
  function formulaFor(r: number, c: number, cell: ICellData): string | undefined {
    if (cell.f) return cell.f;
    if (!cell.si) return undefined;
    const master = masters.get(cell.si);
    return master?.cell.f ? shiftFormula(master.cell.f, r - master.row, c - master.column) : undefined;
  }
}

const grow = (range: Range, r: number, c: number): Range => ({
  startRow: Math.min(range.startRow, r),
  endRow: Math.max(range.endRow, r),
  startColumn: Math.min(range.startColumn, c),
  endColumn: Math.max(range.endColumn, c),
});

function sameValue(a: ICellData | undefined, b: ICellData | undefined): boolean {
  return (a?.v ?? null) === (b?.v ?? null) && JSON.stringify(a?.p?.body ?? null) === JSON.stringify(b?.p?.body ?? null);
}

function numberText(n: number): string {
  if (Object.is(n, -0)) return '0';
  return String(n);
}

function cellXml(
  ctx: Context,
  source: SourceSheet,
  r: number,
  c: number,
  cell: ICellData,
  src: SourceCell | undefined,
  options: { keepFormula: boolean; keepExtras: boolean; formula: string | undefined },
): string {
  const p = source.root.prefix;
  const attrs: [string, string][] = [['r', cellName(r, c)]];
  // Attributes Folio doesn't know (cell metadata, phonetic) stay while the cell's content does.
  for (const [k, v] of src?.attrs ?? []) {
    if (['r', 's', 't'].includes(k)) continue;
    if ((k === 'cm' || k === 'vm') && !options.keepExtras) continue;
    attrs.push([k, v]);
  }
  const s = styleIndex(ctx, cell, src);
  if (s > 0) attrs.splice(1, 0, ['s', String(s)]);

  let f = '';
  const hasFormula = options.keepFormula || Boolean(options.formula);
  if (options.keepFormula) f = src!.f!.raw;
  else if (options.formula) {
    const text = escapeText(formulaToFile(options.formula));
    f = cell.ft === 2 && cell.ref ? `<${p}f t="array" ref="${escapeAttr(cell.ref)}">${text}</${p}f>` : `<${p}f>${text}</${p}f>`;
  }

  let t: string | undefined;
  let v: string | undefined;
  const value = cell.p?.body?.dataStream !== undefined ? cell.p.body.dataStream.replace(/\r?\n$/, '').replace(/\r\n?/g, '\n') : cell.v;
  if (value !== undefined && value !== null && !(value === '' && !hasFormula)) {
    if (cell.t === CellValueType.BOOLEAN || typeof value === 'boolean') {
      t = 'b';
      v = truthy(value) ? '1' : '0';
    } else if (typeof value === 'number' || (cell.t === CellValueType.NUMBER && value !== '' && Number.isFinite(Number(value)))) {
      const n = Number(value);
      if (Number.isFinite(n)) v = numberText(n);
      else {
        t = 'e';
        v = '#NUM!';
      }
    } else {
      const textValue = String(value);
      if (EXCEL_ERRORS.has(textValue)) t = 'e';
      else if (hasFormula) t = 'str';
      else t = 's';
      v = t === 's' ? String(ctx.strings.indexOf(textValue)) : textValue;
    }
  }
  if (t) attrs.splice(s > 0 ? 2 : 1, 0, ['t', t]);
  const valueXml = v === undefined ? '' : `<${p}v>${escapeText(t === 'str' ? encodeOfficeText(v) : v)}</${p}v>`;
  const extra = options.keepExtras ? (src?.extra ?? '') : '';
  const body = f + valueXml + extra;
  return body ? `<${p}c${attrsText(attrs)}>${body}</${p}c>` : `<${p}c${attrsText(attrs)}/>`;
}

function styleIndex(ctx: Context, cell: ICellData, src: SourceCell | undefined): number {
  const id = cell.s;
  if (typeof id === 'string' && /^x\d+$/.test(id) && ctx.baseline.styles[id] && same(ctx.current.styles[id], ctx.baseline.styles[id])) {
    return Number(id.slice(1));
  }
  const style = styleOf(id, ctx.current.styles);
  if (!style) return 0;
  const base = Number(attrOf(src?.attrs ?? [], 's') ?? 0);
  return ctx.styles.indexFor(style, base < ctx.styles.count ? base : 0);
}

// ---- Workbook ----------------------------------------------------------------------------------

function patchWorkbook(ctx: Context, placed: { id: string; source: SourceSheet | undefined; part: string; relId: string }[], removed: SourceSheet[]) {
  const { book, current, pkg } = ctx;
  const text = book.workbookText;
  const root = book.workbook;
  const p = root.prefix;
  const edits: Edit[] = [];
  const sheetsEl = root.child('sheets')!;
  const entries = sheetsEl.elements('sheet');

  // Worksheet slots in the original list are filled with the current sheets in order;
  // chart sheets and dialog sheets (which Folio doesn't show) keep their places.
  const worksheetIds = new Set(book.sheets.map((s) => s.entry));
  let nextSheetId = Math.max(0, ...entries.map((e) => Number(e.attr('sheetId') ?? 0))) + 1;
  const queue = [...placed];
  const list: { xml: string; oldIndex: number }[] = [];
  const write = (item: (typeof placed)[number]) => {
    const sheet = current.sheets[item.id]!;
    const hidden = sheet.hidden === BooleanNumber.TRUE;
    if (item.source) {
      const attrs = item.source.entry.attrs.map(([k, v]): [string, string] => [k, k === 'name' ? (sheet.name ?? v) : v]).filter(([k]) => k !== 'state');
      const wasVeryHidden = item.source.entry.attr('state') === 'veryHidden';
      if (hidden) attrs.splice(2, 0, ['state', wasVeryHidden ? 'veryHidden' : 'hidden']);
      return `<${item.source.entry.name}${attrsText(attrs)}/>`;
    }
    return `<${p}sheet name="${escapeAttr(sheet.name ?? 'Sheet')}" sheetId="${nextSheetId++}"${hidden ? ' state="hidden"' : ''} r:id="${item.relId}"/>`;
  };
  entries.forEach((entry, index) => {
    if (worksheetIds.has(entry) || removed.some((s) => s.entry === entry)) {
      const item = queue.shift();
      if (item) list.push({ xml: write(item), oldIndex: book.sheets.find((s) => s.id === item.id) ? entries.indexOf(book.sheets.find((s) => s.id === item.id)!.entry) : -1 });
    } else list.push({ xml: text.slice(entry.start, entry.end), oldIndex: index });
  });
  for (const item of queue) list.push({ xml: write(item), oldIndex: -1 });
  const sheetsXml = list.map((l) => l.xml).join('');
  if (sheetsXml !== text.slice(sheetsEl.innerStart, sheetsEl.innerEnd)) edits.push({ start: sheetsEl.innerStart, end: sheetsEl.innerEnd, text: sheetsXml });

  // Defined names local to a sheet follow it to its new position; a deleted sheet's go.
  const newIndex = new Map<number, number>();
  list.forEach((l, i) => l.oldIndex >= 0 && newIndex.set(l.oldIndex, i));
  for (const name of root.child('definedNames')?.elements('definedName') ?? []) {
    const local = name.attr('localSheetId');
    let xml = text.slice(name.start, name.end);
    if (local !== undefined) {
      const moved = newIndex.get(Number(local));
      if (moved === undefined) {
        edits.push({ start: name.start, end: name.end, text: '' });
        continue;
      }
      if (moved !== Number(local)) xml = xml.replace(/localSheetId="\d+"/, `localSheetId="${moved}"`);
    }
    xml = renameInFormula(ctx, xml);
    if (xml !== text.slice(name.start, name.end)) edits.push({ start: name.start, end: name.end, text: xml });
  }

  // The active tab must still exist.
  const view = root.path('bookViews/workbookView');
  const activeTab = Number(view?.attr('activeTab') ?? 0);
  if (view && activeTab >= list.length) {
    const viewText = text.slice(view.start, view.end).replace(/activeTab="\d+"/, 'activeTab="0"').replace(/firstSheet="\d+"/, 'firstSheet="0"');
    edits.push({ start: view.start, end: view.end, text: viewText });
  }

  if (ctx.formulas) {
    const calcPr = root.child('calcPr');
    if (calcPr) {
      if (calcPr.attr('fullCalcOnLoad') !== '1') {
        const attrs = calcPr.attrs.filter(([k]) => k !== 'fullCalcOnLoad');
        attrs.push(['fullCalcOnLoad', '1']);
        edits.push({ start: calcPr.start, end: calcPr.end, text: `<${calcPr.name}${attrsText(attrs)}/>` });
      }
    } else {
      const later = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst'];
      const next = root.elements().find((el) => later.includes(el.local));
      const at = next ? next.start : root.innerEnd;
      edits.push({ start: at, end: at, text: `<${p}calcPr fullCalcOnLoad="1"/>` });
    }
  }
  const patched = patchText(text, edits);
  if (patched !== text) pkg.set(book.workbookPart, patched);
}

/** Values of a range like 'Data'!$B$2:$B$5 in a snapshot (for the caches of new charts). */
function snapshotResolver(data: IWorkbookData): Resolve {
  return (ref) => {
    const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(ref.trim());
    const range = match ? parseRange(match[3]!.replace(/\$/g, '')) : undefined;
    if (!match || !range) return null;
    const name = (match[1] ?? match[2]!).replace(/''/g, "'");
    const sheet = Object.values(data.sheets).find((s) => s?.name === name);
    if (!sheet) return null;
    const out: (string | number | null)[] = [];
    for (let r = range.startRow; r <= Math.min(range.endRow, range.startRow + 10_000); r++) {
      for (let c = range.startColumn; c <= Math.min(range.endColumn, range.startColumn + 1000); c++) {
        const v = sheet.cellData?.[r]?.[c]?.v;
        out.push(v === undefined || v === null ? null : typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : String(v));
      }
    }
    return out;
  };
}

/** Old and new names of renamed sheets. */
function renames(ctx: Context): [string, string][] {
  const out: [string, string][] = [];
  for (const sheet of ctx.book.sheets) {
    const now = ctx.current.sheets[sheet.id]?.name;
    if (now && now !== sheet.name) out.push([sheet.name, now]);
  }
  return out;
}

/** References to renamed sheets in formula text ('Old Name'!A1, Old!A1) get the new names. */
function renameInFormula(ctx: Context, formula: string): string {
  let out = formula;
  for (const [from, to] of renames(ctx)) {
    const quoted = `'${from.replace(/'/g, "''")}'!`;
    const escapedQuoted = escapeText(quoted).replace(/'/g, '&apos;');
    out = out.split(quoted).join(`${quoteSheet(to)}!`).split(escapedQuoted).join(`${escapeText(quoteSheet(to))}!`);
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(from)) {
      out = out.replace(new RegExp(`(^|[^A-Za-z0-9_.'!])${from.replace(/\./g, '\\.')}!`, 'g'), (_, before: string) => `${before}${escapeText(quoteSheet(to))}!`);
    }
  }
  return out;
}

/** Charts and pivot caches name sheets in their references; renamed sheets are updated there. */
function renameReferences(ctx: Context) {
  if (renames(ctx).length === 0) return;
  for (const part of ctx.pkg.list()) {
    const type = ctx.pkg.contentType(part) ?? '';
    if (type === CONTENT.chart) {
      const text = ctx.pkg.text(part)!;
      const next = text.replace(/(<(\w+:)?f>)([^<]*)(<\/(\w+:)?f>)/g, (_, open: string, _p, body: string, close: string) => open + renameInFormula(ctx, body) + close);
      if (next !== text) ctx.pkg.set(part, next);
    } else if (type.endsWith('pivotCacheDefinition+xml')) {
      const text = ctx.pkg.text(part)!;
      let next = text;
      for (const [from, to] of renames(ctx)) next = next.split(`sheet="${escapeAttr(from)}"`).join(`sheet="${escapeAttr(to)}"`);
      if (next !== text) ctx.pkg.set(part, next);
    }
  }
}

function writeStrings(ctx: Context) {
  const { book, pkg, strings } = ctx;
  const items = strings.added
    .map((s) => {
      const text = escapeText(encodeOfficeText(s));
      const space = /^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : '';
      return `<si><t${space}>${text}</t></si>`;
    })
    .join('');
  const total = book.sst.strings.length + strings.added.length;
  if (book.sst.part && pkg.has(book.sst.part)) {
    const text = pkg.text(book.sst.part)!;
    const root = parseXml(text);
    const p = root.prefix;
    const prefixed = p ? items.replace(/<(\/?)(si|t)\b/g, `<$1${p}$2`) : items;
    const open = text.slice(root.start, root.innerStart === root.end ? root.end : root.innerStart);
    let newOpen = open.replace(/\suniqueCount="\d+"/, ` uniqueCount="${total}"`);
    if (!/uniqueCount=/.test(newOpen)) newOpen = newOpen.replace(/(\/?>)$/, ` uniqueCount="${total}"$1`);
    const count = Number(/\scount="(\d+)"/.exec(open)?.[1] ?? book.sst.strings.length);
    newOpen = newOpen.replace(/\scount="\d+"/, ` count="${count + strings.added.length}"`);
    const edits: Edit[] =
      root.innerStart === root.end
        ? [{ start: root.start, end: root.end, text: `${newOpen.replace(/\/>$/, '>')}${prefixed}</${root.name}>` }]
        : [
            { start: root.start, end: root.innerStart, text: newOpen },
            { start: root.innerEnd, end: root.innerEnd, text: prefixed },
          ];
    pkg.set(book.sst.part, patchText(text, edits));
  } else {
    const part = 'xl/sharedStrings.xml';
    pkg.set(
      part,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${MAIN_NS}" count="${strings.added.length}" uniqueCount="${total}">${items}</sst>`,
      CONTENT.sharedStrings,
    );
    pkg.addRel(book.workbookPart, REL.sharedStrings, part);
  }
}

/** Excel rebuilds calcChain.xml; a stale one makes it report the file as damaged. */
function dropCalcChain(ctx: Context) {
  const { pkg, book } = ctx;
  for (const rel of pkg.relsOfType(book.workbookPart, REL.calcChain)) {
    const part = pkg.target(book.workbookPart, rel);
    pkg.removeRel(book.workbookPart, rel.id);
    if (part) pkg.remove(part);
  }
}

export type { XmlElement };
