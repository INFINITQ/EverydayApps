// @vitest-environment node
// Each app's installer lists the file types it opens in Settings > Apps > Default apps
// (config/installer-hooks.nsh). The list must match the types the installer registers
// (bundle.fileAssociations in tauri.conf.json), or Windows would offer the app for types it
// doesn't open, or leave some out.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
// NSIS reads files without a byte-order mark in the system code page: keep them ASCII.
const ascii = /^[\t\n\r\x20-\x7e]*$/;

type Conf = {
  bundle: {
    shortDescription: string;
    fileAssociations: { ext: string[]; name: string }[];
    windows: { nsis: { installerHooks?: string } };
  };
};

describe.each(['pdf', 'sheets', 'docs', 'slides'])('the %s installer', (app) => {
  const dir = join(root, 'apps', app, 'src-tauri');
  const conf = JSON.parse(readFileSync(join(dir, 'tauri.conf.json'), 'utf8')) as Conf;
  const hooksFile = conf.bundle.windows.nsis.installerHooks;
  const hooks = hooksFile ? readFileSync(join(dir, hooksFile), 'utf8') : '';

  it('lists exactly the file types it registers', () => {
    const listed = [
      ...hooks.matchAll(/^\s*!insertmacro FOLIO_FILE_TYPE "([^"]+)" "([^"]+)"/gm),
    ].map(([, ext, progId]) => `${ext} ${progId}`);
    const registered = conf.bundle.fileAssociations.flatMap((a) =>
      a.ext.map((ext) => `${ext} ${a.name}`),
    );
    expect(listed.sort()).toEqual(registered.sort());
  });

  it('describes the app as its bundle does, and uses the shared hooks', () => {
    expect(hooks).toContain(`!define FOLIO_DESCRIPTION "${conf.bundle.shortDescription}"`);
    expect(hooks).toContain('!include "${__FILEDIR__}\\..\\..\\..\\config\\installer-hooks.nsh"');
    expect(hooks).toMatch(ascii);
  });
});

it('the shared hooks are plain ASCII', () => {
  expect(readFileSync(join(root, 'config', 'installer-hooks.nsh'), 'utf8')).toMatch(ascii);
});
