// A small ZIP reader and writer for Office packages, built for "patch, don't regenerate":
// entries the app didn't change are copied byte for byte (local header, compressed data
// and central directory record), and only changed or new parts are compressed again.
// Documents are untrusted, so reading is bounded: entry count, each entry's size and the
// total size are checked before anything is inflated, and inflating stops as soon as an
// entry produces more bytes than its header declared (zip bombs lie about their size).
// Inflate and deflate use the platform's own CompressionStream (nothing to bundle).

export type ZipLimits = {
  maxEntries: number;
  /** Largest single entry once inflated. */
  maxEntryBytes: number;
  /** All entries together once inflated. */
  maxTotalBytes: number;
};

export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxEntryBytes: 1024 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
};

export class ZipError extends Error {}

/** One entry as found in the archive. `raw` and `central` are the exact original bytes. */
export type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  /** Local header, compressed data and any data descriptor, exactly as in the file. */
  raw: Uint8Array;
  /** Offset of the compressed data inside `raw`. */
  dataOffset: number;
  /** The central directory record, exactly as in the file. */
  central: Uint8Array;
};

export type ZipArchive = { entries: ZipEntry[]; comment: Uint8Array };

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const END64_LOCATOR = 0x07064b50;

const utf8 = new TextDecoder('utf-8');
// Names without the UTF-8 flag are code page 437; latin1 is close enough for part names.
const cp437 = new TextDecoder('latin1');

export function readZip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at, true);
  const u16 = (at: number) => view.getUint16(at, true);
  const u64 = (at: number) => {
    const value = view.getBigUint64(at, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('The file is too large.');
    return Number(value);
  };
  if (bytes.length < 22) throw new ZipError("This isn't a PowerPoint file.");

  // The end record sits in the last 64 KiB + 22 bytes (it may be followed by a comment).
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(at) === END && at + 22 + u16(at + 20) <= bytes.length) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipError("This isn't a PowerPoint file, or it is damaged.");
  let count = u16(end + 10);
  let directorySize = u32(end + 12);
  let directoryOffset = u32(end + 16);
  const comment = bytes.slice(end + 22, end + 22 + u16(end + 20));
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || u32(locator) !== END64_LOCATOR) throw new ZipError('The file is damaged.');
    const end64 = u64(locator + 8);
    if (end64 + 56 > bytes.length || u32(end64) !== END64) throw new ZipError('The file is damaged.');
    count = u64(end64 + 32);
    directorySize = u64(end64 + 40);
    directoryOffset = u64(end64 + 48);
  }
  if (count > limits.maxEntries) throw new ZipError(`The file has too many parts (${count}).`);
  if (directoryOffset + directorySize > bytes.length) throw new ZipError('The file is damaged.');

  type Found = Omit<ZipEntry, 'raw' | 'dataOffset'> & { localOffset: number };
  const found: Found[] = [];
  let at = directoryOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(at) !== CENTRAL) throw new ZipError('The file is damaged.');
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const crc = u32(at + 16);
    let compressedSize = u32(at + 20);
    let size = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    let localOffset = u32(at + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (at + recordLength > bytes.length) throw new ZipError('The file is damaged.');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = (flags & 0x800 ? utf8 : cp437).decode(nameBytes);
    // ZIP64: sizes and offset that don't fit 32 bits live in an extra field, in this order.
    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      let extra = at + 46 + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = u16(extra);
        const length = u16(extra + 2);
        if (id === 0x0001) {
          let field = extra + 4;
          if (size === 0xffffffff) (size = u64(field)), (field += 8);
          if (compressedSize === 0xffffffff) (compressedSize = u64(field)), (field += 8);
          if (localOffset === 0xffffffff) localOffset = u64(field);
          break;
        }
        extra += 4 + length;
      }
    }
    if (flags & 0x1) throw new ZipError('This presentation is encrypted, so it can\'t be opened.');
    if (method !== 0 && method !== 8) throw new ZipError(`${name} uses a compression method Folio can't read.`);
    if (size > limits.maxEntryBytes) throw new ZipError(`${name} is too large to open safely.`);
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError('The presentation is too large to open safely.');
    found.push({
      name,
      method,
      flags,
      crc,
      compressedSize,
      size,
      localOffset,
      central: bytes.subarray(at, at + recordLength),
    });
    at += recordLength;
  }

  // Each entry's original bytes run from its local header to the next entry (or the
  // central directory), which also covers a data descriptor after the data.
  const starts = [...new Set(found.map((f) => f.localOffset))].sort((a, b) => a - b);
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  for (const entry of found) {
    const local = entry.localOffset;
    if (local + 30 > bytes.length || u32(local) !== LOCAL) throw new ZipError('The file is damaged.');
    const dataOffset = 30 + u16(local + 26) + u16(local + 28);
    const next = starts.find((s) => s > local) ?? directoryOffset;
    const stop = Math.min(next, directoryOffset);
    if (local + dataOffset + entry.compressedSize > stop) throw new ZipError('The file is damaged.');
    const key = entry.name.toLowerCase();
    if (names.has(key)) throw new ZipError(`The file has two parts named ${entry.name}.`);
    names.add(key);
    entries.push({
      name: entry.name,
      method: entry.method,
      flags: entry.flags,
      crc: entry.crc,
      compressedSize: entry.compressedSize,
      size: entry.size,
      central: entry.central,
      raw: bytes.subarray(local, stop),
      dataOffset,
    });
  }
  return { entries, comment };
}

/** The entry's contents, inflated and checked against its declared size and CRC. */
export async function inflateEntry(entry: ZipEntry): Promise<Uint8Array> {
  const data = entry.raw.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  let out: Uint8Array;
  if (entry.method === 0) {
    out = data.slice();
  } else {
    out = await pump(data, new DecompressionStream('deflate-raw'), entry.size, entry.name);
  }
  if (out.length !== entry.size) throw new ZipError(`${entry.name} is damaged.`);
  if (crc32(out) !== entry.crc) throw new ZipError(`${entry.name} is damaged.`);
  return out;
}

export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  return pump(data, new CompressionStream('deflate-raw'), Infinity, 'data');
}

/** Runs `data` through a (de)compression stream, stopping once it exceeds `limit` bytes. */
async function pump(data: Uint8Array, stream: TransformStream<BufferSource, Uint8Array>, limit: number, name: string) {
  const writer = stream.writable.getWriter();
  void writer.write(data as BufferSource).catch(() => undefined);
  void writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new ZipError(`${name} is larger than it claims to be, so it wasn't opened.`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ZipError) throw error;
    throw new ZipError(`${name} is damaged.`);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** What to write: an entry copied unchanged, or new contents for a part. */
export type ZipItem = { entry: ZipEntry } | { name: string; data: Uint8Array };

const encoder = new TextEncoder();

/** Writes an archive. Copied entries keep their exact bytes; new ones are deflated. */
export async function writeZip(items: ZipItem[], comment: Uint8Array = new Uint8Array()): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const item of items) {
    if ('entry' in item) {
      const central = item.entry.central.slice();
      const view = new DataView(central.buffer);
      if (offset > 0xfffffffe) throw new ZipError('The presentation is too large to save.');
      if (view.getUint32(42, true) === 0xffffffff) throw new ZipError('The presentation is too large to save.');
      view.setUint32(42, offset, true);
      chunks.push(item.entry.raw);
      directory.push(central);
      offset += item.entry.raw.length;
      continue;
    }
    const name = encoder.encode(item.name);
    const compressed = await deflate(item.data);
    // Tiny parts can grow when deflated: store those as they are.
    const stored = compressed.length >= item.data.length;
    const body = stored ? item.data : compressed;
    const crc = crc32(item.data);
    if (offset + body.length > 0xfffffffe) throw new ZipError('The presentation is too large to save.');
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x800, true);
    lv.setUint16(8, stored ? 0 : 8, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, item.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, stored ? 0 : 8, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, item.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    chunks.push(local, body);
    directory.push(central);
    offset += local.length + body.length;
  }
  const directorySize = directory.reduce((sum, c) => sum + c.length, 0);
  if (items.length > 0xfffe || offset + directorySize > 0xfffffffe) {
    throw new ZipError('The presentation is too large to save.');
  }
  const end = new Uint8Array(22 + comment.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END, true);
  ev.setUint16(8, items.length, true);
  ev.setUint16(10, items.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, comment.length, true);
  end.set(comment, 22);
  const out = new Uint8Array(offset + directorySize + end.length);
  let at = 0;
  for (const chunk of [...chunks, ...directory, end]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function dosTime(now: Date) {
  return {
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
    date: (Math.max(0, now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
  };
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
