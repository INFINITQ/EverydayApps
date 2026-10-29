// Dev-only: Folio Slides in a plain browser, on the shell's in-memory backend, so the UI
// can be driven by Playwright on any OS (the real app needs Windows). Never bundled: the
// production build only uses index.html. Open http://localhost:5174/dev/harness.html.

import '@folio/ui/folio.css';
import '../src/slides.css';
import { Shell, ShellApp } from '@folio/shell';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { fakeBackend } from '../../../packages/shell/src/testing';
import { AppIcon } from '../src/AppIcon';
import { slidesFormat } from '../src/slidesFormat';
import { type DeckSpec, SAMPLE, makePptx } from '../src/testing/makePptx';

const fake = fakeBackend();
const shell = new Shell(fake.backend, [slidesFormat], 'Folio Slides');
const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const harness = {
  shell,
  fake,
  /** Opens a generated deck (the sample one by default) as C:\test\<name>. */
  async open(name: string, spec: DeckSpec = SAMPLE) {
    await harness.openBytes(name, toBase64(await makePptx(spec)));
  },
  async openBytes(name: string, base64: string) {
    const path = `C:\\test\\${name}`;
    fake.files.set(path, { bytes: fromBase64(base64), version: 1 });
    fake.nextOpen([path]);
    await shell.openDialog();
  },
  /** A file as the app last wrote it, base64. */
  file: (name: string) => {
    const file = fake.files.get(`C:\\test\\${name}`);
    return file ? toBase64(file.bytes) : null;
  },
  /** What the next Open dialog (for pictures...) and Save As dialog return. */
  nextOpenBytes(name: string, base64: string) {
    const path = `C:\\test\\${name}`;
    fake.files.set(path, { bytes: fromBase64(base64), version: 1 });
    fake.nextOpen([path]);
  },
  nextSave: (name: string) => fake.nextSave(`C:\\test\\${name}`),
  /** Whether a second monitor is connected (for the audience window). */
  secondScreen: (connected: boolean) => fake.setSecondScreen(connected),
};
(window as unknown as { harness: typeof harness }).harness = harness;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShellApp shell={shell} tagline="Present, edit and organize PowerPoint decks. Privately." icon={<AppIcon />} />
  </StrictMode>,
);
