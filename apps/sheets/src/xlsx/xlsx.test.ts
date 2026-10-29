import { CellValueType, type ICellData, type IWorkbookData } from '@univerjs/core';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
// @ts-expect-error plain ES module without types
import { makeMinimalXlsx, makeXlsx, zip } from '../../../../tools/fixtures/make-xlsx.mjs';
import { RESOURCE } from './features';
import { readWorkbook } from './read';
import { writeWorkbook } from './write';
import { parseXml } from './xml';
import { ZipError, readZip } from './zip';

const clone = <T>(value: T): T => structuredClone(value);
const parts = (bytes: Uint8Array) => unzipSync(bytes);
const text = (bytes: Uint8Array, name: string) => new TextDecoder().decode(parts(bytes)[name]);
const sheetJs = (bytes: Uint8Array) => XLSX.read(bytes, { type: 'array', cellFormula: true, cellStyles: true, cellNF: true });

/** Parts that differ between two packages (by content), plus added and removed ones. */
function changedParts(before: Uint8Array, after: Uint8Array) {
  const a = parts(before);
  const b = parts(after);
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names]
    .filter((name) => !a[name] || !b[name] || Buffer.compare(Buffer.from(a[name]!), Buffer.from(b[name]!)) !== 0)
    .sort();
}

function open(bytes: Uint8Array = makeXlsx()) {
  const { data, book } = readWorkbook(bytes, 'sample.xlsx');
  const edited = clone(data);
  const sheet = (name: string) => Object.values(edited.sheets).find((s) => s.name === name)!;
  const save = () => writeWorkbook(book, data, edited);
  return { bytes, data, book, edited, sheet, save };
}

describe('reading', () => {
  it('turns values, formulas and formats into the Univer workbook', () => {
    const { data } = open();
    expect(data.sheetOrder.map((id) => data.sheets[id]!.name)).toEqual(['Data', 'Notes', 'Report']);
    const cells = data.sheets.s0!.cellData!;
    expect(cells[0]![0]).toMatchObject({ v: 'Region', t: CellValueType.STRING, s: 'x1' });
    expect(cells[0]![2]).toMatchObject({ v: 'Doubled' });
    expect(cells[0]![4]).toMatchObject({ v: 'Rich text here' });
    expect(cells[1]![1]).toMatchObject({ v: 1200.5, t: CellValueType.NUMBER, s: 'x2' });
    expect(cells[1]![2]).toMatchObject({ f: '=B2*2', si: 's0-0', v: 2401 });
    expect(cells[2]![2]).toMatchObject({ si: 's0-0', v: 1900 });
    expect(cells[2]![2]!.f).toBeUndefined();
    expect(cells[1]![4]).toMatchObject({ v: 1, t: CellValueType.BOOLEAN });
    expect(cells[2]![4]).toMatchObject({ v: '#N/A' });
    expect(cells[5]![2]).toMatchObject({ f: '=XLOOKUP("East",A2:A5,C2:C5)' });
    expect(cells[6]![0]).toMatchObject({ f: '=ROW(B1:B2)', ft: 2, ref: 'A7:A8' });
    expect(data.styles.x1).toMatchObject({ bl: 1, bd: { b: { s: 8, cl: { rgb: '#0000FF' } } } });
    expect(data.styles.x1!.bg?.rgb).toMatch(/^#[0-9A-F]{6}$/);
    expect(data.styles.x2).toMatchObject({ n: { pattern: '"$"#,##0.00' } });
    expect(data.styles.x4).toMatchObject({ it: 1, fs: 14, ff: 'Arial', cl: { rgb: '#FF0000' }, ht: 2, vt: 1, tb: 3 });
    const sheet = data.sheets.s0!;
    expect(sheet.mergeData).toEqual([{ startRow: 4, startColumn: 3, endRow: 5, endColumn: 4 }]);
    expect(sheet.freeze).toMatchObject({ ySplit: 1, startRow: 1 });
    expect(sheet.rowData![3]).toMatchObject({ hd: 1 });
    expect(sheet.rowData![0]).toMatchObject({ h: 28 });
    expect(sheet.columnData![0]!.w).toBe(131);
    expect(sheet.tabColor).toBe('#00B050');
  });

  it('notes what it keeps without showing it', () => {
    const { book } = open(makeXlsx({ macros: true }));
    expect(book.kind).toBe('xlsm');
    expect(book.features.macros).toBe(true);
    expect(book.features.pivotTables).toHaveLength(1);
    expect(book.features.charts).toHaveLength(1);
    expect(book.features.externalLinks).toBe(1);
  });

  it('refuses document type definitions and impossible sizes', () => {
    const bomb = zip({ '[Content_Types].xml': '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><Types/>' });
    expect(() => readWorkbook(bomb, 'x.xlsx')).toThrow(/document type definition/);
    // A part that claims to inflate far beyond what deflate can do.
    const liar = zip({ 'a.xml': 'x'.repeat(1000) });
    const view = new DataView(liar.buffer);
    const central = liar.length - 22 - 46 - 5;
    view.setUint32(central + 24, 900_000_000, true);
    expect(() => readZip(liar)).toThrow(ZipError);
  });
});

describe('saving', () => {
  it('gives back the original bytes when nothing changed', () => {
    const { bytes, save } = open();
    expect(save()).toBe(bytes);
  });

  it('patches only the edited sheet and carries everything else byte for byte', () => {
    const { bytes, sheet, save } = open(makeXlsx({ macros: true }));
    sheet('Notes').cellData![1]![1] = { v: 99, t: CellValueType.NUMBER };
    const out = save();
    expect(changedParts(bytes, out)).toEqual(['xl/worksheets/sheet2.xml']);
    const wb = sheetJs(out);
    expect(wb.Sheets.Notes!.B2!.v).toBe(99);
    expect(wb.Sheets.Notes!.B3!.v).toBe(30);
    expect(wb.Sheets.Data!.B2!.v).toBe(1200.5);
    // Only the edited row was rewritten.
    const before = text(bytes, 'xl/worksheets/sheet2.xml');
    const after = text(out, 'xl/worksheets/sheet2.xml');
    expect(after.replace('<c r="B2"><v>99</v></c>', '<c r="B2"><v>20</v></c>')).toBe(before);
  });

  it('adds new text to the shared strings and keeps unchanged rows as written', () => {
    const { bytes, sheet, save } = open();
    sheet('Data').cellData![1]![0] = { v: 'Northwest', t: CellValueType.STRING };
    const out = save();
    expect(changedParts(bytes, out)).toEqual(['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
    expect(sheetJs(out).Sheets.Data!.A2!.v).toBe('Northwest');
    const sst = text(out, 'xl/sharedStrings.xml');
    expect(sst).toContain('<si><t>Northwest</t></si></sst>');
    expect(sst).toContain('uniqueCount="10"');
    const row3 = /<row r="3"[\s\S]*?<\/row>/.exec(text(bytes, 'xl/worksheets/sheet1.xml'))![0];
    expect(text(out, 'xl/worksheets/sheet1.xml')).toContain(row3);
  });

  it('recalculates on open and drops calcChain when formulas change', () => {
    const { bytes, sheet, save } = open();
    const data = sheet('Data');
    data.cellData![1]![1] = { ...data.cellData![1]![1], v: 2000 };
    data.cellData![5]![1] = { ...data.cellData![5]![1], v: 4750.25 };
    data.cellData![7]![2] = { f: '=SUM(B2:B5)*2', v: 9500.5, t: CellValueType.NUMBER };
    const out = save();
    expect(changedParts(bytes, out)).toEqual([
      '[Content_Types].xml',
      'xl/_rels/workbook.xml.rels',
      'xl/calcChain.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(parts(out)['xl/calcChain.xml']).toBeUndefined();
    expect(text(out, 'xl/workbook.xml')).toContain('<calcPr calcId="191029" fullCalcOnLoad="1"/>');
    const wb = sheetJs(out);
    expect(wb.Sheets.Data!.C8).toMatchObject({ f: 'SUM(B2:B5)*2', v: 9500.5 });
    expect(wb.Sheets.Data!.B6).toMatchObject({ f: 'SUM(B2:B5)', v: 4750.25 });
    // The shared formula group and the XLOOKUP prefix are untouched.
    const xml = text(out, 'xl/worksheets/sheet1.xml');
    expect(xml).toContain('<f t="shared" ref="C2:C5" si="0">B2*2</f>');
    expect(xml).toContain('<f>_xlfn.XLOOKUP("East",A2:A5,C2:C5)</f>');
  });

  it('writes a broken shared formula group out cell by cell', () => {
    const { sheet, save } = open();
    const data = sheet('Data');
    data.cellData![1]![2] = { f: '=B2*3', v: 3601.5, t: CellValueType.NUMBER, s: 'x2' };
    const xml = text(save(), 'xl/worksheets/sheet1.xml');
    expect(xml).not.toContain('t="shared"');
    expect(xml).toContain('<c r="C2" s="2"><f>B2*3</f><v>3601.5</v></c>');
    // Children keep the master's original formula, moved to their row.
    expect(xml).toContain('<c r="C3" s="2"><f>B3*2</f><v>1900</v></c>');
    expect(xml).toContain('<c r="C5" s="2"><f>B5*2</f><v>2200</v></c>');
  });

  it('appends changed formats, derived from the cell format they replace', () => {
    const { bytes, data, sheet, save } = open();
    const cell = sheet('Data').cellData![1]![1] as ICellData;
    sheet('Data').cellData![1]![1] = { ...cell, s: { ...data.styles.x2, bl: 1 } };
    const out = save();
    expect(changedParts(bytes, out)).toEqual(['xl/styles.xml', 'xl/worksheets/sheet1.xml']);
    const styles = parseXml(text(out, 'xl/styles.xml'));
    const xfs = styles.child('cellXfs')!.elements('xf');
    expect(xfs).toHaveLength(7);
    expect(styles.child('cellXfs')!.attr('count')).toBe('7');
    const added = xfs[6]!;
    expect(added.attr('numFmtId')).toBe('164');
    const font = styles.child('fonts')!.elements('font')[Number(added.attr('fontId'))]!;
    expect(font.child('b')).toBeDefined();
    expect(font.child('color')!.attr('theme')).toBe('1');
    // The original formats are unchanged, byte for byte.
    const before = text(bytes, 'xl/styles.xml');
    const after = text(out, 'xl/styles.xml');
    const firstXfs = /<cellXfs count="6">([\s\S]*?)<\/cellXfs>/.exec(before)![1]!;
    expect(after).toContain(firstXfs);
    expect(sheetJs(out).Sheets.Data!.B2!.v).toBe(1200.5);
  });

  it('saves sheets added, renamed, moved and deleted', () => {
    const { bytes, edited, sheet, save } = open();
    sheet('Data').name = 'Sales Data';
    edited.sheets.new1 = { id: 'new1', name: 'Summary', cellData: { 0: { 0: { v: 'Hello', t: CellValueType.STRING } } } };
    edited.sheetOrder = ['s1', 's0', 'new1'];
    delete edited.sheets.s2;
    const out = save();
    const wb = sheetJs(out);
    expect(wb.SheetNames).toEqual(['Notes', 'Sales Data', 'Summary']);
    expect(wb.Sheets.Summary!.A1!.v).toBe('Hello');
    expect(wb.Sheets['Sales Data']!.B2!.v).toBe(1200.5);
    const workbook = text(out, 'xl/workbook.xml');
    expect(workbook).toContain('<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">');
    expect(workbook).toContain('<definedName name="SalesTotal">\'Sales Data\'!$B$6</definedName>');
    expect(workbook).toContain('localSheetId="1">\'Sales Data\'!$A$1:$E$8</definedName>');
    // The deleted sheet's drawing, chart, picture and pivot table went with it; the pivot
    // cache (the workbook's) stayed.
    const names = Object.keys(parts(out));
    expect(names).not.toContain('xl/worksheets/sheet3.xml');
    expect(names).not.toContain('xl/charts/chart1.xml');
    expect(names).toContain('xl/pivotCache/pivotCacheDefinition1.xml');
    expect(text(out, 'xl/pivotCache/pivotCacheDefinition1.xml')).toContain('sheet="Sales Data"');
    expect(text(out, '[Content_Types].xml')).toContain('/xl/worksheets/sheet3.xml" ContentType'.replace('sheet3', 'sheet4'));
    expect(changedParts(bytes, out)).toContain('xl/worksheets/sheet4.xml');
  });

  it('updates chart references when a sheet is renamed', () => {
    const { sheet, save } = open();
    sheet('Data').name = 'Sales Data';
    const chart = text(save(), 'xl/charts/chart1.xml');
    expect(chart).toContain("<c:f>'Sales Data'!$A$2:$A$5</c:f>");
    expect(chart).not.toContain('<c:f>Data!');
  });

  it('saves merged cells, column widths, row heights, frozen panes and gridlines', () => {
    const { sheet, save } = open();
    const data = sheet('Data');
    data.mergeData = [{ startRow: 9, startColumn: 0, endRow: 9, endColumn: 2 }];
    data.columnData![0] = { w: 100 };
    data.rowData![1] = { h: 40 };
    data.freeze = { xSplit: 1, ySplit: 2, startRow: 2, startColumn: 1 };
    data.showGridlines = 0;
    const out = save();
    const xml = text(out, 'xl/worksheets/sheet1.xml');
    expect(xml).toContain('<mergeCells count="1"><mergeCell ref="A10:C10"/></mergeCells>');
    expect(xml).toContain('<col min="1" max="1" width="14.28515625" customWidth="1"/>');
    expect(xml).toContain('<pane xSplit="1" ySplit="2" topLeftCell="B3" activePane="bottomRight" state="frozen"/>');
    expect(xml).not.toContain('pane="bottomLeft"');
    expect(xml).toContain('<sheetView showGridLines="0" tabSelected="1" workbookViewId="0">');
    expect(xml).toMatch(/<row r="2"[^>]* ht="30" customHeight="1"[^>]*>/);
    const wb = sheetJs(out);
    expect(wb.Sheets.Data!['!merges']).toEqual([{ s: { r: 9, c: 0 }, e: { r: 9, c: 2 } }]);
    expect(wb.Sheets.Data!['!cols']![0]!.width).toBeCloseTo(14.29, 1);
  });

  it('keeps the macros of an .xlsm byte for byte', () => {
    const { bytes, sheet, save } = open(makeXlsx({ macros: true }));
    sheet('Data').cellData![0]![0] = { v: 'Area', t: CellValueType.STRING, s: 'x1' };
    const out = save();
    expect(parts(out)['xl/vbaProject.bin']).toEqual(parts(bytes)['xl/vbaProject.bin']);
    expect(text(out, '[Content_Types].xml')).toContain('macroEnabled.main+xml');
  });

  it('creates styles and strings for a workbook that had none', () => {
    const { sheet, data, save } = open(makeMinimalXlsx());
    expect(data.sheets.s0!.cellData![0]![0]).toMatchObject({ v: 1 });
    sheet('Sheet1').cellData![0]![1] = { v: 'bold', t: CellValueType.STRING, s: { bl: 1 } };
    const out = save();
    const wb = sheetJs(out);
    expect(wb.Sheets.Sheet1!.B1!.v).toBe('bold');
    expect(text(out, 'xl/styles.xml')).toContain('<b/>');
    expect(text(out, 'xl/_rels/workbook.xml.rels')).toContain('sharedStrings.xml');
    expect(text(out, '[Content_Types].xml')).toContain('/xl/sharedStrings.xml');
  });

  it('round-trips: a saved file reads back the same', () => {
    const { sheet, save } = open();
    sheet('Data').cellData![1]![1] = { v: 1234, t: CellValueType.NUMBER, s: 'x2' };
    const again = readWorkbook(save(), 'sample.xlsx').data as IWorkbookData;
    expect(again.sheets.s0!.cellData![1]![1]).toMatchObject({ v: 1234, s: 'x2' });
    expect(again.sheets.s0!.cellData![2]![2]).toMatchObject({ si: 's0-0', v: 1900 });
  });
});

describe('conditional formatting, validation and filters', () => {
  const resourceOf = (data: IWorkbookData, name: string) => JSON.parse(data.resources!.find((r) => r.name === name)!.data);
  const setResource = (data: IWorkbookData, name: string, value: unknown) => {
    data.resources!.find((r) => r.name === name)!.data = JSON.stringify(value);
  };

  it('reads them into Univer', () => {
    const { data } = open();
    const cf = resourceOf(data, RESOURCE.cf).s1;
    expect(cf).toHaveLength(1);
    expect(cf[0]).toMatchObject({ ranges: [{ startRow: 1, startColumn: 0, endRow: 2, endColumn: 0 }], rule: { type: 'highlightCell', subType: 'number', operator: 'greaterThan', value: 10 } });
    expect(cf[0].rule.style).toMatchObject({ bl: 1, cl: { rgb: '#9C0006' }, bg: { rgb: '#FFC7CE' } });
    const dv = resourceOf(data, RESOURCE.dv).s1;
    expect(dv[0]).toMatchObject({ type: 'list', formula1: 'Yes,No,Maybe', ranges: [{ startRow: 3, startColumn: 0 }], showDropDown: true, allowBlank: true });
    expect(resourceOf(data, RESOURCE.filter).s1).toMatchObject({ ref: { startRow: 0, startColumn: 0, endRow: 2, endColumn: 1 } });
  });

  it('writes back only the rules that changed, keeping the others as written', () => {
    const { bytes, edited, save } = open();
    const cf = resourceOf(edited, RESOURCE.cf);
    cf.s1.push({ cfId: 'new', ranges: [{ startRow: 0, startColumn: 1, endRow: 2, endColumn: 1 }], stopIfTrue: false, rule: { type: 'dataBar', isShowValue: true, config: { min: { type: 'min' }, max: { type: 'max' }, isGradient: true, positiveColor: '#638EC6', nativeColor: '#FF0000' } } });
    setResource(edited, RESOURCE.cf, cf);
    const dv = resourceOf(edited, RESOURCE.dv);
    dv.s1[0].formula1 = 'Yes,No';
    dv.s1.push({ uid: 'n', type: 'whole', operator: 'between', formula1: '1', formula2: '10', ranges: [{ startRow: 5, startColumn: 1, endRow: 5, endColumn: 1 }], showErrorMessage: true, errorStyle: 1 });
    setResource(edited, RESOURCE.dv, dv);
    const filter = resourceOf(edited, RESOURCE.filter);
    filter.s1.filterColumns = [{ colId: 1, customFilters: { customFilters: [{ operator: 'greaterThan', val: 15 }] } }];
    filter.s1.cachedFilteredOut = [1];
    setResource(edited, RESOURCE.filter, filter);
    const out = save();
    expect(changedParts(bytes, out)).toEqual(['xl/styles.xml', 'xl/worksheets/sheet2.xml'].filter((p) => p !== 'xl/styles.xml'));
    const xml = text(out, 'xl/worksheets/sheet2.xml');
    expect(xml).toContain('<conditionalFormatting sqref="A2:A3"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>10</formula></cfRule></conditionalFormatting>');
    expect(xml).toContain('<conditionalFormatting sqref="B1:B3"><cfRule type="dataBar" priority="2"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting>');
    expect(xml).toContain('<formula1>"Yes,No"</formula1>');
    expect(xml).toContain('<dataValidation type="whole" showErrorMessage="1" sqref="B6"><formula1>1</formula1><formula2>10</formula2></dataValidation>');
    expect(xml).toContain('<autoFilter ref="A1:B3"><filterColumn colId="1"><customFilters><customFilter operator="greaterThan" val="15"/></customFilters></filterColumn></autoFilter>');
    expect(xml).toMatch(/<row r="2" hidden="1">/);
    // Schema order: autoFilter, conditionalFormatting, dataValidations, hyperlinks.
    expect(xml.indexOf('<autoFilter')).toBeLessThan(xml.indexOf('<conditionalFormatting'));
    expect(xml.indexOf('<conditionalFormatting')).toBeLessThan(xml.indexOf('<dataValidations'));
    expect(xml.indexOf('<dataValidations')).toBeLessThan(xml.indexOf('<hyperlinks'));
    const wb = sheetJs(out);
    expect(wb.Sheets.Notes!.A2!.v).toBe(5);
  });
});

describe('comments and pictures', () => {
  const resourceOf = (data: IWorkbookData, name: string) => JSON.parse(data.resources!.find((r) => r.name === name)!.data);
  const setResource = (data: IWorkbookData, name: string, value: unknown) => {
    data.resources!.find((r) => r.name === name)!.data = JSON.stringify(value);
  };

  it('reads notes as comment threads and pictures as images', () => {
    const { data } = open();
    const [note] = resourceOf(data, RESOURCE.comments).s1;
    expect(note).toMatchObject({ ref: 'B1', authorName: 'Sam Sample', text: { dataStream: 'Sam Sample:\rCheck this number\r\n' } });
    const drawing = resourceOf(data, RESOURCE.drawings).s2;
    expect(drawing.order).toHaveLength(1);
    const image = drawing.data[drawing.order[0]];
    expect(image.source).toMatch(/^data:image\/png;base64,/);
    expect(image.sheetTransform.from).toEqual({ column: 0, columnOffset: 0, row: 8, rowOffset: 0 });
    expect(image.transform).toMatchObject({ width: 40, height: 40 });
  });

  it('saves changed notes with the VML that shows them', () => {
    const { bytes, edited, save } = open();
    const comments = resourceOf(edited, RESOURCE.comments);
    comments.s1[0].text.dataStream = 'Checked\r\n';
    comments.s0 = [{ id: 'n1', threadId: 'n1', ref: 'C2', dT: '', personId: 'Me', authorName: 'Me', text: { dataStream: 'Doubled\rvalue\r\n' }, unitId: edited.id, subUnitId: 's0', children: [] }];
    setResource(edited, RESOURCE.comments, comments);
    const out = save();
    const changed = changedParts(bytes, out);
    expect(changed).toEqual(expect.arrayContaining(['xl/comments1.xml', 'xl/comments2.xml', 'xl/drawings/vmlDrawing1.vml', 'xl/drawings/vmlDrawing2.vml', 'xl/worksheets/sheet1.xml']));
    expect(changed).not.toContain('xl/worksheets/sheet2.xml');
    expect(text(out, 'xl/comments1.xml')).toContain('<comment ref="B1" authorId="0"><text><r><t>Checked</t></r></text></comment>');
    expect(text(out, 'xl/comments2.xml')).toContain('<author>Me</author>');
    expect(text(out, 'xl/drawings/vmlDrawing2.vml')).toContain('<x:Row>1</x:Row><x:Column>2</x:Column>');
    expect(text(out, 'xl/worksheets/sheet1.xml')).toMatch(/<legacyDrawing r:id="rId\d+"\/><extLst>/);
    expect(text(out, '[Content_Types].xml')).toContain('/xl/comments2.xml');
    const wb = sheetJs(out);
    expect((wb.Sheets.Data!.C2 as { c?: { t: string }[] }).c?.[0]?.t).toBe('Doubled\nvalue');
    expect((wb.Sheets.Notes!.B1 as { c?: { t: string }[] }).c?.[0]?.t).toBe('Checked');
  });

  it('moves, deletes and adds pictures, keeping the chart in the same drawing as written', () => {
    const { bytes, edited, save } = open();
    const drawings = resourceOf(edited, RESOURCE.drawings);
    const id = drawings.s2.order[0];
    drawings.s2.data[id].sheetTransform.from = { column: 1, columnOffset: 5, row: 9, rowOffset: 0 };
    drawings.s2.data[id].sheetTransform.to = { column: 2, columnOffset: 0, row: 11, rowOffset: 0 };
    const png = drawings.s2.data[id].source;
    drawings.s0 = { order: ['new'], data: { new: { ...drawings.s2.data[id], drawingId: 'new', subUnitId: 's0', source: png } } };
    setResource(edited, RESOURCE.drawings, drawings);
    const out = save();
    const drawing = text(out, 'xl/drawings/drawing1.xml');
    expect(drawing).toContain('<xdr:from><xdr:col>1</xdr:col><xdr:colOff>47625</xdr:colOff><xdr:row>9</xdr:row>');
    const chartAnchor = /<xdr:twoCellAnchor><xdr:from><xdr:col>3[\s\S]*?<\/xdr:twoCellAnchor>/.exec(text(bytes, 'xl/drawings/drawing1.xml'))![0];
    expect(drawing).toContain(chartAnchor);
    expect(text(out, 'xl/worksheets/sheet1.xml')).toMatch(/<drawing r:id="rId\d+"\/>/);
    expect(Object.keys(parts(out))).toEqual(expect.arrayContaining(['xl/drawings/drawing2.xml', 'xl/media/image2.png']));

    // Deleting the picture removes its anchor only.
    const again = open();
    const d = resourceOf(again.edited, RESOURCE.drawings);
    d.s2 = { order: [], data: {} };
    setResource(again.edited, RESOURCE.drawings, d);
    const deleted = text(again.save(), 'xl/drawings/drawing1.xml');
    expect(deleted).not.toContain('<xdr:pic>');
    expect(deleted).toContain(chartAnchor);
  });
});
