// Generates test workbooks (.xlsx/.xlsm) the way Excel lays them out, with the parts Folio
// Sheets must edit (cells, formats, merges, panes) and the parts it must carry over untouched
// (a chart, a picture, a pivot table, macros, custom XML, an external link, calcChain).
// No real documents are involved: everything here is made up.
//
// Usage from tests: import { makeXlsx } from '../tools/fixtures/make-xlsx.mjs'.

import { deflateRawSync } from 'node:zlib';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

let crcTable;
function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip of `files` ({ name: string | Uint8Array }), deflated like Office does. */
export function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const deflated = deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, deflated);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(deflated.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += 30 + nameBytes.length + deflated.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, directory, end]));
}

const rels = (list) =>
  `${XML}<Relationships xmlns="${PKG}">${list
    .map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`;
const T = (name) => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${name}`;

/** A 4x4 red PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP8z8DwnwEJMKFzAEIVBAFI3kqdAAAAAElFTkSuQmCC',
  'base64',
);

const STRINGS = ['Region', 'Sales', 'North', 'South', 'East', 'West', 'Total', 'Rich text here', 'Notes'];

/**
 * The full sample: "Data" (values, formulas, formats, merges, panes), "Notes" (comment,
 * validation, conditional formatting, filter, hyperlink) and "Report" (chart, picture,
 * pivot table). `macros` makes it an .xlsm with a (dummy) VBA project.
 */
export function makeXlsx({ macros = false } = {}) {
  const sst = `${XML}<sst xmlns="${MAIN}" count="12" uniqueCount="${STRINGS.length}">${STRINGS.map((s, i) =>
    i === 7
      ? '<si><r><rPr><b/><sz val="11"/><color theme="1"/><rFont val="Calibri"/></rPr><t xml:space="preserve">Rich </t></r><r><rPr><i/><sz val="11"/><rFont val="Calibri"/></rPr><t>text here</t></r></si>'
      : `<si><t>${s}</t></si>`,
  ).join('')}</sst>`;

  const styles =
    `${XML}<styleSheet xmlns="${MAIN}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>' +
    '<fonts count="3" x14ac:knownFonts="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
    '<font><i/><sz val="14"/><color rgb="FFFF0000"/><name val="Arial"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.79998168889431442"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="medium"><color rgb="FF0000FF"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1" applyProtection="1"><alignment horizontal="center" vertical="top" wrapText="1"/><protection locked="0"/></xf>' +
    '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '<dxfs count="1"><dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs>' +
    '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>';

  const theme =
    `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office">` +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
    '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
    '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';

  // Data: a header row, four regions, a total with a shared formula column and an array formula.
  const data =
    `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${R}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">` +
    '<sheetPr><tabColor rgb="FF00B050"/></sheetPr><dimension ref="A1:E8"/>' +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="B3" sqref="B3"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/>' +
    '<cols><col min="1" max="1" width="18.7109375" customWidth="1"/><col min="2" max="3" width="12.7109375" style="2" customWidth="1"/></cols>' +
    '<sheetData>' +
    '<row r="1" spans="1:5" ht="21" customHeight="1" x14ac:dyDescent="0.25"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1" t="s"><v>1</v></c><c r="C1" s="1" t="inlineStr"><is><t>Doubled</t></is></c><c r="D1" s="1"/><c r="E1" t="s"><v>7</v></c></row>' +
    '<row r="2" spans="1:5" x14ac:dyDescent="0.25"><c r="A2" t="s"><v>2</v></c><c r="B2" s="2"><v>1200.5</v></c><c r="C2" s="2"><f t="shared" ref="C2:C5" si="0">B2*2</f><v>2401</v></c><c r="D2" s="3"><v>45292</v></c><c r="E2" t="b"><v>1</v></c></row>' +
    '<row r="3" spans="1:5" x14ac:dyDescent="0.25"><c r="A3" t="s"><v>3</v></c><c r="B3" s="2"><v>950</v></c><c r="C3" s="2"><f t="shared" si="0"/><v>1900</v></c><c r="D3" s="5"><v>0.25</v></c><c r="E3" t="e"><v>#N/A</v></c></row>' +
    '<row r="4" spans="1:5" hidden="1" x14ac:dyDescent="0.25"><c r="A4" t="s"><v>4</v></c><c r="B4" s="2"><v>700.25</v></c><c r="C4" s="2"><f t="shared" si="0"/><v>1400.5</v></c><c r="D4" s="4" t="s" ph="1"><v>8</v></c></row>' +
    '<row r="5" spans="1:5" x14ac:dyDescent="0.25"><c r="A5" t="s"><v>5</v></c><c r="B5" s="2"><v>1100</v></c><c r="C5" s="2"><f t="shared" si="0"/><v>2200</v></c></row>' +
    '<row r="6" spans="1:5" x14ac:dyDescent="0.25"><c r="A6" t="s"><v>6</v></c><c r="B6" s="2"><f>SUM(B2:B5)</f><v>3950.75</v></c><c r="C6" s="2"><f>_xlfn.XLOOKUP("East",A2:A5,C2:C5)</f><v>1400.5</v></c></row>' +
    '<row r="7" spans="1:5" x14ac:dyDescent="0.25"><c r="A7"><f t="array" ref="A7:A8">ROW(B1:B2)</f><v>1</v></c></row>' +
    '<row r="8" spans="1:5" x14ac:dyDescent="0.25"><c r="A8"><v>2</v></c><c r="B8" t="str"><f>A2&amp;"!"</f><v>North!</v></c></row>' +
    '</sheetData>' +
    '<mergeCells count="1"><mergeCell ref="D5:E6"/></mergeCells>' +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '<pageSetup paperSize="9" orientation="landscape" r:id="rId1"/>' +
    '<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:dataValidations count="0" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"/></ext></extLst>' +
    '</worksheet>';

  const notes =
    `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${R}"><dimension ref="A1:C4"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
    '<sheetData><row r="1"><c r="A1" t="s"><v>8</v></c><c r="B1"><v>10</v></c><c r="C1" t="inlineStr"><is><t>Folio</t></is></c></row>' +
    '<row r="2"><c r="A2"><v>5</v></c><c r="B2"><v>20</v></c></row><row r="3"><c r="A3"><v>15</v></c><c r="B3"><v>30</v></c></row>' +
    '<row r="4"><c r="A4" t="inlineStr"><is><t>Yes</t></is></c></row></sheetData>' +
    '<autoFilter ref="A1:B3"/>' +
    '<conditionalFormatting sqref="A2:A3"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>10</formula></cfRule></conditionalFormatting>' +
    '<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="A4"><formula1>"Yes,No,Maybe"</formula1></dataValidation></dataValidations>' +
    '<hyperlinks><hyperlink ref="C1" r:id="rId3"/></hyperlinks>' +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><legacyDrawing r:id="rId2"/></worksheet>';

  const report =
    `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${R}"><dimension ref="A3:B6"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
    '<sheetData><row r="3"><c r="A3" t="inlineStr"><is><t>Row Labels</t></is></c><c r="B3" t="inlineStr"><is><t>Sum of Sales</t></is></c></row>' +
    '<row r="4"><c r="A4" t="inlineStr"><is><t>North</t></is></c><c r="B4"><v>1200.5</v></c></row>' +
    '<row r="5"><c r="A5" t="inlineStr"><is><t>South</t></is></c><c r="B5"><v>950</v></c></row>' +
    '<row r="6"><c r="A6" t="inlineStr"><is><t>Grand Total</t></is></c><c r="B6"><v>2150.5</v></c></row></sheetData>' +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><drawing r:id="rId1"/></worksheet>';

  const comments =
    `${XML}<comments xmlns="${MAIN}"><authors><author>Sam Sample</author></authors><commentList>` +
    '<comment ref="B1" authorId="0"><text><r><rPr><b/><sz val="9"/><rFont val="Tahoma"/></rPr><t>Sam Sample:</t></r><r><rPr><sz val="9"/><rFont val="Tahoma"/></rPr><t xml:space="preserve">\nCheck this number</t></r></text></comment></commentList></comments>';

  const vml =
    '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    '<v:shape id="_x0000_s1025" type="#_x0000_t202" style="position:absolute;margin-left:107.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:1;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">' +
    '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
    '<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>2, 15, 0, 2, 4, 15, 4, 4</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>0</x:Row><x:Column>1</x:Column></x:ClientData></v:shape></xml>';

  const drawing =
    `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    '<xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>17</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${R}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>` +
    '<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="381000" cy="381000"/>' +
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="Picture 2"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="${R}" r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="381000" cy="381000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;

  const chart =
    `${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}"><c:roundedCorners val="0"/>` +
    '<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Sales by region</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' +
    '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Data!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Sales</c:v></c:pt></c:strCache></c:strRef></c:tx>' +
    '<c:cat><c:strRef><c:f>Data!$A$2:$A$5</c:f><c:strCache><c:ptCount val="4"/><c:pt idx="0"><c:v>North</c:v></c:pt><c:pt idx="1"><c:v>South</c:v></c:pt><c:pt idx="2"><c:v>East</c:v></c:pt><c:pt idx="3"><c:v>West</c:v></c:pt></c:strCache></c:strRef></c:cat>' +
    '<c:val><c:numRef><c:f>Data!$B$2:$B$5</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="4"/><c:pt idx="0"><c:v>1200.5</c:v></c:pt><c:pt idx="1"><c:v>950</c:v></c:pt><c:pt idx="2"><c:v>700.25</c:v></c:pt><c:pt idx="3"><c:v>1100</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>' +
    '<c:gapWidth val="219"/><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>' +
    '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>';

  const pivotCache =
    `${XML}<pivotCacheDefinition xmlns="${MAIN}" xmlns:r="${R}" r:id="rId1" refreshOnLoad="0" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="4">` +
    '<cacheSource type="worksheet"><worksheetSource ref="A1:B5" sheet="Data"/></cacheSource><cacheFields count="2">' +
    '<cacheField name="Region" numFmtId="0"><sharedItems count="4"><s v="North"/><s v="South"/><s v="East"/><s v="West"/></sharedItems></cacheField>' +
    '<cacheField name="Sales" numFmtId="164"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" minValue="700.25" maxValue="1200.5"/></cacheField></cacheFields></pivotCacheDefinition>';
  const pivotRecords =
    `${XML}<pivotCacheRecords xmlns="${MAIN}" count="4"><r><x v="0"/><n v="1200.5"/></r><r><x v="1"/><n v="950"/></r><r><x v="2"/><n v="700.25"/></r><r><x v="3"/><n v="1100"/></r></pivotCacheRecords>`;
  const pivotTable =
    `${XML}<pivotTableDefinition xmlns="${MAIN}" name="PivotTable1" cacheId="1" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Values" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1">` +
    '<location ref="A3:B6" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow" showAll="0"><items count="5"><item x="0"/><item x="1"/><item x="2"/><item x="3"/><item t="default"/></items></pivotField><pivotField dataField="1" numFmtId="164" showAll="0"/></pivotFields>' +
    '<rowFields count="1"><field x="0"/></rowFields><rowItems count="3"><i><x/></i><i><x v="1"/></i><i t="grand"><x/></i></rowItems><colItems count="1"><i/></colItems><dataFields count="1"><dataField name="Sum of Sales" fld="1" baseField="0" baseItem="0"/></dataFields></pivotTableDefinition>';

  const externalLink =
    `${XML}<externalLink xmlns="${MAIN}" xmlns:r="${R}"><externalBook r:id="rId1"><sheetNames><sheetName val="Prices"/></sheetNames><sheetDataSet><sheetData sheetId="0"><row r="1"><cell r="A1"><v>42</v></cell></row></sheetData></sheetDataSet></externalBook></externalLink>`;

  const workbook =
    `${XML}<workbook xmlns="${MAIN}" xmlns:r="${R}"><fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27425"/><workbookPr defaultThemeVersion="166925"/>` +
    '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300" activeTab="0"/></bookViews>' +
    '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/><sheet name="Report" sheetId="3" r:id="rId3"/></sheets>' +
    '<externalReferences><externalReference r:id="rId9"/></externalReferences>' +
    '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">Notes!$A$1:$B$3</definedName><definedName name="SalesTotal">Data!$B$6</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">Data!$A$1:$E$8</definedName></definedNames>' +
    '<calcPr calcId="191029"/><pivotCaches><pivotCache cacheId="1" r:id="rId8"/></pivotCaches></workbook>';

  const workbookRels = [
    ['rId1', T('worksheet'), 'worksheets/sheet1.xml'],
    ['rId2', T('worksheet'), 'worksheets/sheet2.xml'],
    ['rId3', T('worksheet'), 'worksheets/sheet3.xml'],
    ['rId4', T('theme'), 'theme/theme1.xml'],
    ['rId5', T('styles'), 'styles.xml'],
    ['rId6', T('sharedStrings'), 'sharedStrings.xml'],
    ['rId7', T('calcChain'), 'calcChain.xml'],
    ['rId8', T('pivotCacheDefinition'), 'pivotCache/pivotCacheDefinition1.xml'],
    ['rId9', T('externalLink'), 'externalLinks/externalLink1.xml'],
  ];
  if (macros) workbookRels.push(['rId10', 'http://schemas.microsoft.com/office/2006/relationships/vbaProject', 'vbaProject.bin']);

  const files = {
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/>` +
      `${macros ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' : ''}` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' +
      `<Override PartName="/xl/workbook.xml" ContentType="${macros ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'}"/>` +
      ['sheet1', 'sheet2', 'sheet3']
        .map((s) => `<Override PartName="/xl/worksheets/${s}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('') +
      '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>' +
      '<Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>' +
      '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
      '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
      '<Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/>' +
      '<Override PartName="/xl/pivotCache/pivotCacheRecords1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/>' +
      '<Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/>' +
      '<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>' +
      '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
    '_rels/.rels': rels([
      ['rId1', T('officeDocument'), 'xl/workbook.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
      ['rId3', T('extended-properties'), 'docProps/app.xml'],
    ]),
    'docProps/core.xml': `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Sam Sample</dc:creator></cp:coreProperties>`,
    'docProps/app.xml': `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>`,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': rels(workbookRels),
    'xl/worksheets/sheet1.xml': data,
    'xl/worksheets/_rels/sheet1.xml.rels': rels([['rId1', T('printerSettings'), '../printerSettings/printerSettings1.bin']]),
    'xl/printerSettings/printerSettings1.bin': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    'xl/worksheets/sheet2.xml': notes,
    'xl/worksheets/_rels/sheet2.xml.rels': rels([
      ['rId1', T('comments'), '../comments1.xml'],
      ['rId2', T('vmlDrawing'), '../drawings/vmlDrawing1.vml'],
      ['rId3', T('hyperlink'), 'https://example.com/folio', true],
    ]),
    'xl/comments1.xml': comments,
    'xl/drawings/vmlDrawing1.vml': vml,
    'xl/worksheets/sheet3.xml': report,
    'xl/worksheets/_rels/sheet3.xml.rels': rels([
      ['rId1', T('drawing'), '../drawings/drawing1.xml'],
      ['rId2', T('pivotTable'), '../pivotTables/pivotTable1.xml'],
    ]),
    'xl/drawings/drawing1.xml': drawing,
    'xl/drawings/_rels/drawing1.xml.rels': rels([
      ['rId1', T('chart'), '../charts/chart1.xml'],
      ['rId2', T('image'), '../media/image1.png'],
    ]),
    'xl/charts/chart1.xml': chart,
    'xl/media/image1.png': PNG,
    'xl/pivotTables/pivotTable1.xml': pivotTable,
    'xl/pivotTables/_rels/pivotTable1.xml.rels': rels([['rId1', T('pivotCacheDefinition'), '../pivotCache/pivotCacheDefinition1.xml']]),
    'xl/pivotCache/pivotCacheDefinition1.xml': pivotCache,
    'xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels': rels([['rId1', T('pivotCacheRecords'), 'pivotCacheRecords1.xml']]),
    'xl/pivotCache/pivotCacheRecords1.xml': pivotRecords,
    'xl/externalLinks/externalLink1.xml': externalLink,
    'xl/externalLinks/_rels/externalLink1.xml.rels': rels([['rId1', T('externalLinkPath'), 'file:///C:/Samples/prices.xlsx', true]]),
    'xl/theme/theme1.xml': theme,
    'xl/styles.xml': styles,
    'xl/sharedStrings.xml': sst,
    'xl/calcChain.xml': `${XML}<calcChain xmlns="${MAIN}"><c r="C2" i="1"/><c r="C3"/><c r="C4"/><c r="C5"/><c r="B6"/><c r="C6"/><c r="A7"/><c r="B8"/></calcChain>`,
    'customXml/item1.xml': '<root xmlns="urn:folio:sample"><value>kept</value></root>',
    'customXml/itemProps1.xml': `${XML}<ds:datastoreItem ds:itemID="{11111111-2222-3333-4444-555555555555}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>`,
    'customXml/_rels/item1.xml.rels': rels([['rId1', T('customXmlProps'), 'itemProps1.xml']]),
  };
  files['_rels/.rels'] = rels([
    ['rId1', T('officeDocument'), 'xl/workbook.xml'],
    ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ['rId3', T('extended-properties'), 'docProps/app.xml'],
    ['rId4', T('customXml'), 'customXml/item1.xml'],
  ]);
  if (macros) files['xl/vbaProject.bin'] = new Uint8Array(Buffer.from('dummy VBA project: never run, always kept'));
  return zip(files);
}

/** The smallest workbook Excel opens: one sheet, no styles, no strings. */
export function makeMinimalXlsx(cells = '<row r="1"><c r="A1"><v>1</v></c></row>') {
  return zip({
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': rels([['rId1', T('officeDocument'), 'xl/workbook.xml']]),
    'xl/workbook.xml': `${XML}<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([['rId1', T('worksheet'), 'worksheets/sheet1.xml']]),
    'xl/worksheets/sheet1.xml': `${XML}<worksheet xmlns="${MAIN}"><sheetData>${cells}</sheetData></worksheet>`,
  });
}
