// Comments and pictures: worksheet parts <-> Univer's comment threads and images.
//
// Comments: Excel's notes (commentsN.xml, drawn by a VML part) become Univer comment threads.
// Threaded comments from newer Excel are shown with their replies but kept as they are.
// Pictures: the pictures in a sheet's drawing become Univer images; charts and shapes in the
// same drawing are kept exactly as written.

import type { IWorksheetData } from '@univerjs/core';
import { type ChartModel, type Resolve, chartXml, readChart } from '../charts/model';
import { CONTENT, type Package, REL } from './opc';
import { cellName, parseCell } from './refs';
import { type XmlElement, attrsText, escapeAttr, escapeText, parseXml } from './xml';

const EMU_PER_PIXEL = 9525;

// ---- Comments ----------------------------------------------------------------------------

/**
 * Folio's user in Univer, the author of comments added in Folio. Univer's offline permission
 * service reads a user's role from the start of the id, and only an "Owner" (or "Editor") may
 * edit the workbook, so the id keeps that prefix. Files get FOLIO_NAME as the author instead.
 */
export const FOLIO_USER_ID = 'Owner_Folio';
const FOLIO_NAME = 'Folio';

export type CommentBody = { dataStream: string };
export type ThreadComment = {
  id: string;
  threadId: string;
  ref: string;
  dT: string;
  personId: string;
  authorName?: string;
  text: CommentBody;
  unitId: string;
  subUnitId: string;
  parentId?: string;
  children?: ThreadComment[];
};

export type CommentSource = {
  /** The notes part and the VML that draws them (if the sheet had notes). */
  commentsPart?: string;
  commentsRel?: string;
  vmlPart?: string;
  vmlRel?: string;
  /** Newer Excel's threaded comments: shown, never rewritten. */
  threaded: boolean;
};

const body = (text: string): CommentBody => ({ dataStream: `${text.replace(/\r\n?|\n/g, '\r')}\r\n` });
export const commentText = (comment: { text?: CommentBody }) => (comment.text?.dataStream ?? '').replace(/\r\n$/, '').replace(/\r/g, '\n');

function runsText(el: XmlElement | undefined): string {
  if (!el) return '';
  let out = '';
  for (const child of el.elements()) {
    if (child.local === 't') out += child.text();
    else if (child.local === 'r') out += child.child('t')?.text() ?? '';
  }
  return out;
}

export function readComments(pkg: Package, sheetPart: string, sheetId: string, unitId: string): { comments: ThreadComment[]; source: CommentSource } {
  const source: CommentSource = { threaded: false };
  const comments: ThreadComment[] = [];
  const now = '2000/01/01 00:00';
  const threadedRel = pkg.relsOfType(sheetPart, REL.threadedComment)[0];
  const threadedPart = pkg.target(sheetPart, threadedRel);
  if (threadedPart && pkg.has(threadedPart)) {
    source.threaded = true;
    const persons = new Map<string, string>();
    for (const rel of pkg.rels('xl/workbook.xml')) {
      if (rel.type !== REL.person) continue;
      const part = pkg.target('xl/workbook.xml', rel);
      for (const person of (part && pkg.xml(part)?.elements('person')) || []) persons.set(person.attr('id') ?? '', person.attr('displayName') ?? '');
    }
    const roots = new Map<string, ThreadComment>();
    for (const el of pkg.xml(threadedPart)?.elements('threadedComment') ?? []) {
      const id = el.attr('id') ?? `${sheetId}-tc${roots.size}`;
      const personId = el.attr('personId') ?? '';
      const comment: ThreadComment = {
        id,
        threadId: el.attr('parentId') ?? id,
        ref: el.attr('ref') ?? 'A1',
        dT: (el.attr('dT') ?? now).replace('T', ' ').replace(/-/g, '/').slice(0, 16),
        personId: persons.get(personId) || personId,
        authorName: persons.get(personId) || undefined,
        text: body(el.child('text')?.text() ?? ''),
        unitId,
        subUnitId: sheetId,
      };
      const parent = el.attr('parentId');
      if (parent && roots.has(parent)) {
        comment.parentId = parent;
        (roots.get(parent)!.children ??= []).push(comment);
      } else roots.set(id, { ...comment, children: [] });
    }
    comments.push(...roots.values());
  }

  const rel = pkg.relsOfType(sheetPart, REL.comments)[0];
  const part = pkg.target(sheetPart, rel);
  const vmlRel = pkg.relsOfType(sheetPart, REL.vmlDrawing)[0];
  source.vmlPart = pkg.target(sheetPart, vmlRel);
  source.vmlRel = vmlRel?.id;
  if (part && pkg.has(part)) {
    source.commentsPart = part;
    source.commentsRel = rel?.id;
    if (!source.threaded) {
      const root = pkg.xml(part);
      const authors = root?.child('authors')?.elements('author').map((a) => a.text()) ?? [];
      (root?.child('commentList')?.elements('comment') ?? []).forEach((el, i) => {
        const author = authors[Number(el.attr('authorId') ?? 0)] ?? '';
        const id = `${sheetId}-note${i}`;
        comments.push({
          id,
          threadId: id,
          ref: el.attr('ref') ?? 'A1',
          dT: now,
          // Notes Folio wrote, or with no author, are yours: Univer lets only their author edit them.
          personId: author && author !== FOLIO_NAME ? author : FOLIO_USER_ID,
          ...(author ? { authorName: author } : {}),
          text: body(runsText(el.child('text'))),
          unitId,
          subUnitId: sheetId,
          children: [],
        });
      });
    }
  }
  return { comments, source };
}

/**
 * Writes a sheet's notes after they changed: commentsN.xml and the VML that draws them (other
 * shapes in that VML, like form controls, stay). Returns the sheet's <legacyDrawing> element
 * to put in place (null to remove it), or undefined to leave the sheet as it is.
 */
export function writeComments(
  pkg: Package,
  sheetPart: string,
  sheet: Partial<IWorksheetData>,
  comments: ThreadComment[],
  source: CommentSource,
  prefix: string,
  legacyDrawing: XmlElement | undefined,
): string | null | undefined {
  if (source.threaded) return undefined;
  const notes = comments.filter((c) => !c.parentId && parseCell(c.ref));
  const authors: string[] = [];
  const authorOf = (name: string) => {
    let i = authors.indexOf(name);
    if (i < 0) i = authors.push(name) - 1;
    return i;
  };
  // Comments added in Folio carry Folio's user id and no name; the file gets the name.
  const nameOf = (c: ThreadComment) => c.authorName || (c.personId === FOLIO_USER_ID ? FOLIO_NAME : c.personId);
  const items = notes.map((c) => {
    // Replies have nowhere to go in a note: they're added below the comment, with their author.
    const replies = (c.children ?? []).map((r) => `\n${nameOf(r) || ''}: ${commentText(r)}`).join('');
    const text = commentText(c) + replies;
    const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
    return `<comment ref="${escapeAttr(c.ref)}" authorId="${authorOf(nameOf(c) || FOLIO_NAME)}"><text><r><t${space}>${escapeText(text)}</t></r></text></comment>`;
  });

  let commentsPart = source.commentsPart;
  let vmlPart = source.vmlPart;
  // Shapes in the VML other than notes (form controls) stay.
  const vmlText = vmlPart ? (pkg.text(vmlPart) ?? '') : '';
  const others = [...vmlText.matchAll(/<v:shape\b[\s\S]*?<\/v:shape>/g)].map((m) => m[0]).filter((shape) => !/ObjectType="Note"/.test(shape));
  if (notes.length === 0) {
    if (commentsPart) {
      if (source.commentsRel) pkg.removeRel(sheetPart, source.commentsRel);
      pkg.remove(commentsPart);
    }
    if (vmlPart && others.length === 0) {
      if (source.vmlRel) pkg.removeRel(sheetPart, source.vmlRel);
      pkg.remove(vmlPart);
      return null;
    }
  } else {
    if (!commentsPart) {
      commentsPart = freeName(pkg, 'xl/comments', '.xml');
      pkg.addRel(sheetPart, REL.comments, commentsPart);
    }
    pkg.set(
      commentsPart,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors>${authors.map((a) => `<author>${escapeText(a)}</author>`).join('')}</authors><commentList>${items.join('')}</commentList></comments>`,
      CONTENT.comments,
    );
  }
  if (notes.length === 0 && !vmlPart) return undefined;

  let relId = source.vmlRel;
  if (!vmlPart) {
    vmlPart = freeName(pkg, 'xl/drawings/vmlDrawing', '.vml');
    relId = pkg.addRel(sheetPart, REL.vmlDrawing, vmlPart);
    pkg.setContentType(vmlPart, CONTENT.vml, true);
  }
  const header =
    /<o:shapelayout[\s\S]*?<\/o:shapelayout>/.exec(vmlText)?.[0] ?? '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>';
  const shapetype =
    /<v:shapetype\b[^>]*id="_x0000_t202"[\s\S]*?<\/v:shapetype>/.exec(vmlText)?.[0] ??
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>';
  const otherTypes = [...vmlText.matchAll(/<v:shapetype\b[\s\S]*?<\/v:shapetype>/g)].map((m) => m[0]).filter((t) => !/id="_x0000_t202"/.test(t));
  const shapes = notes.map((c, i) => noteShape(c.ref, 1025 + 1000 + i, sheet));
  pkg.set(
    vmlPart,
    `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">${header}${shapetype}${otherTypes.join('')}${others.join('')}${shapes.join('')}</xml>`,
  );
  if (legacyDrawing) return undefined;
  return `<${prefix}legacyDrawing r:id="${relId}"/>`;
}

function noteShape(ref: string, id: number, sheet: Partial<IWorksheetData>): string {
  const at = parseCell(ref) ?? { row: 0, column: 0 };
  void sheet;
  const anchor = `${at.column + 1}, 15, ${Math.max(0, at.row - 1)}, 2, ${at.column + 3}, 15, ${at.row + 3}, 16`;
  return (
    `<v:shape id="_x0000_s${id}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:1;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">` +
    '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
    `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${anchor}</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${at.row}</x:Row><x:Column>${at.column}</x:Column></x:ClientData></v:shape>`
  );
}

function freeName(pkg: Package, stem: string, ext: string): string {
  for (let n = 1; ; n++) if (!pkg.has(`${stem}${n}${ext}`)) return `${stem}${n}${ext}`;
}

// ---- Pictures ------------------------------------------------------------------------------

type Cell = { column: number; columnOffset: number; row: number; rowOffset: number };
export type SheetImage = {
  unitId: string;
  subUnitId: string;
  drawingId: string;
  drawingType: number;
  imageSourceType: 'BASE64';
  source: string;
  transform: { left: number; top: number; width: number; height: number; angle: number; flipX: boolean; flipY: boolean; skewX: number; skewY: number };
  sheetTransform: { from: Cell; to: Cell; angle: number; flipX: boolean; flipY: boolean; skewX: number; skewY: number };
  axisAlignSheetTransform: { from: Cell; to: Cell; angle: number; flipX: boolean; flipY: boolean; skewX: number; skewY: number };
  anchorType: string;
};
/** A chart over the grid (a Univer "DOM drawing" its chart component draws). */
export type ChartDrawing = Omit<SheetImage, 'imageSourceType' | 'source'> & { componentKey: string; data: { chart: ChartModel }; allowTransform: boolean };
export type DrawingData = { data: Record<string, SheetImage | ChartDrawing>; order: string[] };
export const CHART_DRAWING = 8;
const isChart = (d: SheetImage | ChartDrawing | undefined): d is ChartDrawing => d?.drawingType === CHART_DRAWING;

export type PictureSource = {
  drawingPart?: string;
  drawingRel?: string;
  /** Each picture's anchor as written, by drawing id. */
  anchors: Map<string, { xml: string; start: number; end: number }>;
};

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };

/** Sheet geometry in pixels, for turning cell anchors into positions and back. */
export class Grid {
  constructor(private readonly sheet: Partial<IWorksheetData>) {}
  width(c: number) {
    const w = this.sheet.columnData?.[c];
    return w?.hd ? 0 : (w?.w ?? this.sheet.defaultColumnWidth ?? 64);
  }
  height(r: number) {
    const h = this.sheet.rowData?.[r];
    return h?.hd ? 0 : (h?.h ?? this.sheet.defaultRowHeight ?? 20);
  }
  x(c: number) {
    let x = 0;
    for (let i = 0; i < c; i++) x += this.width(i);
    return x;
  }
  y(r: number) {
    let y = 0;
    for (let i = 0; i < r; i++) y += this.height(i);
    return y;
  }
  /** The cell (and offset in it) at a position. */
  at(x: number, y: number): Cell {
    let column = 0;
    let left = x;
    while (column < 16_383 && left >= this.width(column) && this.width(column) >= 0) {
      if (this.width(column) === 0 && left === 0) break;
      left -= this.width(column);
      column += 1;
    }
    let row = 0;
    let top = y;
    while (row < 1_048_575 && top >= this.height(row)) {
      if (this.height(row) === 0 && top === 0) break;
      top -= this.height(row);
      row += 1;
    }
    return { column, columnOffset: left, row, rowOffset: top };
  }
}

function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function cellOf(el: XmlElement | undefined): Cell {
  const n = (name: string) => Number(el?.child(name)?.text() ?? 0);
  return { column: n('col'), columnOffset: n('colOff') / EMU_PER_PIXEL, row: n('row'), rowOffset: n('rowOff') / EMU_PER_PIXEL };
}

export function readPictures(pkg: Package, sheetPart: string, sheetId: string, unitId: string, sheet: Partial<IWorksheetData>): { drawing: DrawingData | null; source: PictureSource } {
  const source: PictureSource = { anchors: new Map() };
  const rel = pkg.relsOfType(sheetPart, REL.drawing)[0];
  const part = pkg.target(sheetPart, rel);
  if (!part || !pkg.has(part)) return { drawing: null, source };
  source.drawingPart = part;
  source.drawingRel = rel?.id;
  const text = pkg.text(part)!;
  const root = parseXml(text);
  const grid = new Grid(sheet);
  const drawing: DrawingData = { data: {}, order: [] };
  let n = 0;
  let charts = 0;
  for (const anchor of root.elements()) {
    const pic = anchor.child('pic');
    const chartRel = anchor.child('graphicFrame')?.path('graphic/graphicData/chart')?.attr('r:id');
    const chartPart = chartRel ? pkg.target(part, pkg.relById(part, chartRel)) : undefined;
    if (!pic && !chartPart) continue;
    const embed = pic?.path('blipFill/blip')?.attr('r:embed');
    const image = pic ? pkg.target(part, pkg.relById(part, embed)) : undefined;
    const bytes = image ? pkg.bytesOf(image) : undefined;
    const chartText = chartPart && pkg.has(chartPart) ? pkg.text(chartPart) : undefined;
    if (pic ? !image || !bytes : !chartText) continue;
    const ext = image?.split('.').pop()?.toLowerCase() ?? 'png';
    let from: Cell;
    let to: Cell;
    if (anchor.local === 'twoCellAnchor') {
      from = cellOf(anchor.child('from'));
      to = cellOf(anchor.child('to'));
    } else {
      const extent = anchor.child('ext');
      const width = Number(extent?.attr('cx') ?? 0) / EMU_PER_PIXEL;
      const height = Number(extent?.attr('cy') ?? 0) / EMU_PER_PIXEL;
      if (anchor.local === 'oneCellAnchor') from = cellOf(anchor.child('from'));
      else {
        const pos = anchor.child('pos');
        from = grid.at(Number(pos?.attr('x') ?? 0) / EMU_PER_PIXEL, Number(pos?.attr('y') ?? 0) / EMU_PER_PIXEL);
      }
      to = grid.at(grid.x(from.column) + from.columnOffset + width, grid.y(from.row) + from.rowOffset + height);
    }
    const left = grid.x(from.column) + from.columnOffset;
    const top = grid.y(from.row) + from.rowOffset;
    const width = grid.x(to.column) + to.columnOffset - left;
    const height = grid.y(to.row) + to.rowOffset - top;
    // Univer measures from the window's corner, past the row and column headers.
    const headerX = sheet.rowHeader?.width ?? 46;
    const headerY = sheet.columnHeader?.height ?? 20;
    const plain = { angle: 0, flipX: false, flipY: false, skewX: 0, skewY: 0 };
    const editAs = anchor.attr('editAs') ?? (anchor.local === 'twoCellAnchor' ? 'twoCell' : anchor.local === 'oneCellAnchor' ? 'oneCell' : 'absolute');
    if (chartText) {
      const drawingId = `${sheetId}-chart${charts++}`;
      let chart: ChartModel;
      try {
        chart = readChart(chartText, chartPart!);
      } catch {
        chart = { type: 'unsupported', grouping: 'clustered', legend: null, series: [], part: chartPart };
      }
      drawing.data[drawingId] = {
        unitId,
        subUnitId: sheetId,
        drawingId,
        drawingType: CHART_DRAWING,
        componentKey: 'FolioChart',
        data: { chart },
        allowTransform: true,
        transform: { left: left + headerX, top: top + headerY, width: Math.max(1, width), height: Math.max(1, height), ...plain },
        sheetTransform: { from, to, ...plain },
        axisAlignSheetTransform: { from, to, ...plain },
        anchorType: editAs === 'twoCell' ? '1' : editAs === 'oneCell' ? '0' : '2',
      };
      drawing.order.push(drawingId);
      source.anchors.set(drawingId, { xml: text.slice(anchor.start, anchor.end), start: anchor.start, end: anchor.end });
      continue;
    }
    const drawingId = `${sheetId}-pic${n++}`;
    drawing.data[drawingId] = {
      unitId,
      subUnitId: sheetId,
      drawingId,
      drawingType: 0,
      imageSourceType: 'BASE64',
      source: `data:${MIME[ext] ?? 'image/png'};base64,${base64(bytes!)}`,
      transform: { left: left + headerX, top: top + headerY, width: Math.max(1, width), height: Math.max(1, height), ...plain },
      sheetTransform: { from, to, ...plain },
      axisAlignSheetTransform: { from, to, ...plain },
      anchorType: editAs === 'twoCell' ? '1' : editAs === 'oneCell' ? '0' : '2',
    };
    drawing.order.push(drawingId);
    source.anchors.set(drawingId, { xml: text.slice(anchor.start, anchor.end), start: anchor.start, end: anchor.end });
  }
  return { drawing: drawing.order.length ? drawing : null, source };
}

const positionKey = (d: SheetImage | ChartDrawing | undefined) =>
  d ? JSON.stringify([d.sheetTransform?.from, d.sheetTransform?.to, isChart(d) ? d.data?.chart?.part : d.source.length]) : '';

/**
 * Writes a sheet's pictures after they changed: moved pictures get new anchors, deleted ones
 * go, new ones are added (with their image parts). Everything else in the drawing stays.
 * Returns the sheet's <drawing> element to add when the sheet had no drawing.
 */
export function writePictures(
  pkg: Package,
  sheetPart: string,
  before: DrawingData | null,
  after: DrawingData | null,
  source: PictureSource,
  prefix: string,
  resolve: Resolve,
): string | undefined {
  const xdr = 'xdr:';
  let part = source.drawingPart;
  let created: string | undefined;
  if (!part) {
    if (!after || after.order.length === 0) return undefined;
    part = freeName(pkg, 'xl/drawings/drawing', '.xml');
    pkg.set(
      part,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></xdr:wsDr>',
      CONTENT.drawing,
    );
    const id = pkg.addRel(sheetPart, REL.drawing, part);
    created = `<${prefix}drawing r:id="${id}"/>`;
  }
  const text = pkg.text(part)!;
  const root = parseXml(text);
  const edits: { start: number; end: number; text: string }[] = [];
  const kept = new Set(after?.order ?? []);
  let nextId = Math.max(1, ...[...text.matchAll(/<xdr:cNvPr id="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  // Original pictures: unchanged ones stay, moved ones get new anchor positions, deleted ones go.
  for (const [drawingId, anchor] of source.anchors) {
    const image = after?.data[drawingId];
    if (!kept.has(drawingId) || !image) {
      edits.push({ start: anchor.start, end: anchor.end, text: '' });
      continue;
    }
    const previous = before?.data[drawingId];
    if (isChart(image) && isChart(previous) && image.data.chart.part && JSON.stringify(image.data.chart) !== JSON.stringify(previous.data.chart)) {
      // Its type (or data) was changed in Folio: the chart part is written again.
      pkg.set(image.data.chart.part, chartXml(image.data.chart, resolve));
    }
    if (positionKey(image) === positionKey(previous)) continue;
    const body = /<xdr:pic>[\s\S]*<\/xdr:pic>|<xdr:graphicFrame[\s\S]*<\/xdr:graphicFrame>/.exec(anchor.xml)?.[0];
    if (body) edits.push({ start: anchor.start, end: anchor.end, text: twoCellAnchor(image, body) });
  }
  // New pictures: an image part, a relationship and an anchor each.
  let added = '';
  for (const drawingId of after?.order ?? []) {
    if (source.anchors.has(drawingId)) continue;
    const image = after!.data[drawingId];
    if (!image) continue;
    if (isChart(image)) {
      // A chart made in Folio: a chart part of its own, written with the values it shows.
      const chartPart = freeName(pkg, 'xl/charts/chart', '.xml');
      pkg.set(chartPart, chartXml(image.data.chart, resolve), CONTENT.chart);
      const rel = pkg.addRel(part, REL.chart, chartPart);
      const id = nextId++;
      const frame =
        `<${xdr}graphicFrame macro=""><${xdr}nvGraphicFramePr><${xdr}cNvPr id="${id}" name="Chart ${id}"/><${xdr}cNvGraphicFramePr/></${xdr}nvGraphicFramePr>` +
        `<${xdr}xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></${xdr}xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
        `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rel}"/></a:graphicData></a:graphic></${xdr}graphicFrame>`;
      added += twoCellAnchor(image, frame);
      continue;
    }
    const match = /^data:image\/([a-z+]+);base64,(.*)$/.exec(image.source);
    if (!match) continue;
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1] === 'svg+xml' ? 'svg' : match[1]!;
    const media = freeName(pkg, 'xl/media/image', `.${ext}`);
    pkg.set(media, Uint8Array.from(atob(match[2]!), (c) => c.charCodeAt(0)));
    pkg.setContentType(media, MIME[ext] ?? 'image/png', true);
    const rel = pkg.addRel(part, REL.image, media);
    const id = nextId++;
    const pic =
      `<${xdr}pic><${xdr}nvPicPr><${xdr}cNvPr id="${id}" name="Picture ${id}"/><${xdr}cNvPicPr><a:picLocks noChangeAspect="1"/></${xdr}cNvPicPr></${xdr}nvPicPr>` +
      `<${xdr}blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></${xdr}blipFill>` +
      `<${xdr}spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(image.transform.width * EMU_PER_PIXEL)}" cy="${Math.round(image.transform.height * EMU_PER_PIXEL)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></${xdr}spPr></${xdr}pic>`;
    added += twoCellAnchor(image, pic);
  }
  if (added) edits.push({ start: root.innerEnd, end: root.innerEnd, text: added });
  if (edits.length) {
    edits.sort((a, b) => a.start - b.start);
    let out = '';
    let at = 0;
    for (const edit of edits) {
      out += text.slice(at, edit.start) + edit.text;
      at = edit.end;
    }
    pkg.set(part, out + text.slice(at));
  }
  return created;
}

function twoCellAnchor(image: SheetImage | ChartDrawing, pic: string): string {
  const { from, to } = image.sheetTransform;
  const cell = (tag: string, c: Cell) =>
    `<xdr:${tag}><xdr:col>${c.column}</xdr:col><xdr:colOff>${Math.round(c.columnOffset * EMU_PER_PIXEL)}</xdr:colOff><xdr:row>${c.row}</xdr:row><xdr:rowOff>${Math.round(c.rowOffset * EMU_PER_PIXEL)}</xdr:rowOff></xdr:${tag}>`;
  const editAs = image.anchorType === '0' ? 'oneCell' : image.anchorType === '2' ? 'absolute' : undefined;
  return `<xdr:twoCellAnchor${editAs ? attrsText([['editAs', editAs]]) : ''}>${cell('from', from)}${cell('to', to)}${pic}<xdr:clientData/></xdr:twoCellAnchor>`;
}

export { cellName };
