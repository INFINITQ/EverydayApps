# 0005. WebView2's own connections to Microsoft

- Status: accepted: option 1, the "network lock" (chosen by the owner, 2026-10-29)
- Date: 2026-10-29

## Decision

Folio runs on a private WebView2 runtime that Windows Firewall blocks:

- `tools/network-lock.ps1 -Install` (run once as administrator) mirrors Windows' current
  WebView2 runtime into `C:\Program Files\Folio\WebView2Runtime\current`. It uses hard links,
  so no extra disk space while Windows keeps that version; it falls back to copying
  (~870 MB) if linking fails. Nothing is downloaded. It then adds the Windows Firewall rule
  "Folio: block private WebView2" (outbound, block, all profiles) for that copy's
  `msedgewebview2.exe`. Other apps' WebView2 is untouched.
- The folder is under Program Files on purpose: only administrators can change it, so a
  program running as the user can't swap in its own `msedgewebview2.exe`.
- `crates/folio-core/src/netlock.rs`: when the private runtime exists, the WebView2
  environment is created from it (`browserExecutableFolder`). Rust reads the firewall rule
  back through Windows' firewall API (read-only) and reports `{ privateRuntime, firewallRule,
  active }` through the `network_lock` command.
- The shell warns at startup when the lock is off or only half set up, with the command that
  fixes it. "Network lock status" is in the command palette.
- Updates: after Windows updates its WebView2, run `-Install` again (with Folio closed) to
  move Folio to the new version. `-Status` says when that's needed. This joins the monthly
  audit-and-rebuild routine.
- `-Uninstall` removes the rule and the folder; Folio falls back to the shared WebView2 and
  shows the lock as off.

## Verified (2026-10-29, after the owner ran `-Install` as administrator)

- `-Status`: private runtime WebView2 156.0.4314.50 (hard links; the exe is one file with
  four names, Microsoft's own EdgeCore folders included, so no extra disk space), and the
  rule is enabled, outbound, blocking exactly that copy's `msedgewebview2.exe`.
- End-to-end test: every `msedgewebview2.exe` of the app runs from the private copy, and the
  app's `network_lock` answer (`firewallRule`, `active`) matches Windows' real firewall
  configuration.
- `tools/check-network.ps1` on the same debug build, 45 s, 9 processes watched:
  **PASS: no network activity outside this PC.** Before the lock it always showed the two
  HTTPS connections to Microsoft described above.
- Still optional: `check-network.ps1 -Etw` from an administrator PowerShell records Windows'
  own per-process network and DNS events, which also catches connections shorter than the
  0.5 s polling interval.

## Finding

`tools/check-network.ps1` on the hidden debug build of Folio Hello (twice, 20 s and 30 s):

```
FAIL tcp 17424 msedgewebview2.exe [main] …:58886 -> 2603:1046:c04:1410::2:443 Established
FAIL tcp 17424 msedgewebview2.exe [main] …:58884 -> 2603:1046:c04:1410::2:443 Established
```

WebView2's **main browser process** keeps two HTTPS connections open to a Microsoft (Azure)
address while the app runs. Nothing else in the app's process tree touched the network.

## What it is not

- **Not Folio's code or pages.** Chromium's network log (`--log-net-log`) for the same run
  lists only `http://tauri.localhost/…` and `http://ipc.localhost/…` requests. The page's
  network APIs are blocked (see the end-to-end tests), the content policy is active, and the
  Rust side has no network code (ADR 0001).
- **Not Chromium's network stack.** Because the connections are absent from the net log, they
  don't go through Chromium at all, which is why the dead-end proxy, `--disable-background-
  networking` and the other flags (ADR 0002) don't affect them. They come from a separate
  client inside `msedgewebview2.exe`, consistent with WebView2's diagnostic data, which
  Microsoft documents as following the Windows "Diagnostics & feedback" setting, with
  "required" data always sent. Not one of ~30 known Edge/WebView2 service hostnames resolved
  into this exact block, so the endpoint isn't identified by name yet (an `-Etw` run as
  administrator, or a packet capture, would show the server name).
- **Not document content, as far as Microsoft documents it.** Required diagnostic data
  covers the runtime (version, crashes, basic reliability). Crash dumps, which *can* contain
  document text, stay on this PC (ADR 0002).

## Options

1. **Private WebView2 copy + firewall rule (most private).** Ship Microsoft's "Fixed
   Version" WebView2 runtime in one folder shared by all Folio apps (~180 MB on disk,
   once), point `BrowserExecutableFolder` at it, and add a Windows Firewall rule (one-time
   administrator prompt at install) that blocks every outbound connection from *that copy's*
   `msedgewebview2.exe`. Other apps' WebView2 (Teams, Outlook…) are unaffected. Cost: disk
   space, and runtime security updates arrive only when Folio is rebuilt (monthly, like
   the engines). The audit can then require zero connections.
2. **Keep the system WebView2 (lightest).** Accept Microsoft's diagnostic connections, set
   Windows to "Required diagnostic data" only, and document it. The audit allow-lists this
   one connection pattern and fails on anything else.
3. **Block WebView2 system-wide in the firewall.** Not recommended: it breaks every other app
   that uses WebView2.

## Consequences

Until this is decided, `check-network.ps1` keeps failing on these two connections, on
purpose. Phase 1 (the PDF app) doesn't depend on the choice; packaging (Phase 0b, step 10)
does.
