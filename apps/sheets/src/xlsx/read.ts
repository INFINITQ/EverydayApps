// .xlsx -> Univer. Builds the workbook Univer shows, and keeps a "source" model of the
// package: every cell's original XML, every sheet's text and the elements in it, so saving
// can patch exactly what changed (see write.ts).

import {
  BooleanNumber,
  CellValueType,
  type ICellData,
  type IColumnData,
  type IRowData,
  type IStyleData,
  type IWorkbookData,
  type IWorksheetData,
  LocaleType,
} from '@univerjs/core';
import { CONTENT, Package, REL } from './opc';
import { writeZip } from './zip';
import { MAX_COLUMNS, MAX_ROWS, type Range, cellName, parseCell, parseRange } from './refs';
import { StyleSheet } from './styles';
import { type XmlElement, decodeOfficeText, parseAttrs, parseXml, scanTags, unescapeXml } from './xml';

export type Kind = 'xlsx' | 'xlsm' | 'xltx' | 'xltm';

export const MAIN_TYPES: Record<string, Kind> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml': 'xlsx',
  'application/vnd.ms-excel.sheet.macroEnabled.main+xml': 'xlsm',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml': 'xltx',
  'application/vnd.ms-excel.template.macroEnabled.main+xml': 'xltm',
};

/** A cell as the file has it. */
export type SourceCell = {
  row: number;
  column: number;
  /** The whole <c> element as written. */
  raw: string;
  attrs: [string, string][];
  /** The <f> element as written, its attributes and its text. */
  f?: { raw: string; attrs: [string, string][]; text: string };
  v?: string;
  /** Children other than <f>, <v> and <is> (extLst), as written. */
  extra: string;
};

export type SourceRow = { row: number; attrs: [string, string][]; cells: SourceCell[]; /** The whole <row> element as written. */ raw: string; start: number };

export type SourceSheet = {
  /** Univer's id for the sheet ("s0", "s1"... in the file's order). */
  id: string;
  name: string;
  part: string;
  relId: string;
  /** The workbook.xml <sheet> element. */
  entry: XmlElement;
  text: string;
  /** The worksheet's root element (sheetData's children aren't parsed into it). */
  root: XmlElement;
  sheetData: XmlElement;
  rows: Map<number, SourceRow>;
  cells: Map<number, Map<number, SourceCell>>;
  /** Column widths and formats as written (<col> elements), for patching <cols>. */
  cols: XmlElement[];
  /** Pixel sizes used for this sheet's defaults. */
  defaultRowHeight: number;
  defaultColumnWidth: number;
  /** Excel's character-width unit for this workbook, in pixels. */
  digitWidth: number;
  /** Shared formula groups by their si, as written. */
  sharedFormulas: Map<string, { master: SourceCell; ref?: Range }>;
};

/** Things in the file Folio shows or keeps without editing them. */
export type Features = {
  macros: boolean;
  pivotTables: { sheet: string; name: string; location: Range | undefined; part: string }[];
  charts: { sheet: string; part: string }[];
  tables: { sheet: string; name: string; ref: Range | undefined; part: string }[];
  externalLinks: number;
  chartsheets: string[];
  dialogsheets: string[];
  threadedComments: boolean;
  dataConnections: boolean;
};

export type SourceBook = {
  pkg: Package;
  kind: Kind;
  workbookPart: string;
  workbookText: string;
  workbook: XmlElement;
  styles: StyleSheet;
  stylesPart: string | undefined;
  sst: { part: string | undefined; strings: string[]; rich: Set<number> };
  sheets: SourceSheet[];
  date1904: boolean;
  features: Features;
};

const FORMULA_PREFIX = /_xlfn\.(?:_xlws\.)?|_xlws\.|_xludf\./g;

/** Strips Excel's "future function" prefixes, which Univer doesn't use. */
export const formulaFromFile = (text: string) => `=${text.replace(FORMULA_PREFIX, '')}`;

/** Character width in pixels for Excel's column unit, from the workbook's default font. */
function digitWidthOf(style: IStyleData): number {
  const size = style.fs ?? 11;
  // Calibri/Aptos 11 and Arial 10 are 7 px; scale others by size.
  return Math.max(5, Math.round((size / 11) * 7));
}

/**
 * Reads a workbook. `sheetIds` names the worksheets (in order) after a save, so they keep the
 * ids Univer already uses for them.
 */
export function readWorkbook(bytes: Uint8Array, name: string, sheetIds?: string[]): { data: IWorkbookData; book: SourceBook } {
  const pkg = new Package(bytes);
  const officeRel = pkg.relsOfType('', REL.officeDocument)[0] ?? pkg.rels('').find((r) => r.type.endsWith('/officeDocument'));
  const workbookPart = pkg.target('', officeRel);
  if (!workbookPart || !pkg.has(workbookPart)) throw new Error("This file isn't an Excel workbook.");
  const mainType = pkg.contentType(workbookPart) ?? '';
  const kind = MAIN_TYPES[mainType];
  if (!kind) {
    if (mainType.includes('binary')) throw new Error('Binary workbooks (.xlsb) are not supported. Save it as .xlsx in Excel first.');
    throw new Error("This file isn't an Excel workbook.");
  }
  const workbookText = pkg.text(workbookPart)!;
  const workbook = parseXml(workbookText);

  const relTarget = (type: string) => pkg.target(workbookPart, pkg.relsOfType(workbookPart, type)[0]);
  const themePart = relTarget(REL.theme);
  const stylesPart = relTarget(REL.styles);
  const styles = new StyleSheet(stylesPart ? pkg.text(stylesPart) : undefined, themePart ? pkg.xml(themePart) : undefined);
  const sstPart = relTarget(REL.sharedStrings);
  const sst = readSharedStrings(sstPart ? pkg.text(sstPart) : undefined);
  const date1904 = ['1', 'true'].includes(workbook.child('workbookPr')?.attr('date1904') ?? '');

  const features: Features = {
    macros: kind === 'xlsm' || kind === 'xltm' || pkg.relsOfType(workbookPart, REL.vbaProject).length > 0,
    pivotTables: [],
    charts: [],
    tables: [],
    externalLinks: pkg.relsOfType(workbookPart, REL.externalLink).length,
    chartsheets: [],
    dialogsheets: [],
    threadedComments: false,
    dataConnections: pkg.rels(workbookPart).some((r) => r.type.endsWith('/connections')),
  };

  const defaultStyle = styles.style(0);
  const digitWidth = digitWidthOf(defaultStyle);
  const data: IWorkbookData = {
    id: `workbook-${Math.random().toString(36).slice(2)}`,
    name,
    appVersion: '1.2.0',
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: [],
    sheets: {},
    resources: [],
  };
  // Univer style ids "x<index>" for every cell format in the file.
  for (let i = 0; i < styles.count; i++) data.styles[`x${i}`] = styles.style(i);

  const sheets: SourceSheet[] = [];
  const entries = workbook.child('sheets')?.elements('sheet') ?? [];
  let worksheets = 0;
  entries.forEach((entry, index) => {
    const relId = entry.attr('r:id') ?? entry.attr('id') ?? '';
    const rel = pkg.relById(workbookPart, relId);
    const part = pkg.target(workbookPart, rel);
    const sheetName = entry.attr('name') ?? `Sheet${index + 1}`;
    if (rel?.type === REL.chartsheet) features.chartsheets.push(sheetName);
    else if (rel?.type.endsWith('/dialogsheet')) features.dialogsheets.push(sheetName);
    if (!part || !pkg.has(part) || pkg.contentType(part) !== CONTENT.worksheet) return;
    const id = sheetIds?.[worksheets] ?? `s${worksheets}`;
    worksheets += 1;
    const source = readSheet(pkg, part, id, sheetName, relId, entry, digitWidth);
    sheets.push(source);
    data.sheetOrder.push(source.id);
    data.sheets[source.id] = toUniverSheet(source, entry, styles, sst.strings, date1904);
    collectFeatures(pkg, source, features);
  });
  if (sheets.length === 0) throw new Error('This workbook has no worksheets Folio can show.');

  return {
    data,
    book: { pkg, kind, workbookPart, workbookText, workbook, styles, stylesPart, sst: { part: sstPart, ...sst }, sheets, date1904, features },
  };
}

function readSharedStrings(text: string | undefined): { strings: string[]; rich: Set<number> } {
  const rich = new Set<number>();
  if (!text) return { strings: [], rich };
  const items = parseXml(text).elements('si');
  items.forEach((si, i) => si.child('r') && rich.add(i));
  return { strings: items.map(stringItemText), rich };
}

/** The text of a shared string or inline string (runs joined; phonetic hints left out). */
export function stringItemText(si: XmlElement): string {
  let out = '';
  for (const child of si.elements()) {
    if (child.local === 't') out += child.text();
    else if (child.local === 'r') out += child.child('t')?.text() ?? '';
  }
  return decodeOfficeText(out);
}

function readSheet(pkg: Package, part: string, id: string, name: string, relId: string, entry: XmlElement, digitWidth: number): SourceSheet {
  const text = pkg.text(part)!;
  const root = parseXml(text, ['sheetData']);
  const sheetData = root.child('sheetData');
  if (!sheetData) throw new Error(`${name} is damaged (it has no cell data).`);
  const rows = new Map<number, SourceRow>();
  const cells = new Map<number, Map<number, SourceCell>>();
  const sharedFormulas = new Map<string, { master: SourceCell; ref?: Range }>();

  let row: SourceRow | null = null;
  let cell: (SourceCell & { start: number }) | null = null;
  let nextRow = 0;
  let nextColumn = 0;
  let open: { name: string; end: number; attrs: string; start: number } | null = null;
  let extraFrom = -1;
  scanTags(text, sheetData.innerStart, sheetData.innerEnd, (tag) => {
    const local = tag.name.slice(tag.name.indexOf(':') + 1);
    // Inside <f>, <v> or <is>: everything up to its end belongs to it (<is> holds <t> runs).
    if (open && !(tag.kind === 'close' && local === open.name)) return;
    if (cell && extraFrom >= 0) {
      // Inside an unknown child of <c> (extLst): skip until it closes.
      if (tag.kind === 'close' && local === 'c') {
        cell.extra += text.slice(extraFrom, tag.start);
        extraFrom = -1;
      } else return;
    }
    if (local === 'row' && tag.kind !== 'close') {
      const attrs = parseAttrs(tag.attrs);
      const r = Number(attrs.find(([k]) => k === 'r')?.[1] ?? nextRow + 1) - 1;
      row = { row: r, attrs, cells: [], raw: '', start: tag.start };
      rows.set(r, row);
      nextRow = r + 1;
      nextColumn = 0;
      if (tag.kind === 'empty') {
        row.raw = text.slice(tag.start, tag.end);
        row = null;
      }
      return;
    }
    if (local === 'row' && tag.kind === 'close') {
      if (row) (row as SourceRow).raw = text.slice((row as SourceRow).start, tag.end);
      row = null;
      return;
    }
    if (local === 'c' && tag.kind !== 'close') {
      const attrs = parseAttrs(tag.attrs);
      const ref = attrs.find(([k]) => k === 'r')?.[1];
      const at = ref ? parseCell(ref) : undefined;
      const r = at?.row ?? (row as SourceRow | null)?.row ?? nextRow;
      const c = at?.column ?? nextColumn;
      nextColumn = c + 1;
      cell = { row: r, column: c, raw: '', attrs, extra: '', start: tag.start };
      if (tag.kind === 'empty') finishCell(tag.end);
      return;
    }
    if (!cell) return;
    if (tag.kind === 'close' && local === 'c') {
      finishCell(tag.end);
      return;
    }
    if (tag.kind === 'open') {
      if (local === 'f' || local === 'v' || local === 'is') open = { name: local, end: tag.end, attrs: tag.attrs, start: tag.start };
      else extraFrom = tag.start;
      return;
    }
    if (tag.kind === 'empty') {
      if (local === 'f') cell.f = { raw: text.slice(tag.start, tag.end), attrs: parseAttrs(tag.attrs), text: '' };
      else if (local === 'v') cell.v = '';
      else if (local !== 'is') cell.extra += text.slice(tag.start, tag.end);
      return;
    }
    if (tag.kind === 'close' && open && local === open.name) {
      const inner = text.slice(open.end, tag.start);
      if (local === 'f') cell.f = { raw: text.slice(open.start, tag.end), attrs: parseAttrs(open.attrs), text: unescapeXml(inner) };
      else if (local === 'v') cell.v = unescapeXml(inner);
      else if (local === 'is') cell.v = stringItemText(parseXml(`<is>${inner}</is>`));
      open = null;
    }
  });

  function finishCell(end: number) {
    const c = cell!;
    c.raw = text.slice(c.start, end);
    let byRow = cells.get(c.row);
    if (!byRow) cells.set(c.row, (byRow = new Map()));
    byRow.set(c.column, c);
    (row as SourceRow | null)?.cells.push(c);
    const f = c.f;
    if (f && attrOf(f.attrs, 't') === 'shared' && f.text) {
      const si = attrOf(f.attrs, 'si') ?? '';
      sharedFormulas.set(si, { master: c, ref: parseRange(attrOf(f.attrs, 'ref') ?? '') });
    }
    cell = null;
    open = null;
  }

  const format = root.child('sheetFormatPr');
  const rowPt = Number(format?.attr('defaultRowHeight') ?? 15);
  const defaultRowHeight = Math.round(((rowPt > 0 ? rowPt : 15) * 96) / 72);
  const colChars = Number(format?.attr('defaultColWidth') ?? 0);
  const defaultColumnWidth = colChars > 0 ? Math.round(colChars * digitWidth) : Math.round(digitWidth * 8 + 8);
  return {
    id,
    name,
    part,
    relId,
    entry,
    text,
    root,
    sheetData,
    rows,
    cells,
    cols: root.child('cols')?.elements('col') ?? [],
    defaultRowHeight,
    defaultColumnWidth,
    digitWidth,
    sharedFormulas,
  };
}

export const attrOf = (attrs: [string, string][], name: string) => attrs.find(([k]) => k === name)?.[1];

/** A source cell as Univer data. */
export function cellData(cell: SourceCell, strings: string[], date1904: boolean, sheetId: string): ICellData {
  const out: ICellData = {};
  const s = Number(attrOf(cell.attrs, 's') ?? 0);
  if (s > 0) out.s = `x${s}`;
  const t = attrOf(cell.attrs, 't') ?? 'n';
  const v = cell.v;
  if (v !== undefined) {
    switch (t) {
      case 's': {
        const text = strings[Number(v)];
        if (text !== undefined) {
          out.v = text;
          out.t = CellValueType.STRING;
        }
        break;
      }
      case 'str':
      case 'inlineStr':
        out.v = decodeOfficeText(v);
        out.t = CellValueType.STRING;
        break;
      case 'b':
        out.v = v === '1' || v.toLowerCase() === 'true' ? 1 : 0;
        out.t = CellValueType.BOOLEAN;
        break;
      case 'e':
        out.v = v;
        out.t = CellValueType.STRING;
        break;
      case 'd': {
        const ms = Date.parse(v);
        if (Number.isFinite(ms)) {
          out.v = ms / 86_400_000 + (date1904 ? -24107 : 25569);
          out.t = CellValueType.NUMBER;
        }
        break;
      }
      default: {
        const n = Number(v);
        if (v !== '' && Number.isFinite(n)) {
          out.v = n;
          out.t = CellValueType.NUMBER;
        }
      }
    }
  }
  const f = cell.f;
  if (f) {
    const ft = attrOf(f.attrs, 't');
    if (ft === 'shared') {
      const si = `${sheetId}-${attrOf(f.attrs, 'si') ?? ''}`;
      if (f.text) out.f = formulaFromFile(f.text);
      out.si = si;
    } else if (ft === 'array') {
      if (f.text) {
        out.f = formulaFromFile(f.text);
        out.ft = 2;
        const ref = attrOf(f.attrs, 'ref');
        if (ref) out.ref = ref;
      }
    } else if (ft !== 'dataTable' && f.text) {
      out.f = formulaFromFile(f.text);
    }
  }
  return out;
}

function toUniverSheet(source: SourceSheet, entry: XmlElement, styles: StyleSheet, strings: string[], date1904: boolean): Partial<IWorksheetData> {
  const cellMatrix: Record<number, Record<number, ICellData>> = {};
  let maxRow = 0;
  let maxColumn = 0;
  for (const [r, byRow] of source.cells) {
    const out: Record<number, ICellData> = {};
    for (const [c, cell] of byRow) {
      const data = cellData(cell, strings, date1904, source.id);
      if (Object.keys(data).length === 0) continue;
      out[c] = data;
      if (c > maxColumn) maxColumn = c;
    }
    if (Object.keys(out).length) {
      cellMatrix[r] = out;
      if (r > maxRow) maxRow = r;
    }
  }

  const rowData: Record<number, Partial<IRowData>> = {};
  for (const [r, row] of source.rows) {
    const ht = Number(attrOf(row.attrs, 'ht'));
    const custom = attrOf(row.attrs, 'customHeight');
    const hidden = attrOf(row.attrs, 'hidden');
    const data: Partial<IRowData> = {};
    if (ht > 0) data.h = Math.round((ht * 96) / 72);
    if (hidden === '1' || hidden === 'true') data.hd = BooleanNumber.TRUE;
    if (custom === '1' || custom === 'true') data.ia = BooleanNumber.FALSE;
    if (Object.keys(data).length) rowData[r] = data;
  }

  const columnData: Record<number, Partial<IColumnData>> = {};
  for (const col of source.cols) {
    const min = Number(col.attr('min') ?? 1) - 1;
    const max = Math.min(Number(col.attr('max') ?? min + 1) - 1, MAX_COLUMNS - 1);
    const width = Number(col.attr('width'));
    const hidden = col.attr('hidden') === '1' || col.attr('hidden') === 'true';
    // A <col> covering thousands of columns sets them all; Univer keeps them sparse only up to
    // what's used, so very wide ranges stop a bit past the last column in use.
    const last = max - min > 1000 ? Math.max(min, Math.min(max, maxColumn + 50)) : max;
    for (let c = min; c <= last; c++) {
      const data: Partial<IColumnData> = {};
      if (width > 0) data.w = Math.round(width * source.digitWidth);
      if (hidden) data.hd = BooleanNumber.TRUE;
      if (Object.keys(data).length) columnData[c] = data;
    }
  }

  const mergeData = (source.root.child('mergeCells')?.elements('mergeCell') ?? [])
    .map((m) => parseRange(m.attr('ref') ?? ''))
    .filter((r): r is Range => r !== undefined);
  for (const m of mergeData) {
    if (m.endRow > maxRow) maxRow = m.endRow;
    if (m.endColumn > maxColumn) maxColumn = m.endColumn;
  }

  const view = source.root.path('sheetViews/sheetView');
  const pane = view?.child('pane');
  let freeze: IWorksheetData['freeze'] = { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 };
  if (pane && (pane.attr('state') === 'frozen' || pane.attr('state') === 'frozenSplit')) {
    const xSplit = Math.round(Number(pane.attr('xSplit') ?? 0));
    const ySplit = Math.round(Number(pane.attr('ySplit') ?? 0));
    if (xSplit > 0 || ySplit > 0) freeze = { xSplit, ySplit, startRow: ySplit > 0 ? ySplit : -1, startColumn: xSplit > 0 ? xSplit : -1 };
  }
  const tabColor = source.root.path('sheetPr/tabColor');
  const tab = tabColor ? colorFromAttrs(tabColor, styles) : undefined;
  const state = entry.attr('state');
  const zoom = Number(view?.attr('zoomScale') ?? 100);

  return {
    id: source.id,
    name: source.name,
    tabColor: tab ?? '',
    hidden: state === 'hidden' || state === 'veryHidden' ? BooleanNumber.TRUE : BooleanNumber.FALSE,
    freeze,
    rowCount: Math.min(MAX_ROWS, Math.max(1000, maxRow + 100)),
    columnCount: Math.min(MAX_COLUMNS, Math.max(26, maxColumn + 10)),
    zoomRatio: zoom > 0 ? zoom / 100 : 1,
    scrollTop: 0,
    scrollLeft: 0,
    defaultColumnWidth: source.defaultColumnWidth,
    defaultRowHeight: source.defaultRowHeight,
    mergeData,
    cellData: cellMatrix,
    rowData,
    columnData,
    showGridlines: view?.attr('showGridLines') === '0' ? BooleanNumber.FALSE : BooleanNumber.TRUE,
    rightToLeft: view?.attr('rightToLeft') === '1' ? BooleanNumber.TRUE : BooleanNumber.FALSE,
    rowHeader: { width: 46 },
    columnHeader: { height: 20 },
    defaultStyle: 'x0',
  };
}

function colorFromAttrs(el: XmlElement, styles: StyleSheet): string | undefined {
  const rgb = el.attr('rgb');
  if (rgb) return `#${rgb.slice(-6)}`;
  const theme = el.attr('theme');
  if (theme !== undefined) return `#${styles.palette.theme[Number(theme)] ?? '000000'}`;
  return undefined;
}

function collectFeatures(pkg: Package, sheet: SourceSheet, features: Features) {
  for (const rel of pkg.rels(sheet.part)) {
    const part = pkg.target(sheet.part, rel);
    if (!part || !pkg.has(part)) continue;
    if (rel.type === REL.pivotTable) {
      const root = pkg.xml(part);
      features.pivotTables.push({ sheet: sheet.id, name: root?.attr('name') ?? 'PivotTable', location: parseRange(root?.child('location')?.attr('ref') ?? ''), part });
    } else if (rel.type === REL.table) {
      const root = pkg.xml(part);
      features.tables.push({ sheet: sheet.id, name: root?.attr('displayName') ?? root?.attr('name') ?? 'Table', ref: parseRange(root?.attr('ref') ?? ''), part });
    } else if (rel.type === REL.drawing) {
      for (const chartRel of pkg.relsOfType(part, REL.chart)) {
        const chart = pkg.target(part, chartRel);
        if (chart) features.charts.push({ sheet: sheet.id, part: chart });
      }
    } else if (rel.type === REL.threadedComment) {
      features.threadedComments = true;
    }
  }
}

/** "A1" of a cell, for messages. */
export const where = (cell: { row: number; column: number }) => cellName(cell.row, cell.column);

/** An empty workbook to patch into when saving a CSV or an old .xls as .xlsx. */
export function BLANK_WORKBOOK(): Uint8Array {
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = (list: [string, string, string][]) =>
    `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
  const files: Record<string, string> = {
    '[Content_Types].xml':
      `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': `${xml}<workbook xmlns="${main}" xmlns:r="${r}"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml']]),
    'xl/worksheets/sheet1.xml': `${xml}<worksheet xmlns="${main}" xmlns:r="${r}"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`,
  };
  return writeZip(Object.entries(files).map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) })));
}
