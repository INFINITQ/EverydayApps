// Saved signatures: one list shared by every open document, kept on this PC only and
// encrypted with Windows DPAPI through the shell's secure store.

import {
  SignatureCreationType,
  deserializeEntries,
  serializeEntries,
  type SignatureEntry,
  type SignatureFieldDefinition,
  type SignatureStampFieldDefinition,
} from '@embedpdf/plugin-signature/react';
import { isFolioError, type DocHost } from '@folio/shell';

const KEY = 'pdf-signatures';
/** Older signatures beyond this many are dropped, newest first. */
const LIMIT = 12;

let entries: SignatureEntry[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function persist(host: DocHost) {
  if (entries.length === 0) await host.secure.delete(KEY).catch(() => undefined);
  else await host.secure.put(KEY, new TextEncoder().encode(JSON.stringify(serializeEntries(entries))));
}

export const savedSignatures = {
  list: () => entries,

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },

  /** Reads the saved list once per app run. */
  load(host: DocHost): Promise<void> {
    loading ??= host.secure.get(KEY).then(
      (bytes) => {
        entries = deserializeEntries(JSON.parse(new TextDecoder().decode(bytes)));
        emit();
      },
      (error: unknown) => {
        // Nothing saved yet is normal; anything else is worth saying.
        if (!(isFolioError(error) && error.kind === 'notFound')) {
          host.notify('Your saved signatures could not be read. New ones will replace them.', 'warning');
        }
      },
    );
    return loading;
  },

  async add(host: DocHost, signature: SignatureFieldDefinition): Promise<SignatureEntry> {
    await savedSignatures.load(host);
    const entry: SignatureEntry = { id: newId(), createdAt: Date.now(), signature };
    entries = [entry, ...entries].slice(0, LIMIT);
    emit();
    await persist(host);
    return entry;
  },

  /** A signature used once and not kept. */
  temporary: (signature: SignatureFieldDefinition): SignatureEntry => ({ id: newId(), createdAt: Date.now(), signature }),

  async remove(host: DocHost, id: string) {
    entries = entries.filter((entry) => entry.id !== id);
    emit();
    await persist(host);
  },
};

/** A copy cut down to the visible (non-transparent) pixels plus `padding`; the original if none. */
function trimmed(source: HTMLCanvasElement, padding: number): HTMLCanvasElement {
  const { width, height } = source;
  const alpha = source.getContext('2d')?.getImageData(0, 0, width, height).data;
  if (!alpha) return source;
  let top = height;
  let left = width;
  let bottom = -1;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[(y * width + x) * 4 + 3]! > 8) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return source;
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  const w = Math.min(width, right + padding + 1) - left;
  const h = Math.min(height, bottom + padding + 1) - top;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')?.drawImage(source, left, top, w, h, 0, 0, w, h);
  return out;
}

/**
 * Turns a picked picture (PNG or JPEG) into a signature: scaled down, trimmed, and with
 * white paper made transparent when `clearWhite` is set.
 */
export async function imageSignature(bytes: Uint8Array, clearWhite: boolean): Promise<SignatureStampFieldDefinition> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  const scale = Math.min(1, 900 / bitmap.width, 360 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the picture.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  if (clearWhite) {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      const light = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
      // Paper goes fully transparent; light grey edges fade so the ink stays smooth.
      if (light >= 225) px[i + 3] = 0;
      else if (light > 170) px[i + 3] = Math.round((px[i + 3]! * (225 - light)) / 55);
    }
    context.putImageData(image, 0, 0);
  }

  const result = trimmed(canvas, 4);
  const png = await new Promise<Blob>((resolve, reject) =>
    result.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the picture.'))), 'image/png'),
  );
  return {
    creationType: SignatureCreationType.Upload,
    imageMimeType: 'image/png',
    imageSize: { width: result.width, height: result.height },
    imageData: await png.arrayBuffer(),
    previewDataUrl: result.toDataURL('image/png'),
  };
}
