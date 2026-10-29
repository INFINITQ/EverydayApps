// Pictures as PDF pages, for "Insert pages from a file". JPEGs go in as they are (no
// re-compression); other pictures are decoded by the browser and stored losslessly, with a
// transparency mask when they have one. Each page has the picture's shape, sized like the
// document's pages.

export type Picture =
  | { kind: 'jpeg'; bytes: Uint8Array; width: number; height: number; components: 1 | 3 | 4 }
  | { kind: 'pixels'; rgba: Uint8ClampedArray; width: number; height: number };

/** A JPEG's size and color channels, from its frame header; null if it isn't a JPEG. */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: 1 | 3 | 4 } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    // Frame headers (SOF0-SOF15, except DHT, JPG and DAC) carry the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[at + 5]! << 8) | bytes[at + 6]!;
      const width = (bytes[at + 7]! << 8) | bytes[at + 8]!;
      const components = bytes[at + 9]!;
      if (!width || !height || ![1, 3, 4].includes(components)) return null;
      return { width, height, components: components as 1 | 3 | 4 };
    }
    at += 2 + length;
  }
  return null;
}

/** Browser only: a picked picture, JPEGs kept as they are and everything else as pixels. */
export async function decodePicture(bytes: Uint8Array): Promise<Picture> {
  const jpeg = jpegInfo(bytes);
  if (jpeg) return { kind: 'jpeg', bytes, ...jpeg };
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The picture could not be read.');
    context.drawImage(bitmap, 0, 0);
    return { kind: 'pixels', rgba: context.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Browser only: a picture's size in pixels. */
export async function pictureSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/** Browser only: a picture's RGBA pixels, scaled down to fit `max` (never up). */
export async function picturePixels(bytes: Uint8Array, max: { width: number; height: number }) {
  const { width, height } = await pictureSize(bytes);
  const scale = Math.min(1, max.width / width, max.height / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]), { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  try {
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The picture could not be read.');
    context.drawImage(bitmap, 0, 0);
    return { rgba: context.getImageData(0, 0, w, h).data, width: w, height: h };
  } finally {
    bitmap.close();
  }
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The page size for a picture: its shape, as large as fits in `box` turned to match it. */
export function pageFor(width: number, height: number, box: { width: number; height: number }) {
  const long = Math.max(box.width, box.height);
  const short = Math.min(box.width, box.height);
  const [boxW, boxH] = width >= height ? [long, short] : [short, long];
  const scale = Math.min(boxW / width, boxH / height);
  return { width: Math.round(width * scale * 100) / 100, height: Math.round(height * scale * 100) / 100 };
}

/** A PDF with one page per picture. */
export async function picturesPdf(pictures: Picture[], box: { width: number; height: number }): Promise<Uint8Array> {
  const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
  const objects: Uint8Array[][] = [];
  const add = (...parts: (string | Uint8Array)[]) => objects.push(parts.map((p) => (typeof p === 'string' ? latin1(p) : p)));
  const stream = (dict: string, data: Uint8Array) => add(`<< ${dict} /Length ${data.length} >>\nstream\n`, data, '\nendstream');

  add(''); // 1: catalog
  add(''); // 2: pages
  const kids: number[] = [];
  for (const picture of pictures) {
    const { width, height } = picture;
    let image: number;
    if (picture.kind === 'jpeg') {
      const space = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' }[picture.components];
      // Adobe CMYK JPEGs store inverted values.
      const decode = picture.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
      image = stream(
        `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${space} /BitsPerComponent 8${decode} /Filter /DCTDecode`,
        picture.bytes,
      );
    } else {
      const pixels = width * height;
      const rgb = new Uint8Array(pixels * 3);
      const alpha = new Uint8Array(pixels);
      let seeThrough = false;
      for (let i = 0; i < pixels; i++) {
        rgb[i * 3] = picture.rgba[i * 4]!;
        rgb[i * 3 + 1] = picture.rgba[i * 4 + 1]!;
        rgb[i * 3 + 2] = picture.rgba[i * 4 + 2]!;
        alpha[i] = picture.rgba[i * 4 + 3]!;
        if (alpha[i]! < 255) seeThrough = true;
      }
      const mask = seeThrough
        ? stream(
            `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
            await deflate(alpha),
          )
        : 0;
      image = stream(
        `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode` +
          (mask ? ` /SMask ${mask} 0 R` : ''),
        await deflate(rgb),
      );
    }
    const page = pageFor(width, height, box);
    const content = stream('', latin1(`q ${page.width} 0 0 ${page.height} 0 0 cm /Im0 Do Q`));
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
          `/Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[0] = [latin1('<< /Type /Catalog /Pages 2 0 R >>')];
  objects[1] = [latin1(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`)];

  const out: Uint8Array[] = [latin1('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
  let size = out[0]!.length;
  const offsets: number[] = [];
  objects.forEach((parts, i) => {
    offsets.push(size);
    for (const part of [latin1(`${i + 1} 0 obj\n`), ...parts, latin1('\nendobj\n')]) {
      out.push(part);
      size += part.length;
    }
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`;
  out.push(latin1(xref));
  const pdf = new Uint8Array(out.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of out) {
    pdf.set(part, at);
    at += part.length;
  }
  return pdf;
}
