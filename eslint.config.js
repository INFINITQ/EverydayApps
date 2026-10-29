// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const OFFLINE = 'Folio is offline-only: network APIs are not allowed in app code.';

// Browser APIs that can reach the network. App code must not use them. The rare
// local-asset load (for example a bundled .wasm file) needs an explicit, reviewed
// eslint-disable comment that says why it is safe.
const networkGlobals = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'RTCPeerConnection',
  'WebTransport',
].map((name) => ({ name, message: OFFLINE }));

const networkProperties = [
  { object: 'navigator', property: 'sendBeacon', message: OFFLINE },
  { object: 'window', property: 'fetch', message: OFFLINE },
  { object: 'globalThis', property: 'fetch', message: OFFLINE },
  { object: 'window', property: 'open', message: 'Open links through the folio link command.' },
];

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/target/',
    '**/src-tauri/gen/',
    'playwright-report/',
    'test-results/',
    'vendor/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-globals': ['error', ...networkGlobals],
      'no-restricted-properties': ['error', ...networkProperties],
    },
  },
  {
    // Tests, tooling and config files run in Node or drive the app from outside.
    files: ['**/*.test.{ts,tsx}', 'e2e/**', 'tools/**', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
]);
