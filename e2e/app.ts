// Launches a Folio debug build hidden, with WebView2's debugging port open, and connects
// Playwright to its page. Debug builds only: release builds refuse the debugging port.
// Each launch gets a fresh data folder of its own (FOLIO_TEST_DATA_DIR), so tests never touch
// the installed app's settings, recent files, backups or signatures, and never hand files to
// an installed copy that's running.

import { type Browser, type Page, chromium } from '@playwright/test';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type RunningApp = {
  page: Page;
  /** The app's process (WebView2's processes are its children). */
  pid: number;
  /** This launch's data folder (settings, recent files, `secure\` signatures...). */
  dataDir: string;
  /** Launches the app again with `args` (it hands them to the running copy and exits). */
  launchAgain(args: string[]): number | null;
  /** Stops the app and deletes its data folder. */
  close(): Promise<void>;
};

/** Deletes a test data folder; WebView2 lets go of its profile a moment after the app stops. */
function removeDataDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch {
    // Still in use: it's in the temp folder, which Windows cleans up.
  }
}

/**
 * `extraEnv` can answer the Open and Save dialogs for tests (debug builds only):
 * FOLIO_TEST_OPEN lists the files Open "picks", FOLIO_TEST_SAVE_DIR is the folder Save uses.
 */
export async function launchApp(
  exe: string,
  port = 9341,
  extraEnv: Record<string, string> = {},
): Promise<RunningApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'folio-data-'));
  const env = {
    ...process.env,
    ...extraEnv,
    FOLIO_BACKGROUND: '1',
    FOLIO_TEST_DATA_DIR: dataDir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  };
  const child: ChildProcess = spawn(exe, [], { env, stdio: 'ignore' });
  let browser: Browser | undefined;
  for (let attempt = 0; attempt < 80 && !browser; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!browser) {
    child.kill();
    removeDataDir(dataDir);
    throw new Error(`${exe} never opened its debugging port`);
  }
  const page = browser.contexts()[0]!.pages()[0]!;
  await page.waitForFunction(() => document.querySelector('.folio-app') !== null);
  return {
    page,
    pid: child.pid ?? 0,
    dataDir,
    launchAgain: (args) => spawnSync(exe, args, { env, timeout: 15_000 }).status,
    close: async () => {
      child.kill();
      await new Promise((resolve) => setTimeout(resolve, 300));
      removeDataDir(dataDir);
    },
  };
}

/** Records content-policy violations from now on. */
export async function trackViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const target = window as unknown as { __violations: string[] };
    target.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      target.__violations.push(`${e.effectiveDirective} ${e.blockedURI || '(inline)'}`),
    );
  });
  return () => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);
}
