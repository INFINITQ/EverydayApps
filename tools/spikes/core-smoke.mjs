// Dev-only end-to-end check of the shared core in a real debug build, without touching the
// desktop: Folio Hello starts hidden (FOLIO_BACKGROUND=1) with WebView2's debugging port,
// and the folio commands are driven from inside the page.
//
// Usage: node tools/spikes/core-smoke.mjs [path-to-debug-exe]
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2] ?? 'target/debug/folio-hello.exe';
const port = 9333;
const env = {
  ...process.env,
  FOLIO_BACKGROUND: '1',
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
};
const dir = mkdtempSync(join(tmpdir(), 'folio-smoke-'));
const doc = join(dir, 'notes.txt');
writeFileSync(doc, 'original');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
};

const app = spawn(exe, [], { env, stdio: 'ignore' });
try {
  let browser;
  for (let i = 0; i < 80 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!browser) throw new Error('the app never opened its debugging port');
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__));

  // Runs `invoke` inside the page; errors come back as `{ error: { kind, message } }`.
  const call = (cmd, args, options) =>
    page.evaluate(
      async ([c, a, o]) => {
        try {
          const value = await window.__TAURI_INTERNALS__.invoke(c, a, o);
          return { value: value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : value };
        } catch (error) {
          return { error };
        }
      },
      [cmd, args, options],
    );
  const saveText = (token, text) =>
    page.evaluate(
      async ([t, s]) => {
        try {
          return { value: await window.__TAURI_INTERNALS__.invoke('plugin:folio|save', new TextEncoder().encode(s), { headers: { 'x-folio-token': t } }) };
        } catch (error) {
          return { error };
        }
      },
      [token, text],
    );

  const boot = await page.evaluate(() => window.__FOLIO_BOOT__);
  check('boot data is injected before the page loads', boot?.system?.accent?.length === 7, boot?.system?.accent?.[3]);

  const system = (await call('plugin:folio|system')).value;
  check('system colors', /^#[0-9a-f]{6}$/.test(system?.accent?.[3] ?? ''), `accent ${system?.accent?.[3]}, dark ${system?.dark}`);

  await call('plugin:folio|settings_set', { patch: { smokeTest: true } });
  check('settings persist', (await call('plugin:folio|settings_get')).value?.smokeTest === true);

  const second = spawnSync(exe, [doc], { env, timeout: 15000 });
  check('second launch hands its file over and exits', second.status === 0, `exit code ${second.status}`);
  await page.waitForTimeout(500);
  const pending = (await call('plugin:folio|take_pending')).value ?? [];
  check('the file arrives as a grant (token, no usable path)', pending.length === 1 && pending[0].name === 'notes.txt' && typeof pending[0].token === 'string');
  const token = pending[0]?.token;

  const read = await call('plugin:folio|read', { token });
  check('read returns the bytes', Buffer.from(read.value ?? []).toString() === 'original');

  const saved = await saveText(token, 'edited in folio');
  check('save writes the file', readFileSync(doc, 'utf8') === 'edited in folio', `size ${saved.value?.size}`);

  writeFileSync(doc, 'changed by another program');
  const conflict = await saveText(token, 'mine');
  check('a change made by another program is detected', conflict.error?.kind === 'conflict', conflict.error?.kind);
  check('...and the other program\'s version is kept', readFileSync(doc, 'utf8') === 'changed by another program');

  check('the file is at the top of recent files', (await call('plugin:folio|recent_list')).value?.[0]?.name === 'notes.txt');
  check('the original was backed up', ((await call('plugin:folio|backups_usage')).value?.count ?? 0) >= 1);

  const unknown = await call('plugin:folio|read', { token: 'not-a-token' });
  check('unknown tokens are refused', unknown.error?.kind === 'unknownToken', unknown.error?.kind);

  const fs = await call('plugin:fs|read_file', { path: 'C:\\Windows\\win.ini' });
  check('no generic file-system access', Boolean(fs.error), String(fs.error).slice(0, 70));

  const shell = await call('plugin:shell|open', { path: 'https://example.com' });
  check('no shell access', Boolean(shell.error), String(shell.error).slice(0, 70));
} finally {
  app.kill();
  rmSync(dir, { recursive: true, force: true });
}

const passed = results.every(Boolean);
console.log(passed ? 'ALL PASSED' : 'SOME CHECKS FAILED');
process.exit(passed ? 0 : 1);
