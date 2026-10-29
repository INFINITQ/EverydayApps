// Cell formats: styles.xml <-> Univer styles.
//
// Reading turns every cell format (cellXfs entry) into a Univer style with the id "x<index>".
// Saving never changes or reorders existing formats: a cell that keeps its format keeps its
// index, and a changed format is appended, derived from the cell's original one so whatever
// Folio doesn't show (theme colors, font schemes, protection, cell styles) carries over.

import type { IBorderData, IBorderStyleData, IStyleData, Nullable } from '@univerjs/core';
import { type XmlElement, attrsText, escapeAttr, parseXml, patchText } from './xml';

/** Excel's default palette (indexed colors 0-63). */
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00',
  '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF',
  '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300',
  '993300', '993366', '333399', '333333',
];

/** Office's default theme colors, in the order cell formats number them (lt1, dk1, lt2, dk2...). */
const DEFAULT_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];

/** Built-in number formats (the ones that don't depend on the PC's region). */
export const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?',
  13: '# ??/??', 14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
  20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

const BORDER_STYLES = ['none', 'thin', 'hair', 'dotted', 'dashed', 'dashDot', 'dashDotDot', 'double', 'medium', 'mediumDashed', 'mediumDashDot', 'mediumDashDotDot', 'slantDashDot', 'thick'];
const BORDER_SIDES: [keyof IBorderData, string][] = [['l', 'left'], ['r', 'right'], ['t', 'top'], ['b', 'bottom']];
const H_ALIGN: Record<string, number> = { left: 1, center: 2, right: 3, justify: 4, distributed: 6 };
const V_ALIGN: Record<string, number> = { top: 1, center: 2, bottom: 3, justify: 2, distributed: 2 };

/** Theme colors from a theme part's color scheme, in cell-format order. */
export function themeColors(theme: XmlElement | undefined): string[] {
  const scheme = theme?.path('themeElements/clrScheme');
  if (!scheme) return DEFAULT_THEME;
  const color = (name: string, fallback: string) => {
    const el = scheme.child(name);
    const srgb = el?.child('srgbClr')?.attr('val');
    const sys = el?.child('sysClr')?.attr('lastClr');
    return (srgb ?? sys ?? fallback).toUpperCase();
  };
  const names = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  return names.map((name, i) => color(name, DEFAULT_THEME[i]!));
}

/** Lightens (tint > 0) or darkens (tint < 0) a color the way Office does, in HSL. */
export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let out: number[];
  if (s === 0) out = [l, l, l];
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    out = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return out.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export type Palette = { theme: string[]; indexed: string[] };

/** A <color>-like element as "#RRGGBB", or undefined for automatic/unknown. */
export function colorOf(el: XmlElement | undefined, palette: Palette): string | undefined {
  if (!el || el.attr('auto') === '1') return undefined;
  let hex: string | undefined;
  const rgb = el.attr('rgb');
  const theme = el.attr('theme');
  const indexed = el.attr('indexed');
  if (rgb) hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  else if (theme !== undefined) hex = palette.theme[Number(theme)];
  else if (indexed !== undefined) {
    const n = Number(indexed);
    if (n === 64 || n === 65) return undefined; // system foreground / background
    hex = palette.indexed[n];
  }
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  const tint = Number(el.attr('tint') ?? 0);
  return `#${applyTint(hex.toUpperCase(), Number.isFinite(tint) ? tint : 0)}`;
}

const on = (el: XmlElement | undefined) => el !== undefined && !['0', 'false'].includes(el.attr('val') ?? '1');

export function fontStyle(font: XmlElement | undefined, palette: Palette): IStyleData {
  const style: IStyleData = {};
  if (!font) return style;
  const name = font.child('name')?.attr('val');
  if (name) style.ff = name;
  const size = Number(font.child('sz')?.attr('val'));
  if (size > 0) style.fs = size;
  if (on(font.child('b'))) style.bl = 1;
  if (on(font.child('i'))) style.it = 1;
  const underline = font.child('u');
  if (underline && underline.attr('val') !== 'none') style.ul = { s: 1 };
  if (on(font.child('strike'))) style.st = { s: 1 };
  const color = colorOf(font.child('color'), palette);
  if (color) style.cl = { rgb: color };
  const vert = font.child('vertAlign')?.attr('val');
  if (vert === 'superscript') style.va = 3;
  else if (vert === 'subscript') style.va = 2;
  return style;
}

function fillStyle(fill: XmlElement | undefined, palette: Palette): IStyleData {
  const pattern = fill?.child('patternFill');
  if (pattern) {
    const type = pattern.attr('patternType') ?? (pattern.child('fgColor') ? 'solid' : 'none');
    if (type === 'none') return {};
    // Patterns other than solid show as their foreground color (gray125 and friends as a tint).
    const color = colorOf(pattern.child('fgColor'), palette) ?? (type === 'solid' ? undefined : colorOf(pattern.child('bgColor'), palette));
    return color ? { bg: { rgb: color } } : {};
  }
  const stop = fill?.child('gradientFill')?.child('stop');
  const color = colorOf(stop?.child('color'), palette);
  return color ? { bg: { rgb: color } } : {};
}

function borderSide(el: XmlElement | undefined, palette: Palette): IBorderStyleData | undefined {
  const kind = el?.attr('style');
  if (!el || !kind || kind === 'none') return undefined;
  const s = BORDER_STYLES.indexOf(kind);
  return { s: s < 0 ? 1 : s, cl: { rgb: colorOf(el.child('color'), palette) ?? '#000000' } };
}

function borderStyle(border: XmlElement | undefined, palette: Palette): IStyleData {
  if (!border) return {};
  const bd: IBorderData = {};
  for (const [key, name] of BORDER_SIDES) {
    const side = borderSide(border.child(name) ?? border.child(name === 'left' ? 'start' : name === 'right' ? 'end' : name), palette);
    if (side) bd[key] = side;
  }
  const diagonal = borderSide(border.child('diagonal'), palette);
  if (diagonal && border.attr('diagonalDown') === '1') bd.tl_br = diagonal;
  if (diagonal && border.attr('diagonalUp') === '1') bd.bl_tr = diagonal;
  return Object.keys(bd).length ? { bd } : {};
}

function alignmentStyle(alignment: XmlElement | undefined): IStyleData {
  const style: IStyleData = {};
  if (!alignment) return style;
  const h = H_ALIGN[alignment.attr('horizontal') ?? ''];
  if (h) style.ht = h;
  const v = V_ALIGN[alignment.attr('vertical') ?? ''];
  if (v) style.vt = v;
  if (alignment.attr('wrapText') === '1' || alignment.attr('wrapText') === 'true') style.tb = 3;
  const rotation = Number(alignment.attr('textRotation') ?? 0);
  if (rotation === 255) style.tr = { a: 0, v: 1 };
  else if (rotation > 0 && rotation <= 90) style.tr = { a: rotation };
  else if (rotation > 90 && rotation <= 180) style.tr = { a: 90 - rotation };
  return style;
}

/** A style group's key, for comparing two styles group by group. */
const FONT_KEYS = ['ff', 'fs', 'bl', 'it', 'ul', 'st', 'cl', 'va'] as const;
const ALIGN_KEYS = ['ht', 'vt', 'tb', 'tr'] as const;
const pick = (style: IStyleData | undefined, keys: readonly string[]) =>
  JSON.stringify(keys.map((k) => normalize((style as Record<string, unknown> | undefined)?.[k])));
/** Default-ish values compare equal to absent ones (bold 0, underline { s: 0 }...). */
function normalize(value: unknown): unknown {
  if (value === 0 || value === null || value === undefined) return null;
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('s' in v && (v.s === 0 || v.s === undefined) && !('cl' in v && v.cl)) return null;
    if ('rgb' in v) return v.rgb ? String(v.rgb).toUpperCase() : null;
    if ('a' in v && !v.a && !v.v) return null;
    if ('pattern' in v) return v.pattern === 'General' ? null : v.pattern;
    const keys = Object.keys(v).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const n = normalize(v[k]);
      if (n !== null) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  }
  return value;
}
export const sameFont = (a?: IStyleData, b?: IStyleData) => pick(a, FONT_KEYS) === pick(b, FONT_KEYS);
export const sameFill = (a?: IStyleData, b?: IStyleData) => pick(a, ['bg']) === pick(b, ['bg']);
export const sameBorder = (a?: IStyleData, b?: IStyleData) => pick(a, ['bd']) === pick(b, ['bd']);
export const sameAlignment = (a?: IStyleData, b?: IStyleData) => pick(a, ALIGN_KEYS) === pick(b, ALIGN_KEYS);
export const sameNumber = (a?: IStyleData, b?: IStyleData) => pick(a, ['n']) === pick(b, ['n']);
export const sameStyle = (a?: IStyleData, b?: IStyleData) =>
  sameFont(a, b) && sameFill(a, b) && sameBorder(a, b) && sameAlignment(a, b) && sameNumber(a, b);

/** What a workbook without styles.xml is assumed to have (Office's defaults). */
const FRESH_STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

const hexColor = (rgb: Nullable<string>) => `FF${String(rgb ?? '#000000').replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6)}`;

/** styles.xml, read once; turns formats into Univer styles and appends new ones on save. */
export class StyleSheet {
  readonly root: XmlElement;
  readonly palette: Palette;
  private readonly fonts: XmlElement[];
  private readonly fills: XmlElement[];
  private readonly borders: XmlElement[];
  readonly xfs: XmlElement[];
  readonly dxfs: XmlElement[];
  private readonly formats = new Map<number, string>();
  private readonly cache = new Map<number, IStyleData>();
  // Appended on save.
  private readonly added = { fonts: [] as string[], fills: [] as string[], borders: [] as string[], xfs: [] as string[], numFmts: [] as string[], dxfs: [] as string[] };
  private readonly addedIndex = new Map<string, number>();

  readonly text: string;
  /** The workbook had no styles.xml: Office's defaults were assumed and must be written. */
  readonly created: boolean;

  constructor(text: string | undefined, theme: XmlElement | undefined, palette?: Palette) {
    this.created = text === undefined;
    this.text = text ?? FRESH_STYLES;
    this.root = parseXml(this.text);
    const indexed = this.root.path('colors/indexedColors')?.elements('rgbColor').map((c) => (c.attr('rgb') ?? 'FF000000').slice(-6));
    this.palette = palette ?? { theme: themeColors(theme), indexed: indexed?.length ? indexed : INDEXED };
    this.fonts = this.root.child('fonts')?.elements('font') ?? [];
    this.fills = this.root.child('fills')?.elements('fill') ?? [];
    this.borders = this.root.child('borders')?.elements('border') ?? [];
    this.xfs = this.root.child('cellXfs')?.elements('xf') ?? [];
    this.dxfs = this.root.child('dxfs')?.elements('dxf') ?? [];
    for (const fmt of this.root.child('numFmts')?.elements('numFmt') ?? []) {
      this.formats.set(Number(fmt.attr('numFmtId')), fmt.attr('formatCode') ?? 'General');
    }
  }

  /** A fresh copy to save with: nothing appended yet. */
  fork(): StyleSheet {
    return new StyleSheet(this.created ? undefined : this.text, undefined, this.palette);
  }

  get count(): number {
    return this.xfs.length;
  }

  formatCode(id: number): string {
    return this.formats.get(id) ?? BUILTIN_FORMATS[id] ?? 'General';
  }

  /** The Univer style of cell format `index`. */
  style(index: number): IStyleData {
    let style = this.cache.get(index);
    if (!style) {
      const xf = this.xfs[index];
      style = xf ? this.xfStyle(xf) : {};
      this.cache.set(index, style);
    }
    return style;
  }

  private xfStyle(xf: XmlElement): IStyleData {
    const style: IStyleData = {
      ...fontStyle(this.fonts[Number(xf.attr('fontId') ?? 0)], this.palette),
      ...fillStyle(this.fills[Number(xf.attr('fillId') ?? 0)], this.palette),
      ...borderStyle(this.borders[Number(xf.attr('borderId') ?? 0)], this.palette),
      ...alignmentStyle(xf.child('alignment')),
    };
    const code = this.formatCode(Number(xf.attr('numFmtId') ?? 0));
    if (code !== 'General') style.n = { pattern: code };
    return style;
  }

  /** A differential format (conditional formatting) as a Univer style. */
  dxfStyle(index: number): IStyleData {
    const dxf = this.dxfs[index];
    if (!dxf) return {};
    const style: IStyleData = { ...fontStyle(dxf.child('font'), this.palette), ...borderStyle(dxf.child('border'), this.palette) };
    // In a dxf, a solid fill's color is its bgColor.
    const pattern = dxf.child('fill')?.child('patternFill');
    const color = colorOf(pattern?.child('bgColor'), this.palette) ?? colorOf(pattern?.child('fgColor'), this.palette);
    if (color) style.bg = { rgb: color };
    return style;
  }

  // ---- Saving -------------------------------------------------------------------------------

  /**
   * The index of a cell format that looks like `style`, derived from format `base` (the
   * cell's format before the change): groups that didn't change keep base's records.
   */
  indexFor(style: IStyleData, base: number): number {
    const baseStyle = this.style(base);
    if (sameStyle(style, baseStyle)) return base;
    const xf = this.xfs[base];
    const attrs = new Map<string, string>(xf?.attrs ?? [['numFmtId', '0'], ['fontId', '0'], ['fillId', '0'], ['borderId', '0'], ['xfId', '0']]);
    if (!sameFont(style, baseStyle)) {
      attrs.set('fontId', String(this.addFont(style, this.fonts[Number(attrs.get('fontId') ?? 0)])));
      attrs.set('applyFont', '1');
    }
    if (!sameFill(style, baseStyle)) {
      attrs.set('fillId', String(this.addFill(style)));
      attrs.set('applyFill', '1');
    }
    if (!sameBorder(style, baseStyle)) {
      attrs.set('borderId', String(this.addBorder(style)));
      attrs.set('applyBorder', '1');
    }
    if (!sameNumber(style, baseStyle)) {
      attrs.set('numFmtId', String(this.numFmtId(style.n?.pattern ?? 'General')));
      attrs.set('applyNumberFormat', '1');
    }
    let alignment = xf?.child('alignment') ? this.text.slice(xf.child('alignment')!.start, xf.child('alignment')!.end) : '';
    if (!sameAlignment(style, baseStyle)) {
      alignment = this.alignmentXml(style, xf?.child('alignment'));
      attrs.set('applyAlignment', '1');
    }
    const protection = xf?.child('protection');
    const children = alignment + (protection ? this.text.slice(protection.start, protection.end) : '');
    const prefix = this.root.prefix;
    const xml = `<${prefix}xf${attrsText([...attrs])}${children ? `>${children}</${prefix}xf>` : '/>'}`;
    return this.append('xfs', xml, this.xfs.length);
  }

  private append(kind: keyof StyleSheet['added'], xml: string, existing: number): number {
    const key = `${kind}:${xml}`;
    const known = this.addedIndex.get(key);
    if (known !== undefined) return known;
    this.added[kind].push(xml);
    const index = existing + this.added[kind].length - 1;
    this.addedIndex.set(key, index);
    return index;
  }

  private addFont(style: IStyleData, base: XmlElement | undefined): number {
    const p = this.root.prefix;
    const baseStyle = fontStyle(base, this.palette);
    const keep = (name: string) => {
      const el = base?.child(name);
      return el ? this.text.slice(el.start, el.end) : '';
    };
    let xml = '';
    if (style.bl) xml += `<${p}b/>`;
    if (style.it) xml += `<${p}i/>`;
    if (style.st?.s) xml += `<${p}strike/>`;
    xml += keep('condense') + keep('extend') + keep('outline') + keep('shadow');
    if (style.ul?.s) xml += base?.child('u') && baseStyle.ul?.s ? keep('u') : `<${p}u/>`;
    if (style.va === 3) xml += `<${p}vertAlign val="superscript"/>`;
    else if (style.va === 2) xml += `<${p}vertAlign val="subscript"/>`;
    xml += `<${p}sz val="${style.fs ?? baseStyle.fs ?? 11}"/>`;
    if (pick(style, ['cl']) === pick(baseStyle, ['cl'])) xml += keep('color');
    else if (style.cl?.rgb) xml += `<${p}color rgb="${hexColor(style.cl.rgb)}"/>`;
    const name = style.ff ?? baseStyle.ff ?? 'Calibri';
    xml += `<${p}name val="${escapeAttr(name)}"/>`;
    xml += keep('family') + keep('charset');
    // A theme font follows the theme; a font picked by name doesn't.
    if (name === baseStyle.ff) xml += keep('scheme');
    return this.append('fonts', `<${p}font>${xml}</${p}font>`, this.fonts.length);
  }

  private addFill(style: IStyleData): number {
    const p = this.root.prefix;
    if (!style.bg?.rgb) return 0;
    const xml = `<${p}fill><${p}patternFill patternType="solid"><${p}fgColor rgb="${hexColor(style.bg.rgb)}"/><${p}bgColor indexed="64"/></${p}patternFill></${p}fill>`;
    return this.append('fills', xml, this.fills.length);
  }

  private addBorder(style: IStyleData): number {
    const p = this.root.prefix;
    const side = (name: string, data: Nullable<IBorderStyleData>) =>
      data && data.s
        ? `<${p}${name} style="${BORDER_STYLES[data.s] ?? 'thin'}"><${p}color rgb="${hexColor(data.cl?.rgb)}"/></${p}${name}>`
        : `<${p}${name}/>`;
    const bd = style.bd ?? {};
    const diagonal = bd.tl_br ?? bd.bl_tr;
    const attrs = `${bd.bl_tr ? ' diagonalUp="1"' : ''}${bd.tl_br ? ' diagonalDown="1"' : ''}`;
    const xml = `<${p}border${attrs}>${side('left', bd.l)}${side('right', bd.r)}${side('top', bd.t)}${side('bottom', bd.b)}${side('diagonal', diagonal)}</${p}border>`;
    return this.append('borders', xml, this.borders.length);
  }

  private alignmentXml(style: IStyleData, base: XmlElement | undefined): string {
    const p = this.root.prefix;
    const attrs = new Map<string, string>(base?.attrs ?? []);
    const h = Object.entries(H_ALIGN).find(([, v]) => v === style.ht)?.[0];
    if (h) attrs.set('horizontal', h);
    else attrs.delete('horizontal');
    const v = style.vt === 1 ? 'top' : style.vt === 2 ? 'center' : undefined;
    if (v) attrs.set('vertical', v);
    else attrs.delete('vertical');
    if (style.tb === 3) attrs.set('wrapText', '1');
    else attrs.delete('wrapText');
    const a = style.tr?.v ? 255 : (style.tr?.a ?? 0);
    if (a) attrs.set('textRotation', String(a > 0 ? a : 90 - a));
    else attrs.delete('textRotation');
    return attrs.size ? `<${p}alignment${attrsText([...attrs])}/>` : '';
  }

  numFmtId(pattern: string): number {
    if (pattern === 'General') return 0;
    for (const [id, code] of Object.entries(BUILTIN_FORMATS)) if (code === pattern) return Number(id);
    for (const [id, code] of this.formats) if (code === pattern) return id;
    const id = Math.max(163, ...this.formats.keys()) + 1;
    this.formats.set(id, pattern);
    const p = this.root.prefix;
    this.added.numFmts.push(`<${p}numFmt numFmtId="${id}" formatCode="${escapeAttr(pattern)}"/>`);
    return id;
  }

  /** Appends a differential format (for conditional formatting) and returns its index. */
  addDxf(style: IStyleData): number {
    const p = this.root.prefix;
    let xml = '';
    if (FONT_KEYS.some((k) => normalize((style as Record<string, unknown>)[k]) !== null)) {
      xml += `<${p}font>${style.bl ? `<${p}b/>` : ''}${style.it ? `<${p}i/>` : ''}${style.st?.s ? `<${p}strike/>` : ''}${style.ul?.s ? `<${p}u/>` : ''}${style.cl?.rgb ? `<${p}color rgb="${hexColor(style.cl.rgb)}"/>` : ''}</${p}font>`;
    }
    if (style.bg?.rgb) xml += `<${p}fill><${p}patternFill><${p}bgColor rgb="${hexColor(style.bg.rgb)}"/></${p}patternFill></${p}fill>`;
    return this.append('dxfs', `<${p}dxf>${xml}</${p}dxf>`, this.dxfs.length);
  }

  get changed(): boolean {
    return this.created || Object.values(this.added).some((list) => list.length > 0);
  }

  /** styles.xml with the appended records (or a new one if the workbook had none). */
  toXml(): string {
    const edits: { start: number; end: number; text: string }[] = [];
    const ORDER = ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles', 'dxfs', 'tableStyles', 'colors', 'extLst'];
    const p = this.root.prefix;
    const groups: [string, string, string[], number][] = [
      ['numFmts', 'numFmt', this.added.numFmts, this.formats.size - this.added.numFmts.length],
      ['fonts', 'font', this.added.fonts, this.fonts.length],
      ['fills', 'fill', this.added.fills, this.fills.length],
      ['borders', 'border', this.added.borders, this.borders.length],
      ['cellXfs', 'xf', this.added.xfs, this.xfs.length],
      ['dxfs', 'dxf', this.added.dxfs, this.dxfs.length],
    ];
    for (const [name, , added, existing] of groups) {
      if (added.length === 0) continue;
      const el = this.root.child(name);
      const count = existing + added.length;
      if (el) {
        const open = this.text.slice(el.start, el.innerStart === el.end ? el.end : el.innerStart);
        const hasCount = /\scount="[^"]*"/.test(open);
        const newOpen = (hasCount ? open.replace(/\scount="[^"]*"/, ` count="${count}"`) : open.replace(/(\/?>)$/, ` count="${count}"$1`)).replace(/\/>$/, '>');
        if (el.innerStart === el.end) edits.push({ start: el.start, end: el.end, text: `${newOpen}${added.join('')}</${el.name}>` });
        else {
          edits.push({ start: el.start, end: el.innerStart, text: newOpen });
          edits.push({ start: el.innerEnd, end: el.innerEnd, text: added.join('') });
        }
      } else {
        // Insert the group where the schema wants it: before the first group that follows it.
        const later = ORDER.slice(ORDER.indexOf(name) + 1);
        const next = this.root.elements().find((child) => later.includes(child.local));
        const at = next ? next.start : this.root.innerEnd;
        edits.push({ start: at, end: at, text: `<${p}${name} count="${count}">${added.join('')}</${p}${name}>` });
      }
    }
    return patchText(this.text, edits);
  }

}
