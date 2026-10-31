import type { SystemColors } from '@folio/ui';

export type { SystemColors };

/** A file the user granted Folio access to. `token` is the only way to read or write it. */
/** File types for an Open dialog that isn't for the app's own documents. */
export type OpenFilter = { label: string; extensions: string[] };

/** A folder the user picked; its token can only create new files there. */
export type FolderRef = { token: string; name: string; displayPath: string };

export type FileRef = {
  token: string;
  name: string;
  /** For display only (tooltips, recent files). Rust never accepts it back. */
  displayPath: string;
  size: number;
  modifiedMs: number;
  exists: boolean;
  readOnly: boolean;
  /** Stable, non-reversible id for this path (recent files, remembered view state). */
  key: string;
};

export type Stamp = { size: number; modifiedMs: number };

export type RecentItem = { key: string; name: string; displayPath: string; openedMs: number; exists: boolean };

export type Snapshot = { doc: string; name: string; displayPath: string | null; savedMs: number; size: number };

export type FolioErrorKind =
  | 'conflict'
  | 'locked'
  | 'readOnly'
  | 'denied'
  | 'diskFull'
  | 'notFound'
  | 'unknownToken'
  | 'invalid'
  | 'unavailable'
  | 'tauri'
  | 'io'
  | 'webview2'
  | 'windows';

/** What every failing folio command rejects with. */
export type FolioError = { kind: FolioErrorKind; message: string };

export function isFolioError(value: unknown): value is FolioError {
  return typeof value === 'object' && value !== null && 'kind' in value && 'message' in value;
}

export type Settings = { theme?: 'system' | 'light' | 'dark'; [key: string]: unknown };

/** What a double-click on one of the app's file types opens (crates/folio-core/src/defaults.rs). */
export type TypeDefault = {
  /** Without the dot: "pdf". */
  ext: string;
  /** True when it opens this app. */
  isDefault: boolean;
  /** The app it opens instead, as Windows names it; null when it opens this app or Windows would ask. */
  app: string | null;
};

/** Folio's private, firewalled WebView2 (docs/adr/0005). `active` = both parts in place. */
export type NetworkLock = {
  privateRuntime: boolean;
  runtimeVersion: string | null;
  firewallRule: boolean;
  active: boolean;
};

/** Handed over by Rust before the page loads (see crates/folio-core/src/window.rs). */
export type Boot = { settings: Settings; system: SystemColors };

declare global {
  interface Window {
    __FOLIO_BOOT__?: Boot;
  }
}
