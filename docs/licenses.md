# Third-party licenses

Made by `node tools/license-report.mjs` on 2026-10-30. It lists what the apps ship:
319 npm packages installed for production (some are only partly bundled, or not at all) and
242 Rust crates compiled into the apps (including Folio Docs' .doc converter and Folio Slides' .ppt converter, compiled to WebAssembly).
Build tools and test-only packages are left out.

`pdfium.wasm` (from `@embedpdf/pdfium`, MIT) is Google PDFium compiled to WebAssembly. PDFium is
BSD-3-Clause, and its notice ships in that package as `LICENSE.pdfium`.

Folio Docs ships two more WebAssembly files: `harfbuzz.wasm` (from `harfbuzzjs`, MIT) is the HarfBuzz text
shaper, under HarfBuzz's own MIT-style licence; `folio_doc_legacy_bg.wasm` is office_oxide (MIT OR Apache-2.0)
and the Rust crates listed below, built from source by `tools/build-doc-converter.mjs` (docs/adr/0011).

Folio Slides' `ppt.wasm` is `apps/slides/ppt-wasm` (office_oxide and its crates, listed below) compiled
to WebAssembly.

## Summary

| License | npm | Rust |
| --- | ---: | ---: |
| MIT | 245 | 39 |
| MIT OR Apache-2.0 | 0 | 126 |
| Apache-2.0 | 51 | 2 |
| Apache-2.0 OR MIT | 1 | 22 |
| Unicode-3.0 | 0 | 18 |
| Unlicense OR MIT | 0 | 8 |
| OFL-1.1 | 7 | 0 |
| ISC | 7 | 0 |
| MPL-2.0 | 1 | 5 |
| BSD-3-Clause | 2 | 2 |
| MIT/Apache-2.0 | 0 | 4 |
| 0BSD | 2 | 0 |
| Zlib | 0 | 2 |
| MIT OR Zlib OR Apache-2.0 | 0 | 2 |
| Unlicense/MIT | 0 | 2 |
| BSD-2-Clause | 1 | 0 |
| (MIT OR GPL-3.0-or-later) | 1 | 0 |
| (MIT AND Zlib) | 1 | 0 |
| 0BSD OR MIT OR Apache-2.0 | 0 | 1 |
| BSD-3-Clause AND MIT | 0 | 1 |
| BSD-3-Clause/MIT | 0 | 1 |
| Apache-2.0 AND MIT | 0 | 1 |
| CC0-1.0 OR MIT-0 OR Apache-2.0 | 0 | 1 |
| (Apache-2.0 OR MIT) AND BSD-3-Clause | 0 | 1 |
| Apache-2.0 / MIT | 0 | 1 |
| MIT OR Apache-2.0 OR Zlib | 0 | 1 |
| Zlib OR Apache-2.0 OR MIT | 0 | 1 |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 0 | 1 |

## Copyleft

These ask that changes to them be shared when the app is given to others (personal use is unaffected):

- jszip 3.10.2: (MIT OR GPL-3.0-or-later)
- mtx-decompressor 1.8.0: MPL-2.0
- cssparser 0.37.0: MPL-2.0
- cssparser-macros 0.7.1: MPL-2.0
- dtoa-short 0.3.5: MPL-2.0
- option-ext 0.2.0: MPL-2.0
- selectors 0.38.0: MPL-2.0

## npm packages

| Package | Version | License | Apps |
| --- | --- | --- | --- |
| @aiden0z/pptx-renderer | 1.4.0 | Apache-2.0 | slides |
| @babel/helper-string-parser | 7.29.11 | MIT | pdf |
| @babel/helper-validator-identifier | 7.29.7 | MIT | pdf |
| @babel/parser | 7.29.11 | MIT | pdf |
| @babel/runtime | 7.29.10 | MIT | docs, hello, pdf, sheets, slides |
| @babel/types | 7.29.11 | MIT | pdf |
| @docx-editor.dev/core | 2.32.0 | Apache-2.0 | docs |
| @docx-editor.dev/i18n | 2.32.0 | Apache-2.0 | docs |
| @docx-editor.dev/react | 2.32.0 | Apache-2.0 | docs |
| @embedpdf/core | 2.15.1 | MIT | pdf |
| @embedpdf/engines | 2.15.1 | MIT | pdf |
| @embedpdf/fonts-arabic | 1.0.0 | OFL-1.1 | pdf |
| @embedpdf/fonts-hebrew | 1.0.0 | OFL-1.1 | pdf |
| @embedpdf/fonts-jp | 1.0.0 | OFL-1.1 | pdf |
| @embedpdf/fonts-kr | 1.0.0 | OFL-1.1 | pdf |
| @embedpdf/fonts-latin | 1.0.0 | OFL-1.1 | pdf |
| @embedpdf/fonts-sc | 1.0.0 | OFL-1.1 | pdf |
| @embedpdf/fonts-tc | 1.0.0 | OFL-1.1 | pdf |
| @embedpdf/models | 2.15.1 | MIT | pdf |
| @embedpdf/pdfium | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-annotation | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-attachment | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-bookmark | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-document-manager | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-export | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-form | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-fullscreen | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-history | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-i18n | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-interaction-manager | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-pan | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-print | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-redaction | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-render | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-rotate | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-scroll | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-search | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-selection | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-signature | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-spread | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-stamp | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-thumbnail | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-tiling | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-viewport | 2.15.1 | MIT | pdf |
| @embedpdf/plugin-zoom | 2.15.1 | MIT | pdf |
| @embedpdf/utils | 2.15.1 | MIT | pdf |
| @emotion/hash | 0.9.2 | MIT | docs, hello, pdf, sheets, slides |
| @flatten-js/interval-tree | 1.1.3 | MIT | sheets |
| @floating-ui/core | 1.8.0 | MIT | docs, hello, pdf, sheets, slides |
| @floating-ui/devtools | 0.2.3 | MIT | docs, hello, pdf, sheets, slides |
| @floating-ui/dom | 1.8.0 | MIT | docs, hello, pdf, sheets, slides |
| @floating-ui/react-dom | 2.1.9 | MIT | docs, sheets |
| @floating-ui/utils | 0.2.12 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/keyboard-keys | 9.0.9 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/priority-overflow | 9.4.3 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-accordion | 9.12.5 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-alert | 9.0.2-beta.1 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-aria | 9.17.16 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-avatar | 9.11.9 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-badge | 9.5.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-breadcrumb | 9.4.8 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-button | 9.11.3 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-card | 9.7.4 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-carousel | 9.9.16 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-checkbox | 9.6.6 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-color-picker | 9.3.3 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-combobox | 9.17.8 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-components | 9.74.11 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-context-selector | 9.2.21 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-dialog | 9.18.6 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-divider | 9.7.6 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-drawer | 9.13.5 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-field | 9.5.6 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-icons | 2.0.344 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-image | 9.4.6 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-infobutton | 9.0.1-beta.1 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-infolabel | 9.4.28 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-input | 9.8.8 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-jsx-runtime | 9.4.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-label | 9.4.6 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-link | 9.8.6 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-list | 9.7.0 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-menu | 9.25.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-message-bar | 9.7.9 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-motion | 9.16.5 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-motion-components-preview | 0.15.10 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-nav | 9.4.9 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-overflow | 9.9.5 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-persona | 9.7.11 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-popover | 9.14.10 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-portal | 9.8.17 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-positioning | 9.23.4 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-progress | 9.5.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-provider | 9.22.22 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-radio | 9.6.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-rating | 9.4.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-search | 9.4.8 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-select | 9.5.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-shared-contexts | 9.26.4 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-skeleton | 9.7.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-slider | 9.6.8 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-spinbutton | 9.6.8 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-spinner | 9.8.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-swatch-picker | 9.6.3 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-switch | 9.7.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-table | 9.19.23 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-tabs | 9.12.6 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-tabster | 9.26.19 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-tag-picker | 9.10.6 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-tags | 9.9.8 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-teaching-popover | 9.7.9 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-text | 9.6.21 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-textarea | 9.7.8 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-theme | 9.2.2 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-toast | 9.8.5 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-toolbar | 9.8.7 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-tooltip | 9.10.8 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-tree | 9.16.10 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-utilities | 9.27.0 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/react-virtualizer | 9.0.0-alpha.116 | MIT | docs, hello, pdf, sheets, slides |
| @fluentui/tokens | 1.0.0-alpha.24 | MIT | docs, hello, pdf, sheets, slides |
| @griffel/core | 1.21.4 | MIT | docs, hello, pdf, sheets, slides |
| @griffel/react | 1.7.8 | MIT | docs, hello, pdf, sheets, slides |
| @griffel/style-types | 1.4.3 | MIT | docs, hello, pdf, sheets, slides |
| @jridgewell/gen-mapping | 0.3.13 | MIT | pdf |
| @jridgewell/remapping | 2.3.5 | MIT | pdf |
| @jridgewell/resolve-uri | 3.1.2 | MIT | pdf |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | pdf |
| @jridgewell/trace-mapping | 0.3.31 | MIT | pdf |
| @napi-rs/canvas | 1.0.13 | MIT | slides |
| @napi-rs/canvas-linux-x64-gnu | 1.0.13 | MIT | slides |
| @nodable/entities | 3.1.0 | MIT | docs |
| @radix-ui/number | 1.1.3 | MIT | docs |
| @radix-ui/primitive | 1.2.0 | MIT | docs, sheets |
| @radix-ui/react-arrow | 1.1.17 | MIT | docs, sheets |
| @radix-ui/react-collection | 1.2.0 | MIT | docs, sheets |
| @radix-ui/react-compose-refs | 1.1.5 | MIT | docs, sheets |
| @radix-ui/react-context | 1.3.0 | MIT | docs, sheets |
| @radix-ui/react-dialog | 1.3.1 | MIT | sheets |
| @radix-ui/react-direction | 1.2.0 | MIT | docs, sheets |
| @radix-ui/react-dismissable-layer | 1.2.1 | MIT | docs, sheets |
| @radix-ui/react-dropdown-menu | 2.2.1 | MIT | sheets |
| @radix-ui/react-focus-guards | 1.2.0 | MIT | docs, sheets |
| @radix-ui/react-focus-scope | 1.3.1 | MIT | docs, sheets |
| @radix-ui/react-hover-card | 1.2.1 | MIT | sheets |
| @radix-ui/react-id | 1.1.4 | MIT | docs, sheets |
| @radix-ui/react-menu | 2.2.1 | MIT | sheets |
| @radix-ui/react-popover | 1.3.1 | MIT | sheets |
| @radix-ui/react-popper | 1.4.0 | MIT | docs, sheets |
| @radix-ui/react-portal | 1.2.0 | MIT | docs, sheets |
| @radix-ui/react-presence | 1.1.11 | MIT | docs, sheets |
| @radix-ui/react-primitive | 2.2.0 | MIT | docs, sheets |
| @radix-ui/react-roving-focus | 1.2.1 | MIT | sheets |
| @radix-ui/react-select | 2.4.1 | MIT | docs |
| @radix-ui/react-separator | 1.2.0 | MIT | sheets |
| @radix-ui/react-slot | 1.5.0 | MIT | docs, sheets |
| @radix-ui/react-use-callback-ref | 1.1.5 | MIT | docs, sheets |
| @radix-ui/react-use-controllable-state | 1.3.0 | MIT | docs, sheets |
| @radix-ui/react-use-effect-event | 0.0.5 | MIT | docs, sheets |
| @radix-ui/react-use-is-hydrated | 0.1.3 | MIT | sheets |
| @radix-ui/react-use-layout-effect | 1.1.4 | MIT | docs, sheets |
| @radix-ui/react-use-rect | 1.1.4 | MIT | docs, sheets |
| @radix-ui/react-use-size | 1.1.5 | MIT | docs, sheets |
| @radix-ui/react-visually-hidden | 1.2.13 | MIT | docs |
| @radix-ui/rect | 1.1.3 | MIT | docs, sheets |
| @sveltejs/acorn-typescript | 1.0.13 | MIT | pdf |
| @swc/helpers | 0.5.23 | Apache-2.0 | docs, hello, pdf, sheets, slides |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT | docs, hello, pdf, sheets, slides |
| @types/estree | 1.0.9 | MIT | pdf |
| @types/react | 19.3.0 | MIT | docs, hello, pdf, sheets, slides |
| @types/react-dom | 19.3.0 | MIT | docs, sheets |
| @typescript-eslint/types | 8.72.0 | MIT | pdf |
| @univerjs/core | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/data-validation | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/design | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/docs | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/docs-drawing | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/docs-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/drawing | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/drawing-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/engine-formula | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/engine-render | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/find-replace | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/icons | 1.46.0 | MIT | sheets |
| @univerjs/protocol | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/rpc | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-conditional-formatting | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-conditional-formatting-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-data-validation | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-data-validation-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-drawing | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-drawing-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-filter | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-filter-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-find-replace | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-formula | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-formula-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-numfmt | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-numfmt-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-sort | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-sort-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-thread-comment | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-thread-comment-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/sheets-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/telemetry | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/themes | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/thread-comment | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/thread-comment-ui | 1.2.0 | Apache-2.0 | sheets |
| @univerjs/ui | 1.2.0 | Apache-2.0 | sheets |
| @vue/compiler-core | 3.5.44 | MIT | pdf |
| @vue/compiler-dom | 3.5.44 | MIT | pdf |
| @vue/compiler-sfc | 3.5.44 | MIT | pdf |
| @vue/compiler-ssr | 3.5.44 | MIT | pdf |
| @vue/reactivity | 3.5.44 | MIT | pdf |
| @vue/runtime-core | 3.5.44 | MIT | pdf |
| @vue/runtime-dom | 3.5.44 | MIT | pdf |
| @vue/server-renderer | 3.5.44 | MIT | pdf |
| @vue/shared | 3.5.44 | MIT | pdf |
| @wendellhu/redi | 1.1.3 | MIT | sheets |
| acorn | 8.19.0 | MIT | pdf |
| anynum | 1.0.1 | MIT | docs |
| aria-hidden | 1.2.6 | MIT | docs, sheets |
| aria-query | 5.3.1 | Apache-2.0 | pdf |
| async-lock | 1.4.1 | MIT | sheets |
| axobject-query | 4.1.0 | Apache-2.0 | pdf |
| bidi-js | 1.1.0 | MIT | docs |
| class-variance-authority | 0.7.1 | Apache-2.0 | docs, sheets |
| clsx | 2.1.1 | MIT | docs, pdf, sheets |
| cmdk | 1.1.1 | MIT | sheets |
| collapse-white-space | 2.1.0 | MIT | sheets |
| core-util-is | 1.0.3 | MIT | slides |
| csstype | 3.2.3 | MIT | docs, hello, pdf, sheets, slides |
| decimal.js | 10.6.0 | MIT | sheets |
| detect-node-es | 1.1.0 | MIT | docs, sheets |
| devalue | 5.9.4 | MIT | pdf |
| echarts | 6.1.0 | Apache-2.0 | sheets, slides |
| embla-carousel | 8.6.0 | MIT | docs, hello, pdf, sheets, slides |
| embla-carousel-autoplay | 8.6.0 | MIT | docs, hello, pdf, sheets, slides |
| embla-carousel-fade | 8.6.0 | MIT | docs, hello, pdf, sheets, slides |
| emf-converter | 2.0.2 | Apache-2.0 | docs |
| entities | 7.0.1 | BSD-2-Clause | pdf |
| esm-env | 1.2.2 | MIT | pdf |
| esrap | 2.4.0 | MIT | pdf |
| estree-walker | 2.0.2 | MIT | pdf |
| fast-diff | 1.3.0 | Apache-2.0 | sheets |
| fast-xml-builder | 1.3.1 | MIT | docs |
| fast-xml-parser | 5.11.2 | MIT | docs |
| fflate | 0.8.2 | MIT | docs, sheets |
| franc-min | 6.2.0 | MIT | sheets |
| get-nonce | 1.0.1 | MIT | docs, sheets |
| harfbuzzjs | 1.6.1 | MIT | docs |
| immediate | 3.0.6 | MIT | slides |
| inherits | 2.0.4 | ISC | slides |
| is-reference | 3.0.3 | MIT | pdf |
| is-unsafe | 2.0.2 | MIT | docs |
| isarray | 1.0.0 | MIT | slides |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) | slides |
| kdbush | 4.1.0 | ISC | sheets |
| keyborg | 3.498.0 | MIT | docs, hello, pdf, sheets, slides |
| lie | 3.3.0 | MIT | slides |
| locate-character | 3.0.0 | MIT | pdf |
| lodash-es | 4.18.1 | MIT | sheets |
| magic-string | 0.30.21 | MIT | pdf |
| mtx-decompressor | 1.8.0 | MPL-2.0 | slides |
| n-gram | 2.0.2 | MIT | sheets |
| nanoid | 3.3.20 | MIT | pdf |
| orderedmap | 2.1.1 | MIT | docs |
| ot-json1 | 1.0.2 | ISC | sheets |
| ot-text-unicode | 4.0.0 | ISC | sheets |
| pako | 1.0.11 | (MIT AND Zlib) | docs, slides |
| path-expression-matcher | 1.6.2 | MIT | docs |
| pdfjs-dist | 6.4.299 | Apache-2.0 | slides |
| picocolors | 1.1.1 | ISC | pdf |
| postcss | 8.5.31 | MIT | pdf |
| preact | 10.29.8 | MIT | pdf |
| process-nextick-args | 2.0.1 | MIT | slides |
| prosemirror-commands | 1.7.2 | MIT | docs |
| prosemirror-keymap | 1.2.3 | MIT | docs |
| prosemirror-model | 1.25.12 | MIT | docs |
| prosemirror-state | 1.4.4 | MIT | docs |
| prosemirror-transform | 1.12.4 | MIT | docs |
| prosemirror-view | 1.42.8 | MIT | docs |
| quickselect | 3.0.0 | ISC | sheets |
| rbush | 4.0.1 | MIT | sheets |
| react | 19.3.1 | MIT | docs, hello, pdf, sheets, slides |
| react-dom | 19.3.1 | MIT | docs, hello, pdf, sheets, slides |
| react-remove-scroll | 2.7.2 | MIT | docs, sheets |
| react-remove-scroll-bar | 2.3.8 | MIT | docs, sheets |
| react-style-singleton | 2.2.3 | MIT | docs, sheets |
| readable-stream | 2.3.8 | MIT | slides |
| require-from-string | 2.0.2 | MIT | docs |
| rtl-css-js | 1.16.1 | MIT | docs, hello, pdf, sheets, slides |
| rxjs | 7.8.2 | Apache-2.0 | sheets |
| safe-buffer | 5.1.2 | MIT | slides |
| scheduler | 0.28.0 | MIT | docs, hello, pdf, sheets, slides |
| setimmediate | 1.0.5 | MIT | slides |
| sonner | 2.0.8 | MIT | sheets |
| source-map-js | 1.2.2 | BSD-3-Clause | pdf |
| string_decoder | 1.1.1 | MIT | slides |
| strnum | 2.5.1 | MIT | docs |
| stylis | 4.4.0 | MIT | docs, hello, pdf, sheets, slides |
| svelte | 5.57.2 | MIT | pdf |
| tabster | 8.8.1 | MIT | docs, hello, pdf, sheets, slides |
| trigram-utils | 2.0.1 | MIT | sheets |
| tslib | 2.3.0 | 0BSD | sheets, slides |
| tslib | 2.8.1 | 0BSD | docs, hello, pdf, sheets, slides |
| typescript | 6.0.3 | Apache-2.0 | pdf |
| unicount | 1.1.0 | ISC | sheets |
| use-callback-ref | 1.3.3 | MIT | docs, sheets |
| use-sidecar | 1.1.3 | MIT | docs, sheets |
| use-sync-external-store | 1.7.0 | MIT | docs, hello, pdf, sheets, slides |
| utif2 | 4.1.0 | MIT | docs |
| util-deprecate | 1.0.2 | MIT | slides |
| vue | 3.5.44 | MIT | pdf |
| w3c-keyname | 2.2.8 | MIT | docs |
| xml-naming | 0.3.0 | MIT | docs |
| zimmerframe | 1.1.5 | MIT | pdf |
| zrender | 6.1.0 | BSD-3-Clause | sheets, slides |

## Rust crates

| Crate | Version | License |
| --- | --- | --- |
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| aho-corasick | 1.1.5 | Unlicense OR MIT |
| alloc-no-stdlib | 3.0.0 | BSD-3-Clause |
| alloc-stdlib | 0.3.0 | BSD-3-Clause |
| anyhow | 1.0.104 | MIT OR Apache-2.0 |
| atoi_simd | 0.18.1 | MIT OR Apache-2.0 |
| base64 | 0.23.1 | MIT OR Apache-2.0 |
| bit-set | 0.8.0 | Apache-2.0 OR MIT |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT |
| bitflags | 1.3.2 | MIT/Apache-2.0 |
| bitflags | 2.13.2 | MIT OR Apache-2.0 |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 |
| brotli | 9.1.1 | BSD-3-Clause AND MIT |
| brotli-decompressor | 6.2.0 | BSD-3-Clause/MIT |
| bs58 | 0.5.1 | MIT/Apache-2.0 |
| bumpalo | 3.20.3 | MIT OR Apache-2.0 |
| byteorder | 1.5.0 | Unlicense OR MIT |
| bytes | 1.12.1 | MIT |
| camino | 1.2.6 | MIT OR Apache-2.0 |
| cargo_metadata | 0.19.2 | MIT |
| cargo-platform | 0.1.9 | MIT OR Apache-2.0 |
| cfb | 0.14.0 | MIT |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 |
| chrono | 0.4.45 | MIT OR Apache-2.0 |
| cookie | 0.18.2 | MIT OR Apache-2.0 |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 |
| crc32fast | 1.5.3 | MIT OR Apache-2.0 |
| crossbeam-channel | 0.5.17 | MIT OR Apache-2.0 |
| crossbeam-utils | 0.8.23 | MIT OR Apache-2.0 |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 |
| cssparser | 0.37.0 | MPL-2.0 |
| cssparser-macros | 0.7.1 | MPL-2.0 |
| ctor | 1.0.13 | Apache-2.0 OR MIT |
| darling | 0.24.1 | MIT |
| darling_core | 0.24.1 | MIT |
| darling_macro | 0.24.1 | MIT |
| debug_unsafe | 0.1.4 | MIT OR Apache-2.0 |
| defmt | 1.2.0 | MIT OR Apache-2.0 |
| defmt-macros | 1.2.0 | MIT OR Apache-2.0 |
| defmt-parser | 1.1.0 | MIT OR Apache-2.0 |
| deranged | 0.5.9 | MIT OR Apache-2.0 |
| derive_more | 2.1.1 | MIT |
| derive_more-impl | 2.1.1 | MIT |
| digest | 0.10.7 | MIT OR Apache-2.0 |
| dirs | 7.0.0 | MIT OR Apache-2.0 |
| dirs-sys | 0.5.0 | MIT OR Apache-2.0 |
| displaydoc | 0.2.7 | MIT OR Apache-2.0 |
| dom_query | 0.28.0 | MIT |
| dpi | 0.1.2 | Apache-2.0 AND MIT |
| dtoa | 1.0.11 | MIT OR Apache-2.0 |
| dtoa-short | 0.3.5 | MPL-2.0 |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| dyn-clone | 1.0.20 | MIT OR Apache-2.0 |
| encoding_rs | 0.8.42 | (Apache-2.0 OR MIT) AND BSD-3-Clause |
| equivalent | 1.0.3 | Apache-2.0 OR MIT |
| erased-serde | 0.4.11 | MIT OR Apache-2.0 |
| fast-float2 | 0.2.4 | MIT OR Apache-2.0 |
| fastrand | 2.5.0 | Apache-2.0 OR MIT |
| fdeflate | 0.3.7 | MIT OR Apache-2.0 |
| flate2 | 1.1.10 | MIT OR Apache-2.0 |
| fnv | 1.0.7 | Apache-2.0 / MIT |
| foldhash | 0.2.0 | Zlib |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 |
| generic-array | 0.14.7 | MIT |
| getrandom | 0.3.4 | MIT OR Apache-2.0 |
| getrandom | 0.4.3 | MIT OR Apache-2.0 |
| glob | 0.3.4 | MIT OR Apache-2.0 |
| hashbrown | 0.12.3 | MIT OR Apache-2.0 |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 |
| heck | 0.5.0 | MIT OR Apache-2.0 |
| hex | 0.4.3 | MIT OR Apache-2.0 |
| html5ever | 0.39.0 | MIT OR Apache-2.0 |
| http | 1.5.0 | MIT OR Apache-2.0 |
| ico | 0.6.0 | MIT |
| icu_collections | 2.4.0 | Unicode-3.0 |
| icu_locale_core | 2.4.0 | Unicode-3.0 |
| icu_normalizer | 2.4.0 | Unicode-3.0 |
| icu_normalizer_data | 2.4.0 | Unicode-3.0 |
| icu_properties | 2.4.0 | Unicode-3.0 |
| icu_properties_data | 2.4.0 | Unicode-3.0 |
| icu_provider | 2.4.0 | Unicode-3.0 |
| ident_case | 1.0.1 | MIT/Apache-2.0 |
| idna | 1.1.0 | MIT OR Apache-2.0 |
| idna_adapter | 1.2.2 | Apache-2.0 OR MIT |
| indexmap | 1.9.3 | Apache-2.0 OR MIT |
| indexmap | 2.14.2 | Apache-2.0 OR MIT |
| infer | 0.22.0 | MIT |
| itoa | 1.0.18 | MIT OR Apache-2.0 |
| jiff | 0.2.38 | Unlicense OR MIT |
| jiff-core | 0.1.1 | Unlicense OR MIT |
| jiff-tzdb | 0.1.9 | Unlicense OR MIT |
| jiff-tzdb-platform | 0.1.3 | Unlicense OR MIT |
| json-patch | 4.2.0 | MIT/Apache-2.0 |
| jsonptr | 0.7.1 | MIT OR Apache-2.0 |
| keyboard-types | 0.8.3 | MIT OR Apache-2.0 |
| libc | 0.2.191 | MIT OR Apache-2.0 |
| litemap | 0.8.3 | Unicode-3.0 |
| lock_api | 0.4.14 | MIT OR Apache-2.0 |
| log | 0.4.34 | MIT OR Apache-2.0 |
| markup5ever | 0.39.0 | MIT OR Apache-2.0 |
| memchr | 2.8.3 | Unlicense OR MIT |
| mime | 0.3.17 | MIT OR Apache-2.0 |
| miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 |
| miniz_oxide | 0.9.1 | MIT OR Zlib OR Apache-2.0 |
| mio | 1.2.4 | MIT |
| muda | 0.20.0 | Apache-2.0 OR MIT |
| multiversion_no_op | 1.0.0 | Apache-2.0 OR MIT |
| new_debug_unreachable | 1.0.6 | MIT |
| num-conv | 0.2.2 | MIT OR Apache-2.0 |
| num-traits | 0.2.19 | MIT OR Apache-2.0 |
| office_oxide | 0.1.15 | MIT OR Apache-2.0 |
| once_cell | 1.21.4 | MIT OR Apache-2.0 |
| option-ext | 0.2.0 | MPL-2.0 |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 |
| phf | 0.13.1 | MIT |
| phf_generator | 0.13.1 | MIT |
| phf_macros | 0.13.1 | MIT |
| phf_shared | 0.13.1 | MIT |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT |
| plist | 1.10.3 | MIT |
| png | 0.18.1 | MIT OR Apache-2.0 |
| potential_utf | 0.1.6 | Unicode-3.0 |
| powerfmt | 0.2.1 | MIT OR Apache-2.0 |
| precomputed-hash | 0.1.1 | MIT |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 |
| quick-xml | 0.42.0 | MIT |
| quote | 1.0.47 | MIT OR Apache-2.0 |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib |
| ref-cast | 1.0.27 | MIT OR Apache-2.0 |
| ref-cast-impl | 1.0.27 | MIT OR Apache-2.0 |
| regex | 1.13.1 | MIT OR Apache-2.0 |
| regex-automata | 0.4.18 | MIT OR Apache-2.0 |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 |
| rfd | 0.17.2 | MIT |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT |
| rustversion | 1.0.23 | MIT OR Apache-2.0 |
| same-file | 1.0.6 | Unlicense/MIT |
| schemars | 0.8.22 | MIT |
| schemars | 0.9.0 | MIT |
| schemars | 1.2.3 | MIT |
| schemars_derive | 0.8.22 | MIT |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 |
| selectors | 0.38.0 | MPL-2.0 |
| semver | 1.0.28 | MIT OR Apache-2.0 |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_core | 1.0.229 | MIT OR Apache-2.0 |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 |
| serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 |
| serde_json | 1.0.154 | MIT OR Apache-2.0 |
| serde_repr | 0.1.21 | MIT OR Apache-2.0 |
| serde_spanned | 1.1.2 | MIT OR Apache-2.0 |
| serde_with | 3.24.0 | MIT OR Apache-2.0 |
| serde_with_macros | 3.24.0 | MIT OR Apache-2.0 |
| serde-untagged | 0.1.9 | MIT OR Apache-2.0 |
| serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 |
| serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 |
| servo_arc | 0.4.3 | MIT OR Apache-2.0 |
| sha2 | 0.10.9 | MIT OR Apache-2.0 |
| simd-adler32 | 0.3.10 | MIT |
| siphasher | 1.0.4 | MIT OR Apache-2.0 |
| smallvec | 1.16.4 | MIT OR Apache-2.0 |
| socket2 | 0.6.5 | MIT OR Apache-2.0 |
| softbuffer | 0.4.8 | MIT OR Apache-2.0 |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 |
| string_cache | 0.9.0 | MIT OR Apache-2.0 |
| strsim | 0.11.1 | MIT |
| syn | 2.0.119 | MIT OR Apache-2.0 |
| syn | 3.0.9 | MIT OR Apache-2.0 |
| synstructure | 0.14.0 | MIT |
| tao | 0.37.2 | Apache-2.0 |
| tauri | 2.12.5 | Apache-2.0 OR MIT |
| tauri-codegen | 2.7.4 | Apache-2.0 OR MIT |
| tauri-macros | 2.7.4 | Apache-2.0 OR MIT |
| tauri-runtime | 2.12.2 | Apache-2.0 OR MIT |
| tauri-runtime-wry | 2.12.3 | Apache-2.0 OR MIT |
| tauri-utils | 2.10.2 | Apache-2.0 OR MIT |
| tendril | 0.5.1 | MIT OR Apache-2.0 |
| thiserror | 2.0.21 | MIT OR Apache-2.0 |
| thiserror-impl | 2.0.21 | MIT OR Apache-2.0 |
| time | 0.3.55 | MIT OR Apache-2.0 |
| time-core | 0.1.9 | MIT OR Apache-2.0 |
| time-macros | 0.2.32 | MIT OR Apache-2.0 |
| tinystr | 0.8.5 | Unicode-3.0 |
| tinyvec | 1.13.3 | Zlib OR Apache-2.0 OR MIT |
| tokio | 1.54.1 | MIT |
| toml | 1.1.8+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_datetime | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_parser | 1.1.5+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_writer | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 |
| tracing | 0.1.44 | MIT |
| tracing-core | 0.1.36 | MIT |
| tray-icon | 0.25.1 | MIT OR Apache-2.0 |
| typed-path | 0.13.0 | MIT OR Apache-2.0 |
| typeid | 1.0.3 | MIT OR Apache-2.0 |
| typenum | 1.20.1 | MIT OR Apache-2.0 |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 |
| url | 2.5.8 | MIT OR Apache-2.0 |
| urlpattern | 0.6.0 | MIT |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT |
| uuid | 1.29.0 | Apache-2.0 OR MIT |
| walkdir | 2.5.0 | Unlicense/MIT |
| wasm-bindgen | 0.2.129 | MIT OR Apache-2.0 |
| wasm-bindgen-macro | 0.2.129 | MIT OR Apache-2.0 |
| wasm-bindgen-macro-support | 0.2.129 | MIT OR Apache-2.0 |
| wasm-bindgen-shared | 0.2.129 | MIT OR Apache-2.0 |
| web_atoms | 0.2.6 | MIT OR Apache-2.0 |
| web-time | 1.1.0 | MIT OR Apache-2.0 |
| webview2-com | 0.39.1 | MIT |
| webview2-com-macros | 0.8.1 | MIT |
| webview2-com-sys | 0.39.1 | MIT |
| winapi-util | 0.1.11 | Unlicense OR MIT |
| window-vibrancy | 0.8.1 | Apache-2.0 OR MIT |
| windows | 0.62.2 | MIT OR Apache-2.0 |
| windows-collections | 0.3.2 | MIT OR Apache-2.0 |
| windows-core | 0.62.2 | MIT OR Apache-2.0 |
| windows-future | 0.3.2 | MIT OR Apache-2.0 |
| windows-implement | 0.60.2 | MIT OR Apache-2.0 |
| windows-interface | 0.59.3 | MIT OR Apache-2.0 |
| windows-link | 0.2.1 | MIT OR Apache-2.0 |
| windows-numerics | 0.3.1 | MIT OR Apache-2.0 |
| windows-result | 0.4.1 | MIT OR Apache-2.0 |
| windows-strings | 0.5.1 | MIT OR Apache-2.0 |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 |
| windows-threading | 0.2.1 | MIT OR Apache-2.0 |
| windows-version | 0.1.7 | MIT OR Apache-2.0 |
| winnow | 1.0.4 | MIT |
| writeable | 0.6.4 | Unicode-3.0 |
| wry | 0.57.1 | Apache-2.0 OR MIT |
| yoke | 0.8.4 | Unicode-3.0 |
| yoke-derive | 0.8.4 | Unicode-3.0 |
| zerofrom | 0.1.8 | Unicode-3.0 |
| zerofrom-derive | 0.1.8 | Unicode-3.0 |
| zerotrie | 0.2.5 | Unicode-3.0 |
| zerovec | 0.11.9 | Unicode-3.0 |
| zerovec-derive | 0.11.7 | Unicode-3.0 |
| zip | 9.1.3 | MIT |
| zlib-rs | 0.6.8 | Zlib |
| zmij | 1.0.23 | MIT |
| zopfli | 0.8.4 | Apache-2.0 |
