# 0002. Folio creates its own WebView2 environment (spike S2)

- Status: accepted
- Date: 2026-10-29

## Context

By default WebView2 uploads crash dumps to Microsoft, and a dump can contain document text
from memory. Tauri (wry 0.57) creates the WebView2 environment itself and never sets
`IsCustomCrashReportingEnabled`, and it exposes no switch for browser shortcuts or the
default context menu.

## Decision

- `crates/folio-core/src/webview2.rs` creates the environment with
  `CreateCoreWebView2EnvironmentWithOptions` and hands it to Tauri through
  `WebviewWindowBuilder::with_environment` (available on Windows in Tauri 2.12). No patch
  of Tauri or wry is needed.
- Environment options: crash dumps kept local, browser extensions off, no single sign-on
  with the Windows account, exclusive data folder, tracking prevention on, Fluent overlay
  scrollbars, and our own browser flags (`BROWSER_ARGS`), including a dead-end proxy
  (`--proxy-server=http://127.0.0.1:9`).
- Because the environment is ours, Tauri's own flags, proxy and language settings no longer
  apply; everything lives in `webview2.rs`. wry still applies InPrivate mode and its
  per-webview settings, and already enables CSS `app-region: drag` support.
- After the webview exists, `harden()` turns off browser shortcuts, the default context menu,
  zoom, pinch zoom, swipe navigation, autofill, password saving and reputation checks, and
  denies every permission request. Old crash dumps are deleted at startup.
- COM must be initialised on the main thread before creating the environment (Tauri only
  does it when it builds a webview).

## Evidence (debug build, 2026-10-29)

- Browser process command line contains exactly our flags (plus the overlay-scrollbar flag
  from the scrollbar option, and `--remote-debugging-port` from the test's env variable).
- Privacy probes in dev mode, where Tauri applies no content policy because Vite serves the
  page: `fetch`, remote image and WebSocket fail (they reach only the dead-end proxy);
  `window.open` and navigating away are blocked by the Rust guards; WebRTC is removed.
- F5, Ctrl+R and Ctrl+F5 sent with SendKeys did not reload the page (a marker set in the
  page survived). **Unconfirmed:** the PC was in active use, so the keys may have gone to
  another foreground window. Confirm by hand, and the smoke test reads the WebView2
  settings back instead of simulating keys.
- Crashing the renderer (`Page.crash`) wrote
  `…\EBWebView\Crashpad\reports\<id>.dmp` locally.
- 90 s of polling `Get-NetTCPConnection` / `Get-NetUDPEndpoint` for the app and all its
  `msedgewebview2.exe` processes: only loopback traffic (Vite dev server, debugging port).
  Three `TimeWait` sockets owned by PID 0 were machine-wide leftovers from other programs
  that matched because the script briefly had no app PID during a restart; the real audit
  tool excludes PID 0.

## Not done

- No control run without `IsCustomCrashReportingEnabled`: it would deliberately upload a
  dump (with this PC's user name in paths) to Microsoft. The evidence is the local dump, the
  documented behaviour of the option, and no observed connections.
- Polling can miss very short connections. `tools/check-network.ps1 -Etw` (admin) records
  Windows' own per-process network and DNS events and is the definitive check.

## Consequences

- Any future Tauri upgrade must be checked against `webview2.rs`: if Tauri starts applying
  new defaults in its own environment creation, we have to copy them here.
