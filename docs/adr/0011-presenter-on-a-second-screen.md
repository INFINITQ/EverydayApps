# 0011. Presenter view on two screens: an audience window with no IPC, fed over a BroadcastChannel

- Status: accepted (Windows hand check pending)
- Date: 2026-10-29

## Context

Folio Slides' presenter view (current and next slide, notes, timer) first ran in the main
window only. With a projector or a second monitor, the audience should see just the
slides while the presenter keeps the presenter view. That needs a second window, which
the shared core didn't have, and the plan asked to keep new Tauri commands to a minimum.

## Decision

- One new core command, `presenter_screen(open)` (`crates/folio-core/src/window.rs`,
  `audience`): it opens a full-screen window labelled `audience` on a monitor other than the
  main window's (or closes it), and resolves false when there is no second monitor. The
  window loads the app's own page with `#audience`, built like the main window (same
  WebView2 environment and flags, InPrivate, no autofill, no zoom keys, the same
  initialization script, pop-ups and downloads refused, `webview2::harden`). It closes
  when the main window goes away.
- **The audience window has no IPC permissions:** no capability names it, so it can't call
  any command or read any file. Apps opt in through `DocHost.presenterScreen` (optional).
- The main window sends it the deck (the current package's bytes, once) and each slide
  change over a `BroadcastChannel` (same origin only: the two windows are the same app
  page). Keys pressed while the audience window has the focus (a clicker sends them to
  whichever window is in front) come back the same way.
- Without a second screen nothing changes: the presenter view stays in the main window.

## Evidence

- `cargo check` and `cargo clippy -D warnings` for `x86_64-pc-windows-msvc` pass (Linux).
- In Chromium, the harness page and the audience page run side by side: Alt+F5 opens the
  "second screen" (the fake backend says one is there), the audience page shows the first
  slide, follows Next, a Page Down pressed on the audience page moves the show (skipping a
  hidden slide), and Esc ends it, closing the window.

## Consequences

- Not run on Windows yet: whether two WebView2 windows from the same environment share the
  BroadcastChannel (they share the InPrivate profile, so they should) and how the window
  lands on the projector must be checked by hand. If the channel didn't connect, the
  audience window would say "Waiting for the presentation…" and the presenter view would
  still work in the main window.
- Docs and Sheets don't use it; the command is part of `folio:default` like the others.
