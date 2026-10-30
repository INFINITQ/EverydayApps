// Microsoft's Compound File Binary format (the container of .xls files): just enough to read
// one stream by name. Untrusted input: every sector chain is checked for loops and bounds.

export class XlsError extends Error {}

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const FREE = 0xffffffff;
const MAX_STREAM = 512 * 1024 * 1024;

export function isCompoundFile(bytes: Uint8Array): boolean {
  return SIGNATURE.every((b, i) => bytes[i] === b);
}

/** The streams of a compound file, by name (case-insensitive), read on demand. */
export function readCompoundFile(bytes: Uint8Array): { stream(name: string): Uint8Array | null; names: string[] } {
  if (!isCompoundFile(bytes)) throw new XlsError("This file isn't an Excel 97-2003 workbook.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const sectorSize = 1 << u16(0x1e);
  const miniSize = 1 << u16(0x20);
  if (sectorSize !== 512 && sectorSize !== 4096) throw new XlsError('The workbook is damaged (bad sector size).');
  const sector = (n: number) => {
    const start = (n + 1) * sectorSize;
    if (start + sectorSize > bytes.length + sectorSize) throw new XlsError('The workbook is damaged (a sector is past the end).');
    return bytes.subarray(start, Math.min(start + sectorSize, bytes.length));
  };

  // The FAT's own sectors: 109 listed in the header, more in DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(0x4c + i * 4);
    if (s !== FREE) fatSectors.push(s);
  }
  let difat = u32(0x44);
  const seen = new Set<number>();
  while (difat !== END && difat !== FREE && fatSectors.length < 1_000_000) {
    if (seen.has(difat)) throw new XlsError('The workbook is damaged (a loop in its sector list).');
    seen.add(difat);
    const data = sector(difat);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const s = dv.getUint32(i * 4, true);
      if (s !== FREE) fatSectors.push(s);
    }
    difat = dv.getUint32(sectorSize - 4, true);
  }
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4));
  fatSectors.forEach((s, i) => {
    const data = sector(s);
    fat.set(new Uint32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)), i * (sectorSize / 4));
  });

  const chain = (start: number, table: Uint32Array): number[] => {
    const out: number[] = [];
    const visited = new Set<number>();
    for (let s = start; s !== END && s !== FREE; s = table[s] ?? END) {
      if (visited.has(s) || s >= table.length) throw new XlsError('The workbook is damaged (a broken sector chain).');
      visited.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number, size: number): Uint8Array => {
    if (size > MAX_STREAM) throw new XlsError('The workbook is too large to open.');
    const out = new Uint8Array(size);
    let at = 0;
    for (const s of chain(start, fat)) {
      if (at >= size) break;
      const data = sector(s);
      out.set(data.subarray(0, Math.min(data.length, size - at)), at);
      at += sectorSize;
    }
    return out;
  };

  // Directory entries, 128 bytes each.
  const dirStart = u32(0x30);
  const dirSectors = chain(dirStart, fat);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (const s of dirSectors) {
    const data = sector(s);
    for (let at = 0; at + 128 <= data.length; at += 128) {
      const dv = new DataView(data.buffer, data.byteOffset + at, 128);
      const length = Math.min(64, dv.getUint16(64, true));
      let name = '';
      for (let i = 0; i + 2 < length; i += 2) name += String.fromCharCode(dv.getUint16(i, true));
      entries.push({ name, type: dv.getUint8(66), start: dv.getUint32(116, true), size: dv.getUint32(120, true) });
    }
  }
  const root = entries.find((e) => e.type === 5);
  const cutoff = u32(0x38) || 4096;
  let mini: { stream: Uint8Array; fat: Uint32Array } | null = null;
  const miniStream = () => {
    if (!mini) {
      const miniFatStart = u32(0x3c);
      const count = u32(0x40);
      const table = readChain(miniFatStart, count * sectorSize);
      mini = {
        stream: root ? readChain(root.start, root.size) : new Uint8Array(),
        fat: new Uint32Array(table.buffer, table.byteOffset, Math.floor(table.byteLength / 4)),
      };
    }
    return mini;
  };

  return {
    names: entries.filter((e) => e.type === 2).map((e) => e.name),
    stream(name) {
      const entry = entries.find((e) => e.type === 2 && e.name.toLowerCase() === name.toLowerCase());
      if (!entry) return null;
      if (entry.size >= cutoff) return readChain(entry.start, entry.size);
      const { stream, fat: miniFat } = miniStream();
      if (entry.size > MAX_STREAM) throw new XlsError('The workbook is too large to open.');
      const out = new Uint8Array(entry.size);
      let at = 0;
      for (const s of chain(entry.start, miniFat)) {
        if (at >= entry.size) break;
        out.set(stream.subarray(s * miniSize, s * miniSize + Math.min(miniSize, entry.size - at)), at);
        at += miniSize;
      }
      return out;
    },
  };
}
