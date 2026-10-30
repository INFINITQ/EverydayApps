// Excel 97-2003 (.xls, BIFF8) -> Univer, read-only. Values, formulas (decompiled to text;
// a formula Folio can't read keeps its last value), cell formats, merged cells, column widths,
// row heights, hidden rows and columns, frozen panes and sheet names. Saving goes through
// "Save as" to .xlsx. Macros, charts, comments and pictures in .xls files aren't carried over.

import { BooleanNumber, CellValueType, type ICellData, type IStyleData, type IWorkbookData, type IWorksheetData, LocaleType } from '@univerjs/core';
import { BUILTIN_FORMATS } from '../xlsx/styles';
import { XlsError, readCompoundFile } from './cfb';
import { FUNCTIONS } from './functions';

type BiffRecord = { type: number; data: Uint8Array; continues: Uint8Array[] };

const enc = new TextDecoder('utf-16le');
const latin = new TextDecoder('windows-1252');

function records(stream: Uint8Array, from: number): { list: BiffRecord[]; end: number } {
  const list: BiffRecord[] = [];
  let at = from;
  while (at + 4 <= stream.length) {
    const type = stream[at]! | (stream[at + 1]! << 8);
    const length = stream[at + 2]! | (stream[at + 3]! << 8);
    const data = stream.subarray(at + 4, at + 4 + length);
    at += 4 + length;
    if (type === 0x003c && list.length) list[list.length - 1]!.continues.push(data);
    else list.push({ type, data, continues: [] });
    if (type === 0x000a) break; // EOF of this substream
  }
  return { list, end: at };
}

const u16 = (d: Uint8Array, at: number) => d[at]! | (d[at + 1]! << 8);
const u32 = (d: Uint8Array, at: number) => (d[at]! | (d[at + 1]! << 8) | (d[at + 2]! << 16) | (d[at + 3]! << 24)) >>> 0;
const f64 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset + at, 8).getFloat64(0, true);

/** An XLUnicodeString (cch u16) or ShortXLUnicodeString (cch u8); returns text and size. */
function unicode(d: Uint8Array, at: number, short = false): { text: string; size: number } {
  const cch = short ? d[at]! : u16(d, at);
  const flags = d[at + (short ? 1 : 2)]!;
  let p = at + (short ? 2 : 3);
  const rich = flags & 0x08 ? u16(d, p) : 0;
  if (flags & 0x08) p += 2;
  const ext = flags & 0x04 ? u32(d, p) : 0;
  if (flags & 0x04) p += 4;
  const wide = flags & 0x01;
  const bytes = d.subarray(p, p + cch * (wide ? 2 : 1));
  const text = wide ? enc.decode(bytes) : latin.decode(bytes);
  return { text, size: p - at + bytes.length + rich * 4 + ext };
}

/** RK numbers: 30-bit integers or the top 30 bits of a double, maybe divided by 100. */
function rk(value: number): number {
  const div = value & 1;
  let n: number;
  if (value & 2) n = value >> 2;
  else {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setUint32(4, value & 0xfffffffc, true);
    n = buffer.getFloat64(0, true);
  }
  return div ? n / 100 : n;
}

/** The shared string table, whose strings may continue across CONTINUE records. */
function sharedStrings(record: BiffRecord): string[] {
  const chunks = [record.data, ...record.continues];
  let ci = 0;
  let pos = 8;
  const out: string[] = [];
  const total = u32(record.data, 4);
  const chunk = () => chunks[ci]!;
  const byte = () => {
    if (pos >= chunk().length) {
      ci++;
      pos = 0;
      if (ci >= chunks.length) throw new XlsError('The workbook is damaged (its text is cut short).');
    }
    return chunk()[pos++]!;
  };
  for (let i = 0; i < total && ci < chunks.length; i++) {
    if (pos >= chunk().length) {
      ci++;
      pos = 0;
      if (ci >= chunks.length) break;
    }
    const cch = byte() | (byte() << 8);
    let flags = byte();
    const runs = flags & 0x08 ? byte() | (byte() << 8) : 0;
    let ext = 0;
    if (flags & 0x04) ext = byte() | (byte() << 8) | (byte() << 16) | (byte() << 24);
    let text = '';
    let remaining = cch;
    while (remaining > 0) {
      if (pos >= chunk().length) {
        ci++;
        pos = 0;
        if (ci >= chunks.length) break;
        flags = chunk()[pos++]!; // a continued string restates its width
      }
      const wide = flags & 0x01;
      const available = Math.floor((chunk().length - pos) / (wide ? 2 : 1));
      const take = Math.min(remaining, available);
      const bytes = chunk().subarray(pos, pos + take * (wide ? 2 : 1));
      text += wide ? enc.decode(bytes) : latin.decode(bytes);
      pos += bytes.length;
      remaining -= take;
      if (take === 0 && remaining > 0) {
        ci++;
        pos = 0;
        if (ci >= chunks.length) break;
        flags = chunk()[pos++]!;
      }
    }
    for (let skip = runs * 4 + ext; skip > 0; skip--) byte();
    out.push(text);
  }
  return out;
}

const DEFAULT_PALETTE = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000',
  '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99',
  '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];
/** BIFF border styles in the order of Univer's BorderStyleTypes. */
const BORDER = [0, 1, 8, 4, 3, 13, 7, 2, 9, 5, 10, 6, 11, 12];
const H_ALIGN = [0, 1, 2, 3, 0, 4, 2, 6];

export type XlsResult = { data: IWorkbookData; skippedFormulas: number; macros: boolean };

export function readXls(bytes: Uint8Array, name: string): XlsResult {
  const cfb = readCompoundFile(bytes);
  const stream = cfb.stream('Workbook') ?? cfb.stream('Book');
  if (!stream) throw new XlsError("This file isn't an Excel workbook.");
  if (!cfb.stream('Workbook')) throw new XlsError('Workbooks from Excel 95 and older are not supported.');
  const macros = cfb.names.some((n) => /^(_VBA_PROJECT|VBA|dir)$/i.test(n)) || cfb.names.includes('_VBA_PROJECT_CUR');

  const globals = records(stream, 0).list;
  const bof = globals[0];
  if (!bof || bof.type !== 0x0809 || u16(bof.data, 0) !== 0x0600) throw new XlsError('Only Excel 97-2003 (BIFF8) workbooks can be opened.');

  let strings: string[] = [];
  const fonts: IStyleData[] = [];
  const formats = new Map<number, string>();
  const xfs: Uint8Array[] = [];
  const palette = [...DEFAULT_PALETTE];
  const sheets: { name: string; offset: number; hidden: boolean; type: number }[] = [];
  const externSheets: number[] = [];
  const names: string[] = [];
  let date1904 = false;
  for (const record of globals) {
    const d = record.data;
    switch (record.type) {
      case 0x002f:
        throw new XlsError('This workbook is protected with a password. Open it in Excel and save it without one first.');
      case 0x00fc:
        strings = sharedStrings(record);
        break;
      case 0x0031: {
        const height = u16(d, 0) / 20;
        const grbit = u16(d, 2);
        const style: IStyleData = { fs: height, ff: unicode(d, 14, true).text };
        if (grbit & 0x02) style.it = 1;
        if (grbit & 0x08) style.st = { s: 1 };
        if (u16(d, 6) >= 700) style.bl = 1;
        if (d[10]) style.ul = { s: 1 };
        const sss = u16(d, 8);
        if (sss === 1) style.va = 3;
        else if (sss === 2) style.va = 2;
        fonts.push({ ...style, _icv: u16(d, 4) } as IStyleData);
        break;
      }
      case 0x041e:
        formats.set(u16(d, 0), unicode(d, 2).text);
        break;
      case 0x00e0:
        xfs.push(d);
        break;
      case 0x0092: {
        const count = u16(d, 0);
        for (let i = 0; i < count && 8 + i < 64; i++) palette[8 + i] = [...d.subarray(2 + i * 4, 5 + i * 4)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        break;
      }
      case 0x0022:
        date1904 = u16(d, 0) === 1;
        break;
      case 0x0085:
        sheets.push({ offset: u32(d, 0), hidden: d[4] !== 0, type: d[5]!, name: unicode(d, 6, true).text });
        break;
      case 0x0017: {
        const count = u16(d, 0);
        for (let i = 0; i < count; i++) externSheets.push(u16(d, 2 + i * 6 + 2));
        break;
      }
      case 0x0018: {
        const builtIn = u16(d, 0) & 0x20;
        const cch = d[3]!;
        const text = unicode(new Uint8Array([cch, 0, ...d.subarray(14)]), 0).text;
        names.push(builtIn ? `_xlnm.${text}` : text);
        break;
      }
    }
  }

  const color = (icv: number): string | undefined => {
    if (icv >= 64 || icv === 0x7fff) return undefined;
    const hex = palette[icv];
    return hex ? `#${hex}` : undefined;
  };
  const xfStyle = (index: number): IStyleData => {
    const xf = xfs[index];
    if (!xf) return {};
    const ifnt = u16(xf, 0);
    const fontRecord = fonts[ifnt >= 4 ? ifnt - 1 : ifnt] as (IStyleData & { _icv?: number }) | undefined;
    const { _icv, ...font } = fontRecord ?? ({} as IStyleData & { _icv?: number });
    const style: IStyleData = { ...font };
    const fontColor = _icv === undefined ? undefined : color(_icv);
    if (fontColor && fontColor !== '#000000') style.cl = { rgb: fontColor };
    const ifmt = u16(xf, 2);
    const code = formats.get(ifmt) ?? BUILTIN_FORMATS[ifmt];
    if (code && code !== 'General') style.n = { pattern: code };
    const align = xf[6]!;
    const h = H_ALIGN[align & 0x07];
    if (h) style.ht = h;
    if (align & 0x08) style.tb = 3;
    const v = (align >> 4) & 0x07;
    if (v === 0) style.vt = 1;
    else if (v === 1) style.vt = 2;
    const rotation = xf[7]!;
    if (rotation === 255) style.tr = { a: 0, v: 1 };
    else if (rotation > 0 && rotation <= 90) style.tr = { a: rotation };
    else if (rotation > 90 && rotation <= 180) style.tr = { a: 90 - rotation };
    const borders = u32(xf, 10);
    const borderColors = u32(xf, 14);
    const bd: NonNullable<IStyleData['bd']> = {};
    const side = (dg: number, icv: number) => (dg ? { s: BORDER[dg] ?? 1, cl: { rgb: color(icv) ?? '#000000' } } : undefined);
    const l = side(borders & 0x0f, (borders >> 16) & 0x7f);
    const r = side((borders >> 4) & 0x0f, (borders >> 23) & 0x7f);
    const t = side((borders >> 8) & 0x0f, borderColors & 0x7f);
    const b = side((borders >> 12) & 0x0f, (borderColors >> 7) & 0x7f);
    if (l) bd.l = l;
    if (r) bd.r = r;
    if (t) bd.t = t;
    if (b) bd.b = b;
    if (Object.keys(bd).length) style.bd = bd;
    const pattern = (borderColors >> 26) & 0x3f;
    const fill = u16(xf, 18);
    const fore = color(fill & 0x7f);
    if (pattern && fore) style.bg = { rgb: fore };
    return style;
  };

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
  for (let i = 0; i < xfs.length; i++) data.styles[`x${i}`] = xfStyle(i);
  const sheetNames = sheets.map((s) => s.name);
  let skippedFormulas = 0;

  sheets.forEach((sheet, index) => {
    if (sheet.type !== 0) return;
    const id = `s${index}`;
    const { list } = records(stream, sheet.offset);
    const cells: Record<number, Record<number, ICellData>> = {};
    const rowData: IWorksheetData['rowData'] = {};
    const columnData: IWorksheetData['columnData'] = {};
    const mergeData: IWorksheetData['mergeData'] = [];
    const shared = new Map<string, { rgce: Uint8Array; row: number; column: number }>();
    let freeze: IWorksheetData['freeze'] = { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 };
    let frozen = false;
    let maxRow = 0;
    let maxColumn = 0;
    let pendingString: ICellData | null = null;
    const put = (r: number, c: number, cell: ICellData) => {
      (cells[r] ??= {})[c] = cell;
      if (r > maxRow) maxRow = r;
      if (c > maxColumn) maxColumn = c;
    };
    const styleOf = (ixfe: number) => (ixfe > 0 && ixfe < xfs.length ? { s: `x${ixfe}` } : {});
    const context: FormulaContext = { sheetNames, externSheets, names, shared };

    // Shared and array formulas come after the first cell that uses them: read them first.
    const arrays = new Map<string, string>();
    for (const record of list) {
      const d = record.data;
      if (record.type === 0x04bc || record.type === 0x0221) {
        const row = u16(d, 0);
        const column = d[4]!;
        const at = record.type === 0x04bc ? 8 : 12;
        shared.set(`${row},${column}`, { rgce: d.subarray(at + 2, at + 2 + u16(d, at)), row, column });
        if (record.type === 0x0221) arrays.set(`${row},${column}`, `${columnName(column)}${row + 1}:${columnName(d[5]!)}${u16(d, 2) + 1}`);
      }
    }
    for (const record of list) {
      const d = record.data;
      switch (record.type) {
        case 0x00fd: // LABELSST
          put(u16(d, 0), u16(d, 2), { v: strings[u32(d, 6)] ?? '', t: CellValueType.STRING, ...styleOf(u16(d, 4)) });
          break;
        case 0x0203: // NUMBER
          put(u16(d, 0), u16(d, 2), { v: f64(d, 6), t: CellValueType.NUMBER, ...styleOf(u16(d, 4)) });
          break;
        case 0x027e: // RK
          put(u16(d, 0), u16(d, 2), { v: rk(u32(d, 6)), t: CellValueType.NUMBER, ...styleOf(u16(d, 4)) });
          break;
        case 0x00bd: {
          // MULRK
          const row = u16(d, 0);
          const first = u16(d, 2);
          const count = (d.length - 6) / 6;
          for (let i = 0; i < count; i++) put(row, first + i, { v: rk(u32(d, 6 + i * 6)), t: CellValueType.NUMBER, ...styleOf(u16(d, 4 + i * 6)) });
          break;
        }
        case 0x0205: {
          // BOOLERR
          const value = d[6]!;
          const error = d[7] === 1;
          put(u16(d, 0), u16(d, 2), error ? { v: ERRORS[value] ?? '#N/A', t: CellValueType.STRING, ...styleOf(u16(d, 4)) } : { v: value ? 1 : 0, t: CellValueType.BOOLEAN, ...styleOf(u16(d, 4)) });
          break;
        }
        case 0x0204: // LABEL
          put(u16(d, 0), u16(d, 2), { v: unicode(d, 6).text, t: CellValueType.STRING, ...styleOf(u16(d, 4)) });
          break;
        case 0x0201: // BLANK
          if (u16(d, 4) > 0) put(u16(d, 0), u16(d, 2), styleOf(u16(d, 4)));
          break;
        case 0x00be: {
          // MULBLANK
          const row = u16(d, 0);
          const first = u16(d, 2);
          const count = (d.length - 6) / 2;
          for (let i = 0; i < count; i++) if (u16(d, 4 + i * 2) > 0) put(row, first + i, styleOf(u16(d, 4 + i * 2)));
          break;
        }
        case 0x0006: {
          // FORMULA: its last value, and the formula itself
          const row = u16(d, 0);
          const column = u16(d, 2);
          const cell: ICellData = { ...styleOf(u16(d, 4)) };
          if (u16(d, 12) === 0xffff) {
            const kind = d[6];
            if (kind === 1) Object.assign(cell, { v: d[8] ? 1 : 0, t: CellValueType.BOOLEAN });
            else if (kind === 2) Object.assign(cell, { v: ERRORS[d[8]!] ?? '#N/A', t: CellValueType.STRING });
            else if (kind === 3) Object.assign(cell, { v: '', t: CellValueType.STRING });
            else if (kind === 0) pendingString = cell;
          } else Object.assign(cell, { v: f64(d, 6), t: CellValueType.NUMBER });
          const cce = u16(d, 20);
          const rgce = d.subarray(22, 22 + cce);
          // An array formula belongs to its top-left cell; the others only show results.
          const exp = rgce[0] === 0x01 ? `${u16(rgce, 1)},${u16(rgce, 3)}` : null;
          const array = exp ? arrays.get(exp) : undefined;
          if (array && exp !== `${row},${column}`) {
            put(row, column, cell);
            break;
          }
          const formula = decompile(rgce, row, column, context);
          if (formula) {
            cell.f = `=${formula}`;
            if (array) Object.assign(cell, { ft: 2, ref: array });
          } else skippedFormulas++;
          put(row, column, cell);
          break;
        }
        case 0x0207: // STRING: the text result of the formula before it
          if (pendingString) {
            pendingString.v = unicode(d, 0).text;
            pendingString.t = CellValueType.STRING;
            pendingString = null;
          }
          break;
        case 0x0208: {
          // ROW
          const row = u16(d, 0);
          const height = u16(d, 6);
          const flags = u32(d, 12);
          const data: { h?: number; hd?: BooleanNumber; ia?: BooleanNumber } = {};
          if (!(height & 0x8000) && flags & 0x40) data.h = Math.round(((height & 0x7fff) / 20) * (96 / 72));
          if (flags & 0x20) data.hd = BooleanNumber.TRUE;
          if (Object.keys(data).length) rowData[row] = data;
          break;
        }
        case 0x007d: {
          // COLINFO
          const first = u16(d, 0);
          const last = Math.min(u16(d, 2), first + 300);
          const width = u16(d, 4) / 256;
          const hidden = u16(d, 8) & 0x01;
          for (let c = first; c <= last; c++) columnData[c] = { w: Math.round(width * 7), ...(hidden ? { hd: BooleanNumber.TRUE } : {}) };
          break;
        }
        case 0x00e5: {
          // MERGEDCELLS
          const count = u16(d, 0);
          for (let i = 0; i < count; i++) {
            const at = 2 + i * 8;
            mergeData.push({ startRow: u16(d, at), endRow: u16(d, at + 2), startColumn: u16(d, at + 4), endColumn: u16(d, at + 6) });
          }
          break;
        }
        case 0x023e: // WINDOW2
          frozen = (u16(d, 0) & 0x0008) !== 0;
          break;
        case 0x0041: {
          // PANE
          if (!frozen) break;
          const xSplit = u16(d, 0);
          const ySplit = u16(d, 2);
          freeze = { xSplit, ySplit, startRow: ySplit > 0 ? ySplit : -1, startColumn: xSplit > 0 ? xSplit : -1 };
          break;
        }
      }
    }
    // Workbooks from old Macs count dates from 1904; Univer (like Excel today) from 1900.
    if (date1904) {
      for (const row of Object.values(cells)) {
        for (const cell of Object.values(row)) {
          const pattern = typeof cell.s === 'string' ? data.styles[cell.s]?.n?.pattern : undefined;
          if (typeof cell.v === 'number' && pattern && /[dmyhs]/i.test(pattern.replace(/"[^"]*"|\[^]/g, ''))) cell.v += 1462;
        }
      }
    }
    data.sheetOrder.push(id);
    data.sheets[id] = {
      id,
      name: sheet.name,
      hidden: sheet.hidden ? BooleanNumber.TRUE : BooleanNumber.FALSE,
      cellData: cells,
      rowData,
      columnData,
      mergeData,
      freeze,
      rowCount: Math.max(1000, maxRow + 100),
      columnCount: Math.max(26, maxColumn + 10),
      defaultColumnWidth: 64,
      defaultRowHeight: 20,
      defaultStyle: xfs.length > 15 ? 'x15' : undefined,
    };
  });
  if (data.sheetOrder.length === 0) throw new XlsError('This workbook has no worksheets Folio can show.');
  return { data, skippedFormulas, macros };
}

const ERRORS: Record<number, string> = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0f: '#VALUE!', 0x17: '#REF!', 0x1d: '#NAME?', 0x24: '#NUM!', 0x2a: '#N/A' };

type FormulaContext = {
  sheetNames: string[];
  externSheets: number[];
  names: string[];
  shared: Map<string, { rgce: Uint8Array; row: number; column: number }>;
};

function columnName(column: number): string {
  let name = '';
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Turns a BIFF8 formula's tokens into formula text; null when it holds something Folio can't read. */
export function decompile(rgce: Uint8Array, row: number, column: number, context: FormulaContext, depth = 0): string | null {
  const stack: string[] = [];
  let at = 0;
  const ref = (rw: number, col: number, relative: boolean) => {
    const rowRel = (col & 0x8000) !== 0;
    const colRel = (col & 0x4000) !== 0;
    let r = rw;
    let c = col & 0x3fff;
    if (relative) {
      if (rowRel) r = (row + ((rw << 16) >> 16) + 65536) % 65536;
      if (colRel) c = (column + ((c << 24) >> 24) + 256) % 256;
    }
    return `${colRel ? '' : '$'}${columnName(c)}${rowRel ? '' : '$'}${r + 1}`;
  };
  const sheetOf = (ixti: number) => {
    const tab = context.externSheets[ixti];
    const name = tab === undefined ? undefined : context.sheetNames[tab];
    return name === undefined ? null : `${quoteSheet(name)}!`;
  };
  try {
    while (at < rgce.length) {
      const ptg = rgce[at++]!;
      const base = ptg < 0x20 ? ptg : (ptg & 0x1f) | 0x20;
      const binary = (op: string) => {
        const b = stack.pop()!;
        const a = stack.pop()!;
        stack.push(`${a}${op}${b}`);
      };
      switch (base) {
        case 0x01: {
          // PtgExp: this cell shares the formula of the block at (row, col).
          const master = context.shared.get(`${u16(rgce, at)},${u16(rgce, at + 2)}`);
          at += 4;
          if (!master || depth > 0) return null;
          return decompile(master.rgce, row, column, context, depth + 1);
        }
        case 0x03: binary('+'); break;
        case 0x04: binary('-'); break;
        case 0x05: binary('*'); break;
        case 0x06: binary('/'); break;
        case 0x07: binary('^'); break;
        case 0x08: binary('&'); break;
        case 0x09: binary('<'); break;
        case 0x0a: binary('<='); break;
        case 0x0b: binary('='); break;
        case 0x0c: binary('>='); break;
        case 0x0d: binary('>'); break;
        case 0x0e: binary('<>'); break;
        case 0x0f: binary(' '); break;
        case 0x10: binary(','); break;
        case 0x11: binary(':'); break;
        case 0x12: stack.push(`+${stack.pop()}`); break;
        case 0x13: stack.push(`-${stack.pop()}`); break;
        case 0x14: stack.push(`${stack.pop()}%`); break;
        case 0x15: stack.push(`(${stack.pop()})`); break;
        case 0x16: stack.push(''); break;
        case 0x17: {
          const s = unicode(rgce, at, true);
          at += s.size;
          stack.push(`"${s.text.replace(/"/g, '""')}"`);
          break;
        }
        case 0x19: {
          // PtgAttr
          const type = rgce[at]!;
          if (type & 0x04) at += 3 + (u16(rgce, at + 1) + 1) * 2;
          else at += 3;
          if (type & 0x10) stack.push(`SUM(${stack.pop()})`);
          break;
        }
        case 0x1c: stack.push(ERRORS[rgce[at++]!] ?? '#N/A'); break;
        case 0x1d: stack.push(rgce[at++] ? 'TRUE' : 'FALSE'); break;
        case 0x1e: stack.push(String(u16(rgce, at))); at += 2; break;
        case 0x1f: stack.push(String(f64(rgce, at))); at += 8; break;
        case 0x21: {
          // PtgFunc: a function with a fixed number of arguments
          const fn = FUNCTIONS[u16(rgce, at)];
          at += 2;
          if (!fn || fn[1] < 0) return null;
          const args = stack.splice(stack.length - fn[1], fn[1]);
          stack.push(`${fn[0]}(${args.join(',')})`);
          break;
        }
        case 0x22: {
          // PtgFuncVar
          const argc = rgce[at]! & 0x7f;
          const index = u16(rgce, at + 1) & 0x7fff;
          at += 3;
          const args = stack.splice(stack.length - argc, argc);
          if (index === 255) {
            const [nameArg, ...rest] = args;
            stack.push(`${nameArg}(${rest.join(',')})`);
          } else {
            const fn = FUNCTIONS[index];
            if (!fn) return null;
            stack.push(`${fn[0]}(${args.join(',')})`);
          }
          break;
        }
        case 0x23: {
          const name = context.names[u32(rgce, at) - 1];
          at += 4;
          if (!name) return null;
          stack.push(name);
          break;
        }
        case 0x24: stack.push(ref(u16(rgce, at), u16(rgce, at + 2), false)); at += 4; break;
        case 0x25: stack.push(`${ref(u16(rgce, at), u16(rgce, at + 4), false)}:${ref(u16(rgce, at + 2), u16(rgce, at + 6), false)}`); at += 8; break;
        case 0x26: at += 6; break; // PtgMemArea: the tokens that follow compute it
        case 0x27: at += 6; break;
        case 0x28: at += 6; break;
        case 0x29: at += 2; break;
        case 0x2a: stack.push('#REF!'); at += 4; break;
        case 0x2b: stack.push('#REF!'); at += 8; break;
        case 0x2c: stack.push(ref(u16(rgce, at), u16(rgce, at + 2), true)); at += 4; break;
        case 0x2d: stack.push(`${ref(u16(rgce, at), u16(rgce, at + 4), true)}:${ref(u16(rgce, at + 2), u16(rgce, at + 6), true)}`); at += 8; break;
        case 0x39: {
          // PtgNameX: an add-in function's name (Analysis ToolPak) or an external name
          at += 6;
          return null;
        }
        case 0x3a: {
          const sheet = sheetOf(u16(rgce, at));
          if (!sheet) return null;
          stack.push(sheet + ref(u16(rgce, at + 2), u16(rgce, at + 4), false));
          at += 6;
          break;
        }
        case 0x3b: {
          const sheet = sheetOf(u16(rgce, at));
          if (!sheet) return null;
          stack.push(`${sheet}${ref(u16(rgce, at + 2), u16(rgce, at + 6), false)}:${ref(u16(rgce, at + 4), u16(rgce, at + 8), false)}`);
          at += 10;
          break;
        }
        case 0x3c: stack.push('#REF!'); at += 6; break;
        case 0x3d: stack.push('#REF!'); at += 10; break;
        default:
          return null;
      }
    }
  } catch {
    return null;
  }
  return stack.length === 1 ? stack[0]! : null;
}

