import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real (debug) apps over WebView2's debugging port, with the
// window hidden (FOLIO_BACKGROUND=1). No browser is downloaded. One app at a time, because
// each app allows a single running copy.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
});
