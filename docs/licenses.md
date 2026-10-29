# Third-party licenses

Made by `node tools/license-report.mjs` on 2026-10-29. It lists what the apps ship:
172 npm packages installed for production (some are only partly bundled, or not at all) and
227 Rust crates compiled into the apps. Build tools and test-only packages are left out.

`pdfium.wasm` (from `@embedpdf/pdfium`, MIT) is Google PDFium compiled to WebAssembly. PDFium is
BSD-3-Clause, and its notice ships in that package as `LICENSE.pdfium`.

## Summary

| License | npm | Rust |
| --- | ---: | ---: |
| MIT | 156 | 38 |
| MIT OR Apache-2.0 | 0 | 115 |
| Apache-2.0 OR MIT | 1 | 21 |
| Unicode-3.0 | 0 | 18 |
| Unlicense OR MIT | 0 | 8 |
| OFL-1.1 | 7 | 0 |
| Apache-2.0 | 4 | 1 |
| MPL-2.0 | 0 | 5 |
| MIT/Apache-2.0 | 0 | 4 |
| BSD-3-Clause | 1 | 2 |
| Zlib | 0 | 2 |
| MIT OR Zlib OR Apache-2.0 | 0 | 2 |
| Unlicense/MIT | 0 | 2 |
| BSD-2-Clause | 1 | 0 |
| ISC | 1 | 0 |
| 0BSD | 1 | 0 |
| 0BSD OR MIT OR Apache-2.0 | 0 | 1 |
| BSD-3-Clause AND MIT | 0 | 1 |
| BSD-3-Clause/MIT | 0 | 1 |
| Apache-2.0 AND MIT | 0 | 1 |
| CC0-1.0 OR MIT-0 OR Apache-2.0 | 0 | 1 |
| Apache-2.0 / MIT | 0 | 1 |
| MIT OR Apache-2.0 OR Zlib | 0 | 1 |
| Zlib OR Apache-2.0 OR MIT | 0 | 1 |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 0 | 1 |

## Copyleft

These ask that changes to them be shared when the app is given to others (personal use is unaffected):

- cssparser 0.37.0: MPL-2.0
- cssparser-macros 0.7.1: MPL-2.0
- dtoa-short 0.3.5: MPL-2.0
- option-ext 0.2.0: MPL-2.0
- selectors 0.38.0: MPL-2.0

## npm packages

| Package | Version | License | Apps |
| --- | --- | --- | --- |
| @babel/helper-string-parser | 7.29.11 | MIT | pdf |
| @babel/helper-validator-identifier | 7.29.7 | MIT | pdf |
| @babel/parser | 7.29.11 | MIT | pdf |
| @babel/runtime | 7.29.10 | MIT | hello, pdf |
| @babel/types | 7.29.11 | MIT | pdf |
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
| @emotion/hash | 0.9.2 | MIT | hello, pdf |
| @floating-ui/core | 1.8.0 | MIT | hello, pdf |
| @floating-ui/devtools | 0.2.3 | MIT | hello, pdf |
| @floating-ui/dom | 1.8.0 | MIT | hello, pdf |
| @floating-ui/utils | 0.2.12 | MIT | hello, pdf |
| @fluentui/keyboard-keys | 9.0.9 | MIT | hello, pdf |
| @fluentui/priority-overflow | 9.4.3 | MIT | hello, pdf |
| @fluentui/react-accordion | 9.12.5 | MIT | hello, pdf |
| @fluentui/react-alert | 9.0.2-beta.1 | MIT | hello, pdf |
| @fluentui/react-aria | 9.17.16 | MIT | hello, pdf |
| @fluentui/react-avatar | 9.11.9 | MIT | hello, pdf |
| @fluentui/react-badge | 9.5.7 | MIT | hello, pdf |
| @fluentui/react-breadcrumb | 9.4.8 | MIT | hello, pdf |
| @fluentui/react-button | 9.11.3 | MIT | hello, pdf |
| @fluentui/react-card | 9.7.4 | MIT | hello, pdf |
| @fluentui/react-carousel | 9.9.16 | MIT | hello, pdf |
| @fluentui/react-checkbox | 9.6.6 | MIT | hello, pdf |
| @fluentui/react-color-picker | 9.3.3 | MIT | hello, pdf |
| @fluentui/react-combobox | 9.17.8 | MIT | hello, pdf |
| @fluentui/react-components | 9.74.11 | MIT | hello, pdf |
| @fluentui/react-context-selector | 9.2.21 | MIT | hello, pdf |
| @fluentui/react-dialog | 9.18.6 | MIT | hello, pdf |
| @fluentui/react-divider | 9.7.6 | MIT | hello, pdf |
| @fluentui/react-drawer | 9.13.5 | MIT | hello, pdf |
| @fluentui/react-field | 9.5.6 | MIT | hello, pdf |
| @fluentui/react-icons | 2.0.344 | MIT | hello, pdf |
| @fluentui/react-image | 9.4.6 | MIT | hello, pdf |
| @fluentui/react-infobutton | 9.0.1-beta.1 | MIT | hello, pdf |
| @fluentui/react-infolabel | 9.4.28 | MIT | hello, pdf |
| @fluentui/react-input | 9.8.8 | MIT | hello, pdf |
| @fluentui/react-jsx-runtime | 9.4.7 | MIT | hello, pdf |
| @fluentui/react-label | 9.4.6 | MIT | hello, pdf |
| @fluentui/react-link | 9.8.6 | MIT | hello, pdf |
| @fluentui/react-list | 9.7.0 | MIT | hello, pdf |
| @fluentui/react-menu | 9.25.7 | MIT | hello, pdf |
| @fluentui/react-message-bar | 9.7.9 | MIT | hello, pdf |
| @fluentui/react-motion | 9.16.5 | MIT | hello, pdf |
| @fluentui/react-motion-components-preview | 0.15.10 | MIT | hello, pdf |
| @fluentui/react-nav | 9.4.9 | MIT | hello, pdf |
| @fluentui/react-overflow | 9.9.5 | MIT | hello, pdf |
| @fluentui/react-persona | 9.7.11 | MIT | hello, pdf |
| @fluentui/react-popover | 9.14.10 | MIT | hello, pdf |
| @fluentui/react-portal | 9.8.17 | MIT | hello, pdf |
| @fluentui/react-positioning | 9.23.4 | MIT | hello, pdf |
| @fluentui/react-progress | 9.5.7 | MIT | hello, pdf |
| @fluentui/react-provider | 9.22.22 | MIT | hello, pdf |
| @fluentui/react-radio | 9.6.7 | MIT | hello, pdf |
| @fluentui/react-rating | 9.4.7 | MIT | hello, pdf |
| @fluentui/react-search | 9.4.8 | MIT | hello, pdf |
| @fluentui/react-select | 9.5.7 | MIT | hello, pdf |
| @fluentui/react-shared-contexts | 9.26.4 | MIT | hello, pdf |
| @fluentui/react-skeleton | 9.7.7 | MIT | hello, pdf |
| @fluentui/react-slider | 9.6.8 | MIT | hello, pdf |
| @fluentui/react-spinbutton | 9.6.8 | MIT | hello, pdf |
| @fluentui/react-spinner | 9.8.7 | MIT | hello, pdf |
| @fluentui/react-swatch-picker | 9.6.3 | MIT | hello, pdf |
| @fluentui/react-switch | 9.7.7 | MIT | hello, pdf |
| @fluentui/react-table | 9.19.23 | MIT | hello, pdf |
| @fluentui/react-tabs | 9.12.6 | MIT | hello, pdf |
| @fluentui/react-tabster | 9.26.19 | MIT | hello, pdf |
| @fluentui/react-tag-picker | 9.10.6 | MIT | hello, pdf |
| @fluentui/react-tags | 9.9.8 | MIT | hello, pdf |
| @fluentui/react-teaching-popover | 9.7.9 | MIT | hello, pdf |
| @fluentui/react-text | 9.6.21 | MIT | hello, pdf |
| @fluentui/react-textarea | 9.7.8 | MIT | hello, pdf |
| @fluentui/react-theme | 9.2.2 | MIT | hello, pdf |
| @fluentui/react-toast | 9.8.5 | MIT | hello, pdf |
| @fluentui/react-toolbar | 9.8.7 | MIT | hello, pdf |
| @fluentui/react-tooltip | 9.10.8 | MIT | hello, pdf |
| @fluentui/react-tree | 9.16.10 | MIT | hello, pdf |
| @fluentui/react-utilities | 9.27.0 | MIT | hello, pdf |
| @fluentui/react-virtualizer | 9.0.0-alpha.116 | MIT | hello, pdf |
| @fluentui/tokens | 1.0.0-alpha.24 | MIT | hello, pdf |
| @griffel/core | 1.21.4 | MIT | hello, pdf |
| @griffel/react | 1.7.8 | MIT | hello, pdf |
| @griffel/style-types | 1.4.3 | MIT | hello, pdf |
| @jridgewell/gen-mapping | 0.3.13 | MIT | pdf |
| @jridgewell/remapping | 2.3.5 | MIT | pdf |
| @jridgewell/resolve-uri | 3.1.2 | MIT | pdf |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | pdf |
| @jridgewell/trace-mapping | 0.3.31 | MIT | pdf |
| @sveltejs/acorn-typescript | 1.0.13 | MIT | pdf |
| @swc/helpers | 0.5.23 | Apache-2.0 | hello, pdf |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT | hello, pdf |
| @types/estree | 1.0.9 | MIT | pdf |
| @types/react | 19.3.0 | MIT | hello, pdf |
| @typescript-eslint/types | 8.72.0 | MIT | pdf |
| @vue/compiler-core | 3.5.44 | MIT | pdf |
| @vue/compiler-dom | 3.5.44 | MIT | pdf |
| @vue/compiler-sfc | 3.5.44 | MIT | pdf |
| @vue/compiler-ssr | 3.5.44 | MIT | pdf |
| @vue/reactivity | 3.5.44 | MIT | pdf |
| @vue/runtime-core | 3.5.44 | MIT | pdf |
| @vue/runtime-dom | 3.5.44 | MIT | pdf |
| @vue/server-renderer | 3.5.44 | MIT | pdf |
| @vue/shared | 3.5.44 | MIT | pdf |
| acorn | 8.19.0 | MIT | pdf |
| aria-query | 5.3.1 | Apache-2.0 | pdf |
| axobject-query | 4.1.0 | Apache-2.0 | pdf |
| clsx | 2.1.1 | MIT | pdf |
| csstype | 3.2.3 | MIT | hello, pdf |
| devalue | 5.9.4 | MIT | pdf |
| embla-carousel | 8.6.0 | MIT | hello, pdf |
| embla-carousel-autoplay | 8.6.0 | MIT | hello, pdf |
| embla-carousel-fade | 8.6.0 | MIT | hello, pdf |
| entities | 7.0.1 | BSD-2-Clause | pdf |
| esm-env | 1.2.2 | MIT | pdf |
| esrap | 2.4.0 | MIT | pdf |
| estree-walker | 2.0.2 | MIT | pdf |
| is-reference | 3.0.3 | MIT | pdf |
| keyborg | 3.498.0 | MIT | hello, pdf |
| locate-character | 3.0.0 | MIT | pdf |
| magic-string | 0.30.21 | MIT | pdf |
| nanoid | 3.3.20 | MIT | pdf |
| picocolors | 1.1.1 | ISC | pdf |
| postcss | 8.5.31 | MIT | pdf |
| preact | 10.29.8 | MIT | pdf |
| react | 19.3.1 | MIT | hello, pdf |
| react-dom | 19.3.1 | MIT | hello, pdf |
| rtl-css-js | 1.16.1 | MIT | hello, pdf |
| scheduler | 0.28.0 | MIT | hello, pdf |
| source-map-js | 1.2.2 | BSD-3-Clause | pdf |
| stylis | 4.4.0 | MIT | hello, pdf |
| svelte | 5.57.2 | MIT | pdf |
| tabster | 8.8.1 | MIT | hello, pdf |
| tslib | 2.8.1 | 0BSD | hello, pdf |
| typescript | 6.0.3 | Apache-2.0 | pdf |
| use-sync-external-store | 1.7.0 | MIT | hello, pdf |
| vue | 3.5.44 | MIT | pdf |
| zimmerframe | 1.1.5 | MIT | pdf |

## Rust crates

| Crate | Version | License |
| --- | --- | --- |
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| aho-corasick | 1.1.5 | Unlicense OR MIT |
| alloc-no-stdlib | 3.0.0 | BSD-3-Clause |
| alloc-stdlib | 0.3.0 | BSD-3-Clause |
| anyhow | 1.0.104 | MIT OR Apache-2.0 |
| base64 | 0.23.1 | MIT OR Apache-2.0 |
| bit-set | 0.8.0 | Apache-2.0 OR MIT |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT |
| bitflags | 1.3.2 | MIT/Apache-2.0 |
| bitflags | 2.13.2 | MIT OR Apache-2.0 |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 |
| brotli | 9.1.1 | BSD-3-Clause AND MIT |
| brotli-decompressor | 6.2.0 | BSD-3-Clause/MIT |
| bs58 | 0.5.1 | MIT/Apache-2.0 |
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
| equivalent | 1.0.3 | Apache-2.0 OR MIT |
| erased-serde | 0.4.11 | MIT OR Apache-2.0 |
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
| new_debug_unreachable | 1.0.6 | MIT |
| num-conv | 0.2.2 | MIT OR Apache-2.0 |
| num-traits | 0.2.19 | MIT OR Apache-2.0 |
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
| typeid | 1.0.3 | MIT OR Apache-2.0 |
| typenum | 1.20.1 | MIT OR Apache-2.0 |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 |
| url | 2.5.8 | MIT OR Apache-2.0 |
| urlpattern | 0.6.0 | MIT |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT |
| uuid | 1.29.0 | Apache-2.0 OR MIT |
| walkdir | 2.5.0 | Unlicense/MIT |
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
| zlib-rs | 0.6.8 | Zlib |
| zmij | 1.0.23 | MIT |
