// An in-memory Backend for tests: files keyed by path, grants as tokens, the same error
// kinds as the Rust side (conflict when a file changed since it was read, and so on).

import type { Backend } from './backend';
import type { FileRef, FolioError, Settings, Snapshot, TypeDefault } from './types';

const encode = (text: string) => new TextEncoder().encode(text);
const nameOf = (path: string) => path.split('\\').pop() ?? path;

export function fakeBackend(initial: Record<string, string> = {}, readOnly: string[] = []) {
  const files = new Map<string, { bytes: Uint8Array; version: number }>();
  for (const [path, text] of Object.entries(initial)) files.set(path, { bytes: encode(text), version: 1 });
  const tokens = new Map<string, { path: string; version: number | null }>();
  const recovery = new Map<string, { name: string; bytes: Uint8Array; savedMs: number }>();
  const calls: string[] = [];
  const settings: Settings = {};
  let counter = 0;
  let openQueue: string[] = [];
  let saveTarget: string | null = null;
  let folderTarget: string | null = null;
  const folders = new Map<string, string>();
  let saveFailure: FolioError | null = null;
  let secondScreen = false;
  let defaultApps: TypeDefault[] = [];

  const grant = (path: string): FileRef => {
    const token = `t${++counter}`;
    tokens.set(token, { path, version: null });
    const file = files.get(path);
    return {
      token,
      name: nameOf(path),
      displayPath: path,
      size: file?.bytes.length ?? 0,
      modifiedMs: file?.version ?? 0,
      exists: Boolean(file),
      readOnly: readOnly.includes(path),
      key: path.toLowerCase(),
    };
  };
  const tokenOf = (token: string) => {
    const entry = tokens.get(token);
    if (!entry) throw { kind: 'unknownToken', message: 'unknown token' } satisfies FolioError;
    return entry;
  };
  const off = () => () => undefined;

  const backend: Backend = {
    pickOpen: async (_multiple, filter) => {
      calls.push(`pickOpen:${filter ? filter.extensions.join(',') : 'app'}`);
      return openQueue.splice(0).map(grant);
    },
    pickSave: async () => {
      const path = saveTarget;
      saveTarget = null;
      return path ? grant(path) : null;
    },
    read: async (token) => {
      const entry = tokenOf(token);
      const file = files.get(entry.path);
      if (!file) throw { kind: 'notFound', message: 'missing' } satisfies FolioError;
      entry.version = file.version;
      return file.bytes;
    },
    save: async (token, bytes, force = false) => {
      calls.push(force ? 'save:force' : 'save');
      if (saveFailure) {
        const failure = saveFailure;
        saveFailure = null;
        throw failure;
      }
      const entry = tokenOf(token);
      if (readOnly.includes(entry.path)) throw { kind: 'readOnly', message: 'read-only' } satisfies FolioError;
      const file = files.get(entry.path);
      if (file && entry.version !== null && entry.version !== file.version && !force) {
        throw { kind: 'conflict', message: 'changed on disk' } satisfies FolioError;
      }
      const version = (file?.version ?? 0) + 1;
      files.set(entry.path, { bytes, version });
      entry.version = version;
      return { size: bytes.length, modifiedMs: version };
    },
    pickFolder: async () => {
      const dir = folderTarget;
      folderTarget = null;
      if (!dir) return null;
      const token = `f${++counter}`;
      folders.set(token, dir);
      return { token, name: nameOf(dir), displayPath: dir };
    },
    saveIntoFolder: async (token, name, bytes) => {
      const dir = folders.get(token);
      if (!dir) throw { kind: 'unknownToken', message: 'unknown folder' } satisfies FolioError;
      const dot = name.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let used = name;
      for (let n = 2; files.has(`${dir}\\${used}`); n++) used = `${stem} (${n})${ext}`;
      files.set(`${dir}\\${used}`, { bytes, version: 1 });
      return used;
    },
    setFullscreen: async (on) => {
      calls.push(`fullscreen:${on}`);
    },
    presenterScreen: async (open) => {
      calls.push(`presenterScreen:${open}`);
      return open && secondScreen;
    },
    openLink: async (url) => {
      calls.push(`openLink:${url}`);
    },
    defaultApps: async () => defaultApps,
    openDefaultApps: async () => {
      calls.push('openDefaultApps');
    },
    releaseFolder: async (token) => {
      calls.push(`releaseFolder:${token}`);
      folders.delete(token);
    },
    release: async (token) => {
      calls.push(`release:${token}`);
      tokens.delete(token);
    },
    takePending: async () => [],
    onOpenFiles: off,
    getSettings: async () => settings,
    setSettings: async (patch) => Object.assign(settings, patch),
    onSettings: off,
    recentList: async () => [],
    recentOpen: async (key) => grant(key),
    recentRemove: async () => undefined,
    recentClear: async () => undefined,
    viewStateGet: async () => null,
    viewStateSet: async () => undefined,
    recoveryPut: async (doc, name, bytes) => {
      calls.push(`recovery:${doc}`);
      recovery.set(doc, { name, bytes, savedMs: Date.now() });
    },
    recoveryList: async () =>
      [...recovery].map(([doc, r]): Snapshot => ({ doc, name: r.name, displayPath: null, savedMs: r.savedMs, size: r.bytes.length })),
    recoveryRead: async (doc) => recovery.get(doc)?.bytes ?? new Uint8Array(),
    recoveryDrop: async (doc) => void recovery.delete(doc),
    recoveryOrigin: async () => null,
    backupsClear: async () => undefined,
    securePut: async () => undefined,
    secureGet: async () => new Uint8Array(),
    secureDelete: async () => undefined,
    secureKeys: async () => [],
    system: async () => ({ accent: ['#0078d4'], dark: false, highContrast: false, transparency: true }),
    onSystem: off,
    networkLock: async () => ({ privateRuntime: true, runtimeVersion: 'test', firewallRule: true, active: true }),
    setWindowTheme: async () => undefined,
    onCloseRequested: off,
    onDragState: off,
    appReady: async () => undefined,
    window: {
      minimize: () => undefined,
      toggleMaximize: () => undefined,
      close: () => undefined,
      isMaximized: async () => false,
      onResized: off,
      reportMaximizeRect: () => undefined,
      onCaption: off,
    },
  };

  return {
    backend,
    files,
    calls,
    recovery,
    grant,
    text: (path: string) => new TextDecoder().decode(files.get(path)?.bytes),
    /** Another program writes the file. */
    changeOnDisk: (path: string, text: string) => files.set(path, { bytes: encode(text), version: (files.get(path)?.version ?? 0) + 1 }),
    /** What the next Open / Save dialog returns. */
    nextOpen: (paths: string[]) => void (openQueue = paths),
    nextSave: (path: string | null) => void (saveTarget = path),
    nextFolder: (path: string | null) => void (folderTarget = path),
    failNextSave: (error: FolioError) => void (saveFailure = error),
    /** Whether a second monitor is connected (for a slideshow's audience window). */
    setSecondScreen: (connected: boolean) => void (secondScreen = connected),
    /** What a double-click on each of the app's file types opens. */
    setDefaultApps: (status: TypeDefault[]) => void (defaultApps = status),
  };
}
