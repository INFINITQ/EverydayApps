// Smoke test for Folio Sheets in a plain browser, under Tauri's frozen prototypes (as the app
// runs): opens generated and sample workbooks on the shell's in-memory backend
// (harness/harness.tsx), runs every command the palette offers, saves, and fails on uncaught
// errors, error notices, commands that throw, or saved files that don't read back. It reaches
// code the real-app spec (e2e/sheets.spec.ts) doesn't.
//
// Usage (from apps/sheets): node test/smoke.mjs   (FOLIO_BROWSER=msedge on Windows uses Edge)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { makeXlsx } from '../../../tools/fixtures/make-xlsx.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const XLSX = require('xlsx');
const app = join(import.meta.dirname, '..');
const PORT = 5182;
/** Left out: opening, printing and closing files, app-wide settings, the palette itself. */
const SKIP = /^(file\.(open|print|save|saveAs|saveCopy)$|tab\.|app\.|privacy\.|view\.(fullscreen|theme\.))/;

const build = spawnSync('npx', ['vite', 'build', '-c', 'vite.harness.config.ts'], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) process.exit(1);
const page_path = existsSync(join(app, 'dist/harness/harness/index.html')) ? '/harness/index.html' : '/index.html';
const server = spawn('npx', ['vite', 'preview', '-c', 'vite.harness.config.ts'], { cwd: app, stdio: 'ignore', shell: process.platform === 'win32' });
await new Promise((resolve) => setTimeout(resolve, 2500));

/** Answers the shell's question, if one is open: "Save anyway" when offered, else the first choice. */
const answer = (page) =>
  page.evaluate(() => {
    const question = window.harness.shell.state.question;
    if (!question) return;
    const choice = question.choices.find((c) => c.value === 'anyway') ?? question.choices[0];
    question.answer(choice?.value ?? 'cancel');
  });

const failures = [];
let ran = 0;
const browser = await chromium.launch(process.env.FOLIO_BROWSER ? { channel: process.env.FOLIO_BROWSER } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  // The app runs with Tauri's freezePrototype (config/security.json); so does this page.
  await page.addInitScript(() => Object.freeze(Object.prototype));
  const errors = [];
  page.on('pageerror', (e) => errors.push((e.stack ?? String(e)).split('\n').slice(0, 2).join(' | ')));
  page.on('console', (m) => {
    const url = m.location().url ?? '';
    if (m.type() === 'error' && !url.endsWith('/favicon.ico')) errors.push(`${m.text()} ${url}`.trim());
  });
  await page.goto(`http://127.0.0.1:${PORT}${page_path}`);
  await page.waitForFunction(() => 'harness' in window);

  const files = [
    ['C:\\Docs\\sales.xlsx', makeXlsx()],
    ['C:\\Docs\\macros.xlsm', makeXlsx({ macros: true })],
    ['C:\\Docs\\sample.xls', readFileSync(join(app, '../../fixtures/sheets/sample.xls'))],
    ['C:\\Docs\\list.csv', Buffer.from('name;amount\r\n"Smith, J";1e5\r\nDoe;007\r\n')],
  ];
  for (const [path, bytes] of files) {
    const seen = errors.length;
    await page.evaluate(([p, b64]) => window.harness.open(p, b64), [path, Buffer.from(bytes).toString('base64')]);
    const shown = page.locator('.folio-document:not([hidden])');
    await shown.locator('.sheets-grid canvas').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    // A block selected, for the commands that work on the selection.
    const nameBox = shown.locator('.sheets-grid input').first();
    await nameBox.click();
    await nameBox.fill('A1:C5');
    await nameBox.press('Enter');

    const ids = await page.evaluate((skip) => window.harness.shell.commands().map((c) => c.id).filter((id) => !new RegExp(skip).test(id)), SKIP.source);
    for (const id of ids) {
      const before = errors.length;
      const outcome = await page.evaluate(async (wanted) => {
        const command = window.harness.shell.commands().find((c) => c.id === wanted);
        if (!command || (command.enabled && !command.enabled())) return 'off';
        const running = Promise.resolve().then(() => command.run());
        return Promise.race([
          running.then(() => 'ok', (e) => `threw ${e?.message ?? e}`),
          new Promise((resolve) => setTimeout(() => resolve('waiting'), 2000)),
        ]);
      }, id);
      if (outcome !== 'off') ran += 1;
      if (outcome.startsWith('threw')) failures.push(`${path}: ${id} ${outcome}`);
      // A question goes ahead with its first choice; dialogs and panels are closed.
      await answer(page);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      if (errors.length > before) console.log(`  after ${id}: ${errors.slice(before).join(' | ')}`);
    }

    const notices = await page.evaluate(() => window.harness.shell.state.notices.filter((n) => n.intent === 'error').map((n) => n.message));
    for (const notice of notices) failures.push(`${path}: error notice: ${notice}`);
    // Saved and read back (an old .xls is saved as a new .xlsx).
    const target = path.endsWith('.xls') ? `${path}x` : path;
    if (target !== path) await page.evaluate((p) => window.harness.fake.nextSave(p), target);
    // Saving can ask first (a .csv can't keep formatting): it goes ahead.
    const saving = page.evaluate(() => window.harness.shell.save());
    for (let tries = 0; tries < 80; tries += 1) {
      const done = await Promise.race([saving.then(() => true, () => true), new Promise((resolve) => setTimeout(() => resolve(false), 250))]);
      if (done) break;
      await answer(page);
    }
    await page.waitForTimeout(300);
    const saved = await page.evaluate((p) => window.harness.saved(p), target);
    if (!saved) failures.push(`${path}: nothing was saved`);
    else if (!target.endsWith('.csv')) {
      try {
        const book = XLSX.read(Buffer.from(saved, 'base64'), { type: 'buffer' });
        if (book.SheetNames.length === 0) failures.push(`${path}: the saved workbook has no sheets`);
      } catch (error) {
        failures.push(`${path}: the saved workbook doesn't read back: ${error.message}`);
      }
    }
    for (const error of errors.slice(seen)) failures.push(`${path}: ${error}`);
    console.log(`${path}: ${ids.length} commands, ${errors.length - seen} errors`);
    for (const error of errors.slice(seen)) console.log(`  ${error}`);
    // Closed before the next one, so only one document is on screen.
    await page.evaluate(() => {
      const { shell } = window.harness;
      void shell.close(shell.state.activeId);
    });
    await page.evaluate(() => {
      const question = window.harness.shell.state.question;
      if (question) question.answer('discard');
    });
    await page.waitForTimeout(300);
  }
} finally {
  await browser.close();
  // On Windows the server runs under a shell; stop the whole tree, not just the shell.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
}

console.log(`${ran} command runs, ${failures.length} failures`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
