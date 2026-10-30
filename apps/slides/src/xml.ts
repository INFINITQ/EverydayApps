// XML helpers for Office parts. Parts are untrusted: anything with a DTD is refused before
// it reaches a parser (no entity expansion, no external entities; Office never writes DTDs).

export const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
} as const;

export const REL = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  notesMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  vbaProject: 'http://schemas.microsoft.com/office/2006/relationships/vbaProject',
} as const;

export class XmlError extends Error {}

const DTD = /<!(DOCTYPE|ENTITY)/i;

export function parseXml(text: string, name: string): Document {
  if (DTD.test(text)) throw new XmlError(`${name} contains a DTD, which Folio refuses for safety.`);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) {
    throw new XmlError(`${name} is damaged.`);
  }
  return doc;
}

/** True when the text can safely go to the slide renderer's own XML parser. */
export const isSafeXml = (text: string) => !DTD.test(text);

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export function serializeXml(doc: Document): string {
  return DECLARATION + new XMLSerializer().serializeToString(doc.documentElement);
}

/** Direct children of `parent` with the given namespace and local name. */
export function children(parent: Element, ns: string, local: string): Element[] {
  const out: Element[] = [];
  for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
    if (child.namespaceURI === ns && child.localName === local) out.push(child);
  }
  return out;
}

export function child(parent: Element | null | undefined, ns: string, local: string): Element | null {
  if (!parent) return null;
  for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
    if (c.namespaceURI === ns && c.localName === local) return c;
  }
  return null;
}

/** Follows a path of children in one namespace: path(sp, NS.p, 'nvSpPr', 'cNvPr'). */
export function path(parent: Element | null, ns: string, ...locals: string[]): Element | null {
  let current = parent;
  for (const local of locals) current = child(current, ns, local);
  return current;
}

export function descendants(parent: Element | Document, ns: string, local: string): Element[] {
  return [...parent.getElementsByTagNameNS(ns, local)];
}

/** Creates an element with the prefix the document already uses for `ns` (or `fallback`). */
export function create(doc: Document, ns: string, local: string, fallback: string): Element {
  const prefix = doc.documentElement.lookupPrefix(ns) ?? fallback;
  return doc.createElementNS(ns, prefix ? `${prefix}:${local}` : local);
}

export const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
