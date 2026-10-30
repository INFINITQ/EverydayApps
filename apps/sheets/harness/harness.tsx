// Dev-only: Folio Sheets in a plain browser, on the shell's in-memory backend. Built with
// vite.harness.config.ts and driven by test/smoke.mjs (Playwright). Never shipped.
import '@folio/ui/folio.css';
import '../src/sheets.css';
import { Shell, ShellApp } from '@folio/shell';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { fakeBackend } from '../../../packages/shell/src/testing';
import { AppIcon } from '../src/AppIcon';
import { sheetsFormat } from '../src/sheetsFormat';

const fake = fakeBackend();
const shell = new Shell(fake.backend, [sheetsFormat], 'Folio Sheets');

/** Puts a file in the fake disk and opens it, as if picked in Explorer. */
async function open(path: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  fake.files.set(path, { bytes, version: 1 });
  await shell.openFile(fake.grant(path));
}

function saved(path: string): string | null {
  const file = fake.files.get(path);
  if (!file) return null;
  let text = '';
  for (const byte of file.bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

Object.assign(window, { harness: { shell, fake, open, saved } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShellApp shell={shell} tagline="Harness" icon={<AppIcon />} />
  </StrictMode>,
);
