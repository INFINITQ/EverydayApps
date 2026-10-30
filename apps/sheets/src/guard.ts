// Places in a workbook that Folio carries over without being able to update them: pivot
// tables (where they are and the data they read), tables and the ranges charts plot. Inserting,
// deleting or moving rows and columns before or through them would leave them pointing at the
// wrong cells, so Folio asks first.

import { REL } from './xlsx/opc';
import type { SourceBook } from './xlsx/read';
import { type Range, parseRange } from './xlsx/refs';

export type Region = { sheetId: string; range: Range; what: string };

/** "'My Sheet'!$A$1:$B$5" -> sheet name and range. */
function sheetRef(ref: string): { sheet: string; range: Range } | null {
  const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(ref.trim());
  if (!match) return null;
  const range = parseRange(match[3]!.replace(/\$/g, ''));
  return range ? { sheet: (match[1] ?? match[2]!).replace(/''/g, "'"), range } : null;
}

export function protectedRegions(book: SourceBook): Region[] {
  const regions: Region[] = [];
  const idOf = (name: string) => book.sheets.find((s) => s.name === name)?.id;
  for (const pivot of book.features.pivotTables) {
    if (pivot.location) regions.push({ sheetId: pivot.sheet, range: pivot.location, what: `the pivot table ${pivot.name}` });
  }
  for (const table of book.features.tables) {
    if (table.ref) regions.push({ sheetId: table.sheet, range: table.ref, what: `the table ${table.name}` });
  }
  for (const rel of book.pkg.relsOfType(book.workbookPart, REL.pivotCacheDefinition)) {
    const part = book.pkg.target(book.workbookPart, rel);
    const source = part ? book.pkg.xml(part)?.path('cacheSource/worksheetSource') : undefined;
    const sheet = source?.attr('sheet');
    const range = parseRange(source?.attr('ref') ?? '');
    const id = sheet ? idOf(sheet) : undefined;
    if (id && range) regions.push({ sheetId: id, range, what: 'the data a pivot table reads' });
  }
  for (const chart of book.features.charts) {
    const text = book.pkg.text(chart.part) ?? '';
    for (const match of text.matchAll(/<(?:\w+:)?f>([^<]+)<\/(?:\w+:)?f>/g)) {
      for (const piece of match[1]!.replace(/^\(|\)$/g, '').split(',')) {
        const ref = sheetRef(piece.replace(/&apos;/g, "'"));
        const id = ref ? idOf(ref.sheet) : undefined;
        if (ref && id) regions.push({ sheetId: id, range: ref.range, what: "a chart's data" });
      }
    }
  }
  return regions;
}

export type Structural = { sheetId: string; rows?: number; columns?: number };

/** What a structural command touches: from which row or column on things move. */
export function structuralChange(id: string, params: Record<string, unknown> | undefined, sheetId: string, selection: Range | undefined): Structural | null {
  const range = (params?.range as Range | undefined) ?? selection;
  const sheet = (params?.subUnitId as string | undefined) ?? sheetId;
  switch (id) {
    case 'sheet.command.insert-row':
    case 'sheet.command.remove-row':
    case 'sheet.command.insert-range-move-down':
    case 'sheet.command.delete-range-move-up':
      return range ? { sheetId: sheet, rows: range.startRow } : null;
    case 'sheet.command.insert-col':
    case 'sheet.command.remove-col':
    case 'sheet.command.insert-range-move-right':
    case 'sheet.command.delete-range-move-left':
      return range ? { sheetId: sheet, columns: range.startColumn } : null;
    case 'sheet.command.move-rows': {
      const from = (params?.fromRange as Range | undefined)?.startRow;
      const to = (params?.toRange as Range | undefined)?.startRow;
      return from !== undefined && to !== undefined ? { sheetId: sheet, rows: Math.min(from, to) } : null;
    }
    case 'sheet.command.move-cols': {
      const from = (params?.fromRange as Range | undefined)?.startColumn;
      const to = (params?.toRange as Range | undefined)?.startColumn;
      return from !== undefined && to !== undefined ? { sheetId: sheet, columns: Math.min(from, to) } : null;
    }
    default:
      return null;
  }
}

/** The regions a change would move or resize (on the same sheet, at or after the change). */
export function affected(regions: Region[], change: Structural): Region[] {
  return regions.filter(
    (r) =>
      r.sheetId === change.sheetId &&
      ((change.rows !== undefined && r.range.endRow >= change.rows) || (change.columns !== undefined && r.range.endColumn >= change.columns)),
  );
}
