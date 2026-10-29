// The presentation as Folio edits it: its slide list, notes, and the slide operations
// (reorder, hide, duplicate, delete). Every operation takes a package and returns a new
// one, rewriting only the parts it must; everything else (animations, transitions,
// SmartArt, media, parts Folio doesn't know) is carried over as it was.

import {
  type Package,
  type PartValue,
  addRelationship,
  contentTypeOf,
  editContentTypes,
  emptyRels,
  freeName,
  has,
  mainPart,
  related,
  relationships,
  relativeTarget,
  relsNameOf,
  resolveTarget,
  textOf,
  withParts,
  xmlOf,
} from './pkg';
import { NS, REL, child, children, create, descendants, parseXml, path } from './xml';

export type SlideInfo = {
  /** The slide's part, e.g. ppt/slides/slide3.xml (its identity while the file is open). */
  part: string;
  /** Its id in presentation.xml (p:sldId/@id). */
  id: number;
  /** Its relationship id from the presentation part. */
  relId: string;
  hidden: boolean;
  notesPart: string | null;
};

const SECTIONS_EXT = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}';

export function slidesOf(pkg: Package): SlideInfo[] {
  const main = mainPart(pkg);
  const doc = xmlOf(pkg, main)!;
  const rels = new Map(related(pkg, main, REL.slide).map((rel) => [rel.id, rel.part]));
  const list = path(doc.documentElement, NS.p, 'sldIdLst');
  if (!list) return [];
  const slides: SlideInfo[] = [];
  for (const entry of children(list, NS.p, 'sldId')) {
    const relId = entry.getAttributeNS(NS.r, 'id') ?? '';
    const part = rels.get(relId);
    if (!part || !has(pkg, part)) continue;
    slides.push({
      part,
      id: Number(entry.getAttribute('id')),
      relId,
      hidden: isHidden(textOf(pkg, part) ?? ''),
      notesPart: related(pkg, part, REL.notesSlide).find((rel) => has(pkg, rel.part))?.part ?? null,
    });
  }
  return slides;
}

/** Reads `show="0"` from the slide's root tag without parsing the whole slide. */
function isHidden(xml: string): boolean {
  const root = /<(?:[\w.-]+:)?sld\b[^>]*>/.exec(xml.slice(0, 4096))?.[0] ?? '';
  return /\sshow\s*=\s*["'](0|false)["']/.test(root);
}

/** Slide size in EMU (914400 per inch). */
export function slideSize(pkg: Package): { cx: number; cy: number } {
  const size = path(xmlOf(pkg, mainPart(pkg))!.documentElement, NS.p, 'sldSz');
  return { cx: Number(size?.getAttribute('cx') ?? 12192000), cy: Number(size?.getAttribute('cy') ?? 6858000) };
}

/** The shape holding the notes text on a notes slide (its body placeholder). */
export function notesBody(doc: Document): Element | null {
  for (const sp of descendants(doc, NS.p, 'sp')) {
    const ph = path(sp, NS.p, 'nvSpPr', 'nvPr', 'ph');
    if (ph?.getAttribute('type') === 'body') return sp;
  }
  return null;
}

/** Paragraph texts of a shape's text body (`a:br` line breaks become U+2028). */
export function paragraphsOf(shape: Element | null): string[] {
  const body = child(shape, NS.p, 'txBody') ?? child(shape, NS.a, 'txBody');
  return body ? paragraphTexts(body) : [];
}

/** Paragraph texts of a text body (p:txBody or a:txBody). */
export function paragraphTexts(body: Element): string[] {
  return children(body, NS.a, 'p').map((p) => {
    let text = '';
    for (let node = p.firstElementChild; node; node = node.nextElementSibling) {
      if (node.namespaceURI !== NS.a) continue;
      if (node.localName === 'r' || node.localName === 'fld') text += child(node, NS.a, 't')?.textContent ?? '';
      else if (node.localName === 'br') text += ' ';
    }
    return text;
  });
}

export function notesOf(pkg: Package, slide: SlideInfo): string {
  if (!slide.notesPart) return '';
  const doc = xmlOf(pkg, slide.notesPart);
  return doc ? paragraphsOf(notesBody(doc)).join('\n') : '';
}

export function hasMacros(pkg: Package): boolean {
  const main = mainPart(pkg);
  return (
    related(pkg, main, REL.vbaProject).length > 0 ||
    /macroEnabled/i.test(contentTypeOf(pkg, main) ?? '')
  );
}

// ---- Reorder and hide ---------------------------------------------------------------------

/** Puts the slides in this order (a permutation of the parts in slidesOf). */
export function reorderSlides(pkg: Package, order: string[]): Package {
  const main = mainPart(pkg);
  const doc = xmlOf(pkg, main)!;
  const list = path(doc.documentElement, NS.p, 'sldIdLst')!;
  const slides = slidesOf(pkg);
  const byPart = new Map(slides.map((s) => [s.part, s]));
  if (order.length !== slides.length || order.some((part) => !byPart.has(part))) throw new Error('Not a reordering');
  const entries = new Map(children(list, NS.p, 'sldId').map((e) => [e.getAttributeNS(NS.r, 'id'), e]));
  for (const part of order) list.append(entries.get(byPart.get(part)!.relId)!);
  fixSections(doc, order.map((part) => byPart.get(part)!.id));
  return withParts(pkg, { [main]: doc });
}

export function setHidden(pkg: Package, part: string, hidden: boolean): Package {
  const doc = xmlOf(pkg, part)!;
  if (hidden) doc.documentElement.setAttribute('show', '0');
  else doc.documentElement.removeAttribute('show');
  return withParts(pkg, { [part]: doc });
}

/** Sections (PowerPoint 2010+) list slide ids; keep them contiguous and in slide order. */
function fixSections(doc: Document, order: number[]) {
  const sections = sectionsOf(doc);
  if (sections.length === 0) return;
  const sectionOf = new Map<number, number>();
  sections.forEach((section, index) => section.ids.forEach((id) => sectionOf.set(id, index)));
  const lists: number[][] = sections.map(() => []);
  let current = 0;
  for (const id of order) {
    const own = sectionOf.get(id) ?? current;
    // A slide moved into an earlier section's range joins the section it now sits in.
    if (own > current) current = own;
    lists[current]!.push(id);
  }
  sections.forEach((section, index) => {
    for (const old of children(section.list, NS.p14, 'sldId')) old.remove();
    for (const id of lists[index]!) {
      const entry = create(doc, NS.p14, 'sldId', 'p14');
      entry.setAttribute('id', String(id));
      section.list.append(entry);
    }
  });
}

function sectionsOf(doc: Document): { list: Element; ids: number[] }[] {
  const out: { list: Element; ids: number[] }[] = [];
  const ext = children(path(doc.documentElement, NS.p, 'extLst') ?? doc.documentElement, NS.p, 'ext').find(
    (e) => e.getAttribute('uri') === SECTIONS_EXT,
  );
  if (!ext) return out;
  for (const section of descendants(ext, NS.p14, 'section')) {
    let list = child(section, NS.p14, 'sldIdLst');
    if (!list) {
      list = create(doc, NS.p14, 'sldIdLst', 'p14');
      section.append(list);
    }
    out.push({ list, ids: children(list, NS.p14, 'sldId').map((e) => Number(e.getAttribute('id'))) });
  }
  return out;
}

// ---- Delete -------------------------------------------------------------------------------

/** Every part reachable from the package root through internal relationships. */
export function reachable(pkg: Package): Set<string> {
  const seen = new Set<string>();
  const queue = [''];
  while (queue.length) {
    const source = queue.pop()!;
    for (const rel of related(pkg, source)) {
      if (seen.has(rel.part) || !has(pkg, rel.part)) continue;
      seen.add(rel.part);
      queue.push(rel.part);
    }
  }
  return seen;
}

/**
 * Removes parts that `before` could reach and the package no longer can (a deleted slide's
 * notes, a replaced picture...), with their relationships and content types. Parts that
 * were unreachable to begin with are left alone: they're the author's, not ours.
 */
export function collectGarbage(pkg: Package, before: Set<string>): Package {
  const after = reachable(pkg);
  const gone = [...before].filter((part) => !after.has(part) && has(pkg, part));
  if (gone.length === 0) return pkg;
  const types = xmlOf(pkg, '[Content_Types].xml')!;
  editContentTypes(types, { remove: gone });
  const changes: Record<string, Document | null> = { '[Content_Types].xml': types };
  for (const part of gone) {
    changes[part] = null;
    if (has(pkg, relsNameOf(part))) changes[relsNameOf(part)] = null;
  }
  return withParts(pkg, changes);
}

/** Deletes slides, with the parts only they used. Links to them from other slides are removed. */
export function deleteSlides(pkg: Package, parts: string[]): Package {
  const before = reachable(pkg);
  const main = mainPart(pkg);
  const doc = xmlOf(pkg, main)!;
  const slides = slidesOf(pkg).filter((s) => parts.includes(s.part));
  const removedIds = new Set(slides.map((s) => s.id));
  const removedRels = new Set(slides.map((s) => s.relId));
  const list = path(doc.documentElement, NS.p, 'sldIdLst')!;
  for (const entry of children(list, NS.p, 'sldId')) {
    if (removedRels.has(entry.getAttributeNS(NS.r, 'id') ?? '')) entry.remove();
  }
  for (const show of descendants(doc, NS.p, 'custShow')) {
    for (const sld of descendants(show, NS.p, 'sld')) {
      if (removedRels.has(sld.getAttributeNS(NS.r, 'id') ?? '')) sld.remove();
    }
  }
  for (const section of sectionsOf(doc)) {
    for (const entry of children(section.list, NS.p14, 'sldId')) {
      if (removedIds.has(Number(entry.getAttribute('id')))) entry.remove();
    }
  }
  const rels = xmlOf(pkg, relsNameOf(main))!;
  for (const rel of children(rels.documentElement, NS.rel, 'Relationship')) {
    if (removedRels.has(rel.getAttribute('Id') ?? '')) rel.remove();
  }
  let next = withParts(pkg, { [main]: doc, [relsNameOf(main)]: rels });
  next = dropLinksTo(next, new Set(slides.map((s) => s.part)));
  return collectGarbage(next, before);
}

/** Removes relationships (and the links or list entries using them) that point at `targets`. */
function dropLinksTo(pkg: Package, targets: Set<string>): Package {
  const changes: Record<string, Document> = {};
  for (const name of pkg.parts.keys()) {
    if (!name.endsWith('.rels')) continue;
    const source = sourceOfRels(name);
    if (targets.has(source) || !has(pkg, source)) continue;
    const doomed = relationships(pkg, source).filter((rel) => !rel.external && targets.has(resolveTarget(source, rel.target)));
    if (doomed.length === 0) continue;
    const ids = new Set(doomed.map((rel) => rel.id));
    const relsDoc = xmlOf(pkg, name)!;
    for (const rel of children(relsDoc.documentElement, NS.rel, 'Relationship')) {
      if (ids.has(rel.getAttribute('Id') ?? '')) rel.remove();
    }
    changes[name] = relsDoc;
    const text = textOf(pkg, source);
    if (text === undefined || !source.endsWith('.xml')) continue;
    const doc = parseXml(text, source);
    for (const element of [...doc.getElementsByTagName('*')]) {
      const id = element.getAttributeNS(NS.r, 'id');
      if (id && ids.has(id)) element.remove();
    }
    changes[source] = doc;
  }
  return withParts(pkg, changes);
}

/** "ppt/slides/_rels/slide1.xml.rels" -> "ppt/slides/slide1.xml". */
export function sourceOfRels(rels: string): string {
  const match = /^(.*?)_rels\/([^/]*)\.rels$/.exec(rels);
  return match ? `${match[1]}${match[2]}` : '';
}

// ---- Duplicate ----------------------------------------------------------------------------

/**
 * Relationship types whose targets belong to one slide (copied with it), as PowerPoint
 * does when it duplicates a slide. Everything else (layouts, pictures, media, links) is
 * shared between the slide and its copy.
 */
const OWNED = new Set(
  [
    'notesSlide',
    'chart',
    'chartUserShapes',
    'diagramData',
    'diagramLayout',
    'diagramQuickStyle',
    'diagramColors',
    'tags',
    'oleObject',
    'package',
    'vmlDrawing',
    'themeOverride',
  ].map((t) => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}`),
);
const OWNED_EXTRA = new Set([
  'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
  'http://schemas.microsoft.com/office/2011/relationships/chartStyle',
  'http://schemas.microsoft.com/office/2011/relationships/chartColorStyle',
]);
/** Comments stay with the original slide. */
const DROPPED = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  'http://schemas.microsoft.com/office/2018/10/relationships/comments',
]);

/** Duplicates a slide right after itself. Returns the new package and the copy's part. */
export function duplicateSlide(pkg: Package, part: string): { pkg: Package; part: string } {
  const main = mainPart(pkg);
  const slide = slidesOf(pkg).find((s) => s.part === part);
  if (!slide) throw new Error('No such slide');
  const types = xmlOf(pkg, '[Content_Types].xml')!;
  const changes: Record<string, PartValue> = {};
  const reserved = new Set<string>();
  const copies = new Map<string, string>();
  const addType: Record<string, string> = {};

  /** Copies `source` (and the parts it owns) to a new name; returns the new name. */
  const copy = (source: string, backTo?: { from: string; to: string }): string => {
    const existing = copies.get(source);
    if (existing) return existing;
    const match = /^(.*)\/([^/]*?)(\d*)\.([^./]+)$/.exec(source);
    const name = match ? freeName(pkg, match[1]!, match[2]!, match[4]!, reserved) : `${source}.copy`;
    reserved.add(name);
    copies.set(source, name);
    const override = children(types.documentElement, NS.ct, 'Override').find(
      (o) => (o.getAttribute('PartName') ?? '').replace(/^\/+/, '').toLowerCase() === source.toLowerCase(),
    );
    if (override) addType[name] = override.getAttribute('ContentType') ?? '';
    changes[name] = pkg.parts.get(source)!;
    const rels = relationships(pkg, source);
    if (rels.length) {
      const doc = emptyRels();
      for (const rel of rels) {
        if (DROPPED.has(rel.type)) continue;
        let target = rel.target;
        if (!rel.external) {
          const resolved = resolveTarget(source, rel.target);
          if (backTo && resolved === backTo.from) target = relativeTarget(name, backTo.to);
          else if ((OWNED.has(rel.type) || OWNED_EXTRA.has(rel.type)) && has(pkg, resolved)) {
            target = relativeTarget(name, copy(resolved, backTo ?? { from: part, to: name }));
          }
        }
        const element = create(doc, NS.rel, 'Relationship', '');
        element.setAttribute('Id', rel.id);
        element.setAttribute('Type', rel.type);
        element.setAttribute('Target', target);
        if (rel.external) element.setAttribute('TargetMode', 'External');
        doc.documentElement.append(element);
      }
      changes[relsNameOf(name)] = doc;
    }
    return name;
  };

  const newPart = copy(part);
  // The copy needs its own creation id, or PowerPoint treats both as the same slide.
  const copyDoc = parseXml(textOf(pkg, part)!, newPart);
  for (const id of descendants(copyDoc, NS.p14, 'creationId')) id.setAttribute('val', String(randomId()));
  changes[newPart] = copyDoc;

  // The presentation lists the copy right after the original.
  const doc = xmlOf(pkg, main)!;
  const presRels = xmlOf(pkg, relsNameOf(main))!;
  const relId = addRelationship(presRels, REL.slide, relativeTarget(main, newPart));
  const list = path(doc.documentElement, NS.p, 'sldIdLst')!;
  const ids = children(list, NS.p, 'sldId').map((e) => Number(e.getAttribute('id')));
  const id = Math.max(255, ...ids) + 1;
  const entry = create(doc, NS.p, 'sldId', 'p');
  entry.setAttribute('id', String(id));
  entry.setAttributeNS(NS.r, `${doc.documentElement.lookupPrefix(NS.r) ?? 'r'}:id`, relId);
  const original = children(list, NS.p, 'sldId').find((e) => e.getAttributeNS(NS.r, 'id') === slide.relId)!;
  original.after(entry);
  for (const section of sectionsOf(doc)) {
    const at = children(section.list, NS.p14, 'sldId').find((e) => Number(e.getAttribute('id')) === slide.id);
    if (!at) continue;
    const added = create(doc, NS.p14, 'sldId', 'p14');
    added.setAttribute('id', String(id));
    at.after(added);
  }
  editContentTypes(types, { add: addType });
  return {
    pkg: withParts(pkg, { ...changes, [main]: doc, [relsNameOf(main)]: presRels, '[Content_Types].xml': types }),
    part: newPart,
  };
}

const randomId = () => crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff;
