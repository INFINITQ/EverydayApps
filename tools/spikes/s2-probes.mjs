// Dev-only spike S2 check. Drives Folio Hello over WebView2's debugging port (only
// reachable in debug builds started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
// --remote-debugging-port=9222) and runs every privacy probe on the page.
//
// Usage: node tools/spikes/s2-probes.mjs [port]
import { chromium } from '@playwright/test';

const port = process.argv[2] ?? '9222';
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0]?.pages()[0];
if (!page) throw new Error('No page found on the debugging port');
console.log(`page: ${page.url()}`);

const outside = [];
page.on('request', (request) => {
  const url = new URL(request.url());
  if (!['localhost', 'tauri.localhost', 'ipc.localhost'].includes(url.hostname)) outside.push(request.url());
});

for (const label of ['fetch()', 'Remote image', 'WebSocket', 'window.open()', 'WebRTC', 'Navigate away']) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(label === 'Navigate away' ? 2500 : 700);
}

console.log('--- page log');
console.log(await page.locator('.log').innerText());
console.log('--- requests to outside hosts that reached the network layer');
console.log(outside.length ? outside.join('\n') : '(none)');
process.exit(0);
