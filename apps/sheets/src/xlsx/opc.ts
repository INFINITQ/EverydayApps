// The Open Packaging Conventions layer: parts, their content types and relationships.
// Parts are read lazily; on save, parts nobody changed are copied with their original
// compressed bytes (see zip.ts).

import { type ZipEntry, type ZipOut, inflate, readZip, writeZip } from './zip';
import { type XmlElement, attrsText, decodeXml, escapeAttr, parseXml } from './xml';

export type Relationship = { id: string; type: string; target: string; external: boolean };

export const REL = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  worksheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  chartsheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet',
  sharedStrings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  calcChain: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain',
  comments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  vmlDrawing: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing',
  drawing: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  chart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  pivotTable: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable',
  pivotCacheDefinition: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition',
  table: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table',
  externalLink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink',
  vbaProject: 'http://schemas.microsoft.com/office/2006/relationships/vbaProject',
  threadedComment: 'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment',
  person: 'http://schemas.microsoft.com/office/2017/10/relationships/person',
};

export const CONTENT = {
  worksheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  sharedStrings: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  comments: 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml',
  vml: 'application/vnd.openxmlformats-officedocument.vmlDrawing',
  drawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
};

const RELS_XMLNS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** "xl/worksheets/sheet1.xml" -> "xl/worksheets/_rels/sheet1.xml.rels". */
export function relsPartOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/** Resolves a relationship target against the part that holds the relationship. */
export function resolveTarget(source: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const base = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
  const parts: string[] = [];
  for (const piece of (base + target).split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.' && piece !== '') parts.push(piece);
  }
  return parts.join('/');
}

/** The target to write in `source`'s relationships for `part` (relative, like Office). */
export function relativeTarget(source: string, part: string): string {
  const from = source.split('/').slice(0, -1);
  const to = part.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...Array(from.length - common).fill('..'), ...to.slice(common)].join('/');
}

type Stored = { entry?: ZipEntry; bytes?: Uint8Array; text?: string };

export class Package {
  private readonly parts = new Map<string, Stored>();
  /** Lower-case name -> name as stored (part names are case-insensitive). */
  private readonly names = new Map<string, string>();
  private readonly order: string[] = [];
  private readonly changed = new Set<string>();
  private readonly relCache = new Map<string, Relationship[]>();
  private contentTypes: { defaults: Map<string, string>; overrides: Map<string, string> } | null = null;

  constructor(readonly bytes: Uint8Array) {
    for (const entry of readZip(bytes)) {
      if (this.names.has(entry.name.toLowerCase())) continue;
      this.names.set(entry.name.toLowerCase(), entry.name);
      this.parts.set(entry.name, { entry });
      this.order.push(entry.name);
    }
    if (!this.has('[Content_Types].xml')) throw new Error("This file isn't an Office document (it has no content types).");
    this.types();
  }

  private key(name: string): string | undefined {
    return this.names.get(name.toLowerCase());
  }

  has(name: string): boolean {
    return this.key(name) !== undefined;
  }

  list(): string[] {
    return [...this.order];
  }

  bytesOf(name: string): Uint8Array | undefined {
    const key = this.key(name);
    const stored = key ? this.parts.get(key) : undefined;
    if (!stored) return undefined;
    if (!stored.bytes) {
      if (stored.text !== undefined) stored.bytes = new TextEncoder().encode(stored.text);
      else if (stored.entry) stored.bytes = inflate(stored.entry);
    }
    return stored.bytes;
  }

  text(name: string): string | undefined {
    const key = this.key(name);
    const stored = key ? this.parts.get(key) : undefined;
    if (!stored) return undefined;
    if (stored.text === undefined) {
      const bytes = this.bytesOf(name);
      if (!bytes) return undefined;
      stored.text = decodeXml(bytes);
    }
    return stored.text;
  }

  xml(name: string, skip?: string[]): XmlElement | undefined {
    const text = this.text(name);
    return text === undefined ? undefined : parseXml(text, skip);
  }

  isChanged(name: string): boolean {
    const key = this.key(name);
    return key !== undefined && this.changed.has(key);
  }

  /** Replaces (or adds) a part. New parts need a content type unless their extension has one. */
  set(name: string, content: string | Uint8Array, contentType?: string): void {
    let key = this.key(name);
    if (!key) {
      key = name;
      this.names.set(name.toLowerCase(), name);
      this.order.push(name);
    }
    this.parts.set(key, typeof content === 'string' ? { text: content } : { bytes: content });
    this.changed.add(key);
    this.relCache.delete(key);
    if (contentType) this.setContentType(key, contentType);
  }

  remove(name: string): void {
    const key = this.key(name);
    if (!key) return;
    this.parts.delete(key);
    this.names.delete(key.toLowerCase());
    this.order.splice(this.order.indexOf(key), 1);
    this.changed.add(key);
    this.relCache.delete(key);
    const types = this.types();
    if (types.overrides.delete(`/${key}`.toLowerCase())) this.writeContentTypes();
  }

  // ---- Content types -------------------------------------------------------------------

  private types() {
    if (!this.contentTypes) {
      const root = this.xml('[Content_Types].xml')!;
      const defaults = new Map<string, string>();
      const overrides = new Map<string, string>();
      for (const el of root.elements('Default')) defaults.set((el.attr('Extension') ?? '').toLowerCase(), el.attr('ContentType') ?? '');
      for (const el of root.elements('Override')) overrides.set((el.attr('PartName') ?? '').toLowerCase(), el.attr('ContentType') ?? '');
      this.contentTypes = { defaults, overrides };
    }
    return this.contentTypes;
  }

  contentType(name: string): string | undefined {
    const types = this.types();
    const override = types.overrides.get(`/${name}`.toLowerCase());
    if (override) return override;
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    return types.defaults.get(ext);
  }

  /** Adds an override for a part, or a default for its extension when `byExtension`. */
  setContentType(name: string, type: string, byExtension = false): void {
    const types = this.types();
    if (byExtension) {
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      if (types.defaults.get(ext) === type) return;
      if (!types.defaults.has(ext)) {
        types.defaults.set(ext, type);
        this.writeContentTypes();
        return;
      }
    }
    if (this.contentType(name) === type) return;
    types.overrides.set(`/${name}`.toLowerCase(), type);
    this.writeContentTypes();
  }

  /** Rewrites [Content_Types].xml, keeping the original's entries (and their spelling) first. */
  private writeContentTypes() {
    const types = this.types();
    const root = parseXml(this.text('[Content_Types].xml')!);
    const seenDefaults = new Set<string>();
    const seenOverrides = new Set<string>();
    let body = '';
    for (const el of root.elements()) {
      if (el.local === 'Default') {
        const ext = (el.attr('Extension') ?? '').toLowerCase();
        seenDefaults.add(ext);
        if (types.defaults.has(ext)) body += `<Default Extension="${escapeAttr(el.attr('Extension') ?? '')}" ContentType="${escapeAttr(types.defaults.get(ext)!)}"/>`;
      } else if (el.local === 'Override') {
        const part = (el.attr('PartName') ?? '').toLowerCase();
        seenOverrides.add(part);
        const key = this.key(part.slice(1));
        if (types.overrides.has(part) && key) body += `<Override PartName="/${escapeAttr(key)}" ContentType="${escapeAttr(types.overrides.get(part)!)}"/>`;
      }
    }
    for (const [ext, type] of types.defaults) if (!seenDefaults.has(ext)) body += `<Default Extension="${escapeAttr(ext)}" ContentType="${escapeAttr(type)}"/>`;
    for (const [part, type] of types.overrides) {
      const key = this.key(part.slice(1));
      if (!seenOverrides.has(part) && key) body += `<Override PartName="/${escapeAttr(key)}" ContentType="${escapeAttr(type)}"/>`;
    }
    const text = this.text('[Content_Types].xml')!;
    const xmlDecl = text.startsWith('<?xml') ? text.slice(0, text.indexOf('?>') + 2) : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const open = text.slice(root.start, root.innerStart === root.end ? root.end : root.innerStart).replace(/\/>$/, '>');
    this.set('[Content_Types].xml', `${xmlDecl}\n${open}${body}</${root.name}>`);
  }

  // ---- Relationships -------------------------------------------------------------------

  /** Relationships of a part ("" for the package's own). */
  rels(source: string): Relationship[] {
    const relsPart = source ? relsPartOf(source) : '_rels/.rels';
    const cached = this.relCache.get(relsPart);
    if (cached) return cached;
    const root = this.has(relsPart) ? this.xml(relsPart) : undefined;
    const list: Relationship[] = (root?.elements('Relationship') ?? []).map((el) => ({
      id: el.attr('Id') ?? '',
      type: el.attr('Type') ?? '',
      target: el.attr('Target') ?? '',
      external: el.attr('TargetMode') === 'External',
    }));
    this.relCache.set(relsPart, list);
    return list;
  }

  /** The part a relationship points to (internal relationships only). */
  target(source: string, rel: Relationship | undefined): string | undefined {
    if (!rel || rel.external) return undefined;
    const part = resolveTarget(source, rel.target);
    return this.key(part) ?? part;
  }

  relById(source: string, id: string | undefined): Relationship | undefined {
    return id ? this.rels(source).find((r) => r.id === id) : undefined;
  }

  relsOfType(source: string, type: string): Relationship[] {
    return this.rels(source).filter((r) => r.type === type);
  }

  /** Adds a relationship from `source` to `part` and returns its id. */
  addRel(source: string, type: string, part: string): string {
    const list = [...this.rels(source)];
    const used = new Set(list.map((r) => r.id));
    let n = list.length + 1;
    while (used.has(`rId${n}`)) n++;
    const id = `rId${n}`;
    list.push({ id, type, target: relativeTarget(source, part), external: false });
    this.writeRels(source, list);
    return id;
  }

  removeRel(source: string, id: string): void {
    this.writeRels(
      source,
      this.rels(source).filter((r) => r.id !== id),
    );
  }

  private writeRels(source: string, list: Relationship[]) {
    const relsPart = source ? relsPartOf(source) : '_rels/.rels';
    const original = this.has(relsPart) ? this.xml(relsPart) : undefined;
    // Keep the original elements' text for relationships that stay (unknown attributes too).
    const kept = new Map<string, string>();
    const text = original ? this.text(relsPart)! : '';
    for (const el of original?.elements('Relationship') ?? []) kept.set(el.attr('Id') ?? '', text.slice(el.start, el.end));
    let body = '';
    for (const rel of list) {
      body +=
        kept.get(rel.id) ??
        `<Relationship${attrsText([
          ['Id', rel.id],
          ['Type', rel.type],
          ['Target', rel.target],
          ...(rel.external ? ([['TargetMode', 'External']] as [string, string][]) : []),
        ])}/>`;
    }
    this.set(relsPart, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${RELS_XMLNS}">${body}</Relationships>`);
    this.relCache.set(relsPart, list);
  }

  // ---- Saving ----------------------------------------------------------------------------

  /** Removes parts no relationship leads to any more (after a sheet or picture was deleted). */
  collectGarbage(): string[] {
    const reachable = new Set<string>(['[content_types].xml', '_rels/.rels']);
    const queue = [''];
    while (queue.length) {
      const source = queue.pop()!;
      if (source) reachable.add(relsPartOf(source).toLowerCase());
      for (const rel of this.rels(source)) {
        const part = this.target(source, rel);
        if (!part || reachable.has(part.toLowerCase())) continue;
        reachable.add(part.toLowerCase());
        if (this.has(part)) queue.push(part);
      }
    }
    const removed = this.order.filter((name) => !reachable.has(name.toLowerCase()));
    for (const name of removed) this.remove(name);
    return removed;
  }

  /** The package as a zip; unchanged parts keep their original compressed bytes. */
  toBytes(): Uint8Array {
    if (this.changed.size === 0) return this.bytes;
    const out: ZipOut[] = [];
    for (const name of this.order) {
      const stored = this.parts.get(name)!;
      if (stored.entry && !this.changed.has(name)) out.push({ name, entry: stored.entry });
      else out.push({ name, bytes: this.bytesOf(name)! });
    }
    return writeZip(out);
  }
}
