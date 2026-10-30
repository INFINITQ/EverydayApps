// A1 references: columns, cells, ranges and sqref lists (0-based rows and columns inside).

export type Range = { startRow: number; startColumn: number; endRow: number; endColumn: number };

export const MAX_ROWS = 1_048_576;
export const MAX_COLUMNS = 16_384;

export function columnName(column: number): string {
  let name = '';
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

export function columnIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const cellName = (row: number, column: number) => `${columnName(column)}${row + 1}`;

/** "B3" or "$B$3" -> { row: 2, column: 1 }; undefined if it isn't a cell reference. */
export function parseCell(ref: string): { row: number; column: number } | undefined {
  const match = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})$/.exec(ref.trim());
  if (!match) return undefined;
  const row = Number(match[2]) - 1;
  const column = columnIndex(match[1]!);
  if (row < 0 || row >= MAX_ROWS || column < 0 || column >= MAX_COLUMNS) return undefined;
  return { row, column };
}

/** "A1:C3", "A1", "A:C" or "2:4" -> a range; undefined if it isn't one. */
export function parseRange(ref: string): Range | undefined {
  const [a = '', b = a] = ref.trim().split(':');
  const start = parseCell(a);
  const end = parseCell(b);
  if (start && end) {
    return {
      startRow: Math.min(start.row, end.row),
      startColumn: Math.min(start.column, end.column),
      endRow: Math.max(start.row, end.row),
      endColumn: Math.max(start.column, end.column),
    };
  }
  const columns = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(ref.trim());
  if (columns) {
    const x = columnIndex(columns[1]!);
    const y = columnIndex(columns[2]!);
    return { startRow: 0, endRow: MAX_ROWS - 1, startColumn: Math.min(x, y), endColumn: Math.max(x, y) };
  }
  const rows = /^\$?([0-9]{1,7}):\$?([0-9]{1,7})$/.exec(ref.trim());
  if (rows) {
    const x = Number(rows[1]) - 1;
    const y = Number(rows[2]) - 1;
    return { startColumn: 0, endColumn: MAX_COLUMNS - 1, startRow: Math.min(x, y), endRow: Math.max(x, y) };
  }
  return undefined;
}

export function rangeName(range: Range): string {
  const start = cellName(range.startRow, range.startColumn);
  const end = cellName(range.endRow, range.endColumn);
  return start === end ? start : `${start}:${end}`;
}

/** "A1:B2 D4" -> ranges (sqref lists are space-separated). */
export const parseSqref = (sqref: string): Range[] =>
  sqref
    .split(/\s+/)
    .filter(Boolean)
    .map(parseRange)
    .filter((r): r is Range => r !== undefined);

export const sqrefOf = (ranges: Range[]) => ranges.map(rangeName).join(' ');

export const intersects = (a: Range, b: Range) =>
  a.startRow <= b.endRow && b.startRow <= a.endRow && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn;

/** A sheet name as formulas write it: quoted when it isn't a plain word. */
export function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !parseCell(name) && !/^(R|C)\d*$/i.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}
