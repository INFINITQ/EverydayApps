# 0001. No network code in the Rust side (spike S4)

- Status: accepted
- Date: 2026-10-29

## Context

Folio promises that documents never leave the PC. The first line of defence is that the
native side contains no networking code at all, enforced by `cargo deny check` (see
`deny.toml`) and Clippy's `disallowed-types` / `disallowed-methods` (see `clippy.toml`).

## Decision

- `deny.toml` bans HTTP, TLS, WebSocket and QUIC crates, Tauri's network/shell plugins,
  and tokio's `net` feature. The dependency graph is checked for `x86_64-pc-windows-msvc`
  only, because Tauri pulls some network crates for Android/iOS alone.
- We do **not** use `tauri-plugin-single-instance`. Its Windows implementation is a named
  mutex plus `WM_COPYDATA` (no networking), but it enables tokio's `net` feature on every
  platform because its macOS code uses a Unix socket. folio-core has its own small
  Windows-only single-instance module instead, so the tokio ban can stay strict.

## Evidence

- With the plugin: `cargo deny check` → `bans FAILED`: `feature 'net' for crate
  'tokio = 1.54.1' is explicitly denied`, enabled only by `tauri-plugin-single-instance
  v2.5.5` (`cargo tree -e features -i tokio`).
- Without it: `advisories ok, bans ok, licenses ok, sources ok`. tokio features in use:
  `bytes, default, fs, io-util, rt, rt-multi-thread, sync`.

## Consequences

- Any new dependency that brings in a network crate fails `cargo deny check`, which runs
  before every release build.
- Re-check after every Tauri upgrade: if Tauri itself starts enabling tokio `net` on
  Windows, revisit this record rather than silently relaxing the ban.
