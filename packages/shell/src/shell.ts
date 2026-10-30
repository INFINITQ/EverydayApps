// Documents, tabs and every flow around them: open, save (and what to do when saving
// fails), close with unsaved changes, recovery snapshots, commands. UI-free, so it can be
// tested with a fake backend.

import { type StoreApi, createStore } from 'zustand/vanilla';
import type { Backend } from './backend';
import type { Command, DocHost, DocumentSession, FileTypeInfo, FormatModule } from './host';
import { type FileRef, type RecentItem, type Settings, type Snapshot, isFolioError } from './types';

export type Doc = {
  id: string;
  title: string;
  /** The file it came from; null for a restored document whose file is gone. */
  file: FileRef | null;
  ext: string;
  format: string;
  /** `stateId` at the last save; -1 when never saved in this session (restored). */
  savedStateId: number;
  stateId: number;
  saving: boolean;
  lossy: { id: string; label: string }[];
  lossyAcknowledged: boolean;
};

export type Choice = { label: string; value: string; appearance?: 'primary' | 'secondary' };
export type Question = { title: string; body: string; choices: Choice[]; answer(value: string): void };
export type Notice = { id: number; message: string; intent: 'info' | 'success' | 'warning' | 'error' };

export type ShellState = {
  docs: Doc[];
  activeId: string | null;
  paletteOpen: boolean;
  question: Question | null;
  notices: Notice[];
  recent: RecentItem[];
  recovered: Snapshot[];
  settings: Settings;
  /** Bumped whenever a session's commands or status may have changed. */
  version: number;
  /** Full-screen reading: the window fills the screen and the title and status bars hide. */
  fullscreen: boolean;
};

type SaveMode = 'save' | 'saveAs' | 'saveCopy';
type WriteResult = 'ok' | 'cancelled' | 'saveAs';

export const isDirty = (doc: Doc) => doc.stateId !== doc.savedStateId;

/** Recovery snapshots: at most every 30 s per document, and only once typing pauses for 2 s. */
export const SNAPSHOT_EVERY_MS = 30_000;
export const SNAPSHOT_AFTER_IDLE_MS = 2_000;

let counter = 0;
const newId = () => `doc-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const extensionOf = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');
const withExtension = (name: string, ext: string) => `${name.replace(/\.[^.]+$/, '')}.${ext}`;
const copyName = (name: string, ext: string) => `${name.replace(/\.[^.]+$/, '')} (copy).${ext}`;
const listOf = (items: { label: string }[]) => items.map((i) => i.label).join(', ');

export class Shell {
  readonly store: StoreApi<ShellState>;
  private readonly sessions = new Map<string, DocumentSession>();
  private readonly unsubscribe = new Map<string, () => void>();
  private readonly snapshots = new Map<string, { stateId: number; at: number }>();
  private readonly lastChange = new Map<string, number>();
  private readonly stops: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private noticeId = 0;

  constructor(
    readonly backend: Backend,
    readonly formats: FormatModule[],
    readonly appName: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.store = createStore<ShellState>(() => ({
      docs: [],
      activeId: null,
      paletteOpen: false,
      fullscreen: false,
      question: null,
      notices: [],
      recent: [],
      recovered: [],
      settings: {},
      version: 0,
    }));
  }

  // ---- Lifecycle -------------------------------------------------------------------------

  async start(initialSettings: Settings = {}): Promise<void> {
    this.stop();
    this.set({ settings: initialSettings });
    if (initialSettings.theme === 'light' || initialSettings.theme === 'dark') {
      void this.backend.setWindowTheme(initialSettings.theme).catch(() => undefined);
    }
    this.stops.push(this.backend.onOpenFiles(() => void this.receivePending()));
    this.stops.push(this.backend.onSettings((settings) => this.set({ settings })));
    this.stops.push(this.backend.onCloseRequested(() => this.closeAll()));
    await Promise.all([this.refreshRecent(), this.refreshRecovered()]);
    await this.receivePending();
    this.timer = setInterval(() => void this.snapshotDirty(), 5_000);
    void this.checkNetworkLock(false);
  }

  /** Warns when Folio's private, firewalled WebView2 isn't in place (docs/adr/0005). */
  async checkNetworkLock(reportWhenOn: boolean): Promise<void> {
    const fix = 'To block it, run tools\\network-lock.ps1 -Install in PowerShell opened as administrator.';
    try {
      const lock = await this.backend.networkLock();
      if (lock.active) {
        if (reportWhenOn) {
          this.notify(`Network lock is on: Folio's own WebView2 ${lock.runtimeVersion ?? ''} is blocked by Windows Firewall.`, 'success');
        }
      } else if (lock.privateRuntime) {
        this.notify(`Network lock is half set up: the firewall rule is missing, so WebView2 can still reach Microsoft. ${fix}`, 'warning');
      } else {
        this.notify(`Network lock is off: WebView2 (part of Windows) may send diagnostic data to Microsoft. ${fix}`, 'warning');
      }
    } catch {
      // Older core without the command: nothing to report.
    }
  }

  stop(): void {
    clearInterval(this.timer);
    for (const stop of this.stops.splice(0)) stop();
  }

  get state(): ShellState {
    return this.store.getState();
  }

  session(id: string | null): DocumentSession | undefined {
    return id ? this.sessions.get(id) : undefined;
  }

  doc(id: string | null | undefined): Doc | undefined {
    return this.state.docs.find((d) => d.id === id);
  }

  private set(patch: Partial<ShellState> | ((state: ShellState) => Partial<ShellState>)) {
    this.store.setState(patch);
  }

  private updateDoc(id: string, patch: Partial<Doc>) {
    this.set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
  }

  // ---- Notices and questions ----------------------------------------------------------------

  notify(message: string, intent: Notice['intent'] = 'info'): void {
    const notice = { id: ++this.noticeId, message, intent };
    this.set((s) => ({ notices: [...s.notices, notice] }));
  }

  dismiss(id: number): void {
    this.set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  }

  /** Shows a dialog and resolves with the chosen value (the last choice if dismissed). */
  ask(title: string, body: string, choices: Choice[]): Promise<string> {
    return new Promise((resolve) => {
      const answer = (value: string) => {
        this.set({ question: null });
        resolve(value);
      };
      this.set({ question: { title, body, choices, answer } });
    });
  }

  private fail(error: unknown, fallback = 'Something went wrong.') {
    this.notify(isFolioError(error) ? error.message : error instanceof Error ? error.message : fallback, 'error');
  }

  // ---- Opening ----------------------------------------------------------------------------

  formatFor(name: string): { format: FormatModule; type: FileTypeInfo } | undefined {
    const ext = extensionOf(name);
    for (const format of this.formats) {
      const type = format.fileTypes.find((t) => t.ext === ext);
      if (type) return { format, type };
    }
    return undefined;
  }

  async openDialog(): Promise<void> {
    try {
      for (const file of await this.backend.pickOpen(true)) await this.openFile(file);
    } catch (error) {
      this.fail(error);
    }
  }

  async receivePending(): Promise<void> {
    for (const file of await this.backend.takePending()) await this.openFile(file);
  }

  async openRecent(key: string): Promise<void> {
    try {
      await this.openFile(await this.backend.recentOpen(key));
    } catch (error) {
      this.fail(error, 'That file was moved or deleted.');
      await this.refreshRecent();
    }
  }

  async openFile(file: FileRef): Promise<void> {
    const existing = this.state.docs.find((d) => d.file?.key === file.key);
    if (existing) {
      await this.backend.release(file.token);
      this.activate(existing.id);
      return;
    }
    const match = this.formatFor(file.name);
    if (!match) {
      await this.backend.release(file.token);
      this.notify(`${this.appName} can't open ${file.name}.`, 'error');
      return;
    }
    try {
      const bytes = await this.backend.read(file.token);
      const id = newId();
      await this.addSession(id, match.format, match.type.ext, file.name, bytes, file, false);
      const view = await this.backend.viewStateGet(file.key).catch(() => null);
      if (view !== null && view !== undefined) this.sessions.get(id)?.restoreViewState?.(view);
      if (file.readOnly) this.notify(`${file.name} is read-only. Use Save As to keep your changes.`, 'warning');
      if (!match.type.canSave) this.notify(`${file.name} opens read-only. Save As to edit it as a new file.`, 'info');
    } catch (error) {
      await this.backend.release(file.token).catch(() => undefined);
      this.fail(error, `${file.name} couldn't be opened.`);
    }
    void this.refreshRecent();
  }

  private async addSession(
    id: string,
    format: FormatModule,
    ext: string,
    title: string,
    bytes: Uint8Array,
    file: FileRef | null,
    dirty: boolean,
  ) {
    const session = await format.open({ bytes, name: title }, this.hostFor(id));
    this.sessions.set(id, session);
    const stateId = session.stateId();
    const doc: Doc = {
      id,
      title,
      file,
      ext,
      format: format.id,
      savedStateId: dirty ? -1 : stateId,
      stateId,
      saving: false,
      lossy: session.lossy(),
      lossyAcknowledged: false,
    };
    this.unsubscribe.set(id, session.subscribe(() => this.changed(id)));
    this.set((s) => ({ docs: [...s.docs, doc], activeId: id }));
  }

  private changed(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    const stateId = session.stateId();
    if (stateId !== this.doc(id)?.stateId) this.lastChange.set(id, this.now());
    this.updateDoc(id, { stateId, lossy: session.lossy() });
    this.set((s) => ({ version: s.version + 1 }));
  }

  private hostFor(id: string): DocHost {
    return {
      changed: () => this.changed(id),
      notify: (message, intent) => this.notify(message, intent),
      openAnother: async (extensions, label) => {
        const filter = extensions.length
          ? { label: label ?? `${extensions.map((e) => e.toUpperCase()).join(', ')} files`, extensions }
          : undefined;
        const [file] = await this.backend.pickOpen(false, filter);
        if (!file) return null;
        try {
          if (extensions.length && !extensions.includes(extensionOf(file.name))) {
            this.notify(`${file.name} isn't a supported file here.`, 'warning');
            return null;
          }
          return { name: file.name, bytes: await this.backend.read(file.token) };
        } finally {
          await this.backend.release(file.token);
        }
      },
      openOthers: async (extensions, label) => {
        const filter = extensions.length
          ? { label: label ?? `${extensions.map((e) => e.toUpperCase()).join(', ')} files`, extensions }
          : undefined;
        const picked: { name: string; bytes: Uint8Array }[] = [];
        for (const file of await this.backend.pickOpen(true, filter)) {
          try {
            if (extensions.length && !extensions.includes(extensionOf(file.name))) {
              this.notify(`${file.name} isn't a supported file here.`, 'warning');
              continue;
            }
            picked.push({ name: file.name, bytes: await this.backend.read(file.token) });
          } finally {
            await this.backend.release(file.token);
          }
        }
        return picked;
      },
      saveCopy: (bytes, suggestedName) => this.saveProduced(id, bytes, suggestedName),
      saveCopies: (files, title) => this.saveProducedMany(files, title),
      openLink: (url) => this.backend.openLink(url),
      toggleFullscreen: () => void this.setFullscreen(!this.state.fullscreen),
      isFullscreen: () => this.state.fullscreen,
      presenterScreen: (open) => this.backend.presenterScreen(open).catch(() => false),
      secure: {
        put: (key, bytes) => this.backend.securePut(key, bytes),
        get: (key) => this.backend.secureGet(key),
        delete: (key) => this.backend.secureDelete(key),
        keys: () => this.backend.secureKeys(),
      },
    };
  }

  // ---- Tabs ---------------------------------------------------------------------------------

  activate(id: string): void {
    if (this.doc(id)) this.set({ activeId: id });
  }

  reorder(from: number, to: number): void {
    this.set((s) => {
      const docs = [...s.docs];
      const [moved] = docs.splice(from, 1);
      if (moved) docs.splice(Math.max(0, Math.min(to, docs.length)), 0, moved);
      return { docs };
    });
  }

  cycle(step: 1 | -1): void {
    const { docs, activeId } = this.state;
    const index = docs.findIndex((d) => d.id === activeId);
    const next = docs[(index + step + docs.length) % docs.length];
    if (next) this.activate(next.id);
  }

  // ---- Saving ---------------------------------------------------------------------------------

  /** Saves bytes a document produced (a flattened copy...) as a new file; the tab is unchanged. */
  private async saveProduced(id: string, bytes: Uint8Array, suggestedName: string): Promise<boolean> {
    const doc = this.doc(id);
    if (!doc) return false;
    // Any kind of file (a PDF's attachment, say); without an extension the dialog offers all files.
    const ext = extensionOf(suggestedName);
    const type = this.formats.find((f) => f.id === doc.format)?.fileTypes.find((t) => t.ext === ext);
    const label = type?.label ?? (ext ? `${ext.toUpperCase()} file` : 'All files');
    const file = await this.backend.pickSave(suggestedName, label, ext);
    if (!file) return false;
    try {
      if ((await this.write(file, bytes)) !== 'ok') return false;
      this.notify(`Saved ${file.name}.`, 'success');
      return true;
    } finally {
      await this.backend.release(file.token).catch(() => undefined);
    }
  }

  /** Saves several produced files into a folder the user picks; never overwrites. */
  private async saveProducedMany(files: { bytes: Uint8Array; name: string }[], title: string): Promise<number> {
    if (files.length === 0) return 0;
    const folder = await this.backend.pickFolder(title);
    if (!folder) return 0;
    let saved = 0;
    try {
      for (const file of files) {
        await this.backend.saveIntoFolder(folder.token, file.name, file.bytes);
        saved += 1;
      }
      this.notify(`Saved ${saved} ${saved === 1 ? 'file' : 'files'} in ${folder.name}.`, 'success');
    } catch (error) {
      const reason = isFolioError(error) || error instanceof Error ? error.message : 'Something went wrong.';
      this.notify(
        saved ? `Only ${saved} of ${files.length} files were saved. ${reason}` : `The files couldn't be saved. ${reason}`,
        'error',
      );
    } finally {
      await this.backend.releaseFolder(folder.token).catch(() => undefined);
    }
    return saved;
  }

  private saveTypeFor(doc: Doc): FileTypeInfo | undefined {
    const types = this.formats.find((f) => f.id === doc.format)?.fileTypes ?? [];
    return types.find((t) => t.ext === doc.ext && t.canSave) ?? types.find((t) => t.canSave);
  }

  /** Saves a document. Resolves true once it's written somewhere, false if not. */
  async save(id: string | null = this.state.activeId, mode: SaveMode = 'save'): Promise<boolean> {
    const doc = this.doc(id);
    const session = this.session(id);
    if (!doc || !session || doc.saving) return false;
    const type = this.saveTypeFor(doc);
    if (!type) {
      this.notify(`${this.appName} can't save this kind of file.`, 'error');
      return false;
    }

    let target: 'file' | 'new' | 'copy' = mode === 'saveAs' ? 'new' : mode === 'saveCopy' ? 'copy' : 'file';
    if (target === 'file' && (!doc.file || doc.file.readOnly || type.ext !== doc.ext)) target = 'new';
    if (target === 'file' && doc.lossy.length > 0 && !doc.lossyAcknowledged) {
      const choice = await this.ask(
        `Save ${doc.title}?`,
        `${this.appName} can't keep ${listOf(doc.lossy)} when it saves this file. Save a copy to leave the original as it is.`,
        [
          { label: 'Save a copy', value: 'copy', appearance: 'primary' },
          { label: 'Save anyway', value: 'anyway' },
          { label: 'Cancel', value: 'cancel' },
        ],
      );
      if (choice === 'cancel') return false;
      if (choice === 'copy') target = 'copy';
      else this.updateDoc(doc.id, { lossyAcknowledged: true });
    }

    this.updateDoc(doc.id, { saving: true });
    let retryAs = false;
    try {
      await session.settle?.();
      const savedState = session.stateId();
      const bytes = await session.save(type.ext);
      let file = target === 'file' ? doc.file : null;
      if (!file) {
        const name = target === 'copy' ? copyName(doc.title, type.ext) : withExtension(doc.title, type.ext);
        file = await this.backend.pickSave(name, type.label, type.ext);
        if (!file) return false;
      }
      const result = await this.write(file, bytes);
      if (result !== 'ok') {
        if (target !== 'file') await this.backend.release(file.token);
        retryAs = result === 'saveAs';
        return false;
      }
      if (target === 'copy') {
        await this.backend.release(file.token);
        this.notify(`Saved a copy as ${file.name}.`, 'success');
        return true;
      }
      if (target === 'new' && doc.file && doc.file.token !== file.token) await this.backend.release(doc.file.token);
      this.updateDoc(doc.id, { file, title: file.name, ext: type.ext, savedStateId: savedState });
      session.saved?.(type.ext);
      this.snapshots.delete(doc.id);
      await this.backend.recoveryDrop(doc.id).catch(() => undefined);
      void this.refreshRecent();
      return true;
    } catch (error) {
      this.fail(error, `${doc.title} couldn't be saved.`);
      return false;
    } finally {
      this.updateDoc(doc.id, { saving: false });
      if (retryAs) void this.save(doc.id, 'saveAs');
    }
  }

  private async write(file: FileRef, bytes: Uint8Array): Promise<WriteResult> {
    try {
      await this.backend.save(file.token, bytes);
      return 'ok';
    } catch (error) {
      if (!isFolioError(error)) throw error;
      switch (error.kind) {
        case 'conflict': {
          const choice = await this.ask(
            `${file.name} changed on disk`,
            'Another program changed this file after you opened it. Save your version as a new file, or overwrite theirs?',
            [
              { label: 'Save as…', value: 'saveAs', appearance: 'primary' },
              { label: 'Overwrite', value: 'overwrite' },
              { label: 'Cancel', value: 'cancel' },
            ],
          );
          if (choice === 'overwrite') {
            await this.backend.save(file.token, bytes, true);
            return 'ok';
          }
          return choice === 'saveAs' ? 'saveAs' : 'cancelled';
        }
        case 'readOnly':
        case 'denied':
          this.notify(`${file.name} can't be changed here. Choose another place to save it.`, 'warning');
          return 'saveAs';
        case 'locked':
          this.notify(`Another program is using ${file.name}. Close it there, then save again.`, 'error');
          return 'cancelled';
        case 'diskFull':
          this.notify('The disk is full. Free up some space, then save again.', 'error');
          return 'cancelled';
        default:
          throw error;
      }
    }
  }

  // ---- Closing ----------------------------------------------------------------------------------

  /** Closes a tab, asking first if it has unsaved changes. Resolves false if cancelled. */
  async close(id: string): Promise<boolean> {
    // An edit still being applied counts as a change.
    await this.sessions.get(id)?.settle?.().catch(() => undefined);
    const doc = this.doc(id);
    if (!doc) return true;
    if (isDirty(doc)) {
      this.activate(id);
      const choice = await this.ask(`Save changes to ${doc.title}?`, "Your changes will be lost if you don't save them.", [
        { label: 'Save', value: 'save', appearance: 'primary' },
        { label: "Don't save", value: 'discard' },
        { label: 'Cancel', value: 'cancel' },
      ]);
      if (choice === 'cancel') return false;
      if (choice === 'save' && !(await this.save(id))) return false;
    }
    await this.dispose(id);
    return true;
  }

  /** The window is closing: close every tab; stop at the first "Cancel". */
  async closeAll(): Promise<boolean> {
    for (const doc of [...this.state.docs]) {
      if (!(await this.close(doc.id))) return false;
    }
    this.stop();
    return true;
  }

  private async dispose(id: string) {
    const doc = this.doc(id);
    const session = this.sessions.get(id);
    if (doc?.file && session?.viewState) {
      await this.backend.viewStateSet(doc.file.key, session.viewState()).catch(() => undefined);
    }
    this.unsubscribe.get(id)?.();
    this.unsubscribe.delete(id);
    session?.dispose();
    this.sessions.delete(id);
    this.snapshots.delete(id);
    if (doc?.file) await this.backend.release(doc.file.token).catch(() => undefined);
    await this.backend.recoveryDrop(id).catch(() => undefined);
    this.set((s) => {
      const index = s.docs.findIndex((d) => d.id === id);
      const docs = s.docs.filter((d) => d.id !== id);
      const activeId =
        s.activeId === id ? (docs[Math.min(index, docs.length - 1)]?.id ?? null) : s.activeId;
      return { docs, activeId };
    });
  }

  // ---- Recovery ---------------------------------------------------------------------------------

  /** Takes recovery snapshots of documents with unsaved changes (runs every few seconds). */
  async snapshotDirty(): Promise<void> {
    const now = this.now();
    for (const doc of this.state.docs) {
      if (!isDirty(doc)) continue;
      const last = this.snapshots.get(doc.id);
      if (last?.stateId === doc.stateId) continue;
      if (last && now - last.at < SNAPSHOT_EVERY_MS) continue;
      if (now - (this.lastChange.get(doc.id) ?? 0) < SNAPSHOT_AFTER_IDLE_MS) continue;
      const session = this.sessions.get(doc.id);
      if (!session) continue;
      try {
        const bytes = await (session.snapshot?.() ?? session.save(doc.ext));
        await this.backend.recoveryPut(doc.id, doc.title, bytes, doc.file?.token);
        this.snapshots.set(doc.id, { stateId: doc.stateId, at: now });
      } catch {
        // Try again next round.
      }
    }
  }

  async restore(docId: string): Promise<void> {
    const snapshot = this.state.recovered.find((s) => s.doc === docId);
    const match = snapshot && this.formatFor(snapshot.name);
    if (!snapshot || !match) return;
    try {
      const bytes = await this.backend.recoveryRead(docId);
      const origin = await this.backend.recoveryOrigin(docId).catch(() => null);
      await this.addSession(docId, match.format, match.type.ext, snapshot.name, bytes, origin, true);
      this.set((s) => ({ recovered: s.recovered.filter((r) => r.doc !== docId) }));
    } catch (error) {
      this.fail(error, `${snapshot.name} couldn't be restored.`);
    }
  }

  async discardRecovered(docId: string): Promise<void> {
    await this.backend.recoveryDrop(docId).catch(() => undefined);
    this.set((s) => ({ recovered: s.recovered.filter((r) => r.doc !== docId) }));
  }

  async refreshRecent(): Promise<void> {
    this.set({ recent: await this.backend.recentList().catch(() => []) });
  }

  async refreshRecovered(): Promise<void> {
    const open = new Set(this.state.docs.map((d) => d.id));
    const recovered = await this.backend.recoveryList().catch(() => []);
    this.set({ recovered: recovered.filter((r) => !open.has(r.doc)) });
  }

  // ---- Commands ---------------------------------------------------------------------------------

  async setFullscreen(on: boolean): Promise<void> {
    if (on === this.state.fullscreen) return;
    try {
      await this.backend.setFullscreen(on);
      this.set({ fullscreen: on });
      if (on) this.notify('Press Esc or F11 to leave full screen.');
    } catch (error) {
      this.fail(error, "Full screen isn't available.");
    }
  }

  async setTheme(theme: 'system' | 'light' | 'dark'): Promise<void> {
    const settings = await this.backend.setSettings({ theme });
    this.set({ settings });
    await this.backend.setWindowTheme(theme === 'system' ? null : theme).catch(() => undefined);
  }

  async print(): Promise<void> {
    const session = this.session(this.state.activeId);
    if (session?.print) await session.print();
    else window.print();
  }

  /** Every command: the shell's own, then the active document's. */
  commands(): Command[] {
    const active = this.state.activeId;
    const hasDoc = () => this.state.activeId !== null;
    const shell: Command[] = [
      { id: 'file.open', title: 'Open…', group: 'File', keys: 'Ctrl+O', run: () => this.openDialog() },
      { id: 'file.save', title: 'Save', group: 'File', keys: 'Ctrl+S', enabled: hasDoc, run: () => this.save() },
      { id: 'file.saveAs', title: 'Save as…', group: 'File', keys: 'F12', enabled: hasDoc, run: () => this.save(active, 'saveAs') },
      { id: 'file.saveCopy', title: 'Save a copy…', group: 'File', enabled: hasDoc, run: () => this.save(active, 'saveCopy') },
      { id: 'file.print', title: 'Print…', group: 'File', keys: 'Ctrl+P', enabled: hasDoc, run: () => this.print() },
      { id: 'tab.close', title: 'Close tab', group: 'Tabs', keys: 'Ctrl+W', enabled: hasDoc, run: () => active && this.close(active) },
      { id: 'tab.next', title: 'Next tab', group: 'Tabs', keys: 'Ctrl+Tab', run: () => this.cycle(1) },
      { id: 'tab.previous', title: 'Previous tab', group: 'Tabs', keys: 'Ctrl+Shift+Tab', run: () => this.cycle(-1) },
      { id: 'app.search', title: 'Search commands', group: 'Help', keys: 'Alt+Q', run: () => this.set({ paletteOpen: true }) },
      {
        id: 'view.fullscreen',
        title: this.state.fullscreen ? 'Leave full screen' : 'Full screen',
        group: 'View',
        keys: 'F11',
        run: () => this.setFullscreen(!this.state.fullscreen),
      },
      { id: 'view.theme.system', title: 'Theme: follow Windows', group: 'View', run: () => this.setTheme('system') },
      { id: 'view.theme.light', title: 'Theme: light', group: 'View', run: () => this.setTheme('light') },
      { id: 'view.theme.dark', title: 'Theme: dark', group: 'View', run: () => this.setTheme('dark') },
      {
        id: 'privacy.networkLock',
        title: 'Network lock status',
        group: 'Privacy',
        run: () => this.checkNetworkLock(true),
      },
      {
        id: 'privacy.clearRecent',
        title: 'Clear recent files',
        group: 'Privacy',
        run: async () => {
          await this.backend.recentClear();
          await this.refreshRecent();
        },
      },
      {
        id: 'privacy.clearBackups',
        title: 'Delete backups of files you saved',
        group: 'Privacy',
        run: async () => {
          await this.backend.backupsClear();
          this.notify('Backups deleted.', 'success');
        },
      },
    ];
    return [...shell, ...(this.session(active)?.commands() ?? [])];
  }

  setPaletteOpen(open: boolean): void {
    this.set({ paletteOpen: open });
  }
}
