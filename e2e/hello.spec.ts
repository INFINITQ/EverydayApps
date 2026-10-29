import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunningApp, launchApp, trackViolations } from './app';

const EXE = 'target/debug/folio-hello.exe';

let app: RunningApp;
let dir: string;

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'folio-e2e-'));
  app = await launchApp(EXE);
});

test.afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('opens a file from a second launch, edits it and saves with Ctrl+S', async () => {
  const { page } = app;
  const file = join(dir, 'notes.txt');
  writeFileSync(file, 'first line');
  const violations = await trackViolations(page);

  await expect(page.getByRole('heading', { name: 'Folio Hello' })).toBeVisible();
  expect(app.launchAgain([file])).toBe(0);

  const tab = page.getByRole('tab', { name: /notes\.txt/ });
  await expect(tab).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'Text' });
  await expect(editor).toHaveValue('first line');

  await editor.fill('first line\nsecond line');
  await expect(tab).toHaveAttribute('data-dirty', 'true');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  await page.keyboard.press('Control+S');
  await expect.poll(() => readFileSync(file, 'utf8')).toBe('first line\nsecond line');
  await expect(tab).toHaveAttribute('data-dirty', 'false');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  expect(await violations()).toEqual([]);
});

test('the page cannot reach the network', async () => {
  const { page } = app;
  const outside: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (!['localhost', 'tauri.localhost', 'ipc.localhost'].includes(host))
      outside.push(request.url());
  });

  const results = await page.evaluate(async () => {
    const attempt = async (run: () => Promise<unknown>) =>
      run().then(
        () => 'reached',
        () => 'blocked',
      );
    return {
      fetch: await attempt(() => fetch('https://example.com/')),
      image: await attempt(
        () =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = resolve;
            img.onerror = reject;
            img.src = 'https://example.com/favicon.ico';
          }),
      ),
      websocket: await attempt(
        () =>
          new Promise((resolve, reject) => {
            const ws = new WebSocket('wss://example.com/');
            ws.onopen = resolve;
            ws.onerror = reject;
          }),
      ),
      popup: window.open('https://example.com/') === null ? 'blocked' : 'reached',
      webrtc:
        typeof (window as unknown as Record<string, unknown>).RTCPeerConnection === 'undefined'
          ? 'blocked'
          : 'reached',
    };
  });

  expect(results).toEqual({
    fetch: 'blocked',
    image: 'blocked',
    websocket: 'blocked',
    popup: 'blocked',
    webrtc: 'blocked',
  });
  // Requests the content policy refuses never reach the network layer.
  expect(outside).toEqual([]);
});

test('reports the network lock honestly, and runs on the private WebView2 when it is installed', async () => {
  type Lock = { privateRuntime: boolean; firewallRule: boolean; active: boolean };
  const lock = await app.page.evaluate(() =>
    (
      window as unknown as { __TAURI_INTERNALS__: { invoke(cmd: string): Promise<Lock> } }
    ).__TAURI_INTERNALS__.invoke('plugin:folio|network_lock'),
  );
  const runtime = join(
    process.env.ProgramFiles ?? 'C:\\Program Files',
    'Folio',
    'WebView2Runtime',
    'current',
    'msedgewebview2.exe',
  );
  expect(lock.privateRuntime).toBe(existsSync(runtime));
  if (!lock.privateRuntime) return;

  // Every WebView2 process of this app must run from the private copy.
  const script =
    'Get-CimInstance Win32_Process -Filter "Name=\'msedgewebview2.exe\'" | ' +
    "Where-Object { $_.CommandLine -match 'webview-exe-name=folio-hello.exe' } | ForEach-Object ExecutablePath";
  const paths = spawnSync('powershell', ['-NoProfile', '-Command', script])
    .stdout.toString()
    .trim()
    .split(/\r?\n/);
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) expect(path.toLowerCase()).toBe(runtime.toLowerCase());

  // The app's "firewall rule found" must match Windows' real firewall configuration.
  const rule =
    "$r = Get-NetFirewallRule -DisplayName 'Folio: block private WebView2' -ErrorAction SilentlyContinue; " +
    "if ($r -and $r.Enabled -eq 'True' -and $r.Direction -eq 'Outbound' -and $r.Action -eq 'Block' -and " +
    "(($r | Get-NetFirewallApplicationFilter).Program -eq '" +
    runtime +
    "')) { 'yes' } else { 'no' }";
  const ruleInPlace =
    spawnSync('powershell', ['-NoProfile', '-Command', rule]).stdout.toString().trim() === 'yes';
  expect(lock.firewallRule).toBe(ruleInPlace);
  expect(lock.active).toBe(ruleInPlace);
});
