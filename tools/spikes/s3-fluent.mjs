// Dev-only spike S3 check: Fluent UI under the release content policy.
// Run the debug build that embeds the frontend (`tauri build --debug`) with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222, then:
//   node tools/spikes/s3-fluent.mjs [port]
import { chromium } from '@playwright/test';

const port = process.argv[2] ?? '9222';
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0]?.pages()[0];
if (!page) throw new Error('No page found on the debugging port');
console.log(`page: ${page.url()}`);

await page.evaluate(() => {
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__violations.push(`${e.effectiveDirective} ${e.blockedURI || '(inline)'}`),
  );
});

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message.split('\n')[0]}`);
  }
};

await step('menu opens', async () => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rotate' }).waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape');
});
await step('dialog opens and closes', async () => {
  await page.getByRole('button', { name: 'Dialog', exact: true }).click();
  await page.getByRole('dialog').waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
});
await step('tooltip shows', async () => {
  await page.getByRole('button', { name: 'Open', exact: true }).hover();
  await page.getByText('Opens a PDF').waitFor({ timeout: 3000 });
});
await step('dropdown selects', async () => {
  await page.getByRole('combobox', { name: 'Zoom' }).click();
  await page.getByRole('option', { name: 'Fit width' }).click();
});
await step('toast appears', async () => {
  await page.getByRole('button', { name: 'Toast', exact: true }).click();
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 3000 });
});

const before = await page.getByTestId('primary').evaluate((el) => getComputedStyle(el).backgroundColor);
await step('theme switches', async () => {
  await page.getByRole('switch', { name: 'Dark theme' }).click();
  await page.waitForTimeout(500);
});
const after = await page.getByTestId('primary').evaluate((el) => getComputedStyle(el).backgroundColor);
console.log(`primary button background: ${before} -> ${after}`);

// The policy must still block the network: this should add a connect-src violation.
await page.getByRole('button', { name: 'fetch()', exact: true }).click();
await page.waitForTimeout(800);

console.log('--- violations during the run');
console.log((await page.evaluate(() => window.__violations)).join('\n') || '(none)');
console.log('--- page log (includes violations during page load)');
console.log((await page.locator('.log').innerText()) || '(empty)');
process.exit(0);
