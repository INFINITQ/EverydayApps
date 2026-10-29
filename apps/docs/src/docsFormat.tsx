// Folio Docs' format module. Each open document gets a session: the original package (kept for
// patching saves, see patch.ts), the docx-editor.dev engine that lays it out and edits it, and
// Folio's own toolbar, panels and dialogs around it.

import type { DocumentChange, Editor } from '@docx-editor.dev/core';
import { runToolbarCommand, toolbarCommandState } from '@docx-editor.dev/core';
import { DocxEditor, useDocxEditor, useEditorSnapshot } from '@docx-editor.dev/react';
import type { Command, DocHost, DocumentSession, FormatModule } from '@folio/shell';
import { Button, MessageBar, MessageBarActions, MessageBarBody, Spinner } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { unzipSync } from 'fflate';
import { useEffect, useSyncExternalStore } from 'react';
import { DocsToolbar } from './DocsToolbar';
import { whenOpened } from './engine';
import { convertDoc } from './legacy';
import { type DocumentFacts, DocxPackage, checkXmlSafety, decodeXml, readFacts } from './ooxml';
import { type Baseline, PatchError, baselineOf, engineLosses, patchPackage, verifyPackage } from './patch';
import { printPages } from './print';
import { CommentsPanel, FindPanel, InsertTableDialog, LinkBar, LinkDialog, OutlinePanel, PageSetupDialog, WordCountDialog } from './panels';
import { type SlotId, pictureFile, textStats } from './text';

export const docsFormat: FormatModule = {
  id: 'docs',
  fileTypes: [
    { ext: 'docx', label: 'Word document', canSave: true },
    { ext: 'docm', label: 'Word macro-enabled document', canSave: true },
    { ext: 'doc', label: 'Word 97-2003 document', canSave: false },
  ],
  open: (file, host) => openDocument(file, host),
};

const extensionOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

export async function openDocument(file: { bytes: Uint8Array; name: string }, host: DocHost): Promise<DocsSession> {
  const legacy = extensionOf(file.name) === 'doc';
  const bytes = legacy ? await convertDoc(file.bytes) : file.bytes;
  const pkg = new DocxPackage(bytes);
  checkXmlSafety(pkg);
  return new DocsSession(pkg, readFacts(pkg), host, legacy);
}

export type Panel = 'find' | 'comments' | 'outline';
export type Stats = { words: number; characters: number; charactersWithSpaces: number; paragraphs: number };

export type DocsState = {
  ready: boolean;
  failure: string | null;
  mode: 'edit' | 'view';
  panel: Panel | null;
  /** The find panel shows its replace row. */
  replacing: boolean;
  /** A link the user activated, waiting for "Open it?". */
  linkPrompt: string | null;
  dialog: 'wordCount' | 'insertTable' | 'pageSetup' | null;
  stats: Stats | null;
  /** Bumped when the selection or formatting changes (toolbar state). */
  tick: number;
  /** Notices the user closed. */
  dismissed: string[];
};

/** Typing pauses this long before Folio fingerprints the content (unsaved-changes check). */
const IDLE_MS = 400;

export class DocsSession implements DocumentSession {
  editor: Editor | null = null;
  /** The file as last opened or saved; saves are patched against it. */
  private original: DocxPackage;
  private baseline: Baseline | null = null;
  private losses: { id: string; label: string }[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly stateListeners = new Set<() => void>();
  private state: DocsState;
  private current = 0;
  private nextId = 1;
  /** Content fingerprints seen so far and the state id each one had. */
  private readonly fingerprints = new Map<string, number>();
  private idle: ReturnType<typeof setTimeout> | undefined;
  private opened: Promise<void>;
  private resolveOpened!: () => void;
  private rejectOpened!: (error: Error) => void;
  /** The bytes the engine opens; a stable object so the editor never reloads by accident. */
  readonly source: Uint8Array;

  constructor(
    pkg: DocxPackage,
    readonly facts: DocumentFacts,
    readonly host: DocHost,
    readonly legacy: boolean,
  ) {
    this.original = pkg;
    this.source = pkg.bytes;
    this.state = {
      ready: false,
      failure: null,
      mode: legacy ? 'view' : 'edit',
      panel: null,
      replacing: false,
      linkPrompt: null,
      dialog: null,
      stats: null,
      tick: 0,
      dismissed: [],
    };
    this.opened = new Promise((resolve, reject) => {
      this.resolveOpened = resolve;
      this.rejectOpened = reject;
    });
    this.opened.catch(() => undefined);
  }

  // ---- UI state --------------------------------------------------------------------------

  get ui(): DocsState {
    return this.state;
  }

  update(patch: Partial<DocsState>): void {
    this.state = { ...this.state, ...patch };
    this.stateListeners.forEach((l) => l());
    this.emit();
  }

  watch = (listener: () => void) => {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  };

  private emit() {
    this.listeners.forEach((l) => l());
  }

  // ---- The engine ------------------------------------------------------------------------

  /** Called by the view once the engine has an editor for this document. */
  async attach(editor: Editor): Promise<void> {
    if (this.editor === editor) return;
    this.editor = editor;
    try {
      await whenOpened(editor);
      if (this.editor !== editor) return;
      const first = new Uint8Array(await editor.save());
      this.baseline = baselineOf(first);
      this.losses = engineLosses(this.original, this.baseline);
      this.fingerprints.set(fingerprint(first), 0);
      this.update({ ready: true, stats: statsOf(first) });
      this.resolveOpened();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The document couldn’t be opened.';
      this.update({ failure: message });
      this.rejectOpened(new Error(message));
    }
  }

  /** The engine changed the document. */
  documentChanged(change: DocumentChange): void {
    if (change.source === 'load' || change.source === 'recovery') return;
    this.current = this.nextId++;
    this.emit();
    clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.fingerprintNow(), IDLE_MS);
  }

  /** Selection, formatting or page changed: toolbar and status bar. */
  selectionChanged(): void {
    this.update({ tick: this.state.tick + 1 });
    this.host.changed();
  }

  /** Recognises content seen before (undo back to the saved text counts as unchanged). */
  private async fingerprintNow() {
    const editor = this.editor;
    if (!editor) return;
    const id = this.current;
    const bytes = new Uint8Array(await editor.save());
    if (id !== this.current) return;
    const print = fingerprint(bytes);
    const known = this.fingerprints.get(print);
    if (known === undefined) this.fingerprints.set(print, id);
    else this.current = known;
    this.update({ stats: statsOf(bytes) });
  }

  run(slot: SlotId, value?: unknown): void {
    const editor = this.editor;
    if (!editor || !this.state.ready) return;
    if (value === undefined) runToolbarCommand(editor, slot as never);
    else runToolbarCommand(editor, slot as never, value as never);
    this.selectionChanged();
  }

  slot(slot: SlotId): { enabled: boolean; active: boolean } {
    const editor = this.editor;
    if (!editor || !this.state.ready) return { enabled: false, active: false };
    if (this.state.mode === 'view') return { enabled: false, active: false };
    const state = toolbarCommandState(editor, slot as never);
    return { enabled: state.enabled, active: state.active };
  }

  async insertPicture(): Promise<void> {
    const editor = this.editor;
    if (!editor) return;
    const file = await this.host.openAnother(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'], 'Pictures');
    if (!file) return;
    try {
      const picture = await pictureFile(file);
      const result = await editor.executeImageCommand({ type: 'insertImage', ...picture });
      if (!result.ok) this.host.notify(`The picture couldn’t be inserted${'reason' in result && result.reason ? `: ${String(result.reason)}` : '.'}`, 'warning');
    } catch (error) {
      this.host.notify(error instanceof Error ? error.message : 'The picture couldn’t be inserted.', 'error');
    }
  }

  /** Asks before a link from the document opens in the browser or mail app. */
  askToOpen(href: string): void {
    this.update({ linkPrompt: href });
  }

  // ---- DocumentSession ---------------------------------------------------------------------

  View = () => <DocsView session={this} />;

  stateId(): number {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  lossy(): { id: string; label: string }[] {
    return this.losses;
  }

  commands(): Command[] {
    return documentCommands(this);
  }

  async settle(): Promise<void> {
    if (!this.state.ready) return;
    clearTimeout(this.idle);
    await this.fingerprintNow();
  }

  async save(): Promise<Uint8Array> {
    await this.opened;
    const editor = this.editor!;
    const edited = new Uint8Array(await editor.save());
    let bytes: Uint8Array;
    try {
      bytes = patchPackage(this.original, this.baseline, edited).bytes;
    } catch (error) {
      if (!(error instanceof PatchError)) throw error;
      // The engine's own package, if it holds together, still has every edit.
      verifyPackage(edited, null);
      console.warn('folio-docs: patching failed, saving the engine output', error);
      this.host.notify(
        'Folio couldn’t keep every part of the original file exactly as it was, so it saved the editor’s version of the whole document.',
        'warning',
      );
      bytes = edited;
    }
    // The next save is patched against what was just written.
    this.original = new DocxPackage(bytes);
    this.baseline = baselineOf(edited);
    return bytes;
  }

  async snapshot(): Promise<Uint8Array> {
    await this.opened;
    return patchPackage(this.original, this.baseline, new Uint8Array(await this.editor!.save())).bytes;
  }

  async print(): Promise<void> {
    await this.opened;
    await printPages(this.editor);
  }

  /** PDF goes through the print dialog: Windows' own "Microsoft Print to PDF" writes the file. */
  async exportPdf(): Promise<void> {
    this.host.notify('To save a PDF, choose “Microsoft Print to PDF” (or “Save as PDF”) as the printer.', 'info');
    await this.print();
  }

  status() {
    const editor = this.editor;
    const page = editor && this.state.ready ? (editor as unknown as { snapshot(): { page?: { current: number; total: number } } }).snapshot().page : null;
    const parts: string[] = [];
    if (page && page.total > 0) parts.push(`Page ${page.current} of ${page.total}`);
    if (this.state.stats) parts.push(`${this.state.stats.words.toLocaleString()} ${this.state.stats.words === 1 ? 'word' : 'words'}`);
    if (this.facts.macros) parts.push('Macros kept, never run');
    if (this.state.mode === 'view') parts.push('Read-only');
    return parts.join(' · ');
  }

  dispose(): void {
    clearTimeout(this.idle);
    this.listeners.clear();
    this.stateListeners.clear();
    this.editor = null;
  }
}

/** Identifies content: every part of the engine's package, unpacked (zip timestamps aside). */
export function fingerprint(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const name of Object.keys(files).sort()) {
    for (const data of [new TextEncoder().encode(name), files[name]!]) {
      for (let i = 0; i < data.length; i++) {
        a = Math.imul(a ^ data[i]!, 0x01000193) >>> 0;
        b = (Math.imul(b ^ data[i]!, 0x5bd1e995) + (b >>> 15)) >>> 0;
      }
    }
  }
  return `${a.toString(16)}-${b.toString(16)}-${bytes.length}`;
}

function statsOf(bytes: Uint8Array): Stats | null {
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
    const document = files['word/document.xml'];
    return document ? textStats(decodeXml(document)) : null;
  } catch {
    return null;
  }
}

function useDocsState(session: DocsSession): DocsState {
  return useSyncExternalStore(session.watch, () => session.ui);
}

/** Lives inside the engine's tree: hands its editor to the session and reports changes. */
function EngineBridge({ session }: { session: DocsSession }) {
  const editor = useDocxEditor();
  const revision = useEditorSnapshot(editor);
  useEffect(() => {
    if (editor) void session.attach(editor);
  }, [editor, session]);
  useEffect(() => {
    if (revision > 0) session.selectionChanged();
  }, [revision, session]);
  return null;
}

function Notices({ session, state }: { session: DocsSession; state: DocsState }) {
  const facts = session.facts;
  const items: { id: string; intent: 'info' | 'warning'; text: string; action?: { label: string; run: () => void } }[] = [];
  if (session.legacy) {
    items.push({
      id: 'legacy',
      intent: 'info',
      text: 'This is an old Word 97-2003 document, opened read-only. Folio never changes it: Save as (F12) makes a .docx copy you can edit.',
      ...(state.mode === 'view' ? { action: { label: 'Edit anyway', run: () => session.update({ mode: 'edit' }) } } : {}),
    });
  }
  if (facts.macros) {
    items.push({ id: 'macros', intent: 'warning', text: 'This document contains macros. Folio never runs them, and keeps them unchanged when it saves.' });
  }
  if (facts.linkedPictures + facts.linkedOther > 0) {
    const what = facts.linkedPictures > 0 ? `${facts.linkedPictures} ${facts.linkedPictures === 1 ? 'picture' : 'pictures'}` : 'content';
    items.push({ id: 'linked', intent: 'info', text: `This document links to ${what} outside the file. Folio never loads it; the links are kept.` });
  }
  const visible = items.filter((i) => !state.dismissed.includes(i.id));
  if (visible.length === 0) return null;
  return (
    <div className="docs-notices">
      {visible.map((item) => (
        <MessageBar key={item.id} intent={item.intent} layout="singleline">
          <MessageBarBody>{item.text}</MessageBarBody>
          <MessageBarActions
            containerAction={
              <Button
                aria-label="Dismiss"
                appearance="transparent"
                icon={<DismissRegular />}
                onClick={() => session.update({ dismissed: [...state.dismissed, item.id] })}
              />
            }
          >
            {item.action && <Button onClick={item.action.run}>{item.action.label}</Button>}
          </MessageBarActions>
        </MessageBar>
      ))}
    </div>
  );
}

function DocsView({ session }: { session: DocsSession }) {
  const state = useDocsState(session);
  return (
    <div className="docs-root">
      <DocxEditor.Root
        document={session.source}
        mode={state.mode}
        zoomMode="auto"
        onChange={(change) => session.documentChanged(change)}
        onFontError={(error) => console.warn('folio-docs: font', error.message)}
      >
        <EngineBridge session={session} />
        <DocsToolbar session={session} state={state} />
        <Notices session={session} state={state} />
        {state.failure ? (
          <MessageBar intent="error">
            <MessageBarBody>This document couldn’t be opened: {state.failure}</MessageBarBody>
          </MessageBar>
        ) : (
          <div className="docs-body">
            <DocxEditor.Viewport className="docs-viewport">
              <DocxEditor.Content />
            </DocxEditor.Viewport>
            {!state.ready && (
              <div className="docs-loading">
                <Spinner label="Opening…" />
              </div>
            )}
            {state.panel === 'find' && <FindPanel session={session} state={state} />}
            {state.panel === 'comments' && <CommentsPanel session={session} />}
            {state.panel === 'outline' && <OutlinePanel session={session} />}
          </div>
        )}
        <LinkBar session={session} />
        <LinkDialog session={session} href={state.linkPrompt} />
        {state.dialog === 'wordCount' && <WordCountDialog session={session} stats={state.stats} />}
        {state.dialog === 'insertTable' && <InsertTableDialog session={session} />}
        {state.dialog === 'pageSetup' && <PageSetupDialog session={session} />}
      </DocxEditor.Root>
    </div>
  );
}

/** Commands for the palette and shortcuts. */
function documentCommands(session: DocsSession): Command[] {
  const can = (slot: SlotId) => () => session.slot(slot).enabled;
  const ready = () => session.ui.ready;
  const editing = () => session.ui.ready && session.ui.mode === 'edit';
  const slot = (id: string, title: string, group: string, s: SlotId, keys?: string): Command => ({
    id,
    title,
    group,
    ...(keys ? { keys } : {}),
    enabled: can(s),
    run: () => session.run(s),
  });
  return [
    slot('edit.undo', 'Undo', 'Edit', 'history.undo', 'Ctrl+Z'),
    slot('edit.redo', 'Redo', 'Edit', 'history.redo', 'Ctrl+Y'),
    {
      id: 'edit.find',
      title: 'Find',
      group: 'Edit',
      keys: 'Ctrl+F',
      enabled: ready,
      run: () => session.update({ panel: 'find', replacing: false }),
    },
    {
      id: 'edit.replace',
      title: 'Replace',
      group: 'Edit',
      keys: 'Ctrl+H',
      enabled: editing,
      run: () => session.update({ panel: 'find', replacing: true }),
    },
    slot('format.bold', 'Bold', 'Format', 'text.bold', 'Ctrl+B'),
    slot('format.italic', 'Italic', 'Format', 'text.italic', 'Ctrl+I'),
    slot('format.underline', 'Underline', 'Format', 'text.underline', 'Ctrl+U'),
    slot('format.strike', 'Strikethrough', 'Format', 'text.strike'),
    slot('format.superscript', 'Superscript', 'Format', 'script.super', 'Ctrl+Shift++'),
    slot('format.subscript', 'Subscript', 'Format', 'script.sub', 'Ctrl+='),
    slot('format.clear', 'Clear formatting', 'Format', 'format.clear', 'Ctrl+Space'),
    slot('format.alignLeft', 'Align left', 'Paragraph', 'alignment.left', 'Ctrl+L'),
    slot('format.alignCenter', 'Center', 'Paragraph', 'alignment.center', 'Ctrl+E'),
    slot('format.alignRight', 'Align right', 'Paragraph', 'alignment.right', 'Ctrl+R'),
    slot('format.justify', 'Justify', 'Paragraph', 'alignment.justify', 'Ctrl+J'),
    slot('format.bullets', 'Bulleted list', 'Paragraph', 'list.bullet'),
    slot('format.numbering', 'Numbered list', 'Paragraph', 'list.numbered'),
    slot('format.indent', 'Increase indent', 'Paragraph', 'list.indent'),
    slot('format.outdent', 'Decrease indent', 'Paragraph', 'list.outdent'),
    {
      id: 'insert.table',
      title: 'Table…',
      group: 'Insert',
      enabled: can('table.insert'),
      run: () => session.update({ dialog: 'insertTable' }),
    },
    { id: 'insert.picture', title: 'Picture…', group: 'Insert', enabled: editing, run: () => session.insertPicture() },
    {
      id: 'insert.link',
      title: 'Link…',
      group: 'Insert',
      keys: 'Ctrl+K',
      enabled: can('text.link'),
      run: () => session.run('text.link'),
    },
    slot('insert.pageBreak', 'Page break', 'Insert', 'insert.pageBreak', 'Ctrl+Enter'),
    slot('insert.sectionBreak', 'Section break (next page)', 'Insert', 'insert.sectionBreakNextPage'),
    slot('insert.footnote', 'Footnote', 'Insert', 'insert.footnote', 'Ctrl+Alt+F'),
    slot('insert.endnote', 'Endnote', 'Insert', 'insert.endnote', 'Ctrl+Alt+D'),
    slot('insert.toc', 'Table of contents', 'Insert', 'insert.toc'),
    slot('insert.pageNumber', 'Page number', 'Insert', 'insert.pageNumber'),
    slot('insert.pageXofY', 'Page X of Y', 'Insert', 'insert.pageXofY'),
    {
      id: 'layout.pageSetup',
      title: 'Page setup…',
      group: 'Layout',
      enabled: editing,
      run: () => session.update({ dialog: 'pageSetup' }),
    },
    {
      id: 'layout.header',
      title: 'Edit header',
      group: 'Layout',
      enabled: editing,
      run: () => session.editor?.exec({ type: 'editHeaderFooter', position: 'header' }),
    },
    {
      id: 'layout.footer',
      title: 'Edit footer',
      group: 'Layout',
      enabled: editing,
      run: () => session.editor?.exec({ type: 'editHeaderFooter', position: 'footer' }),
    },
    {
      id: 'review.comments',
      title: session.ui.panel === 'comments' ? 'Hide comments and tracked changes' : 'Comments and tracked changes',
      group: 'Review',
      enabled: ready,
      run: () => session.update({ panel: session.ui.panel === 'comments' ? null : 'comments' }),
    },
    {
      id: 'view.outline',
      title: session.ui.panel === 'outline' ? 'Hide navigation' : 'Navigation (headings)',
      group: 'View',
      enabled: ready,
      run: () => session.update({ panel: session.ui.panel === 'outline' ? null : 'outline' }),
    },
    slot('view.paragraphMarks', 'Show formatting marks', 'View', 'review.paragraphMarks', 'Ctrl+Shift+8'),
    { id: 'file.exportPdf', title: 'Export as PDF…', group: 'File', enabled: ready, run: () => session.exportPdf() },
    {
      id: 'tools.wordCount',
      title: 'Word count',
      group: 'Tools',
      keys: 'Ctrl+Shift+G',
      enabled: ready,
      run: () => session.update({ dialog: 'wordCount' }),
    },
  ];
}
