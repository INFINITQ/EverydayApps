// Folio Docs end to end, on the real (debug) app: open from Explorer, edit, save, and check the
// saved bytes; macros kept; an old .doc saved as a new .docx; links ask first; nothing leaves
// the PC. The same flows run in a plain browser in apps/docs/test/ui.mjs.

import { type Page, expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip, unpack } from '../apps/docs/src/zip';
// @ts-expect-error plain ES module without types
import { MARKERS, WEB_LINK, makeDocx } from '../tools/fixtures/make-docx.mjs';
import { type RunningApp, launchApp, trackViolations } from './app';

const EXE = 'target/debug/folio-docs.exe';

/** Every part of a .docx, unpacked, by name. */
function parts(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(readZip(bytes).map((entry) => [entry.name, unpack(entry)]));
}
const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const bodyText = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

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

async function opened(page: Page) {
  await page.locator('.docs-viewport').waitFor({ timeout: 20_000 });
  await page.locator('.docs-loading').waitFor({ state: 'detached', timeout: 30_000 });
}

let app: RunningApp;
let dir: string;

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-docs-e2e-'));
  // Save dialogs "choose" this folder; links that would open in the browser go to links.log.
  app = await launchApp(EXE, 9344, { FOLIO_TEST_SAVE_DIR: dir, FOLIO_TEST_LINKS: join(dir, 'links.log') });
});

test.afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('opens a .docm, saves an edit and keeps everything else byte for byte', async () => {
  const { page } = app;
  const violations = await trackViolations(page);
  const outside = trackOutside(page);
  const file = join(dir, 'kitchen.docm');
  const original = makeDocx({ macros: true }) as Uint8Array;
  writeFileSync(file, original);
  expect(app.launchAgain([file])).toBe(0);
  await opened(page);
  await expect(page.getByText('Folio never runs them')).toBeVisible();
  await expect(page.getByText('Folio never loads it')).toBeVisible();

  await page.getByText(MARKERS.body).first().click();
  await page.keyboard.press('Home');
  await page.keyboard.type('Hello ');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.folio-statusbar').getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });

  const before = parts(original);
  const after = parts(new Uint8Array(readFileSync(file)));
  expect(bodyText(text(after.get('word/document.xml')))).toContain('Hello ');
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [name, bytes] of before) {
    if (name !== 'word/document.xml') expect(after.get(name), name).toEqual(bytes);
  }
  expect(text(after.get('[Content_Types].xml'))).toContain('macroEnabled');

  // The picture linked from the web was never requested, and nothing else left the app.
  expect(outside).toEqual([]);
  expect(await violations()).toEqual([]);
});

test('a link opens only after asking', async () => {
  const { page } = app;
  const file = join(dir, 'links.docx');
  writeFileSync(file, makeDocx() as Uint8Array);
  expect(app.launchAgain([file])).toBe(0);
  await opened(page);
  await page.getByText('the example site').first().click();
  await page.getByRole('button', { name: 'Open…' }).click();
  await expect(page.getByText('Open this link?')).toBeVisible();
  await page.getByRole('button', { name: 'Open link' }).click();
  await expect
    .poll(() => {
      try {
        return text(readFileSync(join(dir, 'links.log')));
      } catch {
        return ''; // not written yet
      }
    })
    .toContain(WEB_LINK);
});

test('an old .doc opens read-only and Save makes a new .docx', async () => {
  const { page } = app;
  const file = join(dir, 'old.doc');
  const original = readFileSync('fixtures/generated/kitchen.doc');
  writeFileSync(file, original);
  expect(app.launchAgain([file])).toBe(0);
  await expect(page.getByText('opened read-only. Folio never changes it')).toBeVisible({ timeout: 30_000 });
  await opened(page);
  await expect(page.locator('.folio-statusbar')).toContainText('Read-only');
  await page.keyboard.press('Control+s');
  await expect.poll(() => {
    try {
      return bodyText(text(parts(new Uint8Array(readFileSync(join(dir, 'old.docx')))).get('word/document.xml')));
    } catch {
      return '';
    }
  }).toContain('Cell B2');
  expect(readFileSync(file)).toEqual(original);
});

test('find, word count and printing work in the real app', async () => {
  const { page } = app;
  const file = join(dir, 'find.docx');
  writeFileSync(file, makeDocx() as Uint8Array);
  expect(app.launchAgain([file])).toBe(0);
  await opened(page);
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: 'Find' }).fill('bullet');
  await expect(page.getByText(/^3 matches$|of 3/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+G');
  await expect(page.getByText('Characters (with spaces)')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).last().click();
  // Printing paints every page into the print container; the dialog itself is stubbed.
  const pages = await page.evaluate(async () => {
    window.print = () => undefined;
    const before = document.querySelectorAll('.docs-print').length;
    const done = new Promise<number>((resolve) =>
      new MutationObserver((_m, observer) => {
        const container = document.querySelector('.docs-print');
        if (container) {
          resolve(container.querySelectorAll('.docx-page').length);
          observer.disconnect();
        }
      }).observe(document.body, { childList: true }),
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
    return before === 0 ? done : 0;
  });
  expect(pages).toBe(2);
});
