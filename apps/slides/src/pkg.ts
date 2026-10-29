// An Office package (the parts inside a .pptx) as an immutable map from part name to
// contents. Every edit makes a new map that shares the parts it didn't touch, so undo is
// just keeping the old map, and saving can tell exactly which parts changed: an untouched
// part is still the very object read from the file, and goes back out byte for byte.

import { NS, REL, children, create, isSafeXml, parseXml, serializeXml } from './xml';
import { type ZipEntry, ZipError, inflateEntry, readZip, writeZip } from './zip';

/** A part as read from the file (inflated on first use) or as written by an edit. */
export type Part = { readonly entry?: ZipEntry; data?: Uint8Array };

export type Package = {
  /** Part names without the leading slash, in file order (new parts at the end). */
  readonly parts: ReadonlyMap<string, Part>;
  readonly comment: Uint8Array;
};

export type Relationship = { id: string; type: string; target: string; external: boolean };

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();
const texts = new WeakMap<Part, string>();

/** Parts that are XML (read up front so edits can work synchronously). */
const isXmlName = (name: string) => /\.(xml|rels|vml)$/i.test(name);

export async function openPackage(bytes: Uint8Array): Promise<Package> {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    // An OLE file: either an old binary deck or an encrypted (password-protected) .pptx.
    throw new ZipError("This file is password-protected or isn't a .pptx, so it can't be opened here.");
  }
  const archive = readZip(bytes);
  const parts = new Map<string, Part>();
  for (const entry of archive.entries) {
    if (entry.name.endsWith('/')) continue;
    parts.set(entry.name.replace(/^\/+/, ''), { entry });
  }
  await Promise.all(
    [...parts.values()].filter((part) => part.entry && isXmlName(part.entry.name)).map((part) => load(part)),
  );
  if (!parts.has('[Content_Types].xml')) throw new ZipError("This isn't a PowerPoint file.");
  const pkg = { parts, comment: archive.comment };
  // Office never writes DTDs; a part with one is refused before anything parses it.
  for (const name of parts.keys()) {
    if (isXmlName(name) && !isSafeXml(textOf(pkg, name) ?? '')) {
      throw new ZipError(`${name} contains a DTD, which Folio refuses for safety.`);
    }
  }
  return pkg;
}

async function load(part: Part): Promise<Uint8Array> {
  if (!part.data) part.data = await inflateEntry(part.entry!);
  return part.data;
}

export function has(pkg: Package, name: string): boolean {
  return pkg.parts.has(name);
}

/** A part's bytes (inflating it on first use). */
export async function bytesOf(pkg: Package, name: string): Promise<Uint8Array | undefined> {
  const part = pkg.parts.get(name);
  return part ? load(part) : undefined;
}

/** An XML part's text. XML parts are read when the package opens, so this is synchronous. */
export function textOf(pkg: Package, name: string): string | undefined {
  const part = pkg.parts.get(name);
  if (!part) return undefined;
  let text = texts.get(part);
  if (text === undefined) {
    if (!part.data) throw new Error(`${name} isn't loaded`);
    text = decoder.decode(part.data);
    texts.set(part, text);
  }
  return text;
}

export function xmlOf(pkg: Package, name: string): Document | undefined {
  const text = textOf(pkg, name);
  return text === undefined ? undefined : parseXml(text, name);
}

/** New contents for a part: text, bytes, a parsed XML document, or another part's contents. */
export type PartValue = string | Uint8Array | Document | Part;

/** A package with these parts replaced or added (`null` removes a part). */
export function withParts(pkg: Package, changes: Record<string, PartValue | null>): Package {
  const parts = new Map(pkg.parts);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) {
      parts.delete(name);
      continue;
    }
    if (typeof value === 'string') {
      const part: Part = { data: encoder.encode(value) };
      texts.set(part, value);
      parts.set(name, part);
    } else if (value instanceof Uint8Array) {
      parts.set(name, { data: value });
    } else if ('nodeType' in value) {
      const text = serializeXml(value);
      const part: Part = { data: encoder.encode(text) };
      texts.set(part, text);
      parts.set(name, part);
    } else {
      // The same contents under another name (a copied part): shared, read when needed.
      parts.set(name, value);
    }
  }
  return { parts, comment: pkg.comment };
}

/** The file: untouched parts are copied exactly; changed and new ones are compressed. */
export async function savePackage(pkg: Package): Promise<Uint8Array> {
  const items = [];
  for (const [name, part] of pkg.parts) {
    if (part.entry && part.entry.name.replace(/^\/+/, '') === name) items.push({ entry: part.entry });
    else items.push({ name, data: await load(part) });
  }
  return writeZip(items, pkg.comment);
}

/** True when the part is exactly as it was read from the file. */
export const isOriginal = (pkg: Package, name: string) => Boolean(pkg.parts.get(name)?.entry);

// ---- Part names and relationships ------------------------------------------------------

export const dirOf = (name: string) => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');
export const baseOf = (name: string) => name.slice(name.lastIndexOf('/') + 1);

/** "ppt/slides/slide1.xml" -> "ppt/slides/_rels/slide1.xml.rels"; "" -> "_rels/.rels". */
export const relsNameOf = (name: string) => {
  const dir = dirOf(name);
  return `${dir ? `${dir}/` : ''}_rels/${baseOf(name)}.rels`;
};

/** Resolves a relationship target against the part that owns it. */
export function resolveTarget(source: string, target: string): string {
  const clean = target.split('#')[0]!.split('?')[0]!;
  const parts = clean.startsWith('/') ? [] : dirOf(source).split('/').filter(Boolean);
  for (const segment of clean.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(decodeSegment(segment));
  }
  return parts.join('/');
}

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** The target to write in `source`'s relationships to reach part `name`. */
export function relativeTarget(source: string, name: string): string {
  const from = dirOf(source).split('/').filter(Boolean);
  const to = name.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/');
}

/** Parsed relationships per .rels part (parts never change, so this can't go stale). */
const parsedRels = new WeakMap<Part, Relationship[]>();

export function relationships(pkg: Package, source: string): Relationship[] {
  const name = relsNameOf(source);
  const part = pkg.parts.get(name);
  if (!part) return [];
  let rels = parsedRels.get(part);
  if (!rels) {
    const doc = xmlOf(pkg, name)!;
    rels = children(doc.documentElement, NS.rel, 'Relationship').map((rel) => ({
      id: rel.getAttribute('Id') ?? '',
      type: rel.getAttribute('Type') ?? '',
      target: rel.getAttribute('Target') ?? '',
      external: rel.getAttribute('TargetMode') === 'External',
    }));
    parsedRels.set(part, rels);
  }
  return rels.map((rel) => ({ ...rel }));
}

/** Internal relationships of `source`, with their targets resolved to part names. */
export function related(pkg: Package, source: string, type?: string): (Relationship & { part: string })[] {
  return relationships(pkg, source)
    .filter((rel) => !rel.external && (!type || rel.type === type))
    .map((rel) => ({ ...rel, part: resolveTarget(source, rel.target) }));
}

/** A new relationship id for `doc` (a parsed .rels part): rId<n> past the highest in use. */
export function nextRelId(doc: Document): string {
  let highest = 0;
  for (const rel of children(doc.documentElement, NS.rel, 'Relationship')) {
    const match = /^rId(\d+)$/.exec(rel.getAttribute('Id') ?? '');
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `rId${highest + 1}`;
}

export function emptyRels(): Document {
  return parseXml(`<Relationships xmlns="${NS.rel}"/>`, 'relationships');
}

export function addRelationship(doc: Document, type: string, target: string, id = nextRelId(doc)): string {
  const rel = create(doc, NS.rel, 'Relationship', '');
  rel.setAttribute('Id', id);
  rel.setAttribute('Type', type);
  rel.setAttribute('Target', target);
  doc.documentElement.append(rel);
  return id;
}

// ---- Content types --------------------------------------------------------------------

export function contentTypeOf(pkg: Package, name: string): string | undefined {
  const doc = xmlOf(pkg, '[Content_Types].xml');
  if (!doc) return undefined;
  const root = doc.documentElement;
  const override = children(root, NS.ct, 'Override').find(
    (o) => (o.getAttribute('PartName') ?? '').replace(/^\/+/, '').toLowerCase() === name.toLowerCase(),
  );
  if (override) return override.getAttribute('ContentType') ?? undefined;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return (
    children(root, NS.ct, 'Default')
      .find((d) => (d.getAttribute('Extension') ?? '').toLowerCase() === ext)
      ?.getAttribute('ContentType') ?? undefined
  );
}

/** Edits [Content_Types].xml: adds overrides, removes them, and adds extension defaults. */
export function editContentTypes(
  doc: Document,
  change: { add?: Record<string, string>; remove?: string[]; defaults?: Record<string, string> },
): void {
  const root = doc.documentElement;
  const removed = new Set((change.remove ?? []).map((n) => n.toLowerCase()));
  for (const override of children(root, NS.ct, 'Override')) {
    const name = (override.getAttribute('PartName') ?? '').replace(/^\/+/, '').toLowerCase();
    if (removed.has(name) || (change.add && Object.keys(change.add).some((n) => n.toLowerCase() === name))) {
      override.remove();
    }
  }
  const defaults = children(root, NS.ct, 'Default');
  for (const [ext, type] of Object.entries(change.defaults ?? {})) {
    if (defaults.some((d) => (d.getAttribute('Extension') ?? '').toLowerCase() === ext.toLowerCase())) continue;
    const element = create(doc, NS.ct, 'Default', '');
    element.setAttribute('Extension', ext);
    element.setAttribute('ContentType', type);
    const firstOverride = children(root, NS.ct, 'Override')[0];
    root.insertBefore(element, firstOverride ?? null);
  }
  for (const [name, type] of Object.entries(change.add ?? {})) {
    const element = create(doc, NS.ct, 'Override', '');
    element.setAttribute('PartName', `/${name}`);
    element.setAttribute('ContentType', type);
    root.append(element);
  }
}

/** The main presentation part (normally ppt/presentation.xml). */
export function mainPart(pkg: Package): string {
  const main = related(pkg, '', REL.officeDocument)[0]?.part;
  if (!main || !has(pkg, main)) throw new ZipError("This isn't a PowerPoint presentation.");
  return main;
}

/** A part name like `ppt/slides/slide7.xml` that isn't in use yet (any case). */
export function freeName(pkg: Package, dir: string, stem: string, ext: string, reserved: Set<string> = new Set()): string {
  const taken = new Set([...pkg.parts.keys(), ...reserved].map((n) => n.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `${dir}/${stem}${n}.${ext}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}
