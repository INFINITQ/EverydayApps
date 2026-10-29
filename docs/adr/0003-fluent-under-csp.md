# 0003. Fluent UI under the content security policy (spike S3)

- Status: accepted
- Date: 2026-10-29

## Context

Fluent UI React v9 styles components with Griffel, which injects `<style>` tags at run time.
Tauri adds nonces/hashes to the CSP, and browsers ignore `'unsafe-inline'` once a nonce is
present, so Fluent's styles would be blocked by default.

## Decision

- `config/security.json` keeps `style-src 'self' 'unsafe-inline'` and sets
  `dangerousDisableAssetCspModification: ["style-src"]`, so Tauri leaves `style-src` alone.
  Inline *styles* can't load anything remote: images and fonts referenced from CSS are still
  limited by `img-src` / `font-src` (`'self'`, `blob:`, `data:` only). Scripts stay strict:
  `script-src 'self' 'wasm-unsafe-eval'`, no inline scripts, no `eval`.
- `freezePrototype: true` stays on; React 19 and Fluent work with it.
- Fallback, if this ever needs tightening: build-time CSS extraction with
  `@griffel/vite-plugin` plus a nonce through `createDOMRenderer`.

## Evidence (debug build with the embedded frontend, page at `http://tauri.localhost/`)

`tools/spikes/s3-fluent.mjs` drove a gallery of Fluent components over WebView2's debugging
port: Menu, Dialog, Tooltip, Dropdown, Toast, Switch, TabList, Spinner and MessageBar all
rendered and worked; switching light/dark changed the primary button from
`rgb(17, 94, 163)` to `rgb(15, 108, 189)`. The only CSP violation recorded during load and
interaction was the deliberate `fetch('https://example.com/')` probe
(`connect-src https://example.com/`), which shows the policy is active and blocks the
network.

## Consequences

- Any library that needs inline scripts or `eval` will not work and must be rejected or
  configured around (EmbedPDF and the Office engines get checked for this).
