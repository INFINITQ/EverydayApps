// Writes small, valid Word documents (.docx, and .docm with a stand-in macro project) without
// any library. The default document has a bit of everything Folio Docs should show and keep:
// headings and a contents field, bold/italic/underlined text, a bulleted and a numbered list, a
// table, a picture, a web link, a footnote, a comment, tracked changes (an insertion and a
// deletion), a header and a footer with a page number, and a second, landscape section.
// It also carries things Folio doesn't understand and must keep exactly as they are (UNKNOWN):
// an extra part of an unknown kind, a custom XML part, an element and an attribute from an
// unknown namespace, and a picture linked from the web (which must never be fetched).
// Used by the unit and end-to-end tests.
//
// Usage: node tools/fixtures/make-docx.mjs <out.docx|out.docm> [--plain] [--paragraphs=N]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';

export const WEB_LINK = 'https://example.com/folio-docs-test';
/** A picture the document links to instead of embedding. Folio must never load it. */
export const REMOTE_PICTURE = 'https://example.com/folio-docs-tracker.png';
export const MARKERS = {
  title: 'Folio test document',
  body: 'The quick brown fox jumps over the lazy dog.',
  footnote: 'A footnote from the Folio fixtures.',
  comment: 'A comment from a reviewer.',
  inserted: 'inserted by a reviewer',
  deleted: 'deleted by a reviewer',
  header: 'Folio header text',
  footer: 'Page ',
  cell: 'Cell B2',
  landscape: 'This section is landscape.',
};
/** What a save must carry over untouched. */
export const UNKNOWN = {
  part: 'word/folio-unknown.xml',
  partXml:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<folio:data xmlns:folio="urn:folio:test:unknown"><folio:item n="1">Keep me</folio:item></folio:data>',
  relType: 'urn:folio:test:relationships/unknown',
  contentType: 'application/vnd.folio.test-unknown+xml',
  customXml: 'customXml/item1.xml',
  customXmlBody: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<folioProps xmlns="urn:folio:test:props"><owner>Fixtures</owner></folioProps>',
  /** An element from a namespace Word ignores (listed in mc:Ignorable), inside a paragraph. */
  element: '<fx:mystery fx:keep="yes"><fx:inner>opaque</fx:inner></fx:mystery>',
  /** An attribute from the same namespace on a paragraph. */
  attribute: 'fx:paraTag="folio-7"',
  macroPart: 'word/vbaProject.bin',
};

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  fx: 'urn:folio:test:extension',
};
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument';

const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- Zip ----------------------------------------------------------------------------------

/** A zip archive (deflated, fixed timestamps, so the same input gives the same bytes). */
export function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data, store = false } of entries) {
    const raw = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const packed = store ? raw : deflateRawSync(raw);
    const method = store ? 0 : 8;
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/** A solid-colored PNG picture. */
export function png(width, height, rgba) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width * 4 }, (_, i) => rgba[i % 4]))]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- WordprocessingML helpers ---------------------------------------------------------------

const run = (text, props = '') =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (content, { style, num, extra = '', attrs = '' } = {}) => {
  const pPr = [style ? `<w:pStyle w:val="${style}"/>` : '', num ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${num}"/></w:numPr>` : '', extra]
    .join('');
  return `<w:p${attrs ? ` ${attrs}` : ''}>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;
};
const field = (instr, result) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const SECTION_PORTRAIT =
  '<w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/>' +
  '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const SECTION_LANDSCAPE =
  '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';

function picture(rel, id, name, cx, cy, { link = false } = {}) {
  const blip = link ? `<a:blip r:link="${rel}"/>` : `<a:blip r:embed="${rel}"/>`;
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="${name}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

function table(rows) {
  const grid = rows[0].map(() => '<w:gridCol w:w="3000"/>').join('');
  const body = rows
    .map(
      (cells, r) =>
        `<w:tr>${r === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells
          .map((text) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${para(run(text, r === 0 ? '<w:b/>' : ''))}</w:tc>`)
          .join('')}</w:tr>`,
    )
    .join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

const STYLES = `${XML}<w:styles xmlns:w="${NS.w}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:color w:val="2F5496"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="40" w:after="0"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:color w:val="2F5496"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="100"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="100"/><w:ind w:left="220"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/></w:style>
</w:styles>`;

const NUMBERING = `${XML}<w:numbering xmlns:w="${NS.w}">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const SETTINGS = `${XML}<w:settings xmlns:w="${NS.w}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

const FONT_TABLE = `${XML}<w:fonts xmlns:w="${NS.w}"><w:font w:name="Calibri"><w:panose1 w:val="020F0502020204030204"/><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font><w:font w:name="Calibri Light"><w:panose1 w:val="020F0302020204030204"/><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font><w:font w:name="Symbol"><w:panose1 w:val="05050102010706020507"/><w:charset w:val="02"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font></w:fonts>`;

const FOOTNOTES = `${XML}<w:footnotes xmlns:w="${NS.w}">
<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${run(` ${MARKERS.footnote}`)}</w:p></w:footnote>
</w:footnotes>`;

const COMMENTS = `${XML}<w:comments xmlns:w="${NS.w}"><w:comment w:id="0" w:author="Reviewer" w:date="2026-01-02T10:00:00Z" w:initials="R"><w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>${run(MARKERS.comment)}</w:p></w:comment></w:comments>`;

const HEADER = `${XML}<w:hdr xmlns:w="${NS.w}" xmlns:r="${NS.r}">${para(run(MARKERS.header), { style: 'Header' })}</w:hdr>`;
const FOOTER = `${XML}<w:ftr xmlns:w="${NS.w}" xmlns:r="${NS.r}">${para(
  run(MARKERS.footer) + field('PAGE', run('1')) + run(' of ') + field('NUMPAGES', run('2')),
  { style: 'Footer', extra: '<w:jc w:val="center"/>' },
)}</w:ftr>`;

const CORE = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${MARKERS.title}</dc:title><dc:creator>Folio fixtures</dc:creator><cp:lastModifiedBy>Folio fixtures</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`;
const APP = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Folio fixtures</Application></Properties>`;

function documentXml({ plain, paragraphs }) {
  const roots = Object.entries(NS)
    .map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`)
    .join(' ');
  const filler = Array.from({ length: paragraphs }, (_, i) =>
    para(run(`Paragraph ${i + 1}. ${MARKERS.body} Folio keeps documents on this PC.`)),
  ).join('');
  if (plain) {
    return `${XML}<w:document ${roots}><w:body>${para(run(MARKERS.title), { style: 'Title' })}${para(run(MARKERS.body))}${filler}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  }
  const toc = para(
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('Lists')}`,
    { style: 'TOC1' },
  ) + para(run('Table'), { style: 'TOC1' }) + para(`${run('Picture')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`, { style: 'TOC1' });
  const body = [
    para(run(MARKERS.title), { style: 'Title' }),
    toc,
    para(run('Plain, ') + run('bold', '<w:b/>') + run(', ') + run('italic', '<w:i/>') + run(', ') + run('underlined', '<w:u w:val="single"/>') + run('. ' + MARKERS.body)),
    // Unknown markup Word ignores and Folio must keep: an element and an attribute.
    para(run('This paragraph carries unknown markup.') + UNKNOWN.element, { attrs: UNKNOWN.attribute }),
    para(run('Lists'), { style: 'Heading1' }),
    para(run('First bullet'), { style: 'ListParagraph', num: 1 }),
    para(run('Second bullet'), { style: 'ListParagraph', num: 1 }),
    para(run('Third bullet'), { style: 'ListParagraph', num: 1 }),
    para(run('Step one'), { style: 'ListParagraph', num: 2 }),
    para(run('Step two'), { style: 'ListParagraph', num: 2 }),
    para(run('Table'), { style: 'Heading1' }),
    table([
      ['Name', 'Kind', 'Size'],
      ['Cell A2', MARKERS.cell, 'Cell C2'],
      ['Cell A3', 'Cell B3', 'Cell C3'],
    ]),
    para(run('Picture'), { style: 'Heading1' }),
    para(picture('rIdImage1', 1, 'Green square', 914400, 914400)),
    // Linked, not embedded: must never be fetched.
    para(picture('rIdRemote1', 2, 'Remote picture', 914400, 914400, { link: true })),
    para(run('Links and notes'), { style: 'Heading2' }),
    para(
      run('Visit ') +
        `<w:hyperlink r:id="rIdLink1" w:history="1">${run('the example site', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>` +
        run(' for more.'),
    ),
    para(run('This sentence has a footnote.') + '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>'),
    para(
      '<w:commentRangeStart w:id="0"/>' +
        run('This sentence has a comment.') +
        '<w:commentRangeEnd w:id="0"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>',
    ),
    para(
      run('Tracked changes: ') +
        `<w:ins w:id="101" w:author="Reviewer" w:date="2026-01-02T10:00:00Z">${run(MARKERS.inserted)}</w:ins>` +
        run(' and ') +
        `<w:del w:id="102" w:author="Reviewer" w:date="2026-01-02T10:00:00Z"><w:r><w:delText xml:space="preserve">${MARKERS.deleted}</w:delText></w:r></w:del>` +
        run('.'),
    ),
    filler,
    // End of the first (portrait) section.
    para('', { extra: `<w:sectPr>${SECTION_PORTRAIT}</w:sectPr>` }),
    para(run(MARKERS.landscape)),
    `<w:sectPr>${SECTION_LANDSCAPE}</w:sectPr>`,
  ].join('');
  return `${XML}<w:document ${roots} mc:Ignorable="w14 fx"><w:body>${body}</w:body></w:document>`;
}

/**
 * A .docx (or, with `macros`, a .docm whose `word/vbaProject.bin` is a stand-in: Folio never
 * runs macros, it only has to keep them). `plain` makes a minimal document without the extras.
 */
export function makeDocx({ plain = false, macros = false, paragraphs = 0 } = {}) {
  const overrides = [
    ['/word/document.xml', macros ? 'application/vnd.ms-word.document.macroEnabled.main+xml' : `${CT}.wordprocessingml.document.main+xml`],
    ['/word/styles.xml', `${CT}.wordprocessingml.styles+xml`],
    ['/word/settings.xml', `${CT}.wordprocessingml.settings+xml`],
    ['/word/fontTable.xml', `${CT}.wordprocessingml.fontTable+xml`],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', `${CT}.extended-properties+xml`],
  ];
  const rels = [
    ['rIdStyles', `${REL}/styles`, 'styles.xml'],
    ['rIdSettings', `${REL}/settings`, 'settings.xml'],
    ['rIdFonts', `${REL}/fontTable`, 'fontTable.xml'],
  ];
  const parts = [
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/settings.xml', data: SETTINGS },
    { name: 'word/fontTable.xml', data: FONT_TABLE },
    { name: 'docProps/core.xml', data: CORE },
    { name: 'docProps/app.xml', data: APP },
  ];
  if (!plain) {
    overrides.push(
      ['/word/numbering.xml', `${CT}.wordprocessingml.numbering+xml`],
      ['/word/footnotes.xml', `${CT}.wordprocessingml.footnotes+xml`],
      ['/word/comments.xml', `${CT}.wordprocessingml.comments+xml`],
      ['/word/header1.xml', `${CT}.wordprocessingml.header+xml`],
      ['/word/footer1.xml', `${CT}.wordprocessingml.footer+xml`],
      [`/${UNKNOWN.part}`, UNKNOWN.contentType],
      ['/customXml/itemProps1.xml', `${CT}.customXmlProperties+xml`],
    );
    rels.push(
      ['rIdNumbering', `${REL}/numbering`, 'numbering.xml'],
      ['rIdFootnotes', `${REL}/footnotes`, 'footnotes.xml'],
      ['rIdComments', `${REL}/comments`, 'comments.xml'],
      ['rIdHeader1', `${REL}/header`, 'header1.xml'],
      ['rIdFooter1', `${REL}/footer`, 'footer1.xml'],
      ['rIdImage1', `${REL}/image`, 'media/image1.png'],
      ['rIdRemote1', `${REL}/image`, REMOTE_PICTURE, 'External'],
      ['rIdLink1', `${REL}/hyperlink`, WEB_LINK, 'External'],
      ['rIdUnknown1', UNKNOWN.relType, 'folio-unknown.xml'],
      ['rIdCustomXml1', `${REL}/customXml`, '../customXml/item1.xml'],
    );
    parts.push(
      { name: 'word/numbering.xml', data: NUMBERING },
      { name: 'word/footnotes.xml', data: FOOTNOTES },
      { name: 'word/comments.xml', data: COMMENTS },
      { name: 'word/header1.xml', data: HEADER },
      { name: 'word/footer1.xml', data: FOOTER },
      { name: 'word/media/image1.png', data: png(8, 8, [16, 160, 64, 255]), store: true },
      { name: UNKNOWN.part, data: UNKNOWN.partXml },
      { name: UNKNOWN.customXml, data: UNKNOWN.customXmlBody },
      {
        name: 'customXml/itemProps1.xml',
        data: `${XML}<ds:datastoreItem ds:itemID="{6A1B7C55-0F0E-4C1A-9A57-3C5E0D3F1A11}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="urn:folio:test:props"/></ds:schemaRefs></ds:datastoreItem>`,
      },
      {
        name: 'customXml/_rels/item1.xml.rels',
        data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/customXmlProps" Target="itemProps1.xml"/></Relationships>`,
      },
    );
  }
  if (macros) {
    overrides.push([`/${UNKNOWN.macroPart}`, 'application/vnd.ms-office.vbaProject']);
    rels.push(['rIdVba', 'http://schemas.microsoft.com/office/2006/relationships/vbaProject', 'vbaProject.bin']);
    // Not a real VBA project: a recognisable stand-in Folio must keep byte for byte.
    parts.push({ name: UNKNOWN.macroPart, data: Buffer.from('FOLIO-STAND-IN-VBA-PROJECT\0\x01\x02\x03', 'latin1'), store: true });
  }
  const contentTypes =
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
    overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('') +
    '</Types>';
  const packageRels =
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const documentRels =
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels
      .map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${type}" Target="${esc(target)}"${mode ? ` TargetMode="${mode}"` : ''}/>`)
      .join('') +
    '</Relationships>';
  return makeZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: packageRels },
    { name: 'word/document.xml', data: documentXml({ plain, paragraphs }) },
    { name: 'word/_rels/document.xml.rels', data: documentRels },
    ...parts,
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [out, ...flags] = process.argv.slice(2);
  if (!out) {
    console.error('Usage: node tools/fixtures/make-docx.mjs <out.docx|out.docm> [--plain] [--paragraphs=N]');
    process.exit(1);
  }
  const paragraphs = Number(flags.find((f) => f.startsWith('--paragraphs='))?.split('=')[1] ?? 0);
  writeFileSync(out, makeDocx({ plain: flags.includes('--plain'), macros: out.endsWith('.docm'), paragraphs }));
  console.log(`Wrote ${out}`);
}
