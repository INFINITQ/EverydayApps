// Editing text without losing its formatting. A text body is edited as plain paragraphs;
// the change is applied to the XML character by character, so only the runs that changed
// are rewritten: untouched runs keep their exact XML, typed text takes the formatting of
// the character before it (like PowerPoint), and new paragraphs copy their neighbour's.

import {
  type Package,
  addRelationship,
  editContentTypes,
  emptyRels,
  freeName,
  mainPart,
  related,
  relativeTarget,
  relsNameOf,
  withParts,
  xmlOf,
} from './pkg';
import { type SlideInfo, notesBody, paragraphTexts, paragraphsOf } from './deck';
import { NS, REL, child, children, create, descendants, path } from './xml';

/** A soft line break inside a paragraph (Shift+Enter), shown as a new line. */
export const LINE_BREAK = ' ';

type Piece = { char: string; from: number };

/** Replaces the paragraphs of a text body (p:txBody or a:txBody) with `next`. */
export function patchParagraphs(body: Element, next: string[]): void {
  const doc = body.ownerDocument;
  const old = children(body, NS.a, 'p');
  const texts = paragraphTexts(body);
  const wanted = next.length ? next : [''];
  let start = 0;
  while (start < old.length && start < wanted.length && texts[start] === wanted[start]) start++;
  let end = 0;
  while (
    end < old.length - start &&
    end < wanted.length - start &&
    texts[old.length - 1 - end] === wanted[wanted.length - 1 - end]
  ) {
    end++;
  }
  const oldMiddle = old.slice(start, old.length - end);
  const newMiddle = wanted.slice(start, wanted.length - end);
  let previous: Element | null = old[start - 1] ?? null;
  for (let i = 0; i < Math.max(oldMiddle.length, newMiddle.length); i++) {
    const paragraph = oldMiddle[i];
    const text = newMiddle[i];
    if (paragraph && text !== undefined) {
      patchParagraph(paragraph, text);
      previous = paragraph;
    } else if (text !== undefined) {
      const template = previous ?? oldMiddle[oldMiddle.length - 1] ?? old[old.length - end] ?? null;
      const created = newParagraph(doc, template, text);
      if (previous) previous.after(created);
      else if (old[start + oldMiddle.length]) old[start + oldMiddle.length]!.before(created);
      else body.append(created);
      previous = created;
    } else if (paragraph) {
      paragraph.remove();
    }
  }
  if (children(body, NS.a, 'p').length === 0) body.append(newParagraph(doc, null, ''));
}

function segments(paragraph: Element): Element[] {
  return [...paragraph.children].filter(
    (node) => node.namespaceURI === NS.a && (node.localName === 'r' || node.localName === 'fld' || node.localName === 'br'),
  );
}

const textOfSegment = (node: Element) => (node.localName === 'br' ? LINE_BREAK : (child(node, NS.a, 't')?.textContent ?? ''));

/** Changes one paragraph's text to `next`, rewriting only the runs that changed. */
export function patchParagraph(paragraph: Element, next: string): void {
  const doc = paragraph.ownerDocument;
  const nodes = segments(paragraph);
  const pieces: Piece[] = [];
  nodes.forEach((node, from) => {
    for (const char of textOfSegment(node)) pieces.push({ char, from });
  });
  const before = pieces.map((p) => p.char).join('');
  if (before === next) return;
  const oldChars = [...before];
  const newChars = [...next];
  let prefix = 0;
  while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldChars.length - prefix &&
    suffix < newChars.length - prefix &&
    oldChars[oldChars.length - 1 - suffix] === newChars[newChars.length - 1 - suffix]
  ) {
    suffix++;
  }
  // Typed text is formatted like the character before it (or after it, at the start).
  const style = pieces[prefix - 1]?.char !== LINE_BREAK ? pieces[prefix - 1] : undefined;
  const from = style?.from ?? pieces[prefix]?.from ?? -1;
  const inserted = newChars.slice(prefix, newChars.length - suffix).map((char) => ({ char, from }));
  const result = [...pieces.slice(0, prefix), ...inserted, ...pieces.slice(pieces.length - suffix)];

  // Group consecutive characters from the same original run; line breaks stand alone.
  const groups: { from: number; text: string }[] = [];
  for (const piece of result) {
    const last = groups[groups.length - 1];
    if (piece.char !== LINE_BREAK && last && last.from === piece.from && !last.text.endsWith(LINE_BREAK)) last.text += piece.char;
    else groups.push({ from: piece.from, text: piece.char });
  }
  const used = new Set<number>();
  const built: Element[] = groups.map((group) => {
    const original = nodes[group.from];
    if (group.text === LINE_BREAK) {
      if (original?.localName === 'br' && !used.has(group.from)) {
        used.add(group.from);
        return original;
      }
      const br = create(doc, NS.a, 'br', 'a');
      const rPr = original ? child(original, NS.a, 'rPr') : endProperties(paragraph);
      if (rPr) br.append(asRunProperties(doc, rPr));
      return br;
    }
    if (original && original.localName !== 'br' && textOfSegment(original) === group.text && !used.has(group.from)) {
      used.add(group.from);
      return original;
    }
    return makeRun(doc, original && original.localName !== 'br' ? child(original, NS.a, 'rPr') : endProperties(paragraph), group.text);
  });
  const anchor = nodes[0] ?? child(paragraph, NS.a, 'endParaRPr');
  const marker = doc.createComment('folio');
  if (anchor) anchor.before(marker);
  else paragraph.append(marker);
  for (const node of nodes) if (!built.includes(node)) node.remove();
  for (const node of built) marker.before(node);
  marker.remove();
}

function endProperties(paragraph: Element): Element | null {
  return child(paragraph, NS.a, 'endParaRPr');
}

/** `a:rPr` from run properties or end-of-paragraph properties (same attributes). */
function asRunProperties(doc: Document, source: Element): Element {
  const rPr = create(doc, NS.a, 'rPr', 'a');
  for (const attribute of [...source.attributes]) rPr.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  for (const node of [...source.childNodes]) rPr.append(node.cloneNode(true));
  return rPr;
}

function makeRun(doc: Document, properties: Element | null, text: string): Element {
  const run = create(doc, NS.a, 'r', 'a');
  if (properties) {
    const rPr = asRunProperties(doc, properties);
    // Spell-check marks belong to the old text.
    rPr.removeAttribute('err');
    run.append(rPr);
  }
  const t = create(doc, NS.a, 't', 'a');
  t.textContent = text;
  run.append(t);
  return run;
}

function newParagraph(doc: Document, template: Element | null, text: string): Element {
  const paragraph = create(doc, NS.a, 'p', 'a');
  const pPr = template ? child(template, NS.a, 'pPr') : null;
  if (pPr) paragraph.append(pPr.cloneNode(true));
  const lastRun = template ? [...segments(template)].reverse().find((n) => n.localName === 'r') : undefined;
  const properties = (lastRun && child(lastRun, NS.a, 'rPr')) ?? (template ? endProperties(template) : null);
  const end = create(doc, NS.a, 'endParaRPr', 'a');
  if (properties) {
    for (const attribute of [...properties.attributes]) end.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    for (const node of [...properties.childNodes]) end.append(node.cloneNode(true));
  }
  paragraph.append(end);
  if (text) patchParagraph(paragraph, text);
  return paragraph;
}

// ---- Shapes and notes -----------------------------------------------------------------------

/** The shape element (p:sp, p:pic, p:graphicFrame, p:grpSp, p:cxnSp) with this cNvPr id. */
export function findShape(doc: Document, id: string): Element | null {
  for (const cNvPr of descendants(doc, NS.p, 'cNvPr')) {
    if (cNvPr.getAttribute('id') === id) return cNvPr.parentElement?.parentElement ?? null;
  }
  return null;
}

/** The text of a shape on a slide, as paragraphs (null when it holds no text). */
export function shapeText(pkg: Package, slidePart: string, id: string): string[] | null {
  const doc = xmlOf(pkg, slidePart);
  const shape = doc && findShape(doc, id);
  if (!shape || shape.localName !== 'sp') return null;
  return paragraphsOf(shape);
}

/** Sets a shape's text. Shapes without a text body get one. */
export function setShapeText(pkg: Package, slidePart: string, id: string, paragraphs: string[]): Package {
  const doc = xmlOf(pkg, slidePart)!;
  const shape = findShape(doc, id);
  if (!shape || shape.localName !== 'sp') throw new Error('That shape has no text.');
  let body = child(shape, NS.p, 'txBody');
  if (!body) {
    body = create(doc, NS.p, 'txBody', 'p');
    body.append(create(doc, NS.a, 'bodyPr', 'a'), create(doc, NS.a, 'lstStyle', 'a'));
    const after = child(shape, NS.p, 'style') ?? child(shape, NS.p, 'spPr');
    if (after) after.after(body);
    else shape.append(body);
  }
  const before = paragraphsOf(shape);
  if (before.length === paragraphs.length && before.every((text, i) => text === paragraphs[i])) return pkg;
  patchParagraphs(body, paragraphs);
  dropParagraphAnimations(doc, id, children(body, NS.a, 'p').length);
  return withParts(pkg, { [slidePart]: doc });
}

/**
 * Animations can target paragraphs of a shape ("by paragraph" builds). When an edit leaves
 * fewer paragraphs, effects on paragraphs that no longer exist are removed, so PowerPoint
 * never finds an animation pointing past the text. Returns how many were removed.
 */
export function dropParagraphAnimations(doc: Document, id: string, count: number): number {
  const timing = child(doc.documentElement, NS.p, 'timing');
  if (!timing) return 0;
  let removed = 0;
  for (const target of descendants(timing, NS.p, 'spTgt')) {
    if (target.getAttribute('spid') !== id || !timing.contains(target)) continue;
    const range = path(target, NS.p, 'txEl', 'pRg');
    if (!range || Number(range.getAttribute('end') ?? 0) < count) continue;
    let node: Element | null = target;
    while (node && node !== timing && !(node.localName === 'par' && child(node, NS.p, 'cTn')?.hasAttribute('presetClass'))) {
      node = node.parentElement;
    }
    if (node && node !== timing) {
      node.remove();
      removed += 1;
    }
  }
  if (removed && descendants(timing, NS.p, 'cTn').every((c) => !c.hasAttribute('presetClass'))) timing.remove();
  return removed;
}

/** Sets a slide's speaker notes, creating its notes page when it has none. */
export function setNotes(pkg: Package, slide: SlideInfo, text: string): Package {
  const lines = text.split('\n');
  if (!slide.notesPart) {
    if (text === '') return pkg;
    const created = createNotes(pkg, slide);
    if (!created) throw new Error("This presentation has no notes page layout, so notes can't be added.");
    return setNotes(created.pkg, { ...slide, notesPart: created.part }, text);
  }
  const doc = xmlOf(pkg, slide.notesPart)!;
  const shape = notesBody(doc);
  if (!shape) throw new Error("This slide's notes page has no place for notes.");
  const body = child(shape, NS.p, 'txBody');
  if (!body) throw new Error("This slide's notes page has no place for notes.");
  const before = paragraphsOf(shape);
  if (before.join('\n') === text) return pkg;
  patchParagraphs(body, lines);
  return withParts(pkg, { [slide.notesPart]: doc });
}

/** A notes page for a slide that has none, based on the deck's notes master. */
function createNotes(pkg: Package, slide: SlideInfo): { pkg: Package; part: string } | null {
  const main = mainPart(pkg);
  const master = related(pkg, main, REL.notesMaster)[0]?.part;
  if (!master) return null;
  const masterDoc = xmlOf(pkg, master)!;
  const placeholderOf = (type: string) =>
    descendants(masterDoc, NS.p, 'ph').find((ph) => ph.getAttribute('type') === type)?.getAttribute('idx');
  const part = freeName(pkg, 'ppt/notesSlides', 'notesSlide', 'xml');
  const imageIdx = placeholderOf('sldImg');
  const bodyIdx = placeholderOf('body');
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    `<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>' +
    `<p:nvPr><p:ph type="sldImg"${imageIdx ? ` idx="${imageIdx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    `<p:nvPr><p:ph type="body"${bodyIdx ? ` idx="${bodyIdx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr/>` +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
  const notesRels = emptyRels();
  addRelationship(notesRels, REL.notesMaster, relativeTarget(part, master), 'rId1');
  addRelationship(notesRels, REL.slide, relativeTarget(part, slide.part), 'rId2');
  const slideRels = xmlOf(pkg, relsNameOf(slide.part)) ?? emptyRels();
  addRelationship(slideRels, REL.notesSlide, relativeTarget(slide.part, part));
  const types = xmlOf(pkg, '[Content_Types].xml')!;
  editContentTypes(types, { add: { [part]: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml' } });
  return {
    pkg: withParts(pkg, {
      [part]: xml,
      [relsNameOf(part)]: notesRels,
      [relsNameOf(slide.part)]: slideRels,
      '[Content_Types].xml': types,
    }),
    part,
  };
}

/** Whether a slide's notes can be edited (it has notes, or the deck can make them). */
export function canEditNotes(pkg: Package, slide: SlideInfo): boolean {
  return Boolean(slide.notesPart) || related(pkg, mainPart(pkg), REL.notesMaster).length > 0;
}

export const placeholderType = (shape: Element) => path(shape, NS.p, 'nvSpPr', 'nvPr', 'ph')?.getAttribute('type') ?? null;

/** Text placeholders on a slide with no text yet, and the hint each shows (by cNvPr id). */
export function emptyPlaceholders(pkg: Package, slidePart: string): Map<string, string> {
  const hints = new Map<string, string>();
  const doc = xmlOf(pkg, slidePart);
  if (!doc) return hints;
  for (const sp of descendants(doc, NS.p, 'sp')) {
    const ph = path(sp, NS.p, 'nvSpPr', 'nvPr', 'ph');
    const id = path(sp, NS.p, 'nvSpPr', 'cNvPr')?.getAttribute('id');
    if (!ph || !id || !child(sp, NS.p, 'txBody') || paragraphsOf(sp).some((p) => p.length > 0)) continue;
    const type = ph.getAttribute('type') ?? 'body';
    if (['dt', 'ftr', 'sldNum', 'hdr'].includes(type)) continue;
    hints.set(
      id,
      type === 'title' || type === 'ctrTitle'
        ? 'Double-click to add a title'
        : type === 'subTitle'
          ? 'Double-click to add a subtitle'
          : 'Double-click to add text',
    );
  }
  return hints;
}

// ---- Tables ---------------------------------------------------------------------------------

/** A table's cells, by row, as text ('\n' between paragraphs); null for merged-away cells. */
export function tableText(pkg: Package, slidePart: string, id: string): (string | null)[][] | null {
  const doc = xmlOf(pkg, slidePart);
  const table = doc && tableOf(doc, id);
  if (!table) return null;
  return children(table, NS.a, 'tr').map((row) =>
    children(row, NS.a, 'tc').map((cell) =>
      cell.getAttribute('hMerge') === '1' || cell.getAttribute('vMerge') === '1'
        ? null
        : (child(cell, NS.a, 'txBody') ? paragraphTexts(child(cell, NS.a, 'txBody')!) : []).join('\n'),
    ),
  );
}

function tableOf(doc: Document, id: string): Element | null {
  const frame = findShape(doc, id);
  if (!frame || frame.localName !== 'graphicFrame') return null;
  return descendants(frame, NS.a, 'tbl')[0] ?? null;
}

/** Sets the text of a table's cells (null leaves a cell as it is). */
export function setTableText(pkg: Package, slidePart: string, id: string, cells: (string | null)[][]): Package {
  const doc = xmlOf(pkg, slidePart)!;
  const table = tableOf(doc, id);
  if (!table) throw new Error("That isn't a table.");
  let changed = false;
  children(table, NS.a, 'tr').forEach((row, r) => {
    children(row, NS.a, 'tc').forEach((cell, c) => {
      const text = cells[r]?.[c];
      if (text === null || text === undefined) return;
      let body = child(cell, NS.a, 'txBody');
      const before = body ? paragraphTexts(body).join('\n') : '';
      if (before === text) return;
      if (!body) {
        body = create(doc, NS.a, 'txBody', 'a');
        body.append(create(doc, NS.a, 'bodyPr', 'a'), create(doc, NS.a, 'lstStyle', 'a'));
        cell.prepend(body);
      }
      patchParagraphs(body, text.split('\n'));
      changed = true;
    });
  });
  return changed ? withParts(pkg, { [slidePart]: doc }) : pkg;
}
