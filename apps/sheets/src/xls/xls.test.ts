import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readWorkbook } from '../xlsx/read';
import { writeWorkbook } from '../xlsx/write';
import { BLANK_WORKBOOK } from '../xlsx/read';
import { readXls } from './biff';
import { XlsError } from './cfb';

// Made by LibreOffice from tools/fixtures/make-xlsx.mjs's sample (Excel 97 format).
// (Tests run from the repository root.)
const SAMPLE = new Uint8Array(readFileSync(resolve('fixtures/sheets/sample.xls')));

describe('.xls (Excel 97-2003)', () => {
  it('reads every value and formula SheetJS reads', () => {
    const { data, skippedFormulas } = readXls(SAMPLE, 'sample.xls');
    expect(skippedFormulas).toBe(0);
    const other = XLSX.read(SAMPLE, { type: 'array', cellFormula: true });
    expect(data.sheetOrder.map((id) => data.sheets[id]!.name)).toEqual(other.SheetNames);
    let checked = 0;
    data.sheetOrder.forEach((id, index) => {
      const sheet = other.Sheets[other.SheetNames[index]!]!;
      const cells = data.sheets[id]!.cellData!;
      for (const [ref, cell] of Object.entries(sheet)) {
        if (ref.startsWith('!')) continue;
        const { r, c } = XLSX.utils.decode_cell(ref);
        const mine = cells[r]?.[c];
        const theirs = cell as XLSX.CellObject;
        if (theirs.t === 'e') expect(mine?.v).toBe(theirs.w);
        else if (theirs.t === 'b') expect(mine?.v).toBe(theirs.v ? 1 : 0);
        else if (theirs.v !== undefined && theirs.t !== 'z') expect(mine?.v).toEqual(theirs.v);
        if (theirs.f) expect(mine?.f).toBe(`=${theirs.f}`);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(30);
  });

  it('reads formats, merges, sizes and hidden rows', () => {
    const { data } = readXls(SAMPLE, 'sample.xls');
    const sheet = data.sheets.s0!;
    expect(sheet.mergeData).toEqual([{ startRow: 4, endRow: 5, startColumn: 3, endColumn: 4 }]);
    expect(sheet.rowData![0]).toMatchObject({ h: 28 });
    expect(sheet.rowData![3]).toMatchObject({ hd: 1 });
    expect(sheet.columnData![0]!.w).toBe(131);
    const header = data.styles[sheet.cellData![0]![0]!.s as string]!;
    expect(header).toMatchObject({ bl: 1, bd: { b: { s: 8 } } });
    expect(header.bg?.rgb).toMatch(/^#/);
    expect(data.styles[sheet.cellData![1]![1]!.s as string]!.n?.pattern).toContain('#,##0.00');
    expect(data.styles[sheet.cellData![1]![3]!.s as string]!.n?.pattern).toMatch(/[dmy]/i);
  });

  it('saves as a new .xlsx that keeps values, formulas and formats', () => {
    const { data } = readXls(SAMPLE, 'sample.xls');
    const blank = readWorkbook(BLANK_WORKBOOK(), 'sample.xlsx', data.sheetOrder.slice(0, 1));
    const out = writeWorkbook(blank.book, blank.data, data);
    const wb = XLSX.read(out, { type: 'array', cellFormula: true, cellStyles: true });
    expect(wb.SheetNames).toEqual(['Data', 'Notes', 'Report']);
    expect(wb.Sheets.Data!.B2!.v).toBe(1200.5);
    expect(wb.Sheets.Data!.C3!.f).toBe('B3*2');
    expect(wb.Sheets.Data!.B6!.f).toBe('SUM(B2:B5)');
    expect(wb.Sheets.Data!['!merges']).toEqual([{ s: { r: 4, c: 3 }, e: { r: 5, c: 4 } }]);
    expect(wb.Sheets.Data!.B2!.z).toContain('#,##0.00');
    const again = readWorkbook(out, 'sample.xlsx');
    expect(again.data.sheets.s0!.cellData![0]![0]).toMatchObject({ v: 'Region' });
    expect(again.data.styles[again.data.sheets.s0!.cellData![0]![0]!.s as string]).toMatchObject({ bl: 1 });
  });

  it('refuses files that aren\'t BIFF8 workbooks', () => {
    expect(() => readXls(new Uint8Array(512), 'x.xls')).toThrow(XlsError);
    const truncated = SAMPLE.slice(0, 1024);
    expect(() => readXls(truncated, 'x.xls')).toThrow();
  });
});
