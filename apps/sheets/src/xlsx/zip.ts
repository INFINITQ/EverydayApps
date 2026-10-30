// A small zip reader and writer for Office packages. Reading never inflates more than an
// entry declares (zip bombs stop early), and writing copies the compressed bytes of every
// part that wasn't changed exactly as they were: an untouched part stays byte-for-byte the
// same, down to its compression.

import { Inflate, deflateSync } from 'fflate';

/** Limits for untrusted packages. */
export const ZIP_LIMITS = {
  /** Most parts a package may have. */
  entries: 20_000,
  /** Largest single part, uncompressed. */
  entryBytes: 512 * 1024 * 1024,
  /** All parts together, uncompressed. */
  totalBytes: 2 * 1024 * 1024 * 1024,
  /** Deflate can't expand data more than about 1032 times; claims beyond that are lies. */
  ratio: 1100,
};

export class ZipError extends Error {}

export type ZipEntry = {
  name: string;
  /** 0 = stored, 8 = deflated. */
  method: number;
  /** The compressed bytes, as stored in the file. */
  data: Uint8Array;
  crc: number;
  size: number;
  /** DOS time and date, kept for parts copied as they are. */
  time: number;
  date: number;
  /** Bit 11 of the flags: the name is UTF-8. */
  utf8: boolean;
};

const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const u64 = (b: Uint8Array, at: number) => u32(b, at) + u32(b, at + 4) * 2 ** 32;

/** Reads the central directory. Entry data is not inflated until asked for. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  // The end-of-directory record is at most 64 KB (its comment) from the end.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
    if (u32(bytes, at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("This file isn't a workbook (it isn't a zip package).");
  let count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  // Zip64: the real values are in the zip64 end record.
  if (count === 0xffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || u32(bytes, locator) !== 0x07064b50) throw new ZipError('The package is damaged.');
    const record = u64(bytes, locator + 8);
    if (u32(bytes, record) !== 0x06064b50) throw new ZipError('The package is damaged.');
    count = u64(bytes, record + 32);
    offset = u64(bytes, record + 48);
  }
  if (count > ZIP_LIMITS.entries) throw new ZipError('The package has too many parts.');

  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let total = 0;
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (u32(bytes, at) !== 0x02014b50) throw new ZipError('The package is damaged.');
    const flags = u16(bytes, at + 8);
    const method = u16(bytes, at + 10);
    const time = u16(bytes, at + 12);
    const date = u16(bytes, at + 14);
    const crc = u32(bytes, at + 16);
    let compressed = u32(bytes, at + 20);
    let size = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    let local = u32(bytes, at + 42);
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    // Zip64 sizes and offset, in that order, for the fields that overflowed.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = u16(bytes, extra);
      const length = u16(bytes, extra + 2);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === 0xffffffff) {
          size = u64(bytes, field);
          field += 8;
        }
        if (compressed === 0xffffffff) {
          compressed = u64(bytes, field);
          field += 8;
        }
        if (local === 0xffffffff) local = u64(bytes, field);
      }
      extra += 4 + length;
    }
    at = extraEnd + commentLength;

    const name = decoder.decode(nameBytes);
    if (u32(bytes, local) !== 0x04034b50) throw new ZipError('The package is damaged.');
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    if (start + compressed > bytes.length) throw new ZipError('The package is damaged (cut short).');
    if (method !== 0 && method !== 8) throw new ZipError(`The package uses a compression Folio can't read (${name}).`);
    if (flags & 1) throw new ZipError('Encrypted workbooks are not supported yet.');
    if (size > ZIP_LIMITS.entryBytes) throw new ZipError(`${name} is too large to open.`);
    if (method === 8 ? size > Math.max(compressed, 1) * ZIP_LIMITS.ratio : size !== compressed) {
      throw new ZipError('The package is damaged or unsafe (a part claims an impossible size).');
    }
    total += size;
    if (total > ZIP_LIMITS.totalBytes) throw new ZipError('The workbook is too large to open.');
    if (name.endsWith('/')) continue;
    entries.push({ name, method, data: bytes.subarray(start, start + compressed), crc, size, time, date, utf8: (flags & 0x800) !== 0 });
  }
  return entries;
}

/** The entry's contents, checked against its size and checksum. */
export function inflate(entry: ZipEntry): Uint8Array {
  if (entry.method === 0) return check(entry, entry.data);
  const out = new Uint8Array(entry.size);
  let used = 0;
  let overflow = false;
  const inflater = new Inflate((chunk) => {
    if (overflow) return;
    if (used + chunk.length > out.length) {
      overflow = true;
      return;
    }
    out.set(chunk, used);
    used += chunk.length;
  });
  const STEP = 64 * 1024;
  const data = entry.data;
  if (data.length === 0) inflater.push(new Uint8Array(0), true);
  for (let i = 0; i < data.length && !overflow; i += STEP) inflater.push(data.subarray(i, i + STEP), i + STEP >= data.length);
  if (overflow || used !== out.length) throw new ZipError(`${entry.name} is damaged or unsafe (its size is wrong).`);
  return check(entry, out);
}

function check(entry: ZipEntry, data: Uint8Array): Uint8Array {
  if (crc32(data) !== entry.crc) throw new ZipError(`${entry.name} is damaged (checksum mismatch).`);
  return data;
}

let table: Uint32Array | undefined;
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A part to write: either an entry copied as it is, or new contents. */
export type ZipOut = { name: string; entry: ZipEntry } | { name: string; bytes: Uint8Array };

/** 1980-01-01 00:00, what Office itself stamps on package parts. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function writeZip(parts: ZipOut[]): Uint8Array {
  const encoder = new TextEncoder();
  const records: { name: Uint8Array; method: number; crc: number; compressed: number; size: number; time: number; date: number; offset: number; utf8: boolean }[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = encoder.encode(part.name);
    let method: number, data: Uint8Array, crc: number, size: number, time = 0, date = DOS_DATE;
    if ('entry' in part) {
      ({ method, data, crc, size, time, date } = part.entry);
    } else {
      size = part.bytes.length;
      crc = crc32(part.bytes);
      const deflated = deflateSync(part.bytes, { level: 6 });
      // Tiny parts can come out larger compressed; store those.
      method = deflated.length < size ? 8 : 0;
      data = method === 8 ? deflated : part.bytes;
    }
    const utf8 = /[^\x20-\x7e]/.test(part.name);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, utf8 ? 0x800 : 0, true);
    view.setUint16(8, method, true);
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, size, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    chunks.push(header, name, data);
    records.push({ name, method, crc, compressed: data.length, size, time, date, offset, utf8 });
    offset += header.length + name.length + data.length;
    if (offset > 0xffffffff) throw new ZipError('The workbook is too large to save.');
  }
  const directoryStart = offset;
  for (const r of records) {
    const record = new Uint8Array(46);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, r.utf8 ? 0x800 : 0, true);
    view.setUint16(10, r.method, true);
    view.setUint16(12, r.time, true);
    view.setUint16(14, r.date, true);
    view.setUint32(16, r.crc, true);
    view.setUint32(20, r.compressed, true);
    view.setUint32(24, r.size, true);
    view.setUint16(28, r.name.length, true);
    view.setUint32(42, r.offset, true);
    chunks.push(record, r.name);
    offset += record.length + r.name.length;
  }
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, records.length, true);
  view.setUint16(10, records.length, true);
  view.setUint32(12, offset - directoryStart, true);
  view.setUint32(16, directoryStart, true);
  chunks.push(end);
  const out = new Uint8Array(offset + end.length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
