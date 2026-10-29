// "Patch, don't regenerate": the engine writes a whole new package on every save. Folio keeps
// the original file and builds the saved one part by part (docs/adr/0010):
//
// - A part whose content the engine reproduced unchanged (same XML once namespaces, attribute
//   order and formatting whitespace are set aside) keeps its original bytes, compressed data
//   included. The edits the user didn't make leave no trace.
// - A part the user's edits changed comes from the engine.
// - A part the engine never writes (it didn't understand it) is carried over as it was, with
//   its relationships and content type. A part the engine wrote when the document opened but
//   not after an edit was removed by that edit (a deleted picture), so it goes.
// - The result is read back independently and checked before anything is written: every part
//   unpacks and parses, every relationship points at a part that exists, every part has a
//   content type, every `r:id` in a changed part has its relationship.

import {
  DocxPackage,
  REL,
  contentTypeOf,
  decodeXml,
  isXmlPart,
  parseContentTypes,
  parseRelationships,
  parseXml,
  relsPathOf,
  resolveTarget,
  sourceOfRels,
} from './ooxml';
import { type ZipEntry, packEntry, writeZip } from './zip';

const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

/** What the engine wrote for the document as it opened, before any edit. */
export type Baseline = { names: Set<string>; relIds: Map<string, Set<string>>; pkg: DocxPackage };

export function baselineOf(bytes: Uint8Array): Baseline {
  const pkg = new DocxPackage(bytes);
  const relIds = new Map<string, Set<string>>();
  for (const name of pkg.names) {
    if (name.endsWith('.rels')) relIds.set(name, new Set(parseRelationships(pkg.text(name) ?? '').map((r) => r.id)));
  }
  return { names: new Set(pkg.names), relIds, pkg };
}

export type PatchReport = {
  /** Original bytes, untouched. */
  kept: string[];
  /** Changed by the edits: the engine's version. */
  replaced: string[];
  /** New parts (a picture that was inserted...). */
  added: string[];
  /** Parts the engine doesn't write, carried over from the original. */
  carried: string[];
  /** Parts the edits removed. */
  removed: string[];
};

export class PatchError extends Error {
  override name = 'PatchError';
}

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** Attributes that don't change what a part means. */
function ignorable(a: Attr): boolean {
  if (a.prefix === 'xmlns' || a.name === 'xmlns') return true;
  // Word's paragraph identities: the engine adds them where they were missing.
  if (a.namespaceURI === W14 && (a.localName === 'paraId' || a.localName === 'textId')) return true;
  // Whitespace inside text elements is compared as is, so the flag adds nothing.
  return a.name === 'xml:space';
}

/**
 * The XML's content, independent of formatting: namespace URIs instead of prefixes, sorted
 * attributes, no layout whitespace, and none of the attributes in `ignorable`. Two parts with the
 * same canonical form mean the same to Word.
 */
export function canonicalXml(text: string): string {
  const doc = parseXml(text);
  const out: string[] = [];
  const walk = (node: Node, keepSpace: boolean) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 1) {
        const element = child as Element;
        const attributes = [...element.attributes]
          .filter((a) => !ignorable(a))
          .map((a) => {
            // A list of prefixes; its order doesn't matter.
            const value = a.namespaceURI === MC && a.localName === 'Ignorable' ? a.value.split(/\s+/).sort().join(' ') : a.value;
            return `{${a.namespaceURI ?? ''}}${a.localName}=${JSON.stringify(value)}`;
          })
          .sort();
        out.push(`<{${element.namespaceURI ?? ''}}${element.localName}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`);
        const space = element.getAttribute('xml:space');
        walk(element, space === 'preserve' || (space !== 'default' && (keepSpace || /^(t|delText|instrText)$/.test(element.localName))));
        out.push('</>');
      } else if (child.nodeType === 3 || child.nodeType === 4) {
        const value = child.nodeValue ?? '';
        if (keepSpace || value.trim() !== '') out.push(JSON.stringify(value));
      } else if (child.nodeType === 7) {
        out.push(`<?${(child as ProcessingInstruction).target} ${child.nodeValue ?? ''}?>`);
      }
    }
  };
  walk(doc, false);
  return out.join('');
}

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

function sameContent(original: DocxPackage, edited: DocxPackage, name: string): boolean {
  const a = original.bytesOf(name)!;
  const b = edited.bytesOf(name)!;
  if (equalBytes(a, b)) return true;
  if (!isXmlPart(name)) return false;
  try {
    return canonicalXml(decodeXml(a)) === canonicalXml(decodeXml(b));
  } catch {
    return false;
  }
}

/** Engine output for an XML part, with the XML declaration Word writes (the engine leaves it out). */
function withDeclaration(name: string, bytes: Uint8Array): Uint8Array {
  if (!isXmlPart(name)) return bytes;
  const text = decodeXml(bytes);
  if (text.startsWith('<?xml')) return bytes;
  return new TextEncoder().encode(XML_DECLARATION + text.replace(/^\uFEFF/, ''));
}

const serialize = (doc: Document) => new TextEncoder().encode(XML_DECLARATION + new XMLSerializer().serializeToString(doc.documentElement));

/**
 * Builds the file to save from the original, the engine's output for the document as it opened
 * (`baseline`, or null if that isn't known) and the engine's output now (`edited`).
 */
export function patchPackage(
  original: DocxPackage,
  baseline: Baseline | null,
  editedBytes: Uint8Array,
): { bytes: Uint8Array; report: PatchReport } {
  const edited = new DocxPackage(editedBytes);
  const report: PatchReport = { kept: [], replaced: [], added: [], carried: [], removed: [] };
  const parts = new Map<string, ZipEntry>();
  const fromEngine = (name: string) => packEntry(name, withDeclaration(name, edited.bytesOf(name)!));

  for (const name of original.names) {
    if (edited.has(name)) {
      if (sameContent(original, edited, name)) {
        parts.set(name, original.entry(name)!);
        report.kept.push(name);
      } else {
        parts.set(name, fromEngine(name));
        report.replaced.push(name);
      }
    } else if (baseline?.names.has(name)) {
      report.removed.push(name);
    } else {
      parts.set(name, original.entry(name)!);
      report.carried.push(name);
    }
  }
  for (const name of edited.names) {
    if (!original.has(name)) {
      parts.set(name, fromEngine(name));
      report.added.push(name);
    }
  }

  // Relationships the engine never writes, for parts that are still there, go back in.
  for (const name of report.replaced.filter((n) => n.endsWith('.rels'))) {
    const source = sourceOfRels(name);
    const doc = parseXml(decodeXml(edited.bytesOf(name)!));
    const present = new Set(parseRelationships(decodeXml(edited.bytesOf(name)!)).map((r) => r.id));
    const engineWrote = baseline?.relIds.get(name);
    let changed = false;
    for (const rel of original.relationships(source)) {
      if (present.has(rel.id) || engineWrote?.has(rel.id)) continue;
      if (!rel.external && !parts.has(resolveTarget(source, rel.target))) continue;
      const element = doc.createElementNS(PKG_REL, 'Relationship');
      element.setAttribute('Id', rel.id);
      element.setAttribute('Type', rel.type);
      element.setAttribute('Target', rel.target);
      if (rel.external) element.setAttribute('TargetMode', 'External');
      doc.documentElement.appendChild(element);
      changed = true;
    }
    if (changed) parts.set(name, packEntry(name, serialize(doc)));
  }

  // Every part keeps a content type, and the main part keeps its own (a .docm stays a .docm).
  if (report.replaced.includes('[Content_Types].xml')) {
    const originalTypes = original.contentTypes();
    const doc = parseXml(decodeXml(edited.bytesOf('[Content_Types].xml')!));
    const types = parseContentTypes(decodeXml(edited.bytesOf('[Content_Types].xml')!));
    let changed = false;
    const main = original.mainPart;
    const mainType = contentTypeOf(originalTypes, main);
    for (const override of doc.getElementsByTagNameNS(CT_NS, 'Override')) {
      if ((override.getAttribute('PartName') ?? '').replace(/^\//, '') === main && mainType && override.getAttribute('ContentType') !== mainType) {
        override.setAttribute('ContentType', mainType);
        changed = true;
      }
    }
    const overrides = [...doc.getElementsByTagNameNS(CT_NS, 'Override')];
    for (const name of parts.keys()) {
      if (name === '[Content_Types].xml') continue;
      // Parts from the original keep their original type; new parts keep the engine's.
      const want = original.has(name) ? contentTypeOf(originalTypes, name) : undefined;
      if (!want || contentTypeOf(types, name) === want) continue;
      const existing = overrides.find((o) => (o.getAttribute('PartName') ?? '').replace(/^\//, '').toLowerCase() === name.toLowerCase());
      if (existing) existing.setAttribute('ContentType', want);
      else {
        const element = doc.createElementNS(CT_NS, 'Override');
        element.setAttribute('PartName', `/${name}`);
        element.setAttribute('ContentType', want);
        doc.documentElement.appendChild(element);
      }
      changed = true;
    }
    if (changed) parts.set('[Content_Types].xml', packEntry('[Content_Types].xml', serialize(doc)));
  }

  const bytes = writeZip([...parts.values()]);
  verifyPackage(bytes, original, [...report.replaced, ...report.added]);
  return { bytes, report };
}

const REFERENCE_ATTRIBUTES = /\b(?:r|rel):(?:id|embed|link|pict|dm|lo|qs|cs|href|blip)="([^"]+)"/g;

/**
 * Reads a package back on its own and checks it holds together. Problems the original already
 * had are tolerated; new ones throw a PatchError.
 */
export function verifyPackage(bytes: Uint8Array, original: DocxPackage | null, changed: string[] = []): void {
  let pkg: DocxPackage;
  try {
    pkg = new DocxPackage(bytes);
  } catch (error) {
    throw new PatchError(`The saved file couldn't be read back: ${(error as Error).message}`);
  }
  const main = pkg.mainPart;
  if (!pkg.has(main)) throw new PatchError('The saved file has no main document part.');
  const types = pkg.contentTypes();
  const originalTypes = original?.contentTypes();
  for (const name of pkg.names) {
    if (isXmlPart(name)) {
      try {
        parseXml(pkg.text(name) ?? '');
      } catch {
        throw new PatchError(`The saved part ${name} isn't valid XML.`);
      }
    }
    if (name !== '[Content_Types].xml' && !contentTypeOf(types, name) && !(originalTypes && original?.has(name) && !contentTypeOf(originalTypes, name))) {
      throw new PatchError(`The saved part ${name} has no content type.`);
    }
  }
  for (const relsPath of pkg.names.filter((n) => n.endsWith('.rels'))) {
    const source = sourceOfRels(relsPath);
    for (const rel of parseRelationships(pkg.text(relsPath) ?? '')) {
      if (rel.external) continue;
      const target = resolveTarget(source, rel.target);
      if (pkg.has(target)) continue;
      const brokenBefore = original?.relationships(source).some((r) => !r.external && resolveTarget(source, r.target) === target && !original.has(target));
      if (!brokenBefore) throw new PatchError(`The saved part ${relsPath} points at ${target}, which isn't there.`);
    }
  }
  for (const name of changed.filter((n) => isXmlPart(n) && !n.endsWith('.rels') && n !== '[Content_Types].xml')) {
    const ids = new Set(pkg.relationships(name).map((r) => r.id));
    for (const match of (pkg.text(name) ?? '').matchAll(REFERENCE_ATTRIBUTES)) {
      if (!ids.has(match[1]!)) throw new PatchError(`The saved part ${name} refers to ${match[1]}, which it doesn't have.`);
    }
  }
}

// ---- What the engine can't keep --------------------------------------------------------------

/** Element counts that don't matter when they drop (Word's own bookkeeping). */
const HARMLESS = new Set(['w:proofErr', 'w:lastRenderedPageBreak', 'w:noProof', '@xml:space', '@w14:paraId', '@w14:textId']);

const LABELS: Record<string, string> = {
  'w:sdt': 'content controls',
  'w:txbxContent': 'text boxes',
  'w:fldChar': 'fields',
  'w:fldSimple': 'fields',
  'w:instrText': 'fields',
  'mc:AlternateContent': 'drawings',
  'w:drawing': 'drawings',
  'w:pict': 'drawings',
  'w:object': 'embedded objects',
  'm:oMath': 'equations',
  'm:oMathPara': 'equations',
  'w:commentReference': 'comments',
  'w:commentRangeStart': 'comments',
  'w:footnoteReference': 'footnotes',
  'w:endnoteReference': 'endnotes',
  'w:ins': 'tracked changes',
  'w:del': 'tracked changes',
  'w:bookmarkStart': 'bookmarks',
  'w:hyperlink': 'links',
  'w:tbl': 'tables',
  'w:tblCellMar': 'table cell margins',
  'w:sectPr': 'section settings',
};

const STORY = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

function counts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const match of text.matchAll(/<([A-Za-z_][\w.-]*:[\w.-]+)[\s/>]/g)) out.set(match[1]!, (out.get(match[1]!) ?? 0) + 1);
  for (const match of text.matchAll(/\s([A-Za-z_][\w.-]*:[\w.-]+)="/g)) {
    if (!match[1]!.startsWith('xmlns:')) out.set(`@${match[1]!}`, (out.get(`@${match[1]!}`) ?? 0) + 1);
  }
  return out;
}

/**
 * What the engine dropped when it wrote the document as it opened: anything here would be lost
 * from a part once that part is edited and saved. Reported as readable labels.
 */
export function engineLosses(original: DocxPackage, baseline: Baseline): { id: string; label: string }[] {
  const lost = new Map<string, string>();
  for (const name of original.names.filter((n) => STORY.test(n) && baseline.names.has(n))) {
    const before = counts(original.text(name) ?? '');
    const after = counts(baseline.pkg.text(name) ?? '');
    for (const [key, n] of before) {
      if (HARMLESS.has(key) || (after.get(key) ?? 0) >= n) continue;
      const label = LABELS[key] ?? (key.startsWith('@') ? `some formatting details (${key.slice(1)})` : `some Word features (${key})`);
      lost.set(label, label);
    }
  }
  return [...lost.values()].map((label) => ({ id: `engine:${label}`, label }));
}

/** The document's relationships of one kind, from the main part (for tests and facts). */
export function mainRelationships(pkg: DocxPackage, type: string) {
  return pkg.relationships(pkg.mainPart).filter((r) => r.type === `${REL}/${type}`);
}

export { relsPathOf };
