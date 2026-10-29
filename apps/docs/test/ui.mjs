// UI test for Folio Docs in a plain browser: the real shell and format module on the shell's
// in-memory backend (test/harness.tsx), under the app's real content policy. It opens generated
// documents, edits them through the keyboard and toolbar, saves with Ctrl+S, and checks the
// saved bytes with an independent zip reader. Also: links open only after asking, no request
// leaves the page, no content-policy violations.
//
// Usage (from apps/docs): node test/ui.mjs   (FOLIO_BROWSER=msedge on Windows uses Edge)
// Screenshots go to test/out/.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { MARKERS, WEB_LINK, makeDocx } from '../../../tools/fixtures/make-docx.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = import.meta.dirname;
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const PORT = 4610;

const build = spawnSync('npx', ['vite', 'build', '--config', 'test/vite.config.ts'], { cwd: join(here, '..'), stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) process.exit(1);
const server = spawn('npx', ['vite', 'preview', '--config', 'test/vite.config.ts', '--port', String(PORT), '--strictPort'], {
  cwd: join(here, '..'),
  stdio: 'ignore',
  shell: process.platform === 'win32',
});
await new Promise((resolve) => setTimeout(resolve, 2500));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const parts = (base64) => unzipSync(new Uint8Array(Buffer.from(base64, 'base64')));
const bodyText = (xml) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

const browser = await chromium.launch(process.env.FOLIO_BROWSER ? { channel: process.env.FOLIO_BROWSER } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  const outside = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) outside.push(r.url());
  });
  await page.goto(`http://localhost:${PORT}/harness.html`);
  await page.evaluate(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });

  // ---- Open, type, save ---------------------------------------------------------------------
  const original = makeDocx({ macros: true });
  const path = 'C:\\docs\\kitchen.docm';
  await page.evaluate(([p, data]) => window.harness.put(p, data), [path, b64(original)]);
  await page.evaluate((p) => window.harness.open(p), path);
  await page.locator('.docs-viewport').waitFor({ timeout: 20_000 });
  await page.locator('.docs-loading').waitFor({ state: 'detached', timeout: 30_000 });
  const body = page.getByText(MARKERS.body).first();
  await body.waitFor({ timeout: 20_000 });
  check('opens a .docm and shows its text', true);
  check('says the macros are kept, never run', await page.getByText('Folio never runs them').isVisible());
  check('says linked pictures are never loaded', await page.getByText('Folio never loads it').isVisible());
  await page.screenshot({ path: join(out, 'opened.png') });

  await body.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('Hello ');
  await page.waitForTimeout(600);
  check('typing marks the tab unsaved', await page.getByText('Unsaved changes').isVisible());
  await page.keyboard.press('Control+s');
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 15_000 });
  const saved = parts(await page.evaluate((p) => window.harness.file(p), path));
  const before = unzipSync(original);
  const document = strFromU8(saved['word/document.xml']);
  check('the typed text is in the saved file', bodyText(document).includes('Hello Plain, bold') || bodyText(document).includes(`Hello ${MARKERS.body}`) || bodyText(document).includes('Hello '), bodyText(document).slice(0, 80));
  const untouched = Object.keys(before).filter((n) => n !== 'word/document.xml');
  const same = untouched.filter((n) => saved[n] && Buffer.compare(Buffer.from(saved[n]), Buffer.from(before[n])) === 0);
  check('every other part is byte for byte the original', same.length === untouched.length, `${same.length}/${untouched.length}`);
  check('the macro project and macro content type are kept', Boolean(saved['word/vbaProject.bin']) && strFromU8(saved['[Content_Types].xml']).includes('macroEnabled'));
  check('unknown markup survives the edit', document.includes('fx:mystery') && document.includes('fx:paraTag'));

  // ---- Undo back to the saved text reads as saved again -------------------------------------
  await page.keyboard.type('xyz');
  await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  await page.waitForTimeout(1200);
  check('typing then deleting it again counts as no change', await page.getByText('Saved', { exact: true }).isVisible());

  // ---- Bold through the shortcut -------------------------------------------------------------
  await page.getByText('Second bullet').first().dblclick();
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+s');
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 15_000 });
  const bolded = strFromU8(parts(await page.evaluate((p) => window.harness.file(p), path))['word/document.xml']);
  check('Ctrl+B makes the selected word bold', /<w:b\/>(?:(?!<\/w:r>).)*Second/s.test(bolded) || /<w:b\/><\/w:rPr><w:t[^>]*>Second/.test(bolded));

  // ---- Find ------------------------------------------------------------------------------------
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: 'Find' }).fill('bullet');
  await page.waitForTimeout(600);
  check('find counts matches', await page.getByText(/^3 matches$|of 3/).isVisible());
  await page.screenshot({ path: join(out, 'find.png') });
  await page.keyboard.press('Escape');

  // ---- Links ask first -------------------------------------------------------------------------
  await page.getByText('the example site').first().click();
  const open = page.getByRole('button', { name: 'Open…' });
  await open.waitFor({ timeout: 5_000 }).catch(() => undefined);
  if (await open.isVisible()) {
    await open.click();
    await page.getByText('Open this link?').waitFor({ timeout: 5_000 });
    await page.screenshot({ path: join(out, 'link.png') });
    await page.getByRole('button', { name: 'Open link' }).click();
    await page.waitForTimeout(300);
    const calls = await page.evaluate(() => window.harness.calls);
    check('a link opens only after asking', calls.includes(`openLink:${WEB_LINK}`));
  } else {
    check('clicking a link shows the link bar', false);
  }

  // ---- Word count ------------------------------------------------------------------------------
  await page.keyboard.press('Control+Shift+G');
  await page.getByText('Word count').first().waitFor({ timeout: 5_000 });
  check('word count shows', await page.getByText('Characters (with spaces)').isVisible());
  await page.screenshot({ path: join(out, 'wordcount.png') });
  await page.getByRole('button', { name: 'Close' }).last().click();

  // ---- Printing paints every page (the view only paints what's on screen) ---------------------
  const long = makeDocx({ plain: true, paragraphs: 400 });
  await page.evaluate(([p, data]) => window.harness.put(p, data), ['C:\\docs\\long.docx', b64(long)]);
  await page.evaluate((p) => window.harness.open(p), 'C:\\docs\\long.docx');
  await page.locator('.docs-loading').waitFor({ state: 'detached', timeout: 30_000 });
  const status = page.locator('.folio-statusbar');
  await status.getByText(/Page \d+ of \d+/).waitFor({ timeout: 20_000 });
  const total = Number((await status.textContent()).match(/Page \d+ of (\d+)/)[1]);
  const printed = await page.evaluate(() => window.harness.printKeep());
  check('printing paints every page', printed.pages === total && total > 5, `${printed.pages} of ${total} pages`);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  writeFileSync(join(out, 'printed.pdf'), pdf);
  const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check('the printed PDF has one sheet per page', pdfPages === total, `${pdfPages} sheets for ${total} pages`);
  await page.emulateMedia({ media: 'screen' });

  // ---- An old .doc opens read-only; Save makes a new .docx and leaves the .doc alone ------------
  const doc = readFileSync(join(here, '../../../fixtures/generated/kitchen.doc'));
  await page.evaluate(([p, data]) => window.harness.put(p, data), ['C:\\docs\\old.doc', b64(doc)]);
  await page.evaluate((p) => window.harness.open(p), 'C:\\docs\\old.doc');
  await page.getByText('opened read-only. Folio never changes it').waitFor({ timeout: 30_000 });
  await page.locator('.docs-loading').waitFor({ state: 'detached', timeout: 30_000 });
  check('a .doc opens read-only, with its text', (await status.textContent()).includes('Read-only') && (await page.getByText('Cell B2').count()) > 0);
  await page.screenshot({ path: join(out, 'legacy.png') });
  await page.evaluate(() => window.harness.nextSave('C:\\docs\\old.docx'));
  await page.keyboard.press('Control+s');
  await page.getByRole('tab', { name: /old\.docx/ }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  const converted = await page.evaluate(() => window.harness.file('C:\\docs\\old.docx'));
  check('Save makes a new .docx with the text', converted !== null && strFromU8(parts(converted)['word/document.xml']).includes('Cell B2'));
  check('the .doc itself is untouched', (await page.evaluate(() => window.harness.file('C:\\docs\\old.doc'))) === b64(doc));

  // ---- Privacy ---------------------------------------------------------------------------------
  const violations = await page.evaluate(() => window.__violations);
  check('no request left the page', outside.length === 0, outside.join(', '));
  check('no content-policy violations', violations.length === 0, violations.join(', '));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300));
  writeFileSync(join(out, 'saved.docm'), Buffer.from(await page.evaluate((p) => window.harness.file(p), path), 'base64'));
} catch (error) {
  check(`unexpected: ${error.message.split('\n')[0]}`, false);
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
