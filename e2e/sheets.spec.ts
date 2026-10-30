import { type Page, expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { inflate, readZip } from '../apps/sheets/src/xlsx/zip';
// @ts-expect-error plain ES module without types
import { makeXlsx } from '../tools/fixtures/make-xlsx.mjs';
import { type RunningApp, launchApp, trackViolations } from './app';

const EXE = 'target/debug/folio-sheets.exe';

let app: RunningApp;
let dir: string;

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-sheets-e2e-'));
  app = await launchApp(EXE, 9344, { FOLIO_TEST_SAVE_DIR: dir, FOLIO_TEST_OPEN: join(dir, 'picture.png') });
});

test.afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

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

/** Goes to a cell with the name box (left of the formula bar) and types into it. */
async function typeInto(page: Page, cell: string, value: string) {
  const nameBox = page.locator('.sheets-grid input').first();
  await nameBox.click();
  await nameBox.fill(cell);
  await nameBox.press('Enter');
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

/** Each part of a package, inflated. */
function partsOf(bytes: Uint8Array): Map<string, Buffer> {
  return new Map(readZip(bytes).map((entry) => [entry.name, Buffer.from(inflate(entry))]));
}

test('opens a workbook, edits a cell and saves only what changed', async () => {
  const { page } = app;
  const file = join(dir, 'sales.xlsx');
  const original = makeXlsx();
  writeFileSync(file, original);
  const violations = await trackViolations(page);
  const outside = trackOutside(page);

  expect(app.launchAgain([file])).toBe(0);
  const tab = page.getByRole('tab', { name: /sales\.xlsx/ });
  await expect(tab).toBeVisible();
  await expect(page.locator('.sheets-grid canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Pivot tables are shown as they were last refreshed/)).toBeVisible();

  await typeInto(page, 'B3', '999');
  await expect(tab).toHaveAttribute('data-dirty', 'true');
  await page.keyboard.press('Control+S');
  await expect(tab).toHaveAttribute('data-dirty', 'false');

  const saved = new Uint8Array(readFileSync(file));
  const workbook = XLSX.read(saved, { type: 'array', cellFormula: true });
  expect(workbook.Sheets.Data!.B3!.v).toBe(999);
  expect(workbook.Sheets.Data!.B2!.v).toBe(1200.5);
  // The SUM below was recalculated, the shared formula kept.
  expect(workbook.Sheets.Data!.B6!.v).toBe(3999.75);
  const before = partsOf(original);
  const after = partsOf(saved);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (name) => !before.has(name) || !after.has(name) || Buffer.compare(before.get(name)!, after.get(name)!) !== 0,
  );
  expect(changed.sort()).toEqual(['[Content_Types].xml', 'xl/_rels/workbook.xml.rels', 'xl/calcChain.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);

  expect(await violations()).toEqual([]);
  expect(outside).toEqual([]);
});

test('keeps macros, and an unchanged workbook saves byte for byte', async () => {
  const { page } = app;
  const file = join(dir, 'macros.xlsm');
  const original = makeXlsx({ macros: true });
  writeFileSync(file, original);
  expect(app.launchAgain([file])).toBe(0);
  await expect(page.getByText(/This workbook has macros\. Folio never runs them/)).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+S');
  await expect.poll(() => Buffer.compare(readFileSync(file), Buffer.from(original))).toBe(0);

  await typeInto(page, 'A2', 'Northwest');
  await page.keyboard.press('Control+S');
  await expect.poll(() => XLSX.read(readFileSync(file), { type: 'buffer' }).Sheets.Data!.A2!.v).toBe('Northwest');
  expect(partsOf(new Uint8Array(readFileSync(file))).get('xl/vbaProject.bin')).toEqual(partsOf(original).get('xl/vbaProject.bin'));
});

test('edits a CSV file and keeps its other lines as written', async () => {
  const { page } = app;
  const file = join(dir, 'list.csv');
  writeFileSync(file, 'name;amount\r\n"Smith, J";1e5\r\nDoe;007\r\n');
  expect(app.launchAgain([file])).toBe(0);
  await expect(page.getByRole('tab', { name: /list\.csv/ })).toBeVisible();
  await typeInto(page, 'B3', '8');
  await page.keyboard.press('Control+S');
  await expect.poll(() => readFileSync(file, 'utf8')).toBe('name;amount\r\n"Smith, J";1e5\r\nDoe;8\r\n');
});
