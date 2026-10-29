// A Word document's package: its parts, their content types and relationships, read with the
// limits in zip.ts. Folio reads a few things itself, straight from the package, so they don't
// depend on the engine: macros, comments, tracked changes and links to outside content.

import { type ZipEntry, ZipError, isCompoundFile, isZip, readZip, unpack } from './zip';

export const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

export type Relationship = { id: string; type: string; target: string; external: boolean };

export class DocxPackage {
  readonly entries: ZipEntry[];
  private readonly byName = new Map<string, ZipEntry>();
  private readonly cache = new Map<string, Uint8Array>();

  constructor(readonly bytes: Uint8Array) {
    if (isCompoundFile(bytes)) {
      throw new ZipError('This document is password-protected or in an old format. Folio Docs can’t open it.');
    }
    if (!isZip(bytes)) throw new ZipError("This file isn't a Word document, or it's damaged.");
    this.entries = readZip(bytes);
    for (const entry of this.entries) this.byName.set(entry.name, entry);
    if (!this.has('[Content_Types].xml')) throw new ZipError("This file isn't a Word document (it has no content types).");
  }

  get names(): string[] {
    return this.entries.map((e) => e.name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  entry(name: string): ZipEntry | undefined {
    return this.byName.get(name);
  }

  bytesOf(name: string): Uint8Array | undefined {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const entry = this.byName.get(name);
    if (!entry) return undefined;
    const bytes = unpack(entry);
    this.cache.set(name, bytes);
    return bytes;
  }

  text(name: string): string | undefined {
    const bytes = this.bytesOf(name);
    return bytes && decodeXml(bytes);
  }

  /** The main document part, from the package relationships (normally word/document.xml). */
  get mainPart(): string {
    const main = this.relationships('').find((r) => r.type.endsWith('/officeDocument') && !r.external);
    return main ? resolveTarget('', main.target) : 'word/document.xml';
  }

  /** The relationships of a part ('' for the package itself). */
  relationships(part: string): Relationship[] {
    const text = this.text(relsPathOf(part));
    return text ? parseRelationships(text) : [];
  }

  contentTypes(): ContentTypes {
    return parseContentTypes(this.text('[Content_Types].xml') ?? '');
  }
}

/** XML parts are UTF-8 (or UTF-16 with a byte order mark). */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder().decode(bytes);
}

export const isXmlPart = (name: string) => /\.(xml|rels|vml)$/i.test(name) || name === '[Content_Types].xml';

/** `word/_rels/document.xml.rels` for `word/document.xml`; `_rels/.rels` for the package. */
export function relsPathOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/** The part a relationships file belongs to ('' for the package's own). */
export function sourceOfRels(relsPath: string): string {
  const match = /^(.*?)_rels\/([^/]*)\.rels$/.exec(relsPath);
  return match ? `${match[1]}${match[2]}` : '';
}

/** Resolves a relationship's target against the part that owns it. */
export function resolveTarget(source: string, target: string): string {
  if (target.startsWith('/')) return normalize(target.slice(1));
  const base = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
  return normalize(base + target);
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const segment of decodeURI(path).split('/')) {
    if (segment === '..') out.pop();
    else if (segment !== '.' && segment !== '') out.push(segment);
  }
  return out.join('/');
}

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new ZipError('A part of this document is damaged (its XML is broken).');
  return doc;
}

export function parseRelationships(text: string): Relationship[] {
  const doc = parseXml(text);
  return [...doc.getElementsByTagNameNS(PKG_REL, 'Relationship')].map((r) => ({
    id: r.getAttribute('Id') ?? '',
    type: r.getAttribute('Type') ?? '',
    target: r.getAttribute('Target') ?? '',
    external: r.getAttribute('TargetMode') === 'External',
  }));
}

export type ContentTypes = { defaults: Map<string, string>; overrides: Map<string, string> };

export function parseContentTypes(text: string): ContentTypes {
  const doc = parseXml(text);
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const d of doc.getElementsByTagNameNS(CT_NS, 'Default')) {
    defaults.set((d.getAttribute('Extension') ?? '').toLowerCase(), d.getAttribute('ContentType') ?? '');
  }
  for (const o of doc.getElementsByTagNameNS(CT_NS, 'Override')) {
    overrides.set((o.getAttribute('PartName') ?? '').replace(/^\//, ''), o.getAttribute('ContentType') ?? '');
  }
  return { defaults, overrides };
}

export function contentTypeOf(types: ContentTypes, part: string): string | undefined {
  const override = [...types.overrides].find(([name]) => name.toLowerCase() === part.toLowerCase());
  if (override) return override[1];
  const ext = part.includes('.') ? part.slice(part.lastIndexOf('.') + 1).toLowerCase() : '';
  return types.defaults.get(ext);
}

/**
 * Word documents never use DTDs. A part that declares one (or entities) could make an XML
 * parser read files or expand without end, so such documents are refused before anything
 * parses them.
 */
export function checkXmlSafety(pkg: DocxPackage): void {
  for (const name of pkg.names) {
    if (!isXmlPart(name)) continue;
    const text = pkg.text(name) ?? '';
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
      throw new ZipError('This document contains XML declarations Word never writes (a DTD or entities), so Folio won’t open it.');
    }
  }
}

// ---- What Folio reads itself ------------------------------------------------------------------

export type Comment = { id: string; author: string; date: string | null; text: string };

export type DocumentFacts = {
  /** The file carries a macro project (it is kept, never run). */
  macros: boolean;
  comments: Comment[];
  /** Tracked insertions, deletions and moves in the body, headers, footers and notes. */
  revisions: number;
  /** Pictures linked from outside the file (never loaded). */
  linkedPictures: number;
  /** Other content linked from outside (templates, OLE links, frames); never loaded. */
  linkedOther: number;
  /** Web, mail and other links in the text. */
  hyperlinks: number;
  title: string | null;
};

const textOf = (element: Element) =>
  [...element.getElementsByTagNameNS(W, 't')].map((t) => t.textContent ?? '').join('');

export function readFacts(pkg: DocxPackage): DocumentFacts {
  const types = pkg.contentTypes();
  const main = pkg.mainPart;
  const mainRels = pkg.relationships(main);
  const macros =
    pkg.names.some((n) => /vbaProject\.bin$/i.test(n)) ||
    mainRels.some((r) => /vbaProject$/i.test(r.type)) ||
    /macroEnabled/i.test(contentTypeOf(types, main) ?? '');

  const comments: Comment[] = [];
  const commentsRel = mainRels.find((r) => r.type === `${REL}/comments` && !r.external);
  const commentsXml = commentsRel ? pkg.text(resolveTarget(main, commentsRel.target)) : undefined;
  if (commentsXml) {
    for (const c of parseXml(commentsXml).getElementsByTagNameNS(W, 'comment')) {
      comments.push({
        id: c.getAttributeNS(W, 'id') ?? '',
        author: c.getAttributeNS(W, 'author') || 'Unknown author',
        date: c.getAttributeNS(W, 'date'),
        text: [...c.getElementsByTagNameNS(W, 'p')].map(textOf).join('\n'),
      });
    }
  }

  let revisions = 0;
  let linkedPictures = 0;
  let linkedOther = 0;
  let hyperlinks = 0;
  const storyParts = [main, ...mainRels.filter((r) => !r.external && /\/(header|footer|footnotes|endnotes)$/.test(r.type)).map((r) => resolveTarget(main, r.target))];
  for (const part of storyParts) {
    const text = pkg.text(part);
    if (!text) continue;
    revisions += (text.match(/<w:(ins|del|moveFrom|moveTo)\s/g) ?? []).length;
    const rels = pkg.relationships(part);
    for (const r of rels) {
      if (r.type === `${REL}/hyperlink`) hyperlinks += 1;
      else if (r.external && r.type === `${REL}/image`) linkedPictures += 1;
      else if (r.external) linkedOther += 1;
    }
  }
  const settingsRel = mainRels.find((r) => r.type === `${REL}/settings` && !r.external);
  if (settingsRel) linkedOther += pkg.relationships(resolveTarget(main, settingsRel.target)).filter((r) => r.external).length;

  const core = pkg.text('docProps/core.xml');
  const title = core ? /<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1] ?? null : null;
  return { macros, comments, revisions, linkedPictures, linkedOther, hyperlinks, title };
}
