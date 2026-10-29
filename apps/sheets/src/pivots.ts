// Pivot tables: Folio shows them as their cells were last saved, keeps their definitions and
// caches byte for byte, and can refresh simple ones (one row field; sum, count, average,
// minimum or maximum values): their cells are recomputed from the source data, and the cache
// is marked to refresh when Excel opens the file, so Excel rebuilds it the same way.

import type { ICellData, IWorkbookData } from '@univerjs/core';
import { REL } from './xlsx/opc';
import type { SourceBook } from './xlsx/read';
import { type Range, parseRange } from './xlsx/refs';

export type Aggregate = 'sum' | 'count' | 'average' | 'max' | 'min' | 'countNums';

export type Pivot = {
  name: string;
  sheetId: string;
  location: Range;
  firstDataRow: number;
  firstDataCol: number;
  cachePart: string;
  source: { sheet: string; range: Range } | null;
  /** The row field's column in the source (by its name in the header row). */
  rowField: string | null;
  dataFields: { field: string; aggregate: Aggregate }[];
  /** Why Folio can't refresh it, if it can't. */
  unsupported?: string;
};

export function readPivots(book: SourceBook): Pivot[] {
  const pivots: Pivot[] = [];
  const caches = new Map<string, string>();
  for (const el of book.workbook.child('pivotCaches')?.elements('pivotCache') ?? []) {
    const part = book.pkg.target(book.workbookPart, book.pkg.relById(book.workbookPart, el.attr('r:id')));
    if (part) caches.set(el.attr('cacheId') ?? '', part);
  }
  for (const found of book.features.pivotTables) {
    const root = book.pkg.xml(found.part);
    if (!root || !found.location) continue;
    const cacheRel = book.pkg.relsOfType(found.part, REL.pivotCacheDefinition)[0];
    const cachePart = book.pkg.target(found.part, cacheRel) ?? caches.get(root.attr('cacheId') ?? '') ?? '';
    const cache = cachePart ? book.pkg.xml(cachePart) : undefined;
    const fields = cache?.child('cacheFields')?.elements('cacheField').map((f) => f.attr('name') ?? '') ?? [];
    const worksheet = cache?.path('cacheSource/worksheetSource');
    const sourceRange = parseRange(worksheet?.attr('ref') ?? '');
    const location = root.child('location');
    const pivot: Pivot = {
      name: found.name,
      sheetId: found.sheet,
      location: found.location,
      firstDataRow: Number(location?.attr('firstDataRow') ?? 1),
      firstDataCol: Number(location?.attr('firstDataCol') ?? 1),
      cachePart,
      source: worksheet?.attr('sheet') && sourceRange ? { sheet: worksheet.attr('sheet')!, range: sourceRange } : null,
      rowField: null,
      dataFields: [],
    };
    const rowFields = root.child('rowFields')?.elements('field').map((f) => Number(f.attr('x'))) ?? [];
    const colFields = (root.child('colFields')?.elements('field') ?? []).map((f) => Number(f.attr('x'))).filter((x) => x !== -2);
    const pageFields = root.child('pageFields')?.elements('pageField') ?? [];
    if (!pivot.source) pivot.unsupported = 'its data comes from outside the workbook';
    else if (rowFields.length !== 1 || rowFields[0]! < 0) pivot.unsupported = 'it has more than one row field';
    else if (colFields.length) pivot.unsupported = 'it has column fields';
    else if (pageFields.length) pivot.unsupported = 'it has filters';
    pivot.rowField = fields[rowFields[0] ?? -1] ?? null;
    for (const df of root.child('dataFields')?.elements('dataField') ?? []) {
      const aggregate = (df.attr('subtotal') ?? 'sum') as Aggregate;
      if (!['sum', 'count', 'average', 'max', 'min', 'countNums'].includes(aggregate)) pivot.unsupported ??= `it uses ${aggregate} values`;
      pivot.dataFields.push({ field: fields[Number(df.attr('fld'))] ?? '', aggregate });
    }
    if (pivot.dataFields.length === 0) pivot.unsupported ??= 'it has no values';
    pivots.push(pivot);
  }
  return pivots;
}

type Cells = IWorkbookData['sheets'][string]['cellData'];

/**
 * The pivot's cells recomputed from `data`: a matrix starting at its location's top-left cell,
 * with labels and values in the rows below the header (the header row stays as it is), then the
 * grand total. Rows the pivot no longer needs are cleared. Null if it can't be refreshed.
 */
export function refreshPivot(pivot: Pivot, data: IWorkbookData): { range: Range; values: Record<number, Record<number, ICellData | null>> } | null {
  if (pivot.unsupported || !pivot.source) return null;
  const sourceSheet = Object.values(data.sheets).find((s) => s?.name === pivot.source!.sheet);
  const target = data.sheets[pivot.sheetId];
  if (!sourceSheet || !target) return null;
  const cells = (sourceSheet.cellData ?? {}) as NonNullable<Cells>;
  const { range } = pivot.source;
  const header: string[] = [];
  for (let c = range.startColumn; c <= range.endColumn; c++) header.push(String(cells[range.startRow]?.[c]?.v ?? ''));
  const rowColumn = header.indexOf(pivot.rowField ?? '');
  const valueColumns = pivot.dataFields.map((d) => header.indexOf(d.field));
  if (rowColumn < 0 || valueColumns.some((c) => c < 0)) return null;

  // Group the source rows by the row field (in order of first appearance, like a new cache).
  const groups = new Map<string, { label: ICellData['v']; rows: number[] }>();
  const all: number[] = [];
  for (let r = range.startRow + 1; r <= range.endRow; r++) {
    const label = cells[r]?.[range.startColumn + rowColumn]?.v;
    if (label === undefined || label === null || label === '') continue;
    const key = String(label);
    if (!groups.has(key)) groups.set(key, { label, rows: [] });
    groups.get(key)!.rows.push(r);
    all.push(r);
  }
  const aggregate = (rows: number[], column: number, kind: Aggregate): number => {
    const values = rows.map((r) => cells[r]?.[range.startColumn + column]?.v);
    const numbers = values.filter((v): v is number => typeof v === 'number');
    switch (kind) {
      case 'count':
        return values.filter((v) => v !== undefined && v !== null && v !== '').length;
      case 'countNums':
        return numbers.length;
      case 'average':
        return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
      case 'max':
        return numbers.length ? Math.max(...numbers) : 0;
      case 'min':
        return numbers.length ? Math.min(...numbers) : 0;
      default:
        return numbers.reduce((a, b) => a + b, 0);
    }
  };

  const { location, firstDataRow, firstDataCol } = pivot;
  const values: Record<number, Record<number, ICellData | null>> = {};
  const existing = (target.cellData ?? {}) as NonNullable<Cells>;
  const put = (r: number, c: number, v: ICellData['v']) => {
    const keep = existing[r]?.[c];
    (values[r] ??= {})[c] = { ...(keep?.s ? { s: keep.s } : {}), v, t: typeof v === 'number' ? 2 : 1 };
  };
  let row = location.startRow + firstDataRow;
  const labelColumn = location.startColumn;
  for (const group of groups.values()) {
    put(row, labelColumn, group.label);
    pivot.dataFields.forEach((d, i) => put(row, location.startColumn + firstDataCol + i, aggregate(group.rows, valueColumns[i]!, d.aggregate)));
    row++;
  }
  put(row, labelColumn, 'Grand Total');
  pivot.dataFields.forEach((d, i) => put(row, location.startColumn + firstDataCol + i, aggregate(all, valueColumns[i]!, d.aggregate)));
  const end = Math.max(row, location.endRow);
  for (let r = row + 1; r <= end; r++) {
    for (let c = location.startColumn; c <= location.endColumn; c++) (values[r] ??= {})[c] = null;
  }
  return {
    range: { startRow: location.startRow + firstDataRow, endRow: end, startColumn: location.startColumn, endColumn: Math.max(location.endColumn, location.startColumn + firstDataCol + pivot.dataFields.length - 1) },
    values,
  };
}
