// Small helpers with no UI: the engine's toolbar slots Folio uses, word counts read from the
// document's XML, and pictures prepared for insertion.

import type { ChromeSlotId } from '@docx-editor.dev/core';

export type SlotId = ChromeSlotId;

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g;

/** Words as Word counts them: runs of non-space characters, and each CJK character on its own. */
export function countWords(text: string): number {
  let words = 0;
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const cjk = token.match(CJK)?.length ?? 0;
    const rest = token.replace(CJK, ' ').trim();
    words += cjk + (rest ? rest.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length : 0);
  }
  return words;
}

/**
 * Counts for the body of a document (`word/document.xml`): the text of each paragraph as it
 * reads now (tracked deletions and field instructions don't count; tabs and breaks are spaces).
 */
export function textStats(xml: string): { words: number; characters: number; charactersWithSpaces: number; paragraphs: number } {
  let words = 0;
  let characters = 0;
  let charactersWithSpaces = 0;
  let paragraphs = 0;
  for (const paragraph of xml.match(/<w:p[\s>][^]*?<\/w:p>/g) ?? []) {
    const text = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)]
      .map((m) => (m[1] !== undefined ? unescape(m[1]) : ' '))
      .join('');
    if (!text.trim()) continue;
    paragraphs += 1;
    words += countWords(text);
    charactersWithSpaces += [...text].length;
    characters += [...text.replace(/\s/g, '')].length;
  }
  return { words, characters, charactersWithSpaces, paragraphs };
}

const unescape = (text: string) =>
  text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_m, e: string) => {
    const named: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (named[e.toLowerCase()]) return named[e.toLowerCase()]!;
    return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });

export type PictureMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/bmp' | 'image/webp';

/** The picture's type from its first bytes (the file name can't be trusted). */
export function pictureMime(bytes: Uint8Array): PictureMime | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x42, 0x4d)) return 'image/bmp';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

/** Widest a new picture starts out (6.5 inches: a Letter page between 1-inch margins). */
const MAX_WIDTH_POINTS = 468;

/** Fits a picture's pixel size (at 96 dpi) within the text width, keeping its shape. */
export function placedSize(width: number, height: number): { widthPoints: number; heightPoints: number } {
  let w = (width * 72) / 96;
  let h = (height * 72) / 96;
  if (w > MAX_WIDTH_POINTS) {
    h = (h * MAX_WIDTH_POINTS) / w;
    w = MAX_WIDTH_POINTS;
  }
  return { widthPoints: Math.max(1, Math.round(w * 100) / 100), heightPoints: Math.max(1, Math.round(h * 100) / 100) };
}

/** Reads a picture the user picked: its type, and its size once decoded by the browser. */
export async function pictureFile(file: { name: string; bytes: Uint8Array }) {
  const mime = pictureMime(file.bytes);
  if (!mime) throw new Error(`${file.name} isn't a picture Folio can insert (PNG, JPEG, GIF, BMP or WebP).`);
  const bitmap = await createImageBitmap(new Blob([file.bytes as BlobPart], { type: mime }));
  const size = placedSize(bitmap.width, bitmap.height);
  bitmap.close();
  return { data: file.bytes, mime, ...size, title: file.name.replace(/\.[^.]+$/, '') };
}
