import { type Page, expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { type PageTools, createPageTools } from '../apps/pdf/src/pages';
// @ts-expect-error plain ES module without types
import { ATTACHMENT_TEXT, BOOKMARK_LINK, WEB_LINK, makePdf } from '../tools/fixtures/make-pdf.mjs';
import { type RunningApp, launchApp, trackViolations } from './app';
import { type PdfSummary, readPdf } from './pdfjs';

/** The bundled PDFium, for making protected and restricted test files. */
let pdfium: Promise<PageTools> | undefined;
const pageTools = () =>
  (pdfium ??= createPageTools(
    readFileSync(
      new URL('../apps/pdf/node_modules/@embedpdf/pdfium/dist/pdfium.wasm', import.meta.url),
    ),
  ));

/** A small, solid-colored PNG picture. */
function png(width: number, height: number, rgba: readonly number[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width * 4 }, (_, i) => rgba[i % 4]!)),
  ]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Form field values by name (a dropdown's value comes back as a list). */
function fieldValues(summary: PdfSummary): Record<string, unknown> {
  return Object.fromEntries(
    summary.annotations
      .filter((a) => a.fieldName)
      .map((a) => [a.fieldName, Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue]),
  );
}

/** Picks an annotation tool and waits until it's on, as a person would before using it. */
async function pickTool(page: Page, label: string) {
  const tool = page
    .getByRole('toolbar', { name: 'Annotation tools' })
    .getByLabel(label, { exact: true });
  await tool.click();
  await expect(tool).toHaveAttribute('aria-checked', 'true');
}

async function fitPage(page: Page) {
  await page.getByRole('button', { name: 'Zoom level' }).click();
  await page.getByRole('menuitem', { name: 'Fit page' }).click();
  await page.waitForTimeout(500);
}

/** Where Folio PDF keeps saved signatures (encrypted with DPAPI), in this run's data folder. */
const signatures = () => join(app.dataDir, 'secure', 'pdf-signatures.bin');

/** Screen position of a point on page 1, given in PDF points (origin bottom-left, 612 x 792). */
async function onPage(page: Page, x: number, y: number) {
  const box = (await page.locator('.pdf-page').first().boundingBox())!;
  const scale = box.width / 612;
  return { x: box.x + x * scale, y: box.y + (792 - y) * scale };
}

/** Records requests that leave the app (blob: and data: are in-memory, never the network). */
function trackOutside(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    if (!['localhost', 'tauri.localhost', 'ipc.localhost'].includes(url.hostname))
      outside.push(request.url());
  });
  return outside;
}

const EXE = 'target/debug/folio-pdf.exe';

let app: RunningApp;
let dir: string;

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-pdf-e2e-'));
  // Dialogs are answered without appearing: Open "picks" picture.png (and extra.pdf when
  // several files may be picked), Save and the folder picker use this folder. Links that
  // would open in the browser are written to links.log instead.
  app = await launchApp(EXE, 9342, {
    FOLIO_TEST_OPEN: `${join(dir, 'picture.png')};${join(dir, 'extra.pdf')}`,
    FOLIO_TEST_SAVE_DIR: dir,
    FOLIO_TEST_LINKS: join(dir, 'links.log'),
  });
});

test.afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('opens a PDF, shows its pages and thumbnails, finds text, and saves a valid PDF', async () => {
  const { page } = app;
  const file = join(dir, 'report.pdf');
  writeFileSync(file, makePdf(3));
  const violations = await trackViolations(page);
  const outside: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    // blob: and data: URLs are in-memory (rendered pages, thumbnails), never the network.
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    if (!['localhost', 'tauri.localhost', 'ipc.localhost'].includes(url.hostname))
      outside.push(request.url());
  });

  expect(app.launchAgain([file])).toBe(0);
  await expect(page.getByRole('tab', { name: /report\.pdf/ })).toBeVisible();
  await expect(page.getByText('Page 1 of 3', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.pdf-page').first()).toBeVisible();
  await expect(page.locator('.pdf-thumb')).toHaveCount(3);

  await page.keyboard.press('Control+F');
  const find = page.getByPlaceholder('Find in document');
  await find.fill('folio-marker-2');
  await find.press('Enter');
  await expect(page.locator('.pdf-find-count')).toHaveText('1 of 1');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+S');
  await expect.poll(() => readFileSync(file).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  expect(await violations()).toEqual([]);
  expect(outside).toEqual([]);
});

test('fills a form, highlights, draws and signs; the saved PDF keeps all of it', async () => {
  const { page } = app;
  const file = join(dir, 'form.pdf');
  writeFileSync(file, makePdf(2, 'Folio form test', { form: true }));
  const violations = await trackViolations(page);
  const outside = trackOutside(page);
  // The test run's own data folder starts with no saved signatures (and is deleted after).
  await annotateFormAndSign(page, file);
  expect(await violations()).toEqual([]);
  expect(outside).toEqual([]);
});

async function annotateFormAndSign(page: Page, file: string) {
  const annotateBar = page.getByRole('toolbar', { name: 'Annotation tools' });
  /** Picks a tool and waits until it's on, as a person would before using it. */
  const pick = async (label: string) => {
    const tool = annotateBar.getByLabel(label, { exact: true });
    await tool.click();
    await expect(tool).toHaveAttribute('aria-checked', 'true');
  };

  expect(app.launchAgain([file])).toBe(0);
  await expect(page.getByText('Page 1 of 2', { exact: false })).toBeVisible({ timeout: 20_000 });
  // The whole page in view, so every point below is on screen.
  await page.getByRole('button', { name: 'Zoom level' }).click();
  await page.getByRole('menuitem', { name: 'Fit page' }).click();
  await page.waitForTimeout(500);

  // Reading mode keeps form fields fillable.
  const name = page.locator('input[name="full_name"]');
  await name.click();
  await page.keyboard.type('Folio Tester');
  await page.keyboard.press('Tab');
  const agree = await onPage(page, 80, 508);
  await page.mouse.click(agree.x, agree.y);

  // Highlight the first line of body text by selecting it with the highlight tool. The new
  // highlight is selected once it exists, which turns on Delete.
  await page.getByRole('button', { name: 'Annotate' }).click();
  await pick('Highlight text');
  const from = await onPage(page, 73, 644);
  const to = await onPage(page, 300, 644);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(annotateBar.getByLabel('Delete (Del)')).toBeEnabled();

  // A pen stroke in the empty middle of the page. No waiting afterwards: the signature below
  // starts while the stroke is still being written, and saving must still include it.
  await pick('Pen');
  const stroke = [
    await onPage(page, 150, 350),
    await onPage(page, 260, 390),
    await onPage(page, 380, 340),
  ];
  await page.mouse.move(stroke[0]!.x, stroke[0]!.y);
  await page.mouse.down();
  for (const point of stroke.slice(1)) await page.mouse.move(point.x, point.y, { steps: 8 });
  await page.mouse.up();

  // A typed signature, placed near the bottom.
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Type' }).click();
  await dialog.getByPlaceholder('Type your name').fill('Folio Tester');
  await expect(dialog.getByLabel('Save it on this PC for next time (encrypted)')).toBeChecked();
  await dialog.getByRole('button', { name: 'Place signature' }).click();
  await expect(dialog).toBeHidden();
  const spot = await onPage(page, 430, 220);
  await page.mouse.move(spot.x - 20, spot.y);
  await page.mouse.click(spot.x, spot.y);

  await page.keyboard.press('Control+S');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });

  // PDF.js, not the app's engine, re-reads what was saved.
  const saved = await readPdf(readFileSync(file));
  expect(saved.pages).toBe(2);
  const subtypes = saved.annotations.filter((a) => a.page === 1).map((a) => a.subtype);
  expect(subtypes).toEqual(expect.arrayContaining(['Highlight', 'Ink', 'Stamp', 'Widget']));
  const fields = Object.fromEntries(
    saved.annotations.filter((a) => a.fieldName).map((a) => [a.fieldName, a.fieldValue]),
  );
  expect(fields).toMatchObject({ full_name: 'Folio Tester', agree: 'Yes' });
  expect(saved.text[0]).toContain('The quick brown fox');

  // Kept for next time, but only in encrypted form.
  expect(existsSync(signatures())).toBe(true);
  const sealed = readFileSync(signatures()).toString('latin1');
  expect(sealed).not.toContain('Folio Tester');
  expect(sealed).not.toContain('previewDataUrl');
  // Remove it again through the dialog: the store file goes away with the last one.
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Delete this saved signature').first().click();
  await expect.poll(() => existsSync(signatures())).toBe(false);
  await page.keyboard.press('Escape');

  // Reopening shows the filled-in value from the file.
  await page.keyboard.press('Control+W');
  expect(app.launchAgain([file])).toBe(0);
  await expect(page.locator('input[name="full_name"]')).toHaveValue('Folio Tester', {
    timeout: 20_000,
  });
}

test('notes, stamps, pictures, radio buttons and dropdowns are saved; a flattened copy bakes them in', async () => {
  const { page } = app;
  const file = join(dir, 'review.pdf');
  writeFileSync(file, makePdf(2, 'Folio review test', { form: true }));
  writeFileSync(join(dir, 'picture.png'), png(60, 30, [30, 90, 200, 255]));
  const violations = await trackViolations(page);
  const outside = trackOutside(page);
  const bar = page.getByRole('toolbar', { name: 'Annotation tools' });
  const comments = page.getByRole('complementary', { name: 'Comments' });

  expect(app.launchAgain([file])).toBe(0);
  await expect(page.getByText('Page 1 of 2', { exact: false })).toBeVisible({ timeout: 20_000 });
  await fitPage(page);

  // Form fields: a name, a radio button and a dropdown.
  await page.locator('input[name="full_name"]').click();
  await page.keyboard.type('Ada Lovelace');
  await page.keyboard.press('Tab');
  const phone = await onPage(page, 160, 460);
  await page.mouse.click(phone.x, phone.y);
  // EmbedPDF labels the dropdown with the field's display name.
  await page.getByRole('combobox', { name: 'Favorite color' }).selectOption('Green');

  // A sticky note gets its text in the comments panel, which opens ready for typing.
  await page.getByRole('button', { name: 'Annotate' }).click();
  await pickTool(page, 'Sticky note');
  const noteSpot = await onPage(page, 480, 600);
  await page.mouse.click(noteSpot.x, noteSpot.y);
  const note = comments.getByLabel('Comment on note');
  await expect(note).toBeFocused();
  await page.keyboard.type('Please check the totals');
  await page.keyboard.press('Control+Enter');

  // A ready-made stamp, then a picture (the Open dialog is answered with picture.png).
  await bar.getByLabel('Stamp', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Approved', exact: true }).click();
  const stampSpot = await onPage(page, 430, 300);
  await page.mouse.move(stampSpot.x - 10, stampSpot.y);
  await page.mouse.click(stampSpot.x, stampSpot.y);
  await expect(comments.getByText('Stamp', { exact: true })).toBeVisible();
  await bar.getByLabel('Picture', { exact: true }).click();
  await expect(bar.getByLabel('Picture', { exact: true })).toHaveAttribute('aria-pressed', 'true');
  const pictureSpot = await onPage(page, 150, 260);
  await page.mouse.move(pictureSpot.x - 10, pictureSpot.y);
  await page.mouse.click(pictureSpot.x, pictureSpot.y);
  await expect(comments.getByText('Stamp', { exact: true })).toHaveCount(2);

  await page.keyboard.press('Control+S');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
  const saved = await readPdf(readFileSync(file));
  const first = saved.annotations.filter((a) => a.page === 1);
  expect(first.filter((a) => a.subtype === 'Stamp')).toHaveLength(2);
  expect(first.find((a) => a.subtype === 'Text')?.contents).toBe('Please check the totals');
  expect(fieldValues(saved)).toMatchObject({
    full_name: 'Ada Lovelace',
    contact: 'Phone',
    color: 'Green',
  });

  // A flattened copy: annotations and form fields become part of the page.
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: 'Save a flattened copy' }).click();
  await expect(page.getByText('Saved review (flattened).pdf.', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const flat = await readPdf(readFileSync(join(dir, 'review (flattened).pdf')));
  expect(flat.annotations.filter((a) => a.subtype === 'Widget' || a.subtype === 'Stamp')).toEqual(
    [],
  );
  expect(flat.text[0]).toContain('APPROVED');
  expect(flat.text[0]).toContain('Ada Lovelace');
  // The original keeps its live fields, and the tab is still the original.
  expect((await readPdf(readFileSync(file))).annotations.some((a) => a.subtype === 'Widget')).toBe(
    true,
  );
  await expect(page.getByRole('tab', { name: /review\.pdf/ })).toBeVisible();

  expect(await violations()).toEqual([]);
  expect(outside).toEqual([]);
});

/**
 * What each page is: its fixture page number ("2"), an extra.pdf page ("x1"), a picture page
 * or a blank page.
 */
function pageLabels(summary: PdfSummary): string[] {
  return summary.text.map((text, i) => {
    const marker = /folio-marker-(\d+)/.exec(text)?.[1];
    if (marker) return text.includes('Extra document') ? `x${marker}` : marker;
    return summary.sizes[i]!.width > summary.sizes[i]!.height ? 'picture' : 'blank';
  });
}

test('organizes pages: rotate, move, delete, insert, undo, extract and split', async () => {
  const { page } = app;
  const file = join(dir, 'organize.pdf');
  writeFileSync(file, makePdf(4));
  writeFileSync(join(dir, 'picture.png'), png(60, 30, [200, 60, 30, 255]));
  writeFileSync(join(dir, 'extra.pdf'), makePdf(2, 'Extra document'));
  const violations = await trackViolations(page);
  const outside = trackOutside(page);
  const cards = page.locator('.pdf-organize-card');
  const savedLabels = async () => {
    await page.keyboard.press('Control+S');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
    return readPdf(readFileSync(file));
  };
  const settle = () =>
    expect(page.locator('.pdf-organize[aria-busy="false"]')).toBeVisible({ timeout: 15_000 });

  expect(app.launchAgain([file])).toBe(0);
  await expect(page.getByText('Page 1 of 4', { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  await expect(cards).toHaveCount(4);

  // Turn page 2, then drag page 1 to after page 3.
  await cards.nth(1).click();
  await page.getByLabel('Rotate right', { exact: true }).click();
  await settle();
  const from = (await cards.nth(0).boundingBox())!;
  const to = (await cards.nth(2).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width - 10, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await settle();
  await expect(cards.nth(2)).toHaveAttribute('aria-selected', 'true');

  // Delete page 4, then add a blank page and, after it, a picture and another PDF.
  await cards.nth(3).click();
  await page.keyboard.press('Delete');
  await settle();
  await expect(cards).toHaveCount(3);
  await cards.nth(2).click();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Blank page' }).click();
  await settle();
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Pages from PDFs or pictures…' }).click();
  await settle();
  await expect(cards).toHaveCount(7);

  let saved = await savedLabels();
  expect(pageLabels(saved)).toEqual(['2', '3', '1', 'blank', 'picture', 'x1', 'x2']);
  expect(saved.rotations).toEqual([90, 0, 0, 0, 0, 0, 0]);

  // Undo takes back the last change; redo brings it back.
  await page.keyboard.press('Control+Z');
  await settle();
  saved = await savedLabels();
  expect(pageLabels(saved)).toEqual(['2', '3', '1', 'blank']);
  await page.keyboard.press('Control+Y');
  await settle();
  saved = await savedLabels();
  expect(pageLabels(saved)).toHaveLength(7);

  // Extract pages 2-3 to a new PDF (the Save dialog is answered with this folder).
  await cards.nth(1).click();
  await cards.nth(2).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Extract', exact: true }).click();
  await expect(page.getByText('Saved organize (pages 2-3).pdf.', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(pageLabels(await readPdf(readFileSync(join(dir, 'organize (pages 2-3).pdf'))))).toEqual([
    '3',
    '1',
  ]);

  // Split every 3 pages into new files in a folder (answered with this folder).
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.getByLabel('Pages in each file').fill('3');
  await expect(page.getByText('Makes 3 files: pages 1-3; pages 4-6; page 7.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Split' }).click();
  await expect(page.getByText(/Saved 3 files in/)).toBeVisible({ timeout: 15_000 });
  const parts = ['organize (pages 1-3).pdf', 'organize (pages 4-6).pdf', 'organize (page 7).pdf'];
  const counts = await Promise.all(
    parts.map(async (name) => (await readPdf(readFileSync(join(dir, name)))).pages),
  );
  expect(counts).toEqual([3, 3, 1]);

  // Duplicate the first page: the copy goes right after it, still turned.
  await cards.nth(0).click();
  await page.getByLabel('Duplicate pages', { exact: true }).click();
  await settle();
  await expect(cards).toHaveCount(8);
  saved = await savedLabels();
  expect(pageLabels(saved).slice(0, 3)).toEqual(['2', '2', '3']);
  expect(saved.rotations.slice(0, 3)).toEqual([90, 90, 0]);

  // Back to reading: the reorganized document is what's shown.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('Page 1 of 8', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.pdf-page').first()).toBeVisible();

  expect(await violations()).toEqual([]);
  expect(outside).toEqual([]);
});

test('edits page content: retype text, add text, whiteout, redact, and pictures', async () => {
  const { page } = app;
  const file = join(dir, 'content.pdf');
  writeFileSync(file, makePdf(1));
  writeFileSync(join(dir, 'picture.png'), png(120, 60, [30, 90, 200, 255]));
  const violations = await trackViolations(page);
  const outside = trackOutside(page);
  const bar = page.getByRole('toolbar', { name: 'Content tools' });
  const saved = async () => {
    await page.keyboard.press('Control+S');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
    return readPdf(readFileSync(file));
  };
  /** Drags a rectangle between two points given in PDF points. */
  const dragArea = async (from: [number, number], to: [number, number]) => {
    const a = await onPage(page, ...from);
    const b = await onPage(page, ...to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
  };
  /** The edit layer has read the page's text and pictures, and the page stays put. */
  const ready = async () => {
    await expect(page.locator('.pdf-edit-layer[data-ready="true"]').first()).toBeVisible({
      timeout: 15_000,
    });
    let last = '';
    await expect
      .poll(
        async () => {
          const box = JSON.stringify(await page.locator('.pdf-page').first().boundingBox());
          const steady = box === last;
          last = box;
          return steady;
        },
        { intervals: [100], timeout: 10_000 },
      )
      .toBe(true);
  };
  /** Runs an action that changes the page and waits until the changed page has loaded. */
  const generation = async () =>
    Number(await page.locator('.pdf-root').getAttribute('data-generation'));
  const changes = async (action: () => Promise<unknown>) => {
    const before = await generation();
    await action();
    await expect.poll(generation, { timeout: 15_000 }).toBeGreaterThan(before);
    await ready();
  };

  expect(app.launchAgain([file])).toBe(0);
  await expect(page.getByText('Page 1 of 1', { exact: false })).toBeVisible({ timeout: 20_000 });
  await fitPage(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await ready();

  // Retype a line: the editor opens over it, in its own style.
  await page
    .getByRole('button', { name: 'Edit text: The quick brown fox jumps over the lazy dog.' })
    .click();
  const editor = page.getByLabel('Edit text', { exact: true });
  await expect(editor).toHaveValue('The quick brown fox jumps over the lazy dog.');
  await editor.fill('The slow red fox walks around the sleepy cat.');
  await changes(() => editor.press('Enter'));
  await expect(
    page.getByRole('button', { name: 'Edit text: The slow red fox walks around the sleepy cat.' }),
  ).toBeVisible({
    timeout: 15_000,
  });

  // Add new text where clicked.
  await bar.getByLabel('Add text', { exact: true }).click();
  const spot = await onPage(page, 72, 300);
  await page.mouse.click(spot.x, spot.y);
  await page.getByLabel('New text', { exact: true }).fill('Added by Folio');
  await changes(() => page.keyboard.press('Enter'));
  // Text boxes show with the select tool; the new text is one of them.
  await bar.getByLabel('Edit text and pictures', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit text: Added by Folio' })).toBeAttached({
    timeout: 15_000,
  });

  // Whiteout covers the marker line (the text stays in the file); redaction removes a line.
  await bar.getByLabel('Whiteout', { exact: true }).click();
  await changes(() => dragArea([66, 636], [420, 614]));
  await bar.getByLabel('Redact', { exact: true }).click();
  await dragArea([66, 700], [220, 674]);
  await expect(bar.getByText('1 area marked')).toBeVisible();
  await bar.getByRole('button', { name: 'Apply redactions' }).click();
  await changes(() => page.getByRole('dialog').getByRole('button', { name: 'Redact' }).click());

  let summary = await saved();
  let text = summary.text[0]!;
  expect(text).toContain('The slow red fox walks around the sleepy cat.');
  expect(text).not.toContain('The quick brown fox');
  expect(text).toContain('Added by Folio');
  expect(text).toContain('folio-marker-1');
  expect(text).not.toContain('Page 1 of 1');
  expect(text).toContain('Folio test document');

  // A picture goes on the page, selected; Delete removes it and undo brings it back.
  await bar.getByLabel('Edit text and pictures', { exact: true }).click();
  await changes(() => bar.getByLabel('Add a picture', { exact: true }).click());
  await expect(bar.getByRole('button', { name: 'Delete picture' })).toBeVisible({
    timeout: 15_000,
  });
  summary = await saved();
  expect(summary.images[0]).toBe(1);
  await changes(() => page.keyboard.press('Delete'));
  await expect(bar.getByRole('button', { name: 'Delete picture' })).toBeHidden();
  summary = await saved();
  expect(summary.images[0]).toBe(0);
  await changes(() => page.keyboard.press('Control+Z'));
  summary = await saved();
  expect(summary.images[0]).toBe(1);
  text = summary.text[0]!;
  expect(text).toContain('Added by Folio');

  // None of these edits changed anything else on the page.
  await expect(page.getByText('Something else on the page changed')).toHaveCount(0);
  expect(await violations()).toEqual([]);
  expect(outside).toEqual([]);
});

/** Opens "More options", then `item` (and in its submenu, `choice`). */
async function moreMenu(page: Page, item: string, choice?: string) {
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  if (choice) await page.getByRole('menuitemradio', { name: choice }).click();
}

test('reads bookmarks and attached files, asks before links, and changes how pages are shown', async () => {
  const { page } = app;
  const file = join(dir, 'guide.pdf');
  writeFileSync(
    file,
    makePdf(3, 'Folio guide', {
      links: true,
      outline: true,
      attachment: true,
      info: { title: 'Folio guide', author: 'Folio tests', subject: 'Reading features' },
    }),
  );
  const violations = await trackViolations(page);
  const outside = trackOutside(page);
  const log = join(dir, 'links.log');
  const opened = () =>
    existsSync(log) ? readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const pageNumber = page.getByLabel('Page number');
  const dialog = page.getByRole('dialog');
  const sideBySide = async () => {
    const tops = await page
      .locator('.pdf-page')
      .evaluateAll((pages) => pages.map((p) => Math.round(p.getBoundingClientRect().top)));
    return tops.length >= 2 && tops[0] === tops[1];
  };

  expect(app.launchAgain([file])).toBe(0);
  await expect(page.getByText('Page 1 of 3', { exact: false })).toBeVisible({ timeout: 20_000 });

  // Bookmarks: a click goes there; the arrow opens the ones inside.
  await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
  const tree = page.getByRole('tree', { name: 'Bookmarks' });
  await tree.getByRole('treeitem', { name: 'Chapter 2' }).click();
  await expect(pageNumber).toHaveValue('3');
  await expect(tree.getByRole('treeitem', { name: 'Section 1.1' })).toHaveCount(0);
  await tree
    .getByRole('treeitem', { name: /Chapter 1/ })
    .locator('.fui-TreeItemLayout__expandIcon')
    .click();
  await tree.getByRole('treeitem', { name: 'Section 1.1' }).click();
  await expect(pageNumber).toHaveValue('2');

  // A bookmark that is a web link asks first; Cancel leaves it closed.
  await tree.getByRole('treeitem', { name: 'Example website' }).click();
  await expect(dialog).toContainText('Open this link?');
  await expect(dialog).toContainText(BOOKMARK_LINK);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // Links on the page: the web link opens only after "Open in browser"...
  await page.getByRole('tab', { name: 'Pages', exact: true }).click();
  await page.keyboard.press('Control+Home');
  await fitPage(page);
  const click = async (x: number, y: number) => {
    const at = await onPage(page, x, y);
    await page.mouse.click(at.x, at.y);
  };
  await click(120, 405);
  await expect(dialog).toContainText('It goes to example.com');
  await dialog.getByRole('button', { name: 'Open in browser' }).click();
  await expect.poll(opened).toEqual([WEB_LINK]);
  await expect(dialog).toHaveCount(0);
  // ...a javascript: link is only shown...
  await click(120, 375);
  await expect(dialog).toContainText('This link stays closed');
  await expect(dialog.getByRole('button', { name: 'Open in browser' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  // ...and one that asks to start a program is refused.
  await click(120, 345);
  await expect(page.getByText(/doesn't follow this kind of link/)).toBeVisible();
  expect(opened()).toEqual([WEB_LINK]);

  // Attached files are saved where you pick, never opened.
  await page.getByRole('tab', { name: 'Attached files', exact: true }).click();
  const attachments = page.getByRole('list', { name: 'Attached files' });
  await expect(attachments).toContainText('notes.txt');
  await expect(attachments).toContainText('Meeting notes');
  await attachments.getByRole('button', { name: 'Save notes.txt…' }).click();
  await expect.poll(() => existsSync(join(dir, 'notes.txt'))).toBe(true);
  expect(readFileSync(join(dir, 'notes.txt'), 'latin1')).toBe(ATTACHMENT_TEXT);

  // Document properties.
  await page.keyboard.press('Control+D');
  const properties = page.getByRole('dialog', { name: 'Document properties' });
  await expect(properties).toContainText('Folio guide');
  await expect(properties).toContainText('Folio tests');
  await expect(properties).toContainText('Letter, 8.5 × 11 in');
  await properties.getByRole('button', { name: 'Close' }).click();

  // Two pages side by side.
  await moreMenu(page, 'Page layout', 'Two pages side by side');
  await expect.poll(sideBySide).toBe(true);

  // Reading modes change only how the pages look.
  const filter = () =>
    page
      .locator('.pdf-page img')
      .first()
      .evaluate((img) => getComputedStyle(img).filter);
  await moreMenu(page, 'Reading mode', 'Dark pages');
  await expect(page.locator('.pdf-viewer')).toHaveAttribute('data-reading', 'dark');
  expect(await filter()).toContain('invert');
  await moreMenu(page, 'Reading mode', 'Sepia');
  await expect(page.locator('.pdf-viewer')).toHaveAttribute('data-reading', 'sepia');
  expect(await filter()).toContain('url(');

  // Full screen shows only the pages, with a way out.
  await moreMenu(page, 'Full screen');
  await expect(page.getByRole('toolbar', { name: 'Viewer' })).toBeHidden();
  await page.getByRole('button', { name: 'Leave full screen' }).click();
  await expect(page.getByRole('toolbar', { name: 'Viewer' })).toBeVisible();

  // The layout and reading mode come back when the file opens again.
  await page.keyboard.press('Control+W');
  await expect(page.getByRole('tab', { name: /guide\.pdf/ })).toHaveCount(0);
  expect(app.launchAgain([file])).toBe(0);
  await expect(page.getByText(/Page \d of 3/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.pdf-viewer')).toHaveAttribute('data-reading', 'sepia');
  await expect.poll(sideBySide).toBe(true);

  expect(await violations()).toEqual([]);
  expect(outside).toEqual([]);
});

test('opens a protected PDF with its password, keeps it through changes, and sets and removes passwords', async () => {
  const { page } = app;
  const tools = await pageTools();
  const file = join(dir, 'locked.pdf');
  writeFileSync(
    file,
    tools.edit(makePdf(3, 'Locked document'), (doc) => doc.protect('open-sesame')),
  );
  const violations = await trackViolations(page);
  const outside = trackOutside(page);
  const prompt = page.getByRole('group', { name: 'Password needed' });
  const generation = () =>
    page.locator('.pdf-root').first().getAttribute('data-generation').then(Number);
  const saved = async () => {
    const before = readFileSync(file);
    await page.keyboard.press('Control+S');
    await expect.poll(() => readFileSync(file).equals(before), { timeout: 15_000 }).toBe(false);
    return readFileSync(file);
  };

  expect(app.launchAgain([file])).toBe(0);
  await expect(prompt).toBeVisible({ timeout: 20_000 });
  await prompt.getByLabel('Password').fill('wrong');
  await prompt.getByRole('button', { name: 'Open' }).click();
  await expect(prompt.getByText("That password isn't right. Try again.")).toBeVisible({
    timeout: 15_000,
  });
  await prompt.getByLabel('Password').fill('open-sesame');
  await prompt.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Page 1 of 3', { exact: false })).toBeVisible({ timeout: 20_000 });

  // A page change reloads the document with its password; the saved file stays protected.
  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  const cards = page.locator('.pdf-organize-card');
  await expect(cards).toHaveCount(3);
  await cards.nth(2).click();
  await page.keyboard.press('Delete');
  await expect(cards).toHaveCount(2, { timeout: 15_000 });
  await expect(prompt).toHaveCount(0);
  let bytes = await saved();
  await expect(readPdf(bytes)).rejects.toThrow(/password/i);
  expect((await readPdf(bytes, 'open-sesame')).pages).toBe(2);
  await page.getByRole('button', { name: 'Organize', exact: true }).click();

  // A new password: the old one stops working.
  await moreMenu(page, 'Change the password…');
  const change = page.getByRole('dialog', { name: 'Change the password' });
  await change.getByLabel('Password', { exact: true }).fill('new-secret');
  await change.getByLabel('Type it again').fill('new-secre');
  await expect(change.getByText("The passwords don't match.")).toBeVisible();
  await expect(change.getByRole('button', { name: 'Set password' })).toBeDisabled();
  await change.getByLabel('Type it again').fill('new-secret');
  await change.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByText('The password is set.', { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  bytes = await saved();
  await expect(readPdf(bytes, 'open-sesame')).rejects.toThrow(/password/i);
  expect((await readPdf(bytes, 'new-secret')).pages).toBe(2);

  // Undo brings the old password back without asking for it; redo, the new one.
  let before = await generation();
  await page.keyboard.press('Control+Z');
  await expect.poll(generation).toBeGreaterThan(before);
  await expect(page.getByText('Page 1 of 2', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(prompt).toHaveCount(0);
  bytes = await saved();
  expect((await readPdf(bytes, 'open-sesame')).pages).toBe(2);
  before = await generation();
  await page.keyboard.press('Control+Y');
  await expect.poll(generation).toBeGreaterThan(before);
  await expect(page.getByText('Page 1 of 2', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(prompt).toHaveCount(0);

  // Removing the password, then protecting the file afresh.
  await moreMenu(page, 'Remove the password');
  await expect(page.getByText('The password is removed.', { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  bytes = await saved();
  expect((await readPdf(bytes)).pages).toBe(2);
  await moreMenu(page, 'Protect with a password…');
  const protect = page.getByRole('dialog', { name: 'Protect with a password' });
  await protect.getByLabel('Password', { exact: true }).fill('third-one');
  await protect.getByLabel('Type it again').fill('third-one');
  await protect.getByRole('button', { name: 'Set password' }).click();
  await expect(page.getByText('The password is set.', { exact: false }).last()).toBeVisible({
    timeout: 15_000,
  });
  bytes = await saved();
  await expect(readPdf(bytes)).rejects.toThrow(/password/i);
  expect((await readPdf(bytes, 'third-one')).pages).toBe(2);

  // A file whose author allows only printing: the editing tools are off, and say why.
  const restricted = join(dir, 'restricted.pdf');
  writeFileSync(
    restricted,
    tools.edit(makePdf(2, 'Restricted document'), (doc) => doc.restrict('owner-only', 4)),
  );
  expect(app.launchAgain([restricted])).toBe(0);
  await expect(page.getByRole('tab', { name: /restricted\.pdf/ })).toBeVisible();
  await expect(page.getByText('Page 1 of 2', { exact: false })).toBeVisible({ timeout: 20_000 });
  for (const name of ['Annotate', 'Sign', 'Organize', 'Edit']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  }
  await page.keyboard.press('Control+D');
  const properties = page.getByRole('dialog', { name: 'Document properties' });
  await expect(properties).toContainText("The author doesn't allow");
  await expect(properties).toContainText('Encrypted; opens without a password');
  await properties.getByRole('button', { name: 'Close' }).click();

  expect(await violations()).toEqual([]);
  expect(outside).toEqual([]);
});
