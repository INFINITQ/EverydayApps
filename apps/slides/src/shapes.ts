// Shape edits on a slide: move and resize, delete, replace or insert a picture. Each edit
// rewrites the slide part (and adds a media part for a new picture); a deleted shape's
// animations go with it, so PowerPoint never finds a timeline pointing at nothing.

import { collectGarbage, reachable } from './deck';
import {
  type Package,
  addRelationship,
  editContentTypes,
  freeName,
  relationships,
  relativeTarget,
  relsNameOf,
  withParts,
  xmlOf,
} from './pkg';
import { findShape } from './text';
import { NS, REL, child, children, create, descendants, path } from './xml';

export type Bounds = { x: number; y: number; w: number; h: number };

/** EMU per CSS pixel at 96 dpi. */
export const EMU_PER_PX = 9525;

/** Picture types Folio can put on a slide, with the content type PowerPoint expects. */
export const PICTURE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

function transformOf(shape: Element, create_: boolean): Element | null {
  const doc = shape.ownerDocument;
  if (shape.localName === 'graphicFrame') {
    let xfrm = child(shape, NS.p, 'xfrm');
    if (!xfrm && create_) {
      xfrm = create(doc, NS.p, 'xfrm', 'p');
      child(shape, NS.p, 'nvGraphicFramePr')?.after(xfrm);
    }
    return xfrm;
  }
  const props = child(shape, NS.p, shape.localName === 'grpSp' ? 'grpSpPr' : 'spPr');
  if (!props) return null;
  let xfrm = child(props, NS.a, 'xfrm');
  if (!xfrm && create_) {
    xfrm = create(doc, NS.a, 'xfrm', 'a');
    props.prepend(xfrm);
  }
  return xfrm;
}

/** Moves and/or resizes a shape (bounds in EMU). */
export function setBounds(pkg: Package, slidePart: string, id: string, bounds: Bounds): Package {
  const doc = xmlOf(pkg, slidePart)!;
  const shape = findShape(doc, id);
  if (!shape) throw new Error('That shape is no longer on the slide.');
  const xfrm = transformOf(shape, true);
  if (!xfrm) throw new Error("That shape can't be moved.");
  let off = child(xfrm, NS.a, 'off');
  let ext = child(xfrm, NS.a, 'ext');
  if (!off) {
    off = create(doc, NS.a, 'off', 'a');
    xfrm.prepend(off);
  }
  if (!ext) {
    ext = create(doc, NS.a, 'ext', 'a');
    off.after(ext);
  }
  off.setAttribute('x', String(Math.round(bounds.x)));
  off.setAttribute('y', String(Math.round(bounds.y)));
  ext.setAttribute('cx', String(Math.max(1, Math.round(bounds.w))));
  ext.setAttribute('cy', String(Math.max(1, Math.round(bounds.h))));
  return withParts(pkg, { [slidePart]: doc });
}

/** Whether animations on the slide refer to this shape. */
export function isAnimated(pkg: Package, slidePart: string, id: string): boolean {
  const doc = xmlOf(pkg, slidePart);
  const timing = doc && child(doc.documentElement, NS.p, 'timing');
  return Boolean(timing && descendants(timing, NS.p, 'spTgt').some((t) => t.getAttribute('spid') === id));
}

/** Deletes a shape, its animations, and what only it used (a picture's image...). */
export function deleteShape(pkg: Package, slidePart: string, id: string): Package {
  const before = reachable(pkg);
  const doc = xmlOf(pkg, slidePart)!;
  const shape = findShape(doc, id);
  if (!shape) return pkg;
  const ids = new Set([id, ...descendants(shape, NS.p, 'cNvPr').map((c) => c.getAttribute('id') ?? '')]);
  const used = relIdsIn(shape);
  shape.remove();
  removeAnimations(doc, ids);
  const still = relIdsIn(doc.documentElement);
  const changes: Record<string, Document> = { [slidePart]: doc };
  const orphaned = [...used].filter((rid) => !still.has(rid));
  if (orphaned.length) {
    const rels = xmlOf(pkg, relsNameOf(slidePart))!;
    for (const rel of children(rels.documentElement, NS.rel, 'Relationship')) {
      if (orphaned.includes(rel.getAttribute('Id') ?? '')) rel.remove();
    }
    changes[relsNameOf(slidePart)] = rels;
  }
  return collectGarbage(withParts(pkg, changes), before);
}

/** Relationship ids used in an element's subtree (r:embed, r:link, r:id...). */
function relIdsIn(root: Element): Set<string> {
  const ids = new Set<string>();
  for (const element of [root, ...root.getElementsByTagName('*')]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.namespaceURI === NS.r && attribute.value) ids.add(attribute.value);
    }
  }
  return ids;
}

/** Removes the effects that animate `ids` (and builds), dropping the timeline if it empties. */
function removeAnimations(doc: Document, ids: Set<string>) {
  const timing = child(doc.documentElement, NS.p, 'timing');
  if (!timing) return;
  for (const target of descendants(timing, NS.p, 'spTgt')) {
    if (!ids.has(target.getAttribute('spid') ?? '') || !timing.contains(target)) continue;
    let node: Element | null = target;
    let doomed: Element | null = null;
    while (node && node !== timing) {
      const cTn = child(node, NS.p, 'cTn');
      if (node.localName === 'par' && cTn?.hasAttribute('presetClass')) {
        doomed = node;
        break;
      }
      // A trigger ("on click of this shape") owns a whole interactive sequence.
      if (node.localName === 'seq' && cTn?.getAttribute('nodeType') === 'interactiveSeq') {
        doomed = node;
        break;
      }
      node = node.parentElement;
    }
    if (!doomed) continue;
    let parent = doomed.parentElement;
    doomed.remove();
    // Containers left empty go too, up to the main sequence.
    while (parent && parent.localName === 'childTnLst' && parent.children.length === 0) {
      const timeNode = parent.parentElement;
      const container = timeNode?.parentElement;
      if (!timeNode || !container || timeNode.getAttribute('nodeType') === 'mainSeq' || timeNode.getAttribute('nodeType') === 'tmRoot') break;
      parent = container.parentElement;
      container.remove();
    }
  }
  const builds = child(timing, NS.p, 'bldLst');
  if (builds) {
    for (const build of [...builds.children]) if (ids.has(build.getAttribute('spid') ?? '')) build.remove();
    if (builds.children.length === 0) builds.remove();
  }
  const effects = descendants(timing, NS.p, 'cTn').filter((c) => c.hasAttribute('presetClass'));
  if (effects.length === 0) timing.remove();
}

/** Adds an image part for a slide; returns the package and the relationship id. */
function addImage(pkg: Package, slidePart: string, bytes: Uint8Array, ext: string, reserved: Set<string>): { pkg: Package; rid: string } {
  const type = PICTURE_TYPES[ext];
  if (!type) throw new Error('Folio can add PNG, JPEG, GIF and BMP pictures.');
  const name = freeName(pkg, 'ppt/media', 'image', ext === 'jpeg' ? 'jpg' : ext, reserved);
  reserved.add(name);
  const rels = xmlOf(pkg, relsNameOf(slidePart))!;
  const rid = addRelationship(rels, REL.image, relativeTarget(slidePart, name));
  const types = xmlOf(pkg, '[Content_Types].xml')!;
  editContentTypes(types, { defaults: { [ext === 'jpeg' ? 'jpg' : ext]: type } });
  return { pkg: withParts(pkg, { [name]: bytes, [relsNameOf(slidePart)]: rels, '[Content_Types].xml': types }), rid };
}

/** The largest box of the picture's proportions that fits `frame`, centred in it. */
export function fit(frame: Bounds, width: number, height: number): Bounds {
  if (!(width > 0 && height > 0)) return frame;
  const scale = Math.min(frame.w / width, frame.h / height);
  const w = width * scale;
  const h = height * scale;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h };
}

/**
 * Replaces a picture's image, fitting the new one inside the old frame. Crops and image
 * effects that belonged to the old image (and an SVG version of it) are removed.
 */
export function replacePicture(
  pkg: Package,
  slidePart: string,
  id: string,
  image: { bytes: Uint8Array; ext: string; width: number; height: number },
  reserved: Set<string> = new Set(),
): Package {
  const before = reachable(pkg);
  const added = addImage(pkg, slidePart, image.bytes, image.ext, reserved);
  const doc = xmlOf(added.pkg, slidePart)!;
  const shape = findShape(doc, id);
  const blipFill = shape && child(shape, NS.p, 'blipFill');
  const blip = blipFill && child(blipFill, NS.a, 'blip');
  if (!shape || !blip) throw new Error("That isn't a picture.");
  const old = new Set([blip.getAttributeNS(NS.r, 'embed'), blip.getAttributeNS(NS.r, 'link')].filter(Boolean) as string[]);
  for (const id_ of relIdsIn(blip)) old.add(id_);
  blip.removeAttributeNS(NS.r, 'link');
  blip.setAttributeNS(NS.r, `${doc.documentElement.lookupPrefix(NS.r) ?? 'r'}:embed`, added.rid);
  child(blip, NS.a, 'extLst')?.remove();
  child(blipFill, NS.a, 'srcRect')?.remove();
  const xfrm = transformOf(shape, false);
  const off = child(xfrm, NS.a, 'off');
  const ext = child(xfrm, NS.a, 'ext');
  let pkgNext = withParts(added.pkg, { [slidePart]: doc });
  if (off && ext) {
    const frame = { x: Number(off.getAttribute('x')), y: Number(off.getAttribute('y')), w: Number(ext.getAttribute('cx')), h: Number(ext.getAttribute('cy')) };
    pkgNext = setBounds(pkgNext, slidePart, id, fit(frame, image.width, image.height));
  }
  // The old image's relationship goes if nothing else on the slide uses it.
  const finalDoc = xmlOf(pkgNext, slidePart)!;
  const still = relIdsIn(finalDoc.documentElement);
  const rels = xmlOf(pkgNext, relsNameOf(slidePart))!;
  let changed = false;
  for (const rel of children(rels.documentElement, NS.rel, 'Relationship')) {
    const rid = rel.getAttribute('Id') ?? '';
    if (old.has(rid) && !still.has(rid)) {
      rel.remove();
      changed = true;
    }
  }
  if (changed) pkgNext = withParts(pkgNext, { [relsNameOf(slidePart)]: rels });
  return collectGarbage(pkgNext, before);
}

/** Puts a new picture in the middle of the slide (at most half its size). */
export function insertPicture(
  pkg: Package,
  slidePart: string,
  slide: { cx: number; cy: number },
  image: { bytes: Uint8Array; ext: string; width: number; height: number; name: string },
  reserved: Set<string> = new Set(),
): { pkg: Package; id: string } {
  const added = addImage(pkg, slidePart, image.bytes, image.ext, reserved);
  const doc = xmlOf(added.pkg, slidePart)!;
  const tree = path(doc.documentElement, NS.p, 'cSld', 'spTree');
  if (!tree) throw new Error("This slide can't hold pictures.");
  const used = descendants(doc, NS.p, 'cNvPr').map((c) => Number(c.getAttribute('id')) || 0);
  const id = String(Math.max(1, ...used) + 1);
  const natural = { w: image.width * EMU_PER_PX, h: image.height * EMU_PER_PX };
  const box = fit({ x: slide.cx / 4, y: slide.cy / 4, w: slide.cx / 2, h: slide.cy / 2 }, natural.w, natural.h);
  const bounds = natural.w <= slide.cx / 2 && natural.h <= slide.cy / 2
    ? { x: (slide.cx - natural.w) / 2, y: (slide.cy - natural.h) / 2, ...natural }
    : box;
  const p = doc.documentElement.lookupPrefix(NS.p) ?? 'p';
  const a = doc.documentElement.lookupPrefix(NS.a) ?? 'a';
  const r = doc.documentElement.lookupPrefix(NS.r) ?? 'r';
  const name = image.name.replace(/[<>&"]/g, '');
  const xml =
    `<${p}:pic xmlns:${p}="${NS.p}" xmlns:${a}="${NS.a}" xmlns:${r}="${NS.r}"><${p}:nvPicPr><${p}:cNvPr id="${id}" name="Picture ${id}" descr="${name}"/>` +
    `<${p}:cNvPicPr><${a}:picLocks noChangeAspect="1"/></${p}:cNvPicPr><${p}:nvPr/></${p}:nvPicPr>` +
    `<${p}:blipFill><${a}:blip ${r}:embed="${added.rid}"/><${a}:stretch><${a}:fillRect/></${a}:stretch></${p}:blipFill>` +
    `<${p}:spPr><${a}:xfrm><${a}:off x="${Math.round(bounds.x)}" y="${Math.round(bounds.y)}"/><${a}:ext cx="${Math.round(bounds.w)}" cy="${Math.round(bounds.h)}"/></${a}:xfrm>` +
    `<${a}:prstGeom prst="rect"><${a}:avLst/></${a}:prstGeom></${p}:spPr></${p}:pic>`;
  const fragment = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
  const pic = doc.importNode(fragment, true);
  // Drop the namespace declarations the fragment needed on its own.
  for (const attribute of [...pic.attributes]) if (attribute.name.startsWith('xmlns:')) pic.removeAttribute(attribute.name);
  const extLst = child(tree, NS.p, 'extLst');
  tree.insertBefore(pic, extLst);
  return { pkg: withParts(added.pkg, { [slidePart]: doc }), id };
}

/** Relationships of a slide that point outside the file (linked pictures, media, web links). */
export function externalLinks(pkg: Package, part: string) {
  return relationships(pkg, part).filter((rel) => rel.external);
}

/**
 * The text shapes inside a group, with where they are on the slide (EMU): the group's
 * transform (and any nested group's) maps its children's coordinates onto the slide.
 */
export function groupTextShapes(pkg: Package, slidePart: string, groupId: string): { id: string; box: Bounds }[] {
  const doc = xmlOf(pkg, slidePart);
  const group = doc && findShape(doc, groupId);
  if (!group || group.localName !== 'grpSp') return [];
  const out: { id: string; box: Bounds }[] = [];
  type Map_ = (b: Bounds) => Bounds;
  const walk = (container: Element, map: Map_) => {
    const xfrm = child(child(container, NS.p, 'grpSpPr'), NS.a, 'xfrm');
    const n = (element: Element | null, a: string) => Number(element?.getAttribute(a) ?? 0);
    const off = child(xfrm, NS.a, 'off');
    const ext = child(xfrm, NS.a, 'ext');
    const chOff = child(xfrm, NS.a, 'chOff');
    const chExt = child(xfrm, NS.a, 'chExt');
    const sx = n(chExt, 'cx') ? n(ext, 'cx') / n(chExt, 'cx') : 1;
    const sy = n(chExt, 'cy') ? n(ext, 'cy') / n(chExt, 'cy') : 1;
    const inner: Map_ = (b) =>
      map({ x: n(off, 'x') + (b.x - n(chOff, 'x')) * sx, y: n(off, 'y') + (b.y - n(chOff, 'y')) * sy, w: b.w * sx, h: b.h * sy });
    for (let item = container.firstElementChild; item; item = item.nextElementSibling) {
      if (item.namespaceURI !== NS.p) continue;
      if (item.localName === 'grpSp') walk(item, inner);
      if (item.localName !== 'sp' || !child(item, NS.p, 'txBody')) continue;
      const own = child(child(item, NS.p, 'spPr'), NS.a, 'xfrm');
      const at = child(own, NS.a, 'off');
      const size = child(own, NS.a, 'ext');
      const id = path(item, NS.p, 'nvSpPr', 'cNvPr')?.getAttribute('id');
      if (!at || !size || !id) continue;
      out.push({ id, box: inner({ x: n(at, 'x'), y: n(at, 'y'), w: n(size, 'cx'), h: n(size, 'cy') }) });
    }
  };
  walk(group, (b) => b);
  return out;
}
