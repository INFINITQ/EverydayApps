// The plan's budgets, measured on the hidden debug build: time until the window's content first
// paints, time until the first page of a 100-page PDF shows, and memory with that PDF open,
// then after reading it all the way through. Memory is what Task Manager counts: the private
// working set of the app and every WebView2 process it started. (The debug build's Rust side
// isn't optimized; rendering runs in WebAssembly either way.)

import { type Page, expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain ES module without types
import { makePdf } from '../tools/fixtures/make-pdf.mjs';
import { launchApp } from './app';

type Memory = { totalMb: number; processes: Record<string, number> };

/** The private working set of a process and every process it started, in MB, by kind. */
function memoryOf(pid: number): Memory {
  const script = [
    '$all = Get-CimInstance Win32_Process',
    `$ids = [System.Collections.Generic.HashSet[uint32]]::new(); [void]$ids.Add(${pid})`,
    'do { $added = $false; foreach ($p in $all) { if ($ids.Contains([uint32]$p.ParentProcessId) -and $ids.Add([uint32]$p.ProcessId)) { $added = $true } } } while ($added)',
    '$ws = @{}; Get-CimInstance Win32_PerfRawData_PerfProc_Process | ForEach-Object { $ws[[uint32]$_.IDProcess] = [uint64]$_.WorkingSetPrivate }',
    '$all | Where-Object { $ids.Contains([uint32]$_.ProcessId) } | ForEach-Object {',
    '  $kind = if ($_.CommandLine -match "--utility-sub-type=([a-zA-Z.]+)") { $matches[1] } elseif ($_.CommandLine -match "--type=([a-z-]+)") { $matches[1] } elseif ($_.Name -like "msedgewebview2*") { "webview2" } else { "app" }',
    '  "{0} {1}" -f $kind, $ws[[uint32]$_.ProcessId] }',
  ].join('\n');
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  const processes: Record<string, number> = {};
  let total = 0;
  for (const line of out.trim().split(/\r?\n/)) {
    const [kind = '?', bytes = '0'] = line.trim().split(/\s+/);
    const mb = Number(bytes) / 2 ** 20;
    total += mb;
    processes[kind] = Math.round((processes[kind] ?? 0) + mb);
  }
  return { totalMb: Math.round(total), processes };
}

/** Lets the page collect its garbage first, as it would on its own after a while. */
async function settled(page: Page, pid: number): Promise<Memory> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.detach();
  await page.waitForTimeout(2_000);
  return memoryOf(pid);
}

test('stays within its budgets with a 100-page PDF', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'folio-budget-'));
  const file = join(dir, 'long.pdf');
  writeFileSync(file, makePdf(100, 'A long document'));
  const spawned = Date.now();
  const app = await launchApp('target/debug/folio-pdf.exe', 9343);
  try {
    const { page } = app;
    // The page can be ready a moment before its first paint is recorded.
    await page.waitForFunction(
      () => performance.getEntriesByName('first-contentful-paint').length > 0,
      null,
      {
        timeout: 10_000,
      },
    );
    const painted = await page.evaluate(
      () =>
        performance.timeOrigin +
        performance.getEntriesByName('first-contentful-paint')[0]!.startTime,
    );
    const startupMs = Math.round(painted - spawned);
    const empty = await settled(page, app.pid);

    const opening = Date.now();
    expect(app.launchAgain([file])).toBe(0);
    await page.locator('.pdf-page img').first().waitFor({ state: 'visible', timeout: 20_000 });
    const firstPageMs = Date.now() - opening;
    await expect(page.getByText('Page 1 of 100', { exact: false })).toBeVisible();
    await page.waitForTimeout(1_000);
    const opened = await settled(page, app.pid);

    // Read it through, a screen at a time, so every page and thumbnail is drawn once.
    const viewport = page.locator('.pdf-viewport');
    for (let step = 0; step < 400; step++) {
      const atEnd = await viewport.evaluate((element) => {
        element.scrollBy(0, element.clientHeight);
        return element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
      });
      await page.waitForTimeout(60);
      if (atEnd) break;
    }
    await expect(page.getByText('Page 100 of 100', { exact: false })).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(1_000);
    const read = await settled(page, app.pid);

    const report =
      `startup ${startupMs} ms; first page ${firstPageMs} ms; memory: ${empty.totalMb} MB empty, ` +
      `${opened.totalMb} MB with the PDF open, ${read.totalMb} MB after reading it through ` +
      `(${JSON.stringify(read.processes)})`;
    console.log(`Budgets: ${report}`);
    test.info().annotations.push({ type: 'budgets', description: report });
    // Budgets: under 300 MB with the PDF open; the window and the first page in about a second
    // (timings get a margin: the PC may be busy with other work while tests run). Reading
    // through has no budget in the plan, and swings with WebView2's caches (350-480 MB seen);
    // this only catches it growing out of hand.
    expect(opened.totalMb).toBeLessThan(300);
    expect(read.totalMb).toBeLessThan(600);
    expect(firstPageMs).toBeLessThan(2_000);
    expect(startupMs).toBeLessThan(3_000);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
