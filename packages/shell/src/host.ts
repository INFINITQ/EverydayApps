// The contract between the shell and a document format (PDF, spreadsheet, ...). A format
// app implements `FormatModule`; everything else (tabs, saving, recovery, shortcuts,
// printing, the command palette) comes from the shell.

import type { ComponentType, ReactNode } from 'react';

export type Command = {
  id: string;
  title: string;
  /** Shown before the title in the command palette, e.g. "File". */
  group?: string;
  /**
   * Keyboard shortcut, e.g. "Ctrl+S", "F12", "H". Shortcuts with Ctrl, Alt or a function key
   * work everywhere; plain keys are ignored while typing in a text field.
   */
  keys?: string;
  icon?: ReactNode;
  enabled?(): boolean;
  run(): unknown;
};

/** What the shell offers a document session. */
export interface DocHost {
  /** Re-render the toolbar, status bar and command list (selection or tool changed). */
  changed(): void;
  notify(message: string, intent?: 'info' | 'success' | 'warning' | 'error'): void;
  /**
   * Lets the user pick another file to read (insert pages, merge, a picture...). The Open
   * dialog shows only `extensions`, described as `label`. Never a path.
   */
  openAnother(extensions: string[], label?: string): Promise<{ name: string; bytes: Uint8Array } | null>;
  /** Like `openAnother`, but the user can pick several files (to merge, for example). */
  openOthers(extensions: string[], label?: string): Promise<{ name: string; bytes: Uint8Array }[]>;
  /** Saves `bytes` as a new file the user picks (a flattened copy...). True once written. */
  saveCopy(bytes: Uint8Array, suggestedName: string): Promise<boolean>;
  /**
   * Saves several new files into a folder the user picks (the parts of a split document).
   * Existing files are never overwritten. Resolves with how many were saved.
   */
  saveCopies(files: { bytes: Uint8Array; name: string }[], title: string): Promise<number>;
  /**
   * Opens a web or email link in the user's browser or mail app. Ask the user first: links
   * come from documents. Only http, https and mailto links are accepted.
   */
  openLink(url: string): Promise<void>;
  /** Turns full screen on or off (F11 and Esc work too). */
  toggleFullscreen(): void;
  /** Whether the window is full screen now (a slideshow leaves it as it found it). */
  isFullscreen?(): boolean;
  /** Small encrypted items (saved signatures), protected with Windows DPAPI. */
  secure: {
    put(key: string, bytes: Uint8Array): Promise<void>;
    get(key: string): Promise<Uint8Array>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
  };
}

export type FileTypeInfo = { ext: string; label: string; canSave: boolean };

export interface FormatModule {
  id: string;
  /** What this format opens. Types with `canSave: false` open read-only (old formats). */
  fileTypes: FileTypeInfo[];
  open(file: { bytes: Uint8Array; name: string }, host: DocHost): Promise<DocumentSession>;
}

export interface DocumentSession {
  /** The document's UI. Stays mounted while its tab is open, hidden when inactive. */
  View: ComponentType;
  /**
   * Identifies the current content. Changes on every edit, and returns to an earlier value on
   * undo, so "unsaved" is simply `stateId() !== stateId at last save`.
   */
  stateId(): number;
  /** Called whenever the content or the session's commands change. */
  subscribe(listener: () => void): () => void;
  /** Things in this file that won't survive saving (macros, SmartArt...). Empty if none. */
  lossy(): { id: string; label: string }[];
  commands(): Command[];
  /**
   * Finishes edits that are still being applied (a pen stroke the engine writes a moment
   * after the pen lifts), so `stateId()` includes them. The shell waits for it before saving
   * and before checking for unsaved changes on close.
   */
  settle?(): Promise<void>;
  /** The file's bytes in format `ext` (one of the format's `fileTypes` with `canSave`). */
  save(ext: string): Promise<Uint8Array>;
  /** A cheaper serialization for crash recovery, if the format has one. */
  snapshot?(): Promise<Uint8Array>;
  viewState?(): unknown;
  restoreViewState?(state: unknown): void;
  print?(): Promise<void>;
  /** Status bar contents (page number, zoom...). */
  status?(): ReactNode;
  dispose(): void;
}
