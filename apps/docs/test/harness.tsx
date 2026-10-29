// Folio Docs in a plain browser: the real shell and format module on the shell's in-memory
// backend, for UI tests driven by test/ui.mjs (Playwright). Not part of the app build.

import '@folio/ui/folio.css';
import '@docx-editor.dev/core/styles/editor.css';
import '../src/docs.css';
import { Shell, ShellApp } from '@folio/shell';
import { createRoot } from 'react-dom/client';
import { fakeBackend } from '../../../packages/shell/src/testing';
import { AppIcon } from '../src/AppIcon';
import { docsFormat } from '../src/docsFormat';
import { printPages } from '../src/print';

const fake = fakeBackend();
const shell = new Shell(fake.backend, [docsFormat], 'Folio Docs');

const toBase64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

declare global {
  interface Window {
    harness: {
      shell: Shell;
      calls: string[];
      put(path: string, base64: string): void;
      open(path: string): Promise<void>;
      file(path: string): string | null;
      nextSave(path: string | null): void;
      nextOpen(paths: string[]): void;
      /** Paints the active document for printing and leaves it in place (print itself is stubbed). */
      printKeep(): Promise<{ pages: number; text: number }>;
    };
  }
}

window.harness = {
  shell,
  calls: fake.calls,
  put: (path, base64) => void fake.files.set(path, { bytes: fromBase64(base64), version: 1 }),
  open: (path) => shell.openFile(fake.grant(path)),
  file: (path) => {
    const file = fake.files.get(path);
    return file ? toBase64(file.bytes) : null;
  },
  nextSave: (path) => fake.nextSave(path),
  nextOpen: (paths) => fake.nextOpen(paths),
  printKeep: async () => {
    window.print = () => undefined;
    const session = shell.session(shell.state.activeId) as unknown as { editor: unknown; print(): Promise<void> };
    const container = await printPages(session.editor, { keep: true });
    return { pages: container?.querySelectorAll('.docx-page').length ?? 0, text: container?.textContent?.length ?? 0 };
  },
};

createRoot(document.getElementById('root')!).render(
  <ShellApp shell={shell} tagline="Read, write and edit Word documents. Privately." icon={<AppIcon />} />,
);
