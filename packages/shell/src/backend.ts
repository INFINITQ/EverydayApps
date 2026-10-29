// The only module that talks to Tauri. Everything else goes through `Backend`, so the shell
// can be tested with a fake one (see testing.ts).

import type { CaptionState, WindowControls } from '@folio/ui';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type {
  FileRef,
  FolderRef,
  NetworkLock,
  OpenFilter,
  RecentItem,
  Settings,
  Snapshot,
  Stamp,
  SystemColors,
} from './types';

export interface Backend {
  /** The Open dialog, for the app's own file types unless `filter` names others. */
  pickOpen(multiple: boolean, filter?: OpenFilter): Promise<FileRef[]>;
  pickSave(suggestedName: string, label: string, extension: string): Promise<FileRef | null>;
  read(token: string): Promise<Uint8Array>;
  save(token: string, bytes: Uint8Array, force?: boolean): Promise<Stamp>;
  release(token: string): Promise<void>;
  /** The folder picker; the folder's token can only create new files in it. */
  pickFolder(title: string): Promise<FolderRef | null>;
  /** Creates a new file in a picked folder; resolves with the name used (never overwrites). */
  saveIntoFolder(token: string, name: string, bytes: Uint8Array): Promise<string>;
  releaseFolder(token: string): Promise<void>;
  /** Opens a web or email link in the default browser or mail app (Rust checks it). */
  openLink(url: string): Promise<void>;
  takePending(): Promise<FileRef[]>;
  onOpenFiles(listener: () => void): () => void;

  getSettings(): Promise<Settings>;
  setSettings(patch: Record<string, unknown>): Promise<Settings>;
  onSettings(listener: (settings: Settings) => void): () => void;

  recentList(): Promise<RecentItem[]>;
  recentOpen(key: string): Promise<FileRef>;
  recentRemove(key: string): Promise<void>;
  recentClear(): Promise<void>;
  viewStateGet(key: string): Promise<unknown>;
  viewStateSet(key: string, value: unknown): Promise<void>;

  recoveryPut(doc: string, name: string, bytes: Uint8Array, token?: string): Promise<void>;
  recoveryList(): Promise<Snapshot[]>;
  recoveryRead(doc: string): Promise<Uint8Array>;
  recoveryDrop(doc: string): Promise<void>;
  recoveryOrigin(doc: string): Promise<FileRef | null>;
  backupsClear(): Promise<void>;

  securePut(key: string, bytes: Uint8Array): Promise<void>;
  secureGet(key: string): Promise<Uint8Array>;
  secureDelete(key: string): Promise<void>;
  secureKeys(): Promise<string[]>;

  system(): Promise<SystemColors>;
  onSystem(listener: (system: SystemColors) => void): () => void;
  /** Folio's private, firewalled WebView2 (docs/adr/0005). */
  networkLock(): Promise<NetworkLock>;
  setWindowTheme(theme: 'light' | 'dark' | null): Promise<void>;
  setFullscreen(on: boolean): Promise<void>;
  /** Runs `confirm` when the window is asked to close; it closes only if that returns true. */
  onCloseRequested(confirm: () => Promise<boolean>): () => void;
  /** True while files are dragged over the window (the drop itself is handled in Rust). */
  onDragState(listener: (over: boolean) => void): () => void;
  appReady(): Promise<void>;
  window: WindowControls;
}

const folio = (command: string) => `plugin:folio|${command}`;
const toBytes = (value: unknown) => new Uint8Array(value as ArrayBuffer);

function subscribe<T>(event: string, listener: (payload: T) => void): () => void {
  const stop = listen<T>(event, (e) => listener(e.payload));
  return () => void stop.then((unlisten) => unlisten());
}

export function tauriBackend(): Backend {
  const win = getCurrentWindow();
  return {
    pickOpen: (multiple, filter) => invoke(folio('pick_open'), { multiple, filter: filter ?? null }),
    pickSave: (suggestedName, label, extension) => invoke(folio('pick_save'), { suggestedName, label, extension }),
    read: async (token) => toBytes(await invoke(folio('read'), { token })),
    save: (token, bytes, force = false) =>
      invoke(folio('save'), bytes, {
        headers: { 'x-folio-token': token, ...(force ? { 'x-folio-force': '1' } : {}) },
      }),
    release: (token) => invoke(folio('release'), { token }),
    pickFolder: (title) => invoke(folio('pick_folder'), { title }),
    saveIntoFolder: (token, name, bytes) =>
      invoke(folio('save_into_folder'), bytes, {
        headers: { 'x-folio-token': token, 'x-folio-name': encodeURIComponent(name) },
      }),
    releaseFolder: (token) => invoke(folio('release_folder'), { token }),
    openLink: (url) => invoke(folio('open_link'), { url }),
    takePending: () => invoke(folio('take_pending')),
    onOpenFiles: (listener) => subscribe('folio://open-files', () => listener()),

    getSettings: () => invoke(folio('settings_get')),
    setSettings: (patch) => invoke(folio('settings_set'), { patch }),
    onSettings: (listener) => subscribe('folio://settings', listener),

    recentList: () => invoke(folio('recent_list')),
    recentOpen: (key) => invoke(folio('recent_open'), { key }),
    recentRemove: (key) => invoke(folio('recent_remove'), { key }),
    recentClear: () => invoke(folio('recent_clear')),
    viewStateGet: (key) => invoke(folio('view_state_get'), { key }),
    viewStateSet: (key, value) => invoke(folio('view_state_set'), { key, value }),

    recoveryPut: (doc, name, bytes, token) =>
      invoke(folio('recovery_put'), bytes, {
        headers: {
          'x-folio-doc': doc,
          'x-folio-name': encodeURIComponent(name),
          ...(token ? { 'x-folio-token': token } : {}),
        },
      }),
    recoveryList: () => invoke(folio('recovery_list')),
    recoveryRead: async (doc) => toBytes(await invoke(folio('recovery_read'), { doc })),
    recoveryDrop: (doc) => invoke(folio('recovery_drop'), { doc }),
    recoveryOrigin: (doc) => invoke(folio('recovery_origin'), { doc }),
    backupsClear: () => invoke(folio('backups_clear')),

    securePut: (key, bytes) => invoke(folio('secure_put'), bytes, { headers: { 'x-folio-key': key } }),
    secureGet: async (key) => toBytes(await invoke(folio('secure_get'), { key })),
    secureDelete: (key) => invoke(folio('secure_delete'), { key }),
    secureKeys: () => invoke(folio('secure_keys')),

    system: () => invoke(folio('system')),
    onSystem: (listener) => subscribe('folio://system', listener),
    networkLock: () => invoke(folio('network_lock')),
    setWindowTheme: (theme) => win.setTheme(theme),
    setFullscreen: (on) => invoke(folio('set_fullscreen'), { on }),
    onCloseRequested: (confirm) => {
      const stop = win.onCloseRequested(async (event) => {
        event.preventDefault();
        if (await confirm()) await win.destroy();
      });
      return () => void stop.then((unlisten) => unlisten());
    },
    onDragState: (listener) => {
      const stop = getCurrentWebview().onDragDropEvent((event) => {
        listener(event.payload.type === 'enter' || event.payload.type === 'over');
      });
      return () => void stop.then((unlisten) => unlisten());
    },
    appReady: () => invoke(folio('app_ready')),
    window: {
      minimize: () => void win.minimize(),
      toggleMaximize: () => void win.toggleMaximize(),
      close: () => void win.close(),
      isMaximized: () => win.isMaximized(),
      onResized: (listener) => {
        const stop = win.onResized(() => listener());
        return () => void stop.then((unlisten) => unlisten());
      },
      reportMaximizeRect: (rect) => void invoke(folio('caption_maximize_rect'), { rect }),
      onCaption: (listener) => subscribe<CaptionState>('folio://caption', listener),
    },
  };
}
