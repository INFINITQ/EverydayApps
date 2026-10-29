// Reading and writing the zip container of a Word document, with limits: documents come from
// anywhere, so a file can't make Folio unpack more than it allows (zip bombs), and every part
// is checked against its stored CRC. Saving can copy an entry's original compressed bytes
// unchanged, so parts nobody edited stay byte for byte as they were.

import { deflateSync, inflateSync } from 'fflate';

export type ZipEntry = {
  name: string;
  /** 0 = stored, 8 = deflated. */
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  /** The entry's data as stored in the archive (compressed when `method` is 8). */
  raw: Uint8Array;
};

export type ZipLimits = {
  /** Most entries an archive may have. */
  entries: number;
  /** Most bytes all entries may unpack to, together. */
  totalBytes: number;
  /** Most bytes one entry may unpack to. */
  entryBytes: number;
  /** Largest unpacked/packed ratio allowed for entries bigger than `ratioFloor` bytes. */
  ratio: number;
  ratioFloor: number;
};

export const LIMITS: ZipLimits = {
  entries: 10_000,
  totalBytes: 1024 * 1024 * 1024,
  entryBytes: 512 * 1024 * 1024,
  ratio: 200,
  ratioFloor: 16 * 1024 * 1024,
};

/** Why a file can't be read as a zip archive. The message is shown to the user. */
export class ZipError extends Error {
  override name = 'ZipError';
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** True when the bytes start like a zip archive. */
export const isZip = (bytes: Uint8Array) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** True for an OLE compound file: an old .doc, or a password-protected Office document. */
export const isCompoundFile = (bytes: Uint8Array) =>
  bytes.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => bytes[i] === b);

/** Reads an archive's entries (compressed data is kept as is until `unpack`). */
export function readZip(bytes: Uint8Array, limits: ZipLimits = LIMITS): ZipEntry[] {
  const data = view(bytes);
  // The end-of-central-directory record is in the last 64 KiB + 22 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (data.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError("This file isn't a Word document (it's not a zip archive), or it's damaged.");
  const count = data.getUint16(end + 10, true);
  const directorySize = data.getUint32(end + 12, true);
  const directoryOffset = data.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new ZipError('This document is too large for Folio Docs.');
  if (count > limits.entries) throw new ZipError(`This document has too many parts (${count}).`);
  if (directoryOffset + directorySize > end) throw new ZipError('This document is damaged.');

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let total = 0;
  let at = directoryOffset;
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || data.getUint32(at, true) !== 0x02014b50) throw new ZipError('This document is damaged.');
    const flags = data.getUint16(at + 8, true);
    const method = data.getUint16(at + 10, true);
    const crc = data.getUint32(at + 16, true);
    const compressedSize = data.getUint32(at + 20, true);
    const size = data.getUint32(at + 24, true);
    const nameLength = data.getUint16(at + 28, true);
    const extraLength = data.getUint16(at + 30, true);
    const commentLength = data.getUint16(at + 32, true);
    const localOffset = data.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // a folder entry
    if (flags & 1) throw new ZipError('This document is encrypted.');
    if (method !== 0 && method !== 8) throw new ZipError('This document uses a kind of compression Folio Docs can’t read.');
    if (size === 0xffffffff || compressedSize === 0xffffffff) throw new ZipError('This document is too large for Folio Docs.');
    if (size > limits.entryBytes) throw new ZipError(`A part of this document is too large (${name}).`);
    if (size > limits.ratioFloor && size > compressedSize * limits.ratio) {
      throw new ZipError(`A part of this document unpacks to far more than its size (${name}), so Folio won't open it.`);
    }
    total += size;
    if (total > limits.totalBytes) throw new ZipError('This document unpacks to more than Folio Docs allows.');
    const key = name.toLowerCase();
    if (names.has(key)) throw new ZipError(`This document has the part ${name} twice.`);
    names.add(key);

    if (localOffset + 30 > bytes.length || data.getUint32(localOffset, true) !== 0x04034b50) {
      throw new ZipError('This document is damaged.');
    }
    const localName = data.getUint16(localOffset + 26, true);
    const localExtra = data.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localName + localExtra;
    if (start + compressedSize > bytes.length) throw new ZipError('This document is damaged (it may be cut short).');
    entries.push({ name, method, crc, compressedSize, size, raw: bytes.subarray(start, start + compressedSize) });
  }
  return entries;
}

/** An entry's unpacked bytes. Never allocates more than the size the archive declares. */
export function unpack(entry: ZipEntry): Uint8Array {
  let out: Uint8Array;
  if (entry.method === 0) {
    if (entry.raw.length !== entry.size) throw new ZipError(`The part ${entry.name} is damaged.`);
    out = entry.raw;
  } else {
    const buffer = new Uint8Array(entry.size);
    try {
      out = inflateSync(entry.raw, { out: buffer });
    } catch {
      throw new ZipError(`The part ${entry.name} is damaged.`);
    }
    if (out.length !== entry.size) throw new ZipError(`The part ${entry.name} is damaged.`);
  }
  if (crc32(out) !== entry.crc) throw new ZipError(`The part ${entry.name} is damaged (its checksum doesn't match).`);
  return out;
}

/** A new entry from unpacked bytes (pictures and other packed formats are stored as they are). */
export function packEntry(name: string, bytes: Uint8Array): ZipEntry {
  const store = /\.(png|jpe?g|gif|zip|docx|xlsx|pptx|mp4|mp3|wdp|jxr)$/i.test(name);
  const raw = store ? bytes : deflateSync(bytes, { level: 6 });
  return { name, method: store ? 0 : 8, crc: crc32(bytes), compressedSize: raw.length, size: bytes.length, raw };
}

/** Writes an archive. Entries keep their method and compressed bytes; names are UTF-8. */
export function writeZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const names = entries.map((e) => encoder.encode(e.name));
  const localSize = entries.reduce((sum, e, i) => sum + 30 + names[i]!.length + e.raw.length, 0);
  const centralSize = entries.reduce((sum, _e, i) => sum + 46 + names[i]!.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const data = view(out);
  let at = 0;
  const offsets: number[] = [];
  entries.forEach((e, i) => {
    const name = names[i]!;
    offsets.push(at);
    data.setUint32(at, 0x04034b50, true);
    data.setUint16(at + 4, 20, true);
    data.setUint16(at + 6, 0x0800, true);
    data.setUint16(at + 8, e.method, true);
    data.setUint16(at + 10, 0, true);
    data.setUint16(at + 12, 0x21, true);
    data.setUint32(at + 14, e.crc, true);
    data.setUint32(at + 18, e.raw.length, true);
    data.setUint32(at + 22, e.size, true);
    data.setUint16(at + 26, name.length, true);
    data.setUint16(at + 28, 0, true);
    out.set(name, at + 30);
    out.set(e.raw, at + 30 + name.length);
    at += 30 + name.length + e.raw.length;
  });
  const central = at;
  entries.forEach((e, i) => {
    const name = names[i]!;
    data.setUint32(at, 0x02014b50, true);
    data.setUint16(at + 4, 20, true);
    data.setUint16(at + 6, 20, true);
    data.setUint16(at + 8, 0x0800, true);
    data.setUint16(at + 10, e.method, true);
    data.setUint16(at + 12, 0, true);
    data.setUint16(at + 14, 0x21, true);
    data.setUint32(at + 16, e.crc, true);
    data.setUint32(at + 20, e.raw.length, true);
    data.setUint32(at + 24, e.size, true);
    data.setUint16(at + 28, name.length, true);
    data.setUint32(at + 42, offsets[i]!, true);
    out.set(name, at + 46);
    at += 46 + name.length;
  });
  data.setUint32(at, 0x06054b50, true);
  data.setUint16(at + 8, entries.length, true);
  data.setUint16(at + 10, entries.length, true);
  data.setUint32(at + 12, at - central, true);
  data.setUint32(at + 16, central, true);
  return out;
}
