// Folio Slides end to end, on the real (debug) app: open, present, edit, organize, save,
// old .ppt files, macros and links. Saved files are read back with Folio's zip reader and
// checked part by part: what wasn't edited must be byte-identical.

import { type Page, expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAMPLE, makePptx } from '../apps/slides/src/testing/makePptx';
import { inflateEntry, readZip } from '../apps/slides/src/zip';
import { type RunningApp, launchApp, trackViolations } from './app';

const EXE = 'target/debug/folio-slides.exe';

let app: RunningApp;
let dir: string;

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-slides-e2e-'));
  // Dialogs are answered without appearing: Open "picks" picture.png, Save uses this
  // folder, and links that would open in the browser are written to links.log.
  app = await launchApp(EXE, 9346, {
    FOLIO_TEST_OPEN: join(dir, 'picture.png'),
    FOLIO_TEST_SAVE_DIR: dir,
    FOLIO_TEST_LINKS: join(dir, 'links.log'),
  });
});

test.afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Each part of a saved file: its exact stored bytes, and its text when it's XML. */
async function partsOf(file: string) {
  const entries = readZip(new Uint8Array(readFileSync(file))).entries;
  const parts = new Map<string, { raw: Uint8Array; text: string }>();
  for (const entry of entries) {
    const text = /\.(xml|rels)$/.test(entry.name) ? new TextDecoder().decode(await inflateEntry(entry)) : '';
    parts.set(entry.name, { raw: entry.raw, text });
  }
  return parts;
}

/** Names of the parts whose stored bytes differ between two files. */
async function changedParts(before: string | Uint8Array, after: string) {
  const old = new Map(readZip(typeof before === 'string' ? new Uint8Array(readFileSync(before)) : before).entries.map((e) => [e.name, e.raw]));
  const now = await partsOf(after);
  return [...now]
    .filter(([name, part]) => {
      const raw = old.get(name);
      return !raw || raw.length !== part.raw.length || raw.some((b, i) => b !== part.raw[i]);
    })
    .map(([name]) => name)
    .sort();
}

/** Records requests that leave the app (blob: and data: are in-memory, never the network). */
function trackOutside(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    if (!['localhost', 'tauri.localhost', 'ipc.localhost'].includes(url.hostname)) outside.push(request.url());
  });
  return outside;
}

async function openDeck(name: string, bytes: Uint8Array) {
  const file = join(dir, name);
  writeFileSync(file, bytes);
  expect(app.launchAgain([file])).toBe(0);
  await expect(app.page.getByRole('tab', { name: new RegExp(name.replace('.', '\\.')) })).toBeVisible({ timeout: 20_000 });
  return file;
}

const thumbnail = (page: Page, n: number) => page.getByRole('option', { name: new RegExp(`^Slide ${n}(,|$)`) });
const saved = (page: Page) => expect(page.locator('.folio-statusbar')).toContainText('Saved');

test('shows slides, thumbnails and notes; hiding a slide rewrites only that slide', async () => {
  const { page } = app;
  const violations = await trackViolations(page);
  const outside = trackOutside(page);
  const original = await makePptx(SAMPLE);
  const file = await openDeck('review.pptx', original);

  await expect(page.locator('.slides-thumb')).toHaveCount(4);
  await expect(page.getByText('Slide 1 of 4')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Speaker notes' })).toHaveValue('Welcome everyone.\nKeep it short.');
  await expect(page.locator('.slides-current')).toContainText('Quarterly review');
  await expect(thumbnail(page, 3)).toHaveAccessibleName('Slide 3, hidden');

  await thumbnail(page, 2).click();
  await expect(page.locator('.slides-current')).toContainText('Revenue up');
  await page.getByRole('button', { name: 'Hide slide' }).click();
  await expect(thumbnail(page, 2)).toHaveAccessibleName('Slide 2, hidden');
  await page.keyboard.press('Control+S');
  await saved(page);

  expect(await changedParts(original, file)).toEqual(['ppt/slides/slide2.xml']);
  expect((await partsOf(file)).get('ppt/slides/slide2.xml')!.text).toMatch(/<p:sld [^>]*show="0"/);
  expect(await violations()).toEqual([]);
  expect(outside).toEqual([]);
});

test('edits text in place, moves a picture and edits notes; undo works; formatting is kept', async () => {
  const { page } = app;
  const original = await makePptx(SAMPLE);
  const file = await openDeck('growth.pptx', original);
  await thumbnail(page, 2).click();

  const slide = (await page.locator('.slides-current').boundingBox())!;
  // The bullets sit on the left, the picture on the right.
  await page.mouse.dblclick(slide.x + slide.width * 0.2, slide.y + slide.height * 0.45);
  const editor = page.getByRole('textbox', { name: 'Shape text' });
  await expect(editor).toHaveValue('Revenue up 12%\nCosts flat\nHiring two people');
  await editor.press('End');
  await editor.pressSequentially(' soon');
  await editor.press('Escape');
  await expect(page.locator('.slides-current')).toContainText('Hiring two people soon');

  const picture = { x: slide.x + slide.width * 0.75, y: slide.y + slide.height * 0.5 };
  await page.mouse.move(picture.x, picture.y);
  await page.mouse.down();
  await page.mouse.move(picture.x + 40, picture.y + 20, { steps: 6 });
  await page.mouse.up();

  const notes = page.getByRole('textbox', { name: 'Speaker notes' });
  await notes.click();
  await notes.press('End');
  await notes.pressSequentially(' And the garden.');

  // Undo the notes, then redo them.
  await page.locator('.slides-rail').focus();
  await page.keyboard.press('Control+Z');
  await expect(notes).toHaveValue('Mention the new office.');
  await page.keyboard.press('Control+Y');
  await expect(notes).toHaveValue('Mention the new office. And the garden.');

  await page.keyboard.press('Control+S');
  await saved(page);
  expect(await changedParts(original, file)).toEqual(['ppt/notesSlides/notesSlide2.xml', 'ppt/slides/slide2.xml']);
  const xml = (await partsOf(file)).get('ppt/slides/slide2.xml')!.text;
  // Only the edited run changed: the bold "12%" run is as it was.
  expect(xml).toContain('<a:r><a:rPr lang="en-US" b="1" dirty="0"/><a:t>12%</a:t></a:r>');
  expect(xml).toContain('<a:t>Hiring two people soon</a:t>');
  expect(xml).not.toContain('<a:off x="7200000" y="1825625"/>');
  // Transitions and animations elsewhere are untouched (slide 1 wasn't rewritten at all).
});

test('reorders, duplicates and deletes slides; the file reads back with what each slide owns', async () => {
  const { page } = app;
  const original = await makePptx(SAMPLE);
  const file = await openDeck('organize.pptx', original);

  // Drag slide 4 above slide 1.
  await thumbnail(page, 4).dragTo(thumbnail(page, 1), { targetPosition: { x: 40, y: 4 } });
  await expect(page.locator('.slides-current')).toContainText('Questions?');
  await expect(page.getByText('Slide 1 of 4')).toBeVisible();

  await thumbnail(page, 3).click(); // Growth, now third.
  await page.keyboard.press('Control+D');
  await expect(page.locator('.slides-thumb')).toHaveCount(5);
  await thumbnail(page, 5).click();
  await page.getByRole('button', { name: 'Delete slide' }).click();
  await expect(page.locator('.slides-thumb')).toHaveCount(4);

  await page.keyboard.press('Control+S');
  await saved(page);
  const parts = await partsOf(file);
  const order = [...parts.get('ppt/presentation.xml')!.text.matchAll(/<p:sldId id="(\d+)"/g)].map((m) => m[1]);
  expect(order).toHaveLength(4);
  // The duplicate of "Growth" (slide5.xml) has its own notes page.
  expect(parts.get('ppt/slides/slide5.xml')!.text).toContain('Revenue up');
  expect(parts.get('ppt/slides/_rels/slide5.xml.rels')!.text).toContain('notesSlide');
  // Slide 3 (the hidden appendix) was deleted: its part is gone, and nothing points at it.
  expect(parts.has('ppt/slides/slide3.xml')).toBe(false);
  for (const [name, part] of parts) {
    if (name.endsWith('.rels')) expect(part.text, name).not.toContain('slide3.xml"');
  }
  expect(parts.get('[Content_Types].xml')!.text).not.toContain('/ppt/slides/slide3.xml');
  // Parts nothing refers to (custom XML) are kept as they were.
  expect(await changedParts(original, file)).not.toContain('customXml/item1.xml');
});

test('presents full screen with the keyboard; presenter view shows notes, next slide and a timer', async () => {
  const { page } = app;
  await openDeck('show.pptx', await makePptx(SAMPLE));

  await page.keyboard.press('F5');
  const show = page.getByRole('dialog', { name: 'Slideshow' });
  await expect(show).toBeVisible();
  await expect(page.locator('.folio-app')).toHaveClass(/folio-fullscreen/);
  await expect(page.locator('.slides-show-count')).toHaveText('1 / 4');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  // Slide 3 is hidden: the show goes from 2 to 4.
  await expect(page.locator('.slides-show-count')).toHaveText('4 / 4');
  await page.keyboard.press('b');
  await expect(page.locator('.slides-show-blank')).toHaveAttribute('data-color', 'black');
  await page.keyboard.press('b');
  await page.keyboard.press('PageUp');
  await expect(page.locator('.slides-show-count')).toHaveText('2 / 4');
  await page.keyboard.press('Escape');
  await expect(show).toHaveCount(0);
  await expect(page.locator('.folio-app')).not.toHaveClass(/folio-fullscreen/);

  await page.keyboard.press('Alt+F5');
  const presenter = page.getByRole('dialog', { name: 'Presenter view' });
  await expect(presenter).toBeVisible();
  await expect(presenter.getByRole('region', { name: 'Speaker notes' })).toContainText('Mention the new office.');
  await expect(presenter.getByLabel('Elapsed time')).toHaveText(/^0:0\d$/);
  await presenter.getByRole('button', { name: 'Next slide' }).click();
  await expect(presenter).toContainText('Slide 4 of 4');
  await expect(presenter).toContainText('End of the slideshow');
  await presenter.getByRole('button', { name: 'End show' }).click();
  await expect(presenter).toHaveCount(0);
});

test('links ask first; nothing leaves the app', async () => {
  const { page } = app;
  const outside = trackOutside(page);
  const log = join(dir, 'links.log');
  await openDeck('links.pptx', await makePptx(SAMPLE));
  await thumbnail(page, 4).click();
  await page.keyboard.press('Shift+F5');
  const link = page.locator('.slides-show a[href]');
  await link.click();
  const dialog = page.getByRole('dialog', { name: 'Open this link?' });
  await expect(dialog).toContainText('https://example.com/contact');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(existsSync(log)).toBe(false);
  await link.click();
  await page.getByRole('dialog', { name: 'Open this link?' }).getByRole('button', { name: 'Open link' }).click();
  await expect.poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : '')).toContain('https://example.com/contact');
  expect(outside).toEqual([]);
});

test('macros are reported, never run, and kept byte for byte', async () => {
  const { page } = app;
  const original = await makePptx({ ...SAMPLE, macros: true });
  const file = await openDeck('macros.pptm', original);
  await expect(page.locator('.folio-notices')).toContainText('never runs them');
  await page.getByRole('button', { name: 'Duplicate slide' }).click();
  await page.keyboard.press('Control+S');
  await saved(page);
  expect(await changedParts(original, file)).not.toContain('ppt/vbaProject.bin');
  expect((await partsOf(file)).get('[Content_Types].xml')!.text).toContain('macroEnabled.main+xml');
});

test('an old .ppt opens read-only, converted; Save As makes an editable .pptx', async () => {
  const { page } = app;
  const ppt = readFileSync(new URL('../apps/slides/fixtures/SampleShow.ppt', import.meta.url));
  await openDeck('SampleShow.ppt', ppt);
  await expect(page.locator('.folio-statusbar')).toContainText('Read-only (old format)');
  await expect(page.locator('.slides-current')).toContainText('Title of the first slide');
  await expect(page.getByRole('button', { name: 'Duplicate slide' })).toBeDisabled();

  await page.keyboard.press('Control+S');
  const pptx = join(dir, 'SampleShow.pptx');
  await expect.poll(() => existsSync(pptx)).toBe(true);
  await expect(page.getByRole('tab', { name: /SampleShow\.pptx/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicate slide' })).toBeEnabled();
  const parts = await partsOf(pptx);
  expect([...parts.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(2);
});
