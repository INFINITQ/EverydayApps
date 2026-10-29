# 0004. Snap Layouts with tabs in the title bar (spike S1)

- Status: accepted, pending a hand check of the flyout
- Date: 2026-10-29

## Context

Folio draws its own title bar (tabs live in it, like Notepad and File Explorer). Windows 11
shows the Snap Layouts flyout only when the window under the cursor answers `WM_NCHITTEST`
with `HTMAXBUTTON`. Over an HTML button, that window is WebView2's, which we can't change.

## Decision

`crates/folio-core/src/caption.rs` creates a small native child window
(`WS_CHILD | WS_CLIPSIBLINGS`, no extended styles, class `FolioSnapButton`, title
"Maximize" for Narrator) exactly over the HTML maximize button:

- It never paints, so the HTML button shows through.
- It answers `WM_NCHITTEST` with `HTMAXBUTTON`, toggles maximize on `WM_NCLBUTTONUP`, and
  emits `folio://caption` events (`enter` / `leave` / `press` / `release`) so the HTML
  button can show hover and pressed states (its own `:hover` no longer fires).
- The UI reports the button's position in CSS pixels (distance from the right edge, top,
  size) through `caption_maximize_rect`; Rust converts with the window's scale factor and
  repositions on every resize and DPI change.
- Minimum window width stays at 480 px (Windows needs ≤ 500 for snapping to work).

## Evidence

`tools/spikes/s1-snap.ps1` against the debug build: the overlay exists, sits over the
HTML button (46 × 40 at 100 % scaling), is the window under the button's centre, and
answers `WM_NCHITTEST` with `HTMAXBUTTON` (9).

Not yet confirmed: the flyout itself. Simulated hovers can't be trusted while the PC is in
use (another app was in front), and simulated input would disturb whoever is using it.
**Hand check:** hover the maximize button of Folio Hello for a second; the Snap Layouts
flyout should appear; clicking a zone should snap the window. Repeat at 150 % scaling.

## Lessons

- `Process.MainWindowHandle` can point at Tauri's hidden event-loop window
  ("Tao Thread Event Target"); find the window by class `Tauri Window`.
- Don't put layout classes on `FluentProvider`: Fluent copies its className onto the
  portal container it appends to `<body>` (z-index 1000000), which then covers the page.

## Fallback

If the hand check fails: keep native window decorations and put the tab strip directly
under the native title bar (`decorations: true`, drop `caption.rs`).
