// A small XML reader for Office parts. It keeps where every element starts and ends in the
// source text, so a part can be patched in place: only the elements that changed are
// rewritten, everything else stays exactly as it was.
//
// Documents are untrusted: a DOCTYPE (and with it any entity definition) is refused, and
// only the five predefined entities and character references are understood. Nothing is
// ever loaded from outside.

export class XmlError extends Error {}

export type XmlNode = XmlElement | XmlText;

export type XmlText = { text: string; start: number; end: number };

export class XmlElement {
  children: XmlNode[] = [];
  /** Where the element's content starts and ends (both equal to `end` for `<x/>`). */
  innerStart = -1;
  innerEnd = -1;
  constructor(
    /** The name as written, with its prefix ("x:row" or "row"). */
    readonly name: string,
    /** Attributes in source order, values unescaped. */
    readonly attrs: [string, string][],
    /** Offsets of the whole element in the source text. */
    readonly start: number,
    public end: number,
  ) {}

  /** The name without its prefix. */
  get local(): string {
    const colon = this.name.indexOf(':');
    return colon < 0 ? this.name : this.name.slice(colon + 1);
  }

  get prefix(): string {
    const colon = this.name.indexOf(':');
    return colon < 0 ? '' : this.name.slice(0, colon + 1);
  }

  /** An attribute by its name as written ("r:id") or, failing that, by local name. */
  attr(name: string): string | undefined {
    for (const [key, value] of this.attrs) if (key === name) return value;
    if (!name.includes(':')) {
      for (const [key, value] of this.attrs) if (key.endsWith(`:${name}`) && !key.startsWith('xmlns')) return value;
    }
    return undefined;
  }

  /** Child elements, optionally only those with this local name. */
  elements(local?: string): XmlElement[] {
    const out: XmlElement[] = [];
    for (const child of this.children) if (child instanceof XmlElement && (!local || child.local === local)) out.push(child);
    return out;
  }

  child(local: string): XmlElement | undefined {
    for (const child of this.children) if (child instanceof XmlElement && child.local === local) return child;
    return undefined;
  }

  /** Descendant at a path of local names ("sheetViews/sheetView"). */
  path(path: string): XmlElement | undefined {
    let at: XmlElement | undefined = this as XmlElement;
    for (const part of path.split('/')) at = at?.child(part);
    return at;
  }

  /** All text inside, unescaped. */
  text(): string {
    let out = '';
    for (const child of this.children) out += child instanceof XmlElement ? child.text() : child.text;
    return out;
  }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function unescapeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff) throw new XmlError(`Bad character reference ${whole}`);
      return String.fromCodePoint(code);
    }
    const value = ENTITIES[name];
    if (value === undefined) throw new XmlError(`Unknown entity ${whole}`);
    return value;
  });
}

export const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const escapeAttr = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');

/** Characters XML 1.0 can't carry at all; Office writes them as _xHHHH_. */
export function encodeOfficeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/_x[0-9a-fA-F]{4}_/g, (m) => `_x005F${m.slice(1)}`).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, (c) => `_x${c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}_`);
}

/** Office's _xHHHH_ escapes back to characters. */
export function decodeOfficeText(text: string): string {
  if (!text.includes('_x')) return text;
  return text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

export function attrsText(attrs: [string, string][]): string {
  let out = '';
  for (const [key, value] of attrs) out += ` ${key}="${escapeAttr(value)}"`;
  return out;
}

/** Parses attributes from the text between a tag's name and its end. */
export function parseAttrs(text: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) out.push([match[1]!, unescapeXml(match[2] ?? match[3] ?? '')]);
  return out;
}

export type Tag = { kind: 'open' | 'close' | 'empty'; name: string; attrs: string; start: number; end: number };

/**
 * Calls `visit` for every tag between `from` and `to`, in order. Text between tags is left
 * to the caller (it knows the offsets). Comments, processing instructions and CDATA are
 * skipped; CDATA is reported as a text tag with name "#cdata".
 */
export function scanTags(text: string, from: number, to: number, visit: (tag: Tag) => void | false): void {
  let at = from;
  while (at < to) {
    const lt = text.indexOf('<', at);
    if (lt < 0 || lt >= to) return;
    const next = text.charCodeAt(lt + 1);
    if (next === 33 /* ! */) {
      if (text.startsWith('<!--', lt)) {
        const close = text.indexOf('-->', lt + 4);
        if (close < 0) throw new XmlError('Unclosed comment');
        at = close + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', lt)) {
        const close = text.indexOf(']]>', lt + 9);
        if (close < 0) throw new XmlError('Unclosed CDATA');
        if (visit({ kind: 'empty', name: '#cdata', attrs: text.slice(lt + 9, close), start: lt, end: close + 3 }) === false) return;
        at = close + 3;
        continue;
      }
      // <!DOCTYPE ...> and <!ENTITY ...>: never in Office parts, and the way into entity attacks.
      throw new XmlError('This file contains a document type definition, which Folio refuses for safety.');
    }
    if (next === 63 /* ? */) {
      const close = text.indexOf('?>', lt + 2);
      if (close < 0) throw new XmlError('Unclosed processing instruction');
      at = close + 2;
      continue;
    }
    // Find the end of the tag, skipping quoted attribute values (they may contain '>').
    let end = lt + 1;
    let quote = 0;
    for (; end < text.length; end++) {
      const c = text.charCodeAt(end);
      if (quote) {
        if (c === quote) quote = 0;
      } else if (c === 34 || c === 39) quote = c;
      else if (c === 62 /* > */) break;
    }
    if (end >= text.length) throw new XmlError('Unclosed tag');
    if (next === 47 /* / */) {
      const name = text.slice(lt + 2, end).trim();
      if (visit({ kind: 'close', name, attrs: '', start: lt, end: end + 1 }) === false) return;
    } else {
      const selfClosing = text.charCodeAt(end - 1) === 47;
      const body = text.slice(lt + 1, selfClosing ? end - 1 : end);
      const space = body.search(/\s/);
      const name = space < 0 ? body : body.slice(0, space);
      const attrs = space < 0 ? '' : body.slice(space);
      if (visit({ kind: selfClosing ? 'empty' : 'open', name, attrs, start: lt, end: end + 1 }) === false) return;
    }
    at = end + 1;
  }
}

/**
 * Parses a whole part into elements. Elements named in `skip` (by local name) keep their
 * offsets but not their children: worksheets skip `sheetData`, which is read row by row
 * elsewhere.
 */
export function parseXml(text: string, skip: string[] = []): XmlElement {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new XmlError('This file contains a document type definition, which Folio refuses for safety.');
  const root = new XmlElement('#document', [], 0, text.length);
  root.innerStart = 0;
  root.innerEnd = text.length;
  const stack: XmlElement[] = [root];
  let last = 0;
  let skipping: { element: XmlElement; depth: number } | null = null;
  scanTags(text, 0, text.length, (tag) => {
    if (skipping) {
      const local = tag.name.slice(tag.name.indexOf(':') + 1);
      if (local === skipping.element.local) {
        if (tag.kind === 'open') skipping.depth += 1;
        else if (tag.kind === 'close' && --skipping.depth === 0) {
          skipping.element.innerEnd = tag.start;
          skipping.element.end = tag.end;
          skipping = null;
          last = tag.end;
        }
      }
      return;
    }
    const parent = stack[stack.length - 1]!;
    if (tag.start > last) {
      const raw = text.slice(last, tag.start);
      if (raw.trim() || parent.local === 't' || parent.local === 'v' || parent.local === 'f') {
        parent.children.push({ text: unescapeXml(raw), start: last, end: tag.start });
      }
    }
    last = tag.end;
    if (tag.name === '#cdata') {
      parent.children.push({ text: tag.attrs, start: tag.start, end: tag.end });
      return;
    }
    if (tag.kind === 'close') {
      const open = stack.pop();
      if (!open || open.name !== tag.name || stack.length === 0) throw new XmlError(`Mismatched </${tag.name}>`);
      open.innerEnd = tag.start;
      open.end = tag.end;
      return;
    }
    const element = new XmlElement(tag.name, parseAttrs(tag.attrs), tag.start, tag.end);
    parent.children.push(element);
    if (tag.kind === 'empty') {
      element.innerStart = element.innerEnd = tag.end;
      return;
    }
    element.innerStart = tag.end;
    if (skip.includes(element.local)) {
      skipping = { element, depth: 1 };
      return;
    }
    stack.push(element);
  });
  if (skipping || stack.length !== 1) throw new XmlError('The part ends before its elements close.');
  const document = root.elements()[0];
  if (!document) throw new XmlError('The part is empty.');
  return document;
}

/** Text with some ranges replaced. Replacements must not overlap. */
export function patchText(text: string, edits: { start: number; end: number; text: string }[]): string {
  if (edits.length === 0) return text;
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let at = 0;
  for (const edit of sorted) {
    if (edit.start < at) throw new Error('Overlapping XML edits');
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + text.slice(at);
}

/** Decodes a part's bytes (UTF-8, or UTF-16 with a byte-order mark). */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}
