// CSV <-> Univer. Saving keeps every line that didn't change exactly as it was, along with
// the file's delimiter, line endings and byte-order mark.

import { CellValueType, type ICellData, type IWorkbookData, LocaleType } from '@univerjs/core';

export type CsvSource = {
  delimiter: string;
  newline: string;
  bom: 'utf8' | 'utf16le' | null;
  /** Each line as written (without its line ending) and the fields it holds. */
  rows: { raw: string; fields: string[] }[];
  /** The file ended with a line ending. */
  trailingNewline: boolean;
};

/** Text from bytes: UTF-8 or UTF-16 by byte-order mark, else UTF-8, else Windows-1252. */
export function decodeText(bytes: Uint8Array): { text: string; bom: CsvSource['bom'] } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), bom: 'utf8' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), bom: 'utf16le' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bom: null };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), bom: null };
  }
}

/** The delimiter that splits the first lines most consistently: comma, semicolon or tab. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/, 20).filter((l) => l.length > 0);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const first = counts[0] ?? 1;
    if (first < 2) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, delimiter: string): string[] {
  return parseRecords(line, delimiter)[0]?.fields ?? [''];
}

/** RFC 4180 records: quoted fields may hold delimiters, quotes ("") and line breaks. */
export function parseRecords(text: string, delimiter: string): { raw: string; fields: string[]; end: number }[] {
  const records: { raw: string; fields: string[]; end: number }[] = [];
  let at = 0;
  while (at < text.length) {
    const start = at;
    const fields: string[] = [];
    let field = '';
    let quoted = false;
    let inQuotes = false;
    for (;;) {
      if (at >= text.length) {
        fields.push(field);
        break;
      }
      const ch = text[at]!;
      if (inQuotes) {
        if (ch === '"') {
          if (text[at + 1] === '"') {
            field += '"';
            at += 2;
            continue;
          }
          inQuotes = false;
          at++;
          continue;
        }
        field += ch;
        at++;
        continue;
      }
      if (ch === '"' && field === '' && !quoted) {
        inQuotes = true;
        quoted = true;
        at++;
        continue;
      }
      if (ch === delimiter) {
        fields.push(field);
        field = '';
        quoted = false;
        at++;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        fields.push(field);
        break;
      }
      field += ch;
      at++;
    }
    const raw = text.slice(start, at);
    if (text[at] === '\r' && text[at + 1] === '\n') at += 2;
    else if (at < text.length) at += 1;
    records.push({ raw, fields, end: at });
  }
  return records;
}

const NUMBER = /^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$|^[-+]?0?\.\d+$/;

/** A field as a cell: plain numbers become numbers (not "007", which stays text). */
export function fieldCell(field: string): ICellData | null {
  if (field === '') return null;
  if (NUMBER.test(field) && field.replace(/^[-+]/, '').length <= 15) return { v: Number(field), t: CellValueType.NUMBER };
  if (/^(true|false)$/i.test(field)) return { v: field, t: CellValueType.STRING };
  return { v: field, t: CellValueType.STRING };
}

export function readCsv(bytes: Uint8Array, name: string, sheetId = 's0'): { data: IWorkbookData; source: CsvSource } {
  const { text, bom } = decodeText(bytes);
  const delimiter = name.toLowerCase().endsWith('.tsv') ? '\t' : detectDelimiter(text);
  const newline = /\r\n/.test(text) ? '\r\n' : /\n/.test(text) ? '\n' : /\r/.test(text) ? '\r' : '\r\n';
  const records = parseRecords(text, delimiter);
  const trailingNewline = /[\r\n]$/.test(text);
  const cellData: Record<number, Record<number, ICellData>> = {};
  let columns = 0;
  records.forEach((record, r) => {
    const row: Record<number, ICellData> = {};
    record.fields.forEach((field, c) => {
      const cell = fieldCell(field);
      if (cell) row[c] = cell;
    });
    if (Object.keys(row).length) cellData[r] = row;
    columns = Math.max(columns, record.fields.length);
  });
  const data: IWorkbookData = {
    id: `workbook-${Math.random().toString(36).slice(2)}`,
    name,
    appVersion: '1.2.0',
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: name.replace(/\.[^.]+$/, '').slice(0, 31) || 'Sheet1',
        cellData,
        rowCount: Math.max(1000, records.length + 100),
        columnCount: Math.max(26, columns + 10),
        defaultColumnWidth: 88,
        defaultRowHeight: 20,
      },
    },
    resources: [],
  };
  return { data, source: { delimiter, newline, bom, rows: records.map((r) => ({ raw: r.raw, fields: r.fields })), trailingNewline } };
}

/** A cell's value as CSV text (formulas give their result; numbers in full). */
export function cellText(cell: ICellData | undefined | null): string {
  if (!cell) return '';
  const value = cell.p?.body?.dataStream !== undefined ? cell.p.body.dataStream.replace(/\r?\n$/, '') : cell.v;
  if (value === undefined || value === null) return '';
  if (cell.t === CellValueType.BOOLEAN) return value === 1 || value === true || String(value).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
  return String(value);
}

function quote(field: string, delimiter: string): string {
  return /["\r\n]/.test(field) || field.includes(delimiter) || /^\s|\s$/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** The first sheet as CSV, keeping unchanged lines as they were written. */
export function writeCsv(source: CsvSource | null, baseline: IWorkbookData | null, current: IWorkbookData): Uint8Array {
  const delimiter = source?.delimiter ?? ',';
  const newline = source?.newline ?? '\r\n';
  const sheetId = current.sheetOrder[0]!;
  const cells = current.sheets[sheetId]?.cellData ?? {};
  const before = baseline?.sheets[sheetId]?.cellData ?? {};
  const rows = Math.max(-1, ...Object.keys(cells).map(Number)) + 1;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row = cells[r] ?? {};
    const original = source?.rows[r];
    const same =
      original &&
      baseline &&
      Object.keys({ ...row, ...(before[r] ?? {}) }).every((c) => cellText(row[Number(c)]) === cellText(before[r]?.[Number(c)]));
    if (same) {
      lines.push(original.raw);
      continue;
    }
    const width = Math.max(-1, ...Object.keys(row).map(Number)) + 1;
    const fields: string[] = [];
    for (let c = 0; c < width; c++) {
      // A field that didn't change keeps its text (1e5 stays 1e5).
      const kept = baseline && original?.fields[c] !== undefined && cellText(row[c]) === cellText(before[r]?.[c]);
      fields.push(quote(kept ? original!.fields[c]! : cellText(row[c]), delimiter));
    }
    lines.push(fields.join(delimiter));
  }
  let text = lines.join(newline);
  if (source?.trailingNewline !== false && lines.length) text += newline;
  const body = new TextEncoder().encode(text);
  if (source?.bom === 'utf16le') {
    const out = new Uint8Array(2 + text.length * 2);
    out[0] = 0xff;
    out[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      out[2 + i * 2] = code & 0xff;
      out[3 + i * 2] = code >> 8;
    }
    return out;
  }
  if (source?.bom === 'utf8') return new Uint8Array([0xef, 0xbb, 0xbf, ...body]);
  return body;
}
