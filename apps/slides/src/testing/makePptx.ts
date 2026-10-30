// Generated test decks (no real documents in tests). The parts follow what PowerPoint
// itself writes, including things Folio doesn't edit (transitions, animations, a tag part,
// custom XML, comments) so tests can check those survive a save untouched.

import { writeZip } from '../zip';

export type SlideSpec = {
  title: string;
  /** Body paragraphs; `**bold**` marks a bold run. */
  bullets?: string[];
  notes?: string;
  hidden?: boolean;
  picture?: boolean;
  table?: string[][];
  /** Adds a fade transition and an entrance animation on the title. */
  animated?: boolean;
  /** A web link on the title. */
  link?: string;
  /** A tag part (unknown to Folio) related to the slide. */
  tag?: boolean;
  /** A group of two text boxes, its children drawn at half their own size. */
  group?: boolean;
};

export type DeckSpec = { slides: SlideSpec[]; macros?: boolean; wide?: boolean };

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.presentationml';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NSDECL = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`;

/** A 1x1 red PNG. */
export const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rels(items: [id: string, type: string, target: string, external?: boolean][]): string {
  return (
    `${HEAD}<Relationships xmlns="${RELS}">` +
    items
      .map(
        ([id, type, target, external]) =>
          `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : `${RT}/${type}`}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`,
      )
      .join('') +
    '</Relationships>'
  );
}

function runs(text: string): string {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('**')
        ? `<a:r><a:rPr lang="en-US" b="1" dirty="0"/><a:t>${esc(part.slice(2, -2))}</a:t></a:r>`
        : `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(part)}</a:t></a:r>`,
    )
    .join('');
}

const THEME = (name: string) =>
  `${HEAD}<a:theme xmlns:a="${A}" name="${name}"><a:themeElements>` +
  '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2><a:accent1><a:srgbClr val="156082"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="E97132"/></a:accent2><a:accent3><a:srgbClr val="196B24"/></a:accent3><a:accent4><a:srgbClr val="0F9ED5"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="A02B93"/></a:accent5><a:accent6><a:srgbClr val="4EA72E"/></a:accent6><a:hlink><a:srgbClr val="467886"/></a:hlink>' +
  '<a:folHlink><a:srgbClr val="96607D"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"><a:shade val="90000"/></a:schemeClr></a:solidFill></a:bgFillStyleLst></a:fmtScheme>' +
  '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';

const placeholder = (id: number, name: string, ph: string, x: number, y: number, cx: number, cy: number, body = '<a:p><a:endParaRPr lang="en-US"/></a:p>') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`;

const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const MASTER =
  `${HEAD}<p:sldMaster ${NSDECL}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}` +
  placeholder(2, 'Title Placeholder 1', '<p:ph type="title"/>', 838200, 365125, 10515600, 1325563) +
  placeholder(3, 'Text Placeholder 2', '<p:ph type="body" idx="1"/>', 838200, 1825625, 10515600, 4351338) +
  '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
  '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
  '<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle>' +
  '<p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>';

const LAYOUT =
  `${HEAD}<p:sldLayout ${NSDECL} type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree>${GROUP}` +
  placeholder(2, 'Title 1', '<p:ph type="title"/>', 838200, 365125, 10515600, 1325563) +
  placeholder(3, 'Content Placeholder 2', '<p:ph idx="1"/>', 838200, 1825625, 10515600, 4351338) +
  '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const NOTES_MASTER =
  `${HEAD}<p:notesMaster ${NSDECL}><p:cSld><p:spTree>${GROUP}` +
  placeholder(2, 'Slide Image Placeholder 1', '<p:ph type="sldImg" idx="2"/>', 1143000, 685800, 4572000, 3429000, '') .replace('<p:txBody><a:bodyPr/><a:lstStyle/></p:txBody>', '') +
  placeholder(3, 'Notes Placeholder 2', '<p:ph type="body" sz="quarter" idx="3"/>', 685800, 4400550, 5486400, 3600450) +
  '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>';

function slideXml(spec: SlideSpec): string {
  const title = spec.link
    ? `<a:p><a:r><a:rPr lang="en-US" dirty="0"><a:hlinkClick r:id="rIdLink"/></a:rPr><a:t>${esc(spec.title)}</a:t></a:r></a:p>`
    : `<a:p>${runs(spec.title)}</a:p>`;
  let shapes = placeholder(2, 'Title 1', '<p:ph type="title"/>', 838200, 365125, 10515600, 1325563, title);
  if (spec.bullets) {
    shapes += placeholder(
      3,
      'Content Placeholder 2',
      '<p:ph idx="1"/>',
      838200,
      1825625,
      spec.picture ? 6000000 : 10515600,
      4351338,
      spec.bullets.map((b) => `<a:p>${runs(b)}</a:p>`).join(''),
    );
  }
  if (spec.picture) {
    shapes +=
      '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3" descr="A red square"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      '<p:spPr><a:xfrm><a:off x="7200000" y="1825625"/><a:ext cx="3600000" cy="3600000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
  }
  if (spec.table) {
    const columns = spec.table[0]?.length ?? 1;
    const width = 9000000;
    shapes +=
      '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Table 4"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>' +
      `<p:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="${width}" cy="${370840 * spec.table.length}"/></p:xfrm>` +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>' +
      Array.from({ length: columns }, () => `<a:gridCol w="${Math.floor(width / columns)}"/>`).join('') +
      '</a:tblGrid>' +
      spec.table
        .map(
          (row) =>
            '<a:tr h="370840">' +
            row.map((cell) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${runs(cell)}</a:p></a:txBody><a:tcPr/></a:tc>`).join('') +
            '</a:tr>',
        )
        .join('') +
      '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
  }
  if (spec.group) {
    const box = (id: number, name: string, x: number, text: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="${x}" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
      `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p>${runs(text)}</a:p></p:txBody></p:sp>`;
    // Children live in an 8000000 x 2000000 space, drawn at half size from (1000000, 4000000).
    shapes +=
      '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group 9"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="1000000" y="4000000"/><a:ext cx="4000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="8000000" cy="2000000"/></a:xfrm></p:grpSpPr>' +
      box(11, 'Left box', 0, 'Left **note**') +
      box(12, 'Right box', 4000000, 'Right note') +
      '</p:grpSp>';
  }
  const transition = spec.animated ? '<p:transition spd="med"><p:fade/></p:transition>' : '';
  const timing = spec.animated
    ? '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek">' +
      '<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>' +
      '<p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par>' +
      '<p:cTn id="5" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst>' +
      '<p:childTnLst><p:set><p:cBhvr><p:cTn id="6" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="2"/></p:tgtEl>' +
      '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn>' +
      '</p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>' +
      '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
    : '';
  return (
    `${HEAD}<p:sld ${NSDECL}${spec.hidden ? ' show="0"' : ''}><p:cSld><p:spTree>${GROUP}${shapes}</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transition}${timing}</p:sld>`
  );
}

function notesXml(text: string): string {
  return (
    `${HEAD}<p:notes ${NSDECL}><p:cSld><p:spTree>${GROUP}` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
    placeholder(3, 'Notes Placeholder 2', '<p:ph type="body" idx="1"/>', 685800, 4400550, 5486400, 3600450,
      text.split('\n').map((line) => (line ? `<a:p>${runs(line)}</a:p>` : '<a:p><a:endParaRPr lang="en-US"/></a:p>')).join('')) +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>'
  );
}

/** Builds a .pptx (or .pptm with `macros`) from a description. */
export async function makePptx(deck: DeckSpec): Promise<Uint8Array> {
  const files: Record<string, string | Uint8Array> = {};
  const overrides: [string, string][] = [
    ['/ppt/presentation.xml', deck.macros ? 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml' : `${CT}.presentation.main+xml`],
    ['/ppt/slideMasters/slideMaster1.xml', `${CT}.slideMaster+xml`],
    ['/ppt/slideLayouts/slideLayout1.xml', `${CT}.slideLayout+xml`],
    ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ['/ppt/theme/theme2.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ['/ppt/notesMasters/notesMaster1.xml', `${CT}.notesMaster+xml`],
    ['/ppt/presProps.xml', `${CT}.presProps+xml`],
    ['/ppt/viewProps.xml', `${CT}.viewProps+xml`],
    ['/ppt/tableStyles.xml', `${CT}.tableStyles+xml`],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
    ['/customXml/itemProps1.xml', 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml'],
  ];
  const presRels: [string, string, string][] = [['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml']];
  const sldIds: string[] = [];
  let hasPicture = false;
  let tags = 0;
  deck.slides.forEach((spec, i) => {
    const n = i + 1;
    const rid = `rId${100 + n}`;
    presRels.push([rid, 'slide', `slides/slide${n}.xml`]);
    sldIds.push(`<p:sldId id="${255 + n}" r:id="${rid}"/>`);
    overrides.push([`/ppt/slides/slide${n}.xml`, `${CT}.slide+xml`]);
    files[`ppt/slides/slide${n}.xml`] = slideXml(spec);
    const slideRels: [string, string, string, boolean?][] = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
    if (spec.picture) {
      hasPicture = true;
      slideRels.push(['rIdImg', 'image', '../media/image1.png']);
    }
    if (spec.link) slideRels.push(['rIdLink', 'hyperlink', spec.link, true]);
    if (spec.tag) {
      tags += 1;
      slideRels.push(['rIdTag', 'tags', `../tags/tag${tags}.xml`]);
      files[`ppt/tags/tag${tags}.xml`] = `${HEAD}<p:tagLst ${NSDECL}><p:tag name="FOLIO_TEST" val="keep me ${tags}"/></p:tagLst>`;
      overrides.push([`/ppt/tags/tag${tags}.xml`, `${CT}.tags+xml`]);
    }
    if (spec.notes !== undefined) {
      slideRels.push(['rIdNotes', 'notesSlide', `../notesSlides/notesSlide${n}.xml`]);
      files[`ppt/notesSlides/notesSlide${n}.xml`] = notesXml(spec.notes);
      files[`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`] = rels([
        ['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'],
        ['rId2', 'slide', `../slides/slide${n}.xml`],
      ]);
      overrides.push([`/ppt/notesSlides/notesSlide${n}.xml`, `${CT}.notesSlide+xml`]);
    }
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = rels(slideRels);
  });
  presRels.push(
    ['rId2', 'notesMaster', 'notesMasters/notesMaster1.xml'],
    ['rId3', 'presProps', 'presProps.xml'],
    ['rId4', 'viewProps', 'viewProps.xml'],
    ['rId5', 'theme', 'theme/theme1.xml'],
    ['rId6', 'tableStyles', 'tableStyles.xml'],
  );
  if (deck.macros) {
    presRels.push(['rId7', 'http://schemas.microsoft.com/office/2006/relationships/vbaProject', 'vbaProject.bin']);
    files['ppt/vbaProject.bin'] = new TextEncoder().encode('not a real VBA project, only bytes that must survive');
  }
  const [cx, cy] = deck.wide === false ? [9144000, 6858000] : [12192000, 6858000];
  files['ppt/presentation.xml'] =
    `${HEAD}<p:presentation ${NSDECL} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${sldIds.join('')}</p:sldIdLst>` +
    `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/>` +
    '<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>';
  files['ppt/_rels/presentation.xml.rels'] = rels(presRels);
  files['ppt/slideMasters/slideMaster1.xml'] = MASTER;
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([
    ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
    ['rId2', 'theme', '../theme/theme1.xml'],
  ]);
  files['ppt/slideLayouts/slideLayout1.xml'] = LAYOUT;
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]);
  files['ppt/theme/theme1.xml'] = THEME('Office Theme');
  files['ppt/theme/theme2.xml'] = THEME('Notes Theme');
  files['ppt/notesMasters/notesMaster1.xml'] = NOTES_MASTER;
  files['ppt/notesMasters/_rels/notesMaster1.xml.rels'] = rels([['rId1', 'theme', '../theme/theme2.xml']]);
  files['ppt/presProps.xml'] = `${HEAD}<p:presentationPr ${NSDECL}/>`;
  files['ppt/viewProps.xml'] = `${HEAD}<p:viewPr ${NSDECL}><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`;
  files['ppt/tableStyles.xml'] = `${HEAD}<a:tblStyleLst xmlns:a="${A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
  if (hasPicture) files['ppt/media/image1.png'] = PNG;
  files['customXml/item1.xml'] = `${HEAD}<folio xmlns="urn:folio:test">custom data Folio never reads</folio>`;
  files['customXml/itemProps1.xml'] =
    `${HEAD}<ds:datastoreItem ds:itemID="{11111111-2222-3333-4444-555555555555}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>`;
  files['customXml/_rels/item1.xml.rels'] = rels([['rId1', 'customXmlProps', 'itemProps1.xml']]);
  files['docProps/core.xml'] =
    `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test deck</dc:title></cp:coreProperties>`;
  files['docProps/app.xml'] =
    `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Folio test generator</Application><Slides>${deck.slides.length}</Slides></Properties>`;
  files['_rels/.rels'] = rels([
    ['rId1', 'officeDocument', 'ppt/presentation.xml'],
    ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ['rId3', 'extended-properties', 'docProps/app.xml'],
  ]);
  files['[Content_Types].xml'] =
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    (deck.macros ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' : '') +
    overrides.map(([name, type]) => `<Override PartName="${name}" ContentType="${type}"/>`).join('') +
    '</Types>';

  // [Content_Types].xml first, as Office writes it.
  const order = ['[Content_Types].xml', '_rels/.rels', ...Object.keys(files).filter((n) => n !== '[Content_Types].xml' && n !== '_rels/.rels')];
  const encoder = new TextEncoder();
  return writeZip(order.map((name) => ({ name, data: typeof files[name] === 'string' ? encoder.encode(files[name]) : (files[name] as Uint8Array) })));
}

/** The deck most tests use: four slides covering what Folio edits and what it must keep. */
export const SAMPLE: DeckSpec = {
  slides: [
    { title: 'Quarterly review', bullets: ['Prepared by the **planning** team'], animated: true, notes: 'Welcome everyone.\nKeep it short.' },
    { title: 'Growth', bullets: ['Revenue up **12%**', 'Costs flat', 'Hiring two people'], picture: true, notes: 'Mention the new office.', tag: true },
    { title: 'Appendix', table: [['Region', 'Sales'], ['North', '120'], ['South', '95']], hidden: true },
    { title: 'Questions?', link: 'https://example.com/contact' },
  ],
};
