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
import { MARKERS, WEB_LINK, makeDocx, png } from '../../../tools/fixtures/make-docx.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
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
  // The app runs with Tauri's freezePrototype (config/security.json); so does this page, or
  // code that breaks only in the app would pass here.
  await page.addInitScript(() => Object.freeze(Object.prototype));
  const errors = [];
  const outside = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Errors name what failed to load (the console only says "Failed to load resource"). Edge asks
  // for /favicon.ico on its own; that's the browser, not the app.
  page.on('console', (m) => {
    const url = m.location().url ?? '';
    if (m.type() === 'error' && !url.endsWith('/favicon.ico')) errors.push(`${m.text()} ${url}`.trim());
  });
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

  // ---- Received tracked changes and comments are shown ----------------------------------------
  await page.getByRole('button', { name: 'Comments' }).click();
  const panel = page.locator('.docs-panel');
  check('the review panel shows the comment', await panel.getByText(MARKERS.comment).isVisible());
  check('the review panel lists the tracked deletion and insertion', (await panel.getByText(MARKERS.deleted).isVisible()) && (await panel.getByText(MARKERS.inserted).isVisible()));
  await page.screenshot({ path: join(out, 'review.png') });
  await page.getByRole('button', { name: 'Comments' }).click();

  // ---- Word count ------------------------------------------------------------------------------
  await page.keyboard.press('Control+Shift+G');
  await page.getByText('Word count').first().waitFor({ timeout: 5_000 });
  check('word count shows', await page.getByText('Characters (with spaces)').isVisible());
  await page.screenshot({ path: join(out, 'wordcount.png') });
  await page.getByRole('button', { name: 'Close' }).last().click();

  // ---- Insert and layout through the toolbar, each saved and read back -----------------------
  const plainPath = 'C:\\docs\\plain.docx';
  await page.evaluate(([p, data]) => window.harness.put(p, data), [plainPath, b64(makeDocx({ plain: true }))]);
  await page.evaluate((p) => window.harness.open(p), plainPath);
  await page.locator('.docs-loading').waitFor({ state: 'detached', timeout: 30_000 });
  const visible = () => page.locator('.folio-document:not([hidden])');
  const saveAndRead = async () => {
    await page.keyboard.press('Control+s');
    await page.locator('.folio-statusbar').getByText('Saved', { exact: true }).waitFor({ timeout: 15_000 });
    return parts(await page.evaluate((p) => window.harness.file(p), plainPath));
  };
  const insert = async (item) => {
    await page.getByRole('button', { name: 'Insert' }).click();
    await page.getByRole('menuitem', { name: item }).click();
  };
  await visible().getByText(MARKERS.body).first().click();
  await page.keyboard.press('End');
  await insert('Table…');
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click();
  await page.waitForTimeout(500);
  let saved2 = await saveAndRead();
  const tableXml = strFromU8(saved2['word/document.xml']);
  check('Insert → Table adds a 3 × 3 table', (tableXml.match(/<w:tc[\s>]/g) ?? []).length === 9, `tbl=${(tableXml.match(/<w:tbl[\s>]/g) ?? []).length} tc=${(tableXml.match(/<w:tc[\s>]/g) ?? []).length}`);
  await visible().getByText(MARKERS.title).first().click();
  await page.keyboard.press('End');
  await insert('Footnote');
  await page.waitForTimeout(400);
  await page.keyboard.type('Folio footnote');
  await page.waitForTimeout(400);
  saved2 = await saveAndRead();
  check('Insert → Footnote adds a note', strFromU8(saved2['word/document.xml']).includes('w:footnoteReference') && strFromU8(saved2['word/footnotes.xml'] ?? new Uint8Array()).includes('Folio footnote'));
  await visible().getByText(MARKERS.body).first().click();
  await page.keyboard.press('Home');
  await insert('Table of contents');
  await page.waitForTimeout(500);
  saved2 = await saveAndRead();
  check('Insert → Table of contents adds a contents field', /TOC \\o/.test(strFromU8(saved2['word/document.xml'])));
  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByRole('menuitem', { name: 'Page setup…' }).click();
  await page.getByRole('radio', { name: 'Landscape' }).check();
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.waitForTimeout(500);
  saved2 = await saveAndRead();
  check('Page setup → Landscape turns the page', strFromU8(saved2['word/document.xml']).includes('w:orient="landscape"'));
  await page.evaluate(([p, data]) => window.harness.put(p, data), ['C:\\pictures\\dot.png', b64(png(40, 20, [200, 30, 30, 255]))]);
  await page.evaluate(() => window.harness.nextOpen(['C:\\pictures\\dot.png']));
  await visible().getByText(MARKERS.body).first().click();
  await insert('Picture…');
  await page.waitForTimeout(800);
  saved2 = await saveAndRead();
  const media = Object.keys(saved2).filter((n) => n.startsWith('word/media/'));
  const pictureXml = strFromU8(saved2['word/document.xml']);
  check('Insert → Picture embeds the picture', media.length === 1 && /<w:drawing[\s>]/.test(pictureXml), `${media.join(', ')} ${(pictureXml.match(/<[\w:]*(drawing|pict|blip)[^>]*>/g) ?? []).slice(0, 3).join(' ')}`);
  await page.screenshot({ path: join(out, 'inserted.png') });

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

  // ---- Reopening returns to the page the reader was on -----------------------------------------
  const view = await page.evaluate(async () => {
    const shell = window.harness.shell;
    const session = shell.session(shell.state.activeId);
    session.editor.surface.revealPage(4);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return session.viewState();
  });
  check('the view state remembers the page', view?.page === 5, JSON.stringify(view));
  await page.evaluate(([p, data]) => window.harness.put(p, data), ['C:\\docs\\long-again.docx', b64(long)]);
  await page.evaluate(async ([p, v]) => {
    await window.harness.open(p);
    const shell = window.harness.shell;
    shell.session(shell.state.activeId).restoreViewState(v);
  }, ['C:\\docs\\long-again.docx', view]);
  await page.locator('.folio-document:not([hidden]) .docs-loading').waitFor({ state: 'detached', timeout: 30_000 });
  await page.waitForTimeout(800);
  const shown = await page.evaluate(() => {
    const shell = window.harness.shell;
    return shell.session(shell.state.activeId).editor.surface.currentPage('viewport');
  });
  check('reopening shows that page again', shown === 5, `page ${shown}`);

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
  check(`unexpected: ${error.message.split('\n').slice(0, 3).join(' / ')}`, false);
  await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(out, 'failure.png') }).catch(() => undefined);
} finally {
  await browser.close();
  // On Windows the server runs under a shell; stop the whole tree, not just the shell.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
