// Folio PDF's format module: one EmbedPDF registry per open document, sharing a single
// PDFium engine. Viewing: continuous scrolling with tiled rendering, zoom, page navigation,
// thumbnails, find, text selection, rotation, printing and saving. Editing: annotations,
// form filling, signatures, and organizing pages. Page changes go through pages.ts on the
// document's bytes; the result is reloaded into a fresh registry (a new "generation").

import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF, useDocumentState } from '@embedpdf/core/react';
import {
  PdfAnnotationSubtype,
  PdfErrorCode,
  PdfPageFlattenFlag,
  PdfPermissionFlag,
  type PdfAnnotationObject,
  type PdfAttachmentObject,
  type PdfBookmarkObject,
  type PdfDocumentObject,
  type PdfEngine,
  type PdfLinkTarget,
  type Rotation,
} from '@embedpdf/models';
import { AttachmentPluginPackage, useAttachmentCapability } from '@embedpdf/plugin-attachment/react';
import { BookmarkPluginPackage, useBookmarkCapability } from '@embedpdf/plugin-bookmark/react';
import { SpreadMode, SpreadPluginPackage, useSpreadCapability } from '@embedpdf/plugin-spread/react';
import {
  AnnotationLayer,
  AnnotationPluginPackage,
  LockModeType,
  useAnnotationCapability,
  type AnnotationToolOverride,
  type LockMode,
} from '@embedpdf/plugin-annotation/react';
import { FormPluginPackage, useFormPlugin } from '@embedpdf/plugin-form/react';
import {
  SignatureMode,
  SignaturePluginPackage,
  useSignatureCapability,
  type SignatureEntry,
} from '@embedpdf/plugin-signature/react';
import { StampPluginPackage, useStampCapability } from '@embedpdf/plugin-stamp/react';
import {
  DocumentContent,
  DocumentManagerPluginPackage,
  useDocumentManagerCapability,
} from '@embedpdf/plugin-document-manager/react';
import { ExportPluginPackage, useExportCapability } from '@embedpdf/plugin-export/react';
import { HistoryPluginPackage, useHistoryCapability } from '@embedpdf/plugin-history/react';
import { InteractionManagerPluginPackage, PagePointerProvider } from '@embedpdf/plugin-interaction-manager/react';
import { RenderLayer, RenderPluginPackage, useRenderCapability } from '@embedpdf/plugin-render/react';
import { RotatePluginPackage, useRotateCapability } from '@embedpdf/plugin-rotate/react';
import { ScrollPluginPackage, Scroller, useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { SearchLayer, SearchPluginPackage, useSearchCapability } from '@embedpdf/plugin-search/react';
import { SelectionLayer, SelectionPluginPackage } from '@embedpdf/plugin-selection/react';
import { ThumbnailPluginPackage } from '@embedpdf/plugin-thumbnail/react';
import { TilingLayer, TilingPluginPackage } from '@embedpdf/plugin-tiling/react';
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { ZoomMode, ZoomPluginPackage, useZoomCapability } from '@embedpdf/plugin-zoom/react';
import type { Command, DocHost, DocumentSession, FormatModule } from '@folio/shell';
import { Button } from '@fluentui/react-components';
import { FullScreenMinimizeRegular } from '@fluentui/react-icons';
import { type CSSProperties, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { AnnotateBar, colorOf, colorPatch, hasWidth, selectionMenu, SignDialog } from './annotate';
import { CommentsPanel } from './comments';
import { type Box, type PageContentInfo, type TextStyle, pageContent, strayChanges } from './content';
import { EditBar, EditLayer, RedactDialog, StrayDialog } from './edit';
import { pageTools, pdfEngine } from './engine';
import { serializeFieldWrites } from './fieldWrites';
import { OrganizeBar, OrganizeView, SplitDialog } from './organize';
import { type EditablePdf, PageError, movedOrder, pagesLabel } from './pages';
import { LinkDialog, PasswordPrompt, PropertiesDialog, ProtectDialog, attachmentName } from './dialogs';
import { SidePanel } from './panels';
import { decodePicture, picturePixels, pictureSize, picturesPdf } from './pictures';
import { PdfToolbar } from './PdfToolbar';
import { printPages } from './print';
import { savedSignatures } from './signatures';
import { STAMPS, stampLibrary } from './stamps';

export const pdfFormat: FormatModule = {
  id: 'pdf',
  fileTypes: [{ ext: 'pdf', label: 'PDF document', canSave: true }],
  open: async (file, host) => createPdfSession(await pdfEngine(), file.bytes, file.name, host),
};

/** The plugin capabilities a session drives, scoped to its one document. */
type Caps = {
  export: ReturnType<NonNullable<ReturnType<typeof useExportCapability>['provides']>['forDocument']>;
  history: NonNullable<ReturnType<typeof useHistoryCapability>['provides']>;
  zoom: ReturnType<NonNullable<ReturnType<typeof useZoomCapability>['provides']>['forDocument']>;
  scroll: ReturnType<NonNullable<ReturnType<typeof useScrollCapability>['provides']>['forDocument']>;
  search: NonNullable<ReturnType<typeof useSearchCapability>['provides']>;
  rotate: ReturnType<NonNullable<ReturnType<typeof useRotateCapability>['provides']>['forDocument']>;
  render: ReturnType<NonNullable<ReturnType<typeof useRenderCapability>['provides']>['forDocument']>;
  /** Tools, tool defaults and link events (shared by the registry's one document). */
  annotations: NonNullable<ReturnType<typeof useAnnotationCapability>['provides']>;
  annotation: ReturnType<NonNullable<ReturnType<typeof useAnnotationCapability>['provides']>['forDocument']>;
  signature: NonNullable<ReturnType<typeof useSignatureCapability>['provides']>;
  stamps: NonNullable<ReturnType<typeof useStampCapability>['provides']>;
  bookmarks: ReturnType<NonNullable<ReturnType<typeof useBookmarkCapability>['provides']>['forDocument']>;
  attachments: ReturnType<NonNullable<ReturnType<typeof useAttachmentCapability>['provides']>['forDocument']>;
  spread: ReturnType<NonNullable<ReturnType<typeof useSpreadCapability>['provides']>['forDocument']>;
  /** The open document: its pages, encryption and the permissions its author set. */
  document: PdfDocumentObject;
  /** Each page's own rotation (renders of single pages need it passed in). */
  rotations: Rotation[];
};

/**
 * What a PDF's author can forbid (with an owner password). Folio follows these, like other
 * PDF apps; files Folio protects allow everything to whoever has the password.
 */
export type Permission = 'annotate' | 'organize' | 'edit' | 'print' | 'secure';
const PERMISSION_FLAGS: Record<Exclude<Permission, 'secure'>, number> = {
  annotate: PdfPermissionFlag.ModifyAnnotations,
  organize: PdfPermissionFlag.AssembleDocument,
  edit: PdfPermissionFlag.ModifyContents,
  print: PdfPermissionFlag.Print,
};

/** Shown when a feature is off because of the document's own restrictions. */
export const RESTRICTED = "This PDF's author doesn't allow this.";

export type DocumentProperties = {
  fileName: string;
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  creator: string | null;
  producer: string | null;
  created: Date | null;
  modified: Date | null;
  pages: number;
  /** The current page's size in points. */
  pageSize: { width: number; height: number } | null;
  /** Bytes, as last loaded (edits since then aren't counted). */
  fileSize: number;
  encrypted: boolean;
  /** It took a password to open. */
  opensWithPassword: boolean;
  /** What the author doesn't allow (empty when everything is allowed). */
  restrictions: string[];
};

/**
 * Reading locks every annotation, so links can be followed and form fields filled without
 * moving anything by accident. Annotating unlocks annotations but keeps form fields in
 * fill-in mode (EmbedPDF's "form" category).
 */
const LOCKS: Record<ViewerState['mode'], LockMode> = {
  view: { type: LockModeType.All },
  annotate: { type: LockModeType.Include, categories: ['form'] },
  organize: { type: LockModeType.All },
  edit: { type: LockModeType.All },
};

/** Pixels that may differ outside an edited area before Folio says something else changed. */
const STRAY_PIXELS = 12;

/** Page changes keep the document's bytes for undo; past this much, the oldest are let go. */
const UNDO_BYTES = 400 * 1024 * 1024;

/** Tweaks to EmbedPDF's built-in tools: finer default lines; one-shot tools switch back to Select. */
const TOOL_OVERRIDES: AnnotationToolOverride[] = [
  { id: 'ink', defaults: { strokeWidth: 2 } },
  { id: 'square', defaults: { strokeWidth: 2 } },
  { id: 'circle', defaults: { strokeWidth: 2 } },
  { id: 'line', defaults: { strokeWidth: 2 } },
  { id: 'lineArrow', defaults: { strokeWidth: 2 } },
  { id: 'freeText', behavior: { deactivateToolAfterCreate: true } },
  { id: 'textComment', behavior: { deactivateToolAfterCreate: true } },
  { id: 'stamp', behavior: { deactivateToolAfterCreate: true } },
];

/** EmbedPDF writes a pen stroke this long after the pen lifts (its default commit delay). */
const INK_COMMIT_MS = 800;

export type AnnotationStyle = { color?: string; width?: number };

export type ViewerState = {
  ready: boolean;
  page: number;
  pages: number;
  zoom: number;
  /** The side panel is open (`panel` says what it shows). */
  thumbnails: boolean;
  panel: 'pages' | 'bookmarks' | 'attachments';
  /** The document's bookmarks (its outline) and attached files, once read. */
  outline: PdfBookmarkObject[];
  attachments: PdfAttachmentObject[];
  /** Two pages side by side: "odd" pairs 1-2, 3-4; "even" shows page 1 alone, then 2-3. */
  spread: 'none' | 'odd' | 'even';
  /** How pages look on screen (printing and saving are unchanged). */
  reading: 'normal' | 'dark' | 'sepia';
  /** A web or mail link that was clicked, waiting for the user to say whether to open it. */
  linkPrompt: string | null;
  protectOpen: boolean;
  propertiesOpen: boolean;
  /** The file is encrypted (it may need a password to open). */
  encrypted: boolean;
  findOpen: boolean;
  query: string;
  results: number;
  activeResult: number;
  /**
   * "annotate" shows the annotation tools and unlocks annotations; "organize" the page grid;
   * "edit" lets you change the page content itself (text, pictures, whiteout, redaction).
   */
  mode: 'view' | 'annotate' | 'organize' | 'edit';
  editTool: 'select' | 'text' | 'whiteout' | 'redact';
  /** The style new text gets. */
  textStyle: TextStyle;
  /** The picture (or text) selected in edit mode, by page and object number. */
  contentSelection: { page: number; index: number } | null;
  /** Areas marked for redaction, not yet applied. */
  redactions: { page: number; box: Box }[];
  redactOpen: boolean;
  /** The last edit changed something outside the edited area (the check found it). */
  strayChange: boolean;
  /** Pages selected in the organize grid (0-based, in page order). */
  pageSelection: number[];
  /** A page change is being applied. */
  busy: boolean;
  splitOpen: boolean;
  /** The page view is hidden for a moment after a reload, while it returns to your place. */
  restoring: boolean;
  tool: string | null;
  /** How many annotations are selected. */
  selection: number;
  /** Bumped when tool defaults or the selected annotation change, so the bars redraw. */
  revision: number;
  signOpen: boolean;
  commentsOpen: boolean;
  /** A new sticky note whose text box in the comments panel should take the cursor. */
  focusComment: string | null;
};

let counter = 0;

/** The reading mode picked last, for documents opened after it. */
let preferredReading: ViewerState['reading'] = 'normal';

export type PdfSession = DocumentSession & {
  documentId: string;
  viewer(): ViewerState;
  setViewer(patch: Partial<ViewerState>): void;
  caps(): Caps | null;
  connect(caps: Caps): void;
  /** The password the document opened with ('' if none). Kept in memory only. */
  password(): string;
  /** Remembers the password the user typed, before the document is opened again with it. */
  enterPassword(password: string): void;
  /** Whether the document's own restrictions allow `what` (false while loading). */
  allows(what: Permission): boolean;
  /** Sets a password to open the file (replacing any it has), as an undoable change. */
  protect(password: string): Promise<void>;
  /** Removes the password, as an undoable change. */
  unprotect(): Promise<void>;
  goToBookmark(target: PdfLinkTarget): void;
  /** Saves an attached file where the user picks. Attachments are never opened. */
  saveAttachment(attachment: PdfAttachmentObject): Promise<void>;
  properties(): Promise<DocumentProperties>;
  setSpread(spread: ViewerState['spread']): void;
  setReading(reading: ViewerState['reading']): void;
  find(query: string): Promise<void>;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  host: DocHost;
  /** Bumped each time the document is reloaded after a page change. */
  generation(): number;
  /** The bytes the current generation was loaded from (a fresh copy). */
  buffer(): ArrayBuffer;
  /** A small picture of a page, for the organize grid. */
  pageImage(index: number): Promise<string>;
  selectPages(indices: number[]): void;
  /** Page changes resolve to whether they were made. */
  rotatePages(indices: number[], quarterTurns: number): Promise<boolean>;
  deletePages(indices: number[]): Promise<boolean>;
  duplicatePages(indices: number[]): Promise<boolean>;
  /** Moves pages to just before page `before` (0-based; the page count moves them to the end). */
  movePages(indices: number[], before: number): Promise<boolean>;
  insertBlankPage(at: number): Promise<boolean>;
  /** Inserts pages from other PDFs and pictures the user picks, at `at`. */
  insertFiles(at: number): Promise<boolean>;
  extractPages(indices: number[]): Promise<void>;
  splitPages(groups: number[][]): Promise<void>;
  /** The text and pictures on a page, for edit mode. */
  pageContent(page: number): Promise<PageContentInfo>;
  editText(page: number, index: number, text: string): Promise<void>;
  addText(page: number, at: { x: number; y: number }, text: string): Promise<void>;
  moveContent(page: number, index: number, to: Box): Promise<void>;
  removeContent(page: number, index: number): Promise<void>;
  /** Adds a picture the user picks to the page being read, selected so it can be moved. */
  addPicture(): Promise<void>;
  whiteout(page: number, box: Box): Promise<void>;
  applyRedactions(): Promise<void>;
  setMode(mode: ViewerState['mode']): void;
  setTool(toolId: string | null): void;
  /** Color and line width of the selected annotation, or else of the active tool. */
  style(): AnnotationStyle;
  setStyle(patch: AnnotationStyle): void;
  deleteSelected(): void;
  deleteAnnotation(pageIndex: number, id: string): void;
  /** Scrolls to an annotation and selects it (in annotate mode). */
  revealAnnotation(pageIndex: number, id: string): void;
  setComment(pageIndex: number, id: string, contents: string): void;
  insertImage(): Promise<void>;
  /** The id of this document's built-in stamp library. */
  stampLibraryId: string;
  placeStamp(stampId: string): void;
  placeSignature(entry: SignatureEntry): void;
  /** Saves a copy with annotations and form fields made part of the pages. */
  saveFlattened(): Promise<void>;
  /** Called on every pointer release over the pages (pen strokes are written a moment later). */
  notePointer(): void;
};

/**
 * One step of undo history. Annotation and form edits come from EmbedPDF's own history; page
 * changes reload the document, so they keep its bytes (and the password each opens with)
 * from before and after.
 */
type Step = {
  id: number;
  pages?: { before: Uint8Array; after: Uint8Array; passwordBefore: string; passwordAfter: string };
};

const SPREAD_MODES: Record<ViewerState['spread'], SpreadMode> = {
  none: SpreadMode.None,
  odd: SpreadMode.Odd,
  even: SpreadMode.Even,
};

export function createPdfSession(engine: PdfEngine, bytes: Uint8Array, name: string, host: DocHost): PdfSession {
  const serial = ++counter;
  const base = name.replace(/\.pdf$/i, '');
  let generation = 0;
  let documentId = `pdf-${serial}`;
  /** The bytes the current generation was loaded from. */
  let current: Uint8Array = bytes.slice();
  /** The password `current` opens with. */
  let password = '';
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  let caps: Caps | null = null;
  /** Resolves once the current generation's plugins are connected (see `ready`). */
  let connected!: (next: Caps) => void;
  let connection = new Promise<Caps>((resolve) => (connected = resolve));
  /**
   * The connected plugins, waiting for them while the document is (re)opening: Save pressed
   * right after a page change waits for the reloaded document instead of failing.
   */
  const ready = async (): Promise<Caps> => {
    if (caps) return caps;
    let timer = 0;
    const late = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('The document is still opening. Try again in a moment.')), 20_000);
    });
    try {
      return await Promise.race([connection, late]);
    } finally {
      window.clearTimeout(timer);
    }
  };
  let viewer: ViewerState = {
    ready: false,
    page: 1,
    pages: 0,
    zoom: 1,
    thumbnails: true,
    panel: 'pages',
    outline: [],
    attachments: [],
    spread: 'none',
    reading: preferredReading,
    linkPrompt: null,
    protectOpen: false,
    propertiesOpen: false,
    encrypted: false,
    findOpen: false,
    query: '',
    results: 0,
    activeResult: -1,
    mode: 'view',
    tool: null,
    selection: 0,
    revision: 0,
    signOpen: false,
    commentsOpen: false,
    focusComment: null,
    pageSelection: [],
    busy: false,
    splitOpen: false,
    restoring: false,
    editTool: 'select',
    textStyle: { family: 'sans', bold: false, italic: false, size: 12, color: '#000000' },
    contentSelection: null,
    redactions: [],
    redactOpen: false,
    strayChange: false,
  };
  /** Page content for edit mode, per generation and page. */
  const contents = new Map<string, Promise<PageContentInfo>>();
  let imageUrl: string | null = null;
  /** Page pictures for the organize grid, per generation and page. */
  const pageImages = new Map<string, Promise<string>>();
  const pageImageUrls: string[] = [];
  /** When the last pen stroke ended (it reaches the document INK_COMMIT_MS later). */
  let lastInk = 0;
  let lastSelection: unknown = null;
  let lastSelected: unknown = null;
  /** Where to return to once the document (re)opens. */
  let restore: {
    page?: number;
    zoom?: number | string;
    thumbnails?: boolean;
    comments?: boolean;
    panel?: ViewerState['panel'];
    spread?: ViewerState['spread'];
    reading?: ViewerState['reading'];
  } | null = null;

  // Undo history and "unsaved" tracking: every step has its own id, and undo/redo move along
  // the steps, so undoing back to the saved step clears the unsaved marker. After a page
  // change is undone, earlier annotation edits stay as they are (they're part of the bytes
  // the page change started from).
  let steps: Step[] = [{ id: 0 }];
  let pointer = 0;
  let nextId = 1;
  let pending: 'undo' | 'redo' | null = null;
  const stops: Array<() => void> = [];

  const setViewer = (patch: Partial<ViewerState>) => {
    viewer = { ...viewer, ...patch };
    emit();
    host.changed();
  };

  const pushStep = (step: Step) => {
    steps = [...steps.slice(0, pointer + 1), step];
    pointer = steps.length - 1;
    // Let go of the oldest page-change bytes beyond the budget; undo then stops there.
    let held = steps.reduce((sum, s) => sum + (s.pages ? s.pages.before.length + s.pages.after.length : 0), 0);
    for (const old of steps) {
      if (held <= UNDO_BYTES) break;
      if (!old.pages || old === step) continue;
      held -= old.pages.before.length + old.pages.after.length;
      delete old.pages;
    }
  };

  const releasePageImages = () => {
    for (const url of pageImageUrls.splice(0)) URL.revokeObjectURL(url);
    pageImages.clear();
    contents.clear();
  };

  /**
   * Loads `next` (which opens with `nextPassword`) as a new generation of the document,
   * keeping the place and the mode.
   */
  const reload = (next: Uint8Array, nextPassword = password) => {
    restore = { page: viewer.page, zoom: viewer.zoom, thumbnails: viewer.thumbnails, comments: viewer.commentsOpen };
    for (const stop of stops.splice(0)) stop();
    caps = null;
    connection = new Promise<Caps>((resolve) => (connected = resolve));
    pending = null;
    lastSelection = null;
    lastSelected = null;
    current = next;
    password = nextPassword;
    generation += 1;
    documentId = `pdf-${serial}-${generation}`;
    releasePageImages();
    setViewer({
      ready: false,
      selection: 0,
      tool: null,
      findOpen: false,
      query: '',
      results: 0,
      activeResult: -1,
      contentSelection: null,
    });
  };

  /**
   * Writes every annotation change into the PDF. EmbedPDF writes changes in the background,
   * and asking it to write while a write is under way returns at once, so this waits until
   * nothing is pending: otherwise a save right after an edit could miss that edit.
   */
  const flushAnnotations = async (active: Caps) => {
    const inkWait = INK_COMMIT_MS + 100 - (Date.now() - lastInk);
    if (inkWait > 0) await new Promise((resolve) => setTimeout(resolve, inkWait));
    const deadline = Date.now() + 15_000;
    for (;;) {
      await active.annotation.commit().toPromise();
      if (!active.annotation.getState().hasPendingChanges) return;
      if (Date.now() > deadline) throw new Error('Annotations are still being written. Try again in a moment.');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /**
   * Applies a page change: exports the document as it is now (with every annotation), lets
   * `change` edit those bytes, then reloads the result. `sources` (other PDFs to take pages
   * from) are made from the exported bytes, and opened for `change` (with this document's
   * password: a copy of it is one of them). `after` makes a second pass over the result
   * (changing the password needs one), and `passwordAfter` is what the result opens with.
   */
  const changePages = async (
    change: (pdf: EditablePdf, sources: EditablePdf[]) => number[] | void,
    sources?: (before: Uint8Array) => Promise<Uint8Array[] | null>,
    options: { then?: (pdf: EditablePdf) => void; passwordAfter?: string } = {},
  ) => {
    if (!caps || viewer.busy) return false;
    setViewer({ busy: true });
    try {
      const tools = await pageTools();
      const before = await session.save('pdf');
      const extra = sources ? await sources(before) : [];
      if (extra === null) return false;
      const opened: EditablePdf[] = [];
      let selection: number[] = [];
      let after: Uint8Array;
      try {
        for (const bytes of extra) opened.push(tools.open(bytes, password));
        after = tools.edit(
          before,
          (pdf) => {
            selection = change(pdf, opened) ?? [];
          },
          password,
        );
      } finally {
        for (const pdf of opened) pdf.close();
      }
      if (options.then) after = tools.edit(after, options.then);
      const passwordAfter = options.passwordAfter ?? password;
      pushStep({ id: nextId++, pages: { before, after, passwordBefore: password, passwordAfter } });
      reload(after, passwordAfter);
      setViewer({ pageSelection: selection });
      return true;
    } catch (error) {
      host.notify(
        error instanceof PageError ? error.message : `The pages couldn't be changed: ${(error as Error)?.message ?? error}`,
        'error',
      );
      return false;
    } finally {
      setViewer({ busy: false });
    }
  };

  /** Pages of other PDFs and pictures the user picks, as PDFs to insert (null if none picked). */
  const pickedPages = async (before: Uint8Array, at: number): Promise<Uint8Array[] | null> => {
    const files = await host.openOthers(['pdf', 'png', 'jpg', 'jpeg'], 'PDF documents and pictures');
    if (files.length === 0) return null;
    const tools = await pageTools();
    // Pictures become pages shaped like the picture and sized like the page they go after.
    const probe = tools.open(before, password);
    const box = probe.page(Math.max(0, Math.min(at, probe.pageCount) - 1));
    probe.close();
    const out: Uint8Array[] = [];
    for (const file of files) {
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      try {
        if (isPdf) {
          tools.open(file.bytes).close();
          out.push(file.bytes);
        } else {
          out.push(await picturesPdf([await decodePicture(file.bytes)], box));
        }
      } catch (error) {
        throw new PageError(`${file.name}: ${(error as Error)?.message ?? "it couldn't be read."}`);
      }
    }
    return out;
  };

  /**
   * Changes what's printed on one page: exports the document, lets `change` edit the page's
   * objects (it returns the areas it changed), then checks the result: the page is drawn from
   * the saved bytes before and after, and if anything outside those areas looks different,
   * Folio says so and offers to undo. `select` picks an object to select afterwards.
   */
  const changeContent = async (
    page: number,
    change: (content: ReturnType<typeof pageContent>) => { changed: Box[]; select?: number },
  ) => {
    if (!caps || viewer.busy) return;
    setViewer({ busy: true, strayChange: false });
    try {
      const tools = await pageTools();
      const before = await session.save('pdf');
      let result: { changed: Box[]; select?: number } = { changed: [] };
      const after = tools.edit(
        before,
        (pdf) => {
          const content = pageContent(pdf, page);
          try {
            result = change(content);
            if (result.changed.length) content.commit();
          } finally {
            content.close();
          }
        },
        password,
      );
      if (result.changed.length === 0) return;
      const stray = strayChanges(tools, before, after, page, result.changed, password);
      pushStep({ id: nextId++, pages: { before, after, passwordBefore: password, passwordAfter: password } });
      reload(after);
      setViewer({
        contentSelection: result.select === undefined ? null : { page, index: result.select },
        strayChange: stray > STRAY_PIXELS,
      });
    } catch (error) {
      host.notify(error instanceof PageError ? error.message : `The page couldn't be changed: ${(error as Error)?.message ?? error}`, 'error');
    } finally {
      setViewer({ busy: false });
    }
  };

  /**
   * Returns to the place, zoom, layout and panels in `restore` (after a reload, or a view
   * state the shell handed over), hiding the pages meanwhile so nothing jumps.
   */
  const applyRestore = (next: Caps) => {
    const saved = restore;
    restore = null;
    if (!saved) return;
    if (saved.spread && saved.spread !== viewer.spread) session.setSpread(saved.spread);
    if (saved.reading) setViewer({ reading: saved.reading });
    if (saved.panel) setViewer({ panel: saved.panel });
    // Back to the zoom and page the view was at, hidden meanwhile so nothing jumps.
    // (EmbedPDF's views must start at "fit width"; a set zoom right away shows no pages.)
    const zoomBack = typeof saved.zoom === 'number' || (saved.zoom !== undefined && saved.zoom !== ZoomMode.FitWidth);
    if (zoomBack || (saved.page && saved.page > 1)) {
      setViewer({ restoring: true });
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (saved.page && saved.page > 1) next.scroll.scrollToPage({ pageNumber: saved.page, behavior: 'instant' });
        // One more frame so the pages are laid out at their place before they show.
        requestAnimationFrame(() => setViewer({ restoring: false }));
      };
      if (zoomBack) {
        // A zoom asked for before the view has its size is dropped, so ask until it holds.
        const level = saved.zoom as ZoomMode | number;
        const holds = () =>
          typeof level === 'number'
            ? Math.abs(next.zoom.getState().currentZoomLevel - level) < 0.005
            : next.zoom.getState().zoomLevel === level;
        let frames = 0;
        const check = () => {
          if (holds() || frames > 60) return finish();
          if (frames % 6 === 0) next.zoom.requestZoom(level);
          frames += 1;
          requestAnimationFrame(check);
        };
        check();
      } else {
        setTimeout(finish, 50);
      }
    }
    if (saved.thumbnails !== undefined) setViewer({ thumbnails: saved.thumbnails });
    if (saved.comments !== undefined) setViewer({ commentsOpen: saved.comments });
  };

  const session: PdfSession = {
    get documentId() {
      return documentId;
    },
    viewer: () => viewer,
    setViewer,
    caps: () => caps,
    generation: () => generation,
    // slice() copies into a new, plain ArrayBuffer.
    buffer: () => current.slice().buffer as ArrayBuffer,
    password: () => password,
    enterPassword(typed) {
      password = typed;
    },

    allows(what) {
      if (!caps) return false;
      const doc = caps.document;
      // Changing the password takes the owner's rights (a file opened with a password that only
      // lets you read can't have its protection removed).
      if (what === 'secure') return !doc.isEncrypted || doc.isOwnerUnlocked;
      return (doc.permissions & PERMISSION_FLAGS[what]) !== 0;
    },

    async protect(next) {
      if (!next) return;
      setViewer({ protectOpen: false });
      // An old password is removed first, which works whatever encryption the file came with.
      const done = await changePages(
        (pdf) => {
          if (pdf.encrypted) pdf.unprotect();
        },
        undefined,
        { then: (pdf) => pdf.protect(next), passwordAfter: next },
      );
      if (done) host.notify('The password is set. Save the file to keep it.', 'success');
    },

    async unprotect() {
      if (!viewer.encrypted) return;
      const done = await changePages((pdf) => pdf.unprotect(), undefined, { passwordAfter: '' });
      if (done) host.notify('The password is removed. Save the file to keep the change.', 'success');
    },

    goToBookmark(target) {
      caps?.annotation
        .navigateTarget(target)
        .toPromise()
        .catch(() => host.notify("That bookmark doesn't lead anywhere in this document.", 'warning'));
    },

    async saveAttachment(attachment) {
      if (!caps) return;
      try {
        const bytes = new Uint8Array(await caps.attachments.downloadAttachment(attachment).toPromise());
        await host.saveCopy(bytes, attachmentName(attachment.name));
      } catch (error) {
        host.notify(`${attachment.name} couldn't be saved: ${(error as { message?: string })?.message ?? String(error)}`, 'error');
      }
    },

    async properties() {
      if (!caps) throw new Error('The document is still loading.');
      const doc = caps.document;
      const meta = await engine.getMetadata(doc).toPromise();
      const page = doc.pages[Math.max(0, viewer.page - 1)];
      const restrictions = (
        [
          [PdfPermissionFlag.Print, 'printing'],
          [PdfPermissionFlag.CopyContents, 'copying text'],
          [PdfPermissionFlag.ModifyAnnotations, 'comments and annotations'],
          [PdfPermissionFlag.FillForms, 'filling in forms'],
          [PdfPermissionFlag.AssembleDocument, 'changing pages'],
          [PdfPermissionFlag.ModifyContents, 'editing'],
        ] as const
      )
        .filter(([flag]) => (doc.permissions & flag) === 0)
        .map(([, label]) => label);
      return {
        fileName: name,
        title: meta.title || null,
        author: meta.author || null,
        subject: meta.subject || null,
        keywords: meta.keywords || null,
        creator: meta.creator || null,
        producer: meta.producer || null,
        created: meta.creationDate ?? null,
        modified: meta.modificationDate ?? null,
        pages: doc.pageCount,
        // Sizes are kept as if unturned; a turned page shows the other way round.
      pageSize: page
        ? page.rotation % 2 === 1
          ? { width: page.size.height, height: page.size.width }
          : { width: page.size.width, height: page.size.height }
        : null,
        fileSize: current.length,
        encrypted: doc.isEncrypted,
        opensWithPassword: password !== '',
        restrictions,
      };
    },

    setSpread(spread) {
      caps?.spread.setSpreadMode(SPREAD_MODES[spread]);
      setViewer({ spread });
    },

    setReading(reading) {
      preferredReading = reading;
      setViewer({ reading });
    },

    connect(next) {
      // Only the current generation's plugins (an older view can still be closing).
      if (caps || next.document.id !== documentId) return;
      caps = next;
      connected(next);
      const connectedId = documentId;
      stops.push(
        next.history.onHistoryChange((event) => {
          if (event.documentId !== connectedId) return;
          if (pending === 'undo') pointer = Math.max(0, pointer - 1);
          else if (pending === 'redo') pointer = Math.min(steps.length - 1, pointer + 1);
          else pushStep({ id: nextId++ });
          pending = null;
          emit();
        }),
        next.scroll.onPageChange((event) => setViewer({ page: event.pageNumber, pages: event.totalPages })),
        next.zoom.onZoomChange((event) => setViewer({ zoom: event.newZoom })),
        next.annotation.onActiveToolChange((tool) => setViewer({ tool: tool?.id ?? null })),
        next.annotation.onStateChange((state) => {
          // Redraw the bars only when the selection, or the selected annotation, changed.
          const first = state.selectedUids[0];
          const selected = first ? state.byUid[first]?.object : undefined;
          if (state.selectedUids === lastSelection && selected === lastSelected) return;
          lastSelection = state.selectedUids;
          lastSelected = selected;
          setViewer({ selection: state.selectedUids.length, revision: viewer.revision + 1 });
        }),
        next.annotations.onToolsChange(() => setViewer({ revision: viewer.revision + 1 })),
        next.annotation.onAnnotationEvent((event) => {
          // A new sticky note gets its text in the comments panel.
          if (event.type === 'create' && event.annotation.type === PdfAnnotationSubtype.TEXT) {
            setViewer({ commentsOpen: true, focusComment: event.annotation.id });
          }
        }),
        next.annotations.onNavigate((event) => {
          if (event.documentId !== connectedId) return;
          // Web and mail links open only after the user says so (see LinkDialog).
          if (event.result.outcome === 'uri') setViewer({ linkPrompt: event.result.uri });
          else if (event.result.outcome === 'unsupported') {
            host.notify("Folio PDF doesn't follow this kind of link (it may try to open a file or run something).", 'warning');
          }
        }),
      );
      next.annotation.setLocked(LOCKS[viewer.mode]);
      void savedSignatures.load(host);
      setViewer({
        ready: true,
        pages: next.scroll.getTotalPages(),
        page: next.scroll.getCurrentPage(),
        encrypted: next.document.isEncrypted,
        outline: [],
        attachments: [],
      });
      // The side panel's other tabs, read once per generation.
      next.bookmarks
        .getBookmarks()
        .toPromise()
        .then(({ bookmarks }) => caps === next && setViewer({ outline: bookmarks }))
        .catch(() => undefined);
      next.attachments
        .getAttachments()
        .toPromise()
        .then((attachments) => caps === next && setViewer({ attachments }))
        .catch(() => undefined);
      // A mode the document's restrictions don't allow (after a reload, say) goes back to reading.
      const needs = { annotate: 'annotate', organize: 'organize', edit: 'edit' } as const;
      if (viewer.mode !== 'view' && !session.allows(needs[viewer.mode])) session.setMode('view');
      if (restore) applyRestore(next);
      if (next.spread.getSpreadMode() !== SPREAD_MODES[viewer.spread]) next.spread.setSpreadMode(SPREAD_MODES[viewer.spread]);
    },

    async find(query) {
      setViewer({ query });
      if (!caps) return;
      if (!query.trim()) {
        caps.search.stopSearch(documentId);
        setViewer({ results: 0, activeResult: -1 });
        return;
      }
      caps.search.startSearch(documentId);
      const result = await caps.search.searchAllPages(query, documentId).toPromise();
      const total = result.results.length;
      setViewer({ results: total, activeResult: total ? 0 : -1 });
      if (total) caps.search.goToResult(0, documentId);
    },

    undo() {
      if (!caps || viewer.busy || !session.canUndo()) return;
      const step = steps[pointer]!;
      if (step.pages) {
        // Back to the document as it was before the page change. Redo can bring the change
        // back, but not edits made after it, so those steps go.
        const { before, passwordBefore } = step.pages;
        steps = steps.slice(0, pointer + 1);
        pointer -= 1;
        reload(before, passwordBefore);
        return;
      }
      pending = 'undo';
      caps.history.undo();
    },

    redo() {
      if (!caps || viewer.busy || !session.canRedo()) return;
      const next = steps[pointer + 1]!;
      if (next.pages) {
        pointer += 1;
        reload(next.pages.after, next.pages.passwordAfter);
        return;
      }
      pending = 'redo';
      caps.history.redo();
    },

    canUndo() {
      const step = steps[pointer];
      if (!caps || pointer === 0 || !step) return false;
      return step.pages ? true : caps.history.canUndo();
    },

    canRedo() {
      const next = steps[pointer + 1];
      if (!caps || !next) return false;
      return next.pages ? true : caps.history.canRedo();
    },

    pageImage(index) {
      const key = `${generation}:${index}`;
      let image = pageImages.get(key);
      if (!image) {
        if (!caps) return Promise.reject(new Error('The document is still loading.'));
        image = caps.render
          .renderPage({
            pageIndex: index,
            options: {
              scaleFactor: 0.32 * window.devicePixelRatio,
              rotation: caps.rotations[index] ?? 0,
              withAnnotations: true,
            },
          })
          .toPromise()
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            pageImageUrls.push(url);
            return url;
          });
        image.catch(() => pageImages.delete(key));
        pageImages.set(key, image);
      }
      return image;
    },

    selectPages(indices) {
      setViewer({ pageSelection: [...new Set(indices)].filter((i) => i >= 0 && i < viewer.pages).sort((a, b) => a - b) });
    },

    rotatePages: (indices, quarterTurns) =>
      changePages((pdf) => {
        pdf.rotate(indices, quarterTurns);
        return indices;
      }),

    deletePages: (indices) =>
      changePages((pdf) => {
        pdf.remove(indices);
      }),

    duplicatePages: (indices) =>
      changePages(
        (pdf, [copy]) => {
          // Each copy goes right after its page; working from the end keeps indexes valid.
          const sorted = [...new Set(indices)].sort((a, b) => a - b);
          for (const index of [...sorted].reverse()) pdf.importFrom(copy!, [index], index + 1);
          return sorted.map((index, k) => index + k + 1);
        },
        async (before) => [before],
      ),

    movePages: (indices, before) =>
      changePages((pdf) => {
        const order = movedOrder(pdf.pageCount, indices, before);
        pdf.reorder(order);
        return indices.map((index) => order.indexOf(index)).sort((a, b) => a - b);
      }),

    insertBlankPage: (at) =>
      changePages((pdf) => {
        const like = pdf.page(Math.max(0, Math.min(at, pdf.pageCount) - 1));
        pdf.insertBlank(at, like.width, like.height);
        return [Math.min(at, pdf.pageCount - 1)];
      }),

    insertFiles: (at) =>
      changePages(
        (pdf, sources) => {
          let position = Math.min(at, pdf.pageCount);
          const start = position;
          for (const source of sources) {
            pdf.importFrom(source, null, position);
            position += source.pageCount;
          }
          return [...Array(position - start).keys()].map((i) => start + i);
        },
        (before) => pickedPages(before, at),
      ),

    async extractPages(indices) {
      if (!caps || indices.length === 0) return;
      try {
        const tools = await pageTools();
        const source = tools.open(await session.save('pdf'), password);
        const part = tools.create();
        let bytes: Uint8Array;
        try {
          part.importFrom(source, [...new Set(indices)].sort((a, b) => a - b), 0);
          // Pages taken from a protected file stay protected, with the same password.
          if (password) part.protect(password);
          bytes = part.save();
        } finally {
          part.close();
          source.close();
        }
        await host.saveCopy(bytes, `${base} (${pagesLabel(indices)}).pdf`);
      } catch (error) {
        host.notify(`The pages couldn't be extracted: ${(error as Error)?.message ?? error}`, 'error');
      }
    },

    async splitPages(groups) {
      if (!caps || groups.length === 0) return;
      setViewer({ splitOpen: false });
      try {
        const tools = await pageTools();
        const source = tools.open(await session.save('pdf'), password);
        const files: { bytes: Uint8Array; name: string }[] = [];
        try {
          for (const group of groups) {
            const part = tools.create();
            try {
              part.importFrom(source, group, 0);
              if (password) part.protect(password);
              files.push({ bytes: part.save(), name: `${base} (${pagesLabel(group)}).pdf` });
            } finally {
              part.close();
            }
          }
        } finally {
          source.close();
        }
        await host.saveCopies(files, 'Choose a folder for the split files');
      } catch (error) {
        host.notify(`The document couldn't be split: ${(error as Error)?.message ?? error}`, 'error');
      }
    },

    pageContent(page) {
      const key = `${generation}:${page}`;
      let info = contents.get(key);
      if (!info) {
        const bytes = current;
        const opensWith = password;
        info = pageTools().then((tools) => {
          const pdf = tools.open(bytes, opensWith);
          try {
            const content = pageContent(pdf, page);
            try {
              return content.info();
            } finally {
              content.close();
            }
          } finally {
            pdf.close();
          }
        });
        info.catch(() => contents.delete(key));
        contents.set(key, info);
      }
      return info;
    },

    editText: (page, index, text) => changeContent(page, (content) => ({ changed: content.setText(index, text) })),

    addText: (page, at, text) =>
      changeContent(page, (content) => ({ changed: content.addText(at, text, viewer.textStyle) })),

    moveContent: (page, index, to) =>
      changeContent(page, (content) => ({ changed: content.moveObject(index, to), select: index })),

    removeContent: (page, index) => changeContent(page, (content) => ({ changed: content.removeObject(index) })),

    async addPicture() {
      if (!caps) return;
      const file = await host.openAnother(['png', 'jpg', 'jpeg'], 'Pictures');
      if (!file) return;
      const page = Math.max(0, viewer.page - 1);
      try {
        const info = await session.pageContent(page);
        const natural = await pictureSize(file.bytes);
        // Shown at its natural size (96 dpi), but no wider than half the page, centered.
        const scale = Math.min(0.75, (info.width * 0.5) / natural.width, (info.height * 0.5) / natural.height);
        const width = natural.width * scale;
        const height = natural.height * scale;
        const box = { x: (info.width - width) / 2, y: (info.height - height) / 2, width, height };
        // Stored at up to 200 dpi of its placed size, which keeps files small.
        const pixels = await picturePixels(file.bytes, { width: (width / 72) * 200, height: (height / 72) * 200 });
        await changeContent(page, (content) => {
          const changed = content.addPicture(pixels.rgba, pixels.width, pixels.height, box);
          return { changed, select: content.objectCount - 1 };
        });
      } catch (error) {
        host.notify(`That picture couldn't be added: ${(error as Error)?.message ?? error}`, 'error');
      }
    },

    whiteout: (page, box) => changeContent(page, (content) => ({ changed: content.whiteout(box) })),

    async applyRedactions() {
      const marked = viewer.redactions;
      setViewer({ redactOpen: false });
      const pagesTouched = [...new Set(marked.map((mark) => mark.page))];
      for (const page of pagesTouched) {
        const boxes = marked.filter((mark) => mark.page === page).map((mark) => mark.box);
        await changeContent(page, (content) => ({ changed: content.redact(boxes) }));
      }
      setViewer({ redactions: [] });
    },

    host,

    setMode(mode) {
      if (mode !== 'view' && caps && !session.allows(mode)) {
        host.notify(RESTRICTED, 'warning');
        return;
      }
      if (caps) {
        if (mode !== 'annotate') {
          caps.annotation.setActiveTool(null);
          caps.annotation.deselectAnnotation();
        }
        caps.annotation.setLocked(LOCKS[mode]);
        // Editing works on pages as they're stored, so a turned view turns back.
        if (mode === 'edit' && caps.rotate.getRotation() !== 0) caps.rotate.setRotation(0);
      }
      // Organizing starts with the page you were reading selected.
      const pageSelection = mode === 'organize' && viewer.mode !== 'organize' ? [Math.max(0, viewer.page - 1)] : viewer.pageSelection;
      setViewer({ mode, pageSelection });
    },

    setTool(toolId) {
      if (!caps) return;
      if (toolId && viewer.mode !== 'annotate') session.setMode('annotate');
      caps.annotation.setActiveTool(toolId);
    },

    style() {
      if (!caps) return {};
      const selected = viewer.tool === null ? caps.annotation.getSelectedAnnotations()[0]?.object : undefined;
      const source = (selected ?? (viewer.tool ? caps.annotations.getTool(viewer.tool)?.defaults : undefined)) as
        | (Record<string, unknown> & { type?: PdfAnnotationObject['type'] })
        | undefined;
      if (source?.type === undefined) return {};
      return {
        color: colorPatch(source.type, '#000000') ? colorOf(source) : undefined,
        width: hasWidth(source.type) && typeof source.strokeWidth === 'number' ? source.strokeWidth : undefined,
      };
    },

    setStyle(patch) {
      if (!caps) return;
      const changes = (type: PdfAnnotationObject['type']) => ({
        ...(patch.color ? colorPatch(type, patch.color) : null),
        ...(patch.width && hasWidth(type) ? { strokeWidth: patch.width } : null),
      });
      const selected = caps.annotation.getSelectedAnnotations();
      const updates = selected
        .map(({ object }) => ({ pageIndex: object.pageIndex, id: object.id, patch: changes(object.type) }))
        .filter((update) => Object.keys(update.patch).length > 0);
      if (updates.length) caps.annotation.updateAnnotations(updates);
      // The tool remembers the choice for the next annotation it makes.
      const toolId = viewer.tool ?? (selected[0] ? caps.annotations.findToolForAnnotation(selected[0].object)?.id : undefined);
      const type = toolId ? caps.annotations.getTool(toolId)?.defaults.type : undefined;
      if (toolId && type !== undefined) caps.annotations.setToolDefaults(toolId, changes(type));
      setViewer({ revision: viewer.revision + 1 });
    },

    deleteSelected() {
      if (!caps) return;
      const selected = caps.annotation.getSelectedAnnotations();
      if (selected.length) {
        caps.annotation.deleteAnnotations(selected.map(({ object }) => ({ pageIndex: object.pageIndex, id: object.id })));
      }
    },

    deleteAnnotation(pageIndex, id) {
      caps?.annotation.deleteAnnotation(pageIndex, id);
    },

    revealAnnotation(pageIndex, id) {
      if (!caps) return;
      const target = caps.annotation.getAnnotationById(id)?.object;
      session.setMode('annotate');
      caps.annotation.setActiveTool(null);
      caps.scroll.scrollToPage({
        pageNumber: pageIndex + 1,
        pageCoordinates: target ? { x: target.rect.origin.x, y: Math.max(0, target.rect.origin.y - 40) } : undefined,
        behavior: 'smooth',
      });
      caps.annotation.selectAnnotation(pageIndex, id);
    },

    setComment(pageIndex, id, contents) {
      caps?.annotation.updateAnnotation(pageIndex, id, { contents, modified: new Date() });
    },

    // A library per generation: the old one may still be closing in the shared engine.
    get stampLibraryId() {
      return `folio-stamps-${documentId}`;
    },

    placeStamp(stampId) {
      if (!caps) return;
      session.setMode('annotate');
      caps.stamps
        .forDocument(documentId)
        .activateStampPlacementById(session.stampLibraryId, stampId)
        .toPromise()
        .catch(() => host.notify('That stamp isn’t ready yet. Try again in a moment.', 'warning'));
    },

    async insertImage() {
      const file = await host.openAnother(['png', 'jpg', 'jpeg'], 'Pictures');
      if (!file || !caps) return;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)]));
      session.setMode('annotate');
      // Restart the tool so it picks up the new picture.
      caps.annotation.setActiveTool(null);
      caps.annotations.setToolDefaults('stamp', { imageSrc: imageUrl });
      caps.annotation.setActiveTool('stamp');
    },

    placeSignature(entry) {
      if (!caps) return;
      session.setMode('annotate');
      caps.signature.loadEntries([entry]);
      caps.signature.forDocument(documentId).activateSignaturePlacement(entry.id);
      setViewer({ signOpen: false });
    },

    notePointer() {
      if (viewer.tool === 'ink' || viewer.tool === 'inkHighlighter') lastInk = Date.now();
    },

    View: () => <PdfHost session={session} engine={engine} name={name} />,
    stateId: () => steps[pointer]?.id ?? 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    lossy: () => [],
    commands: () => pdfCommands(session),

    async settle() {
      // Nothing can be pending before the first load; after a reload, wait for it (a document
      // that never reopens has nothing to finish).
      if (!caps && generation === 0) return;
      const active = await ready().catch(() => null);
      if (active) await flushAnnotations(active);
    },

    async saveFlattened() {
      if (!caps) return;
      if (!session.allows('edit')) return host.notify(RESTRICTED, 'warning');
      try {
        const flat = await flattenedCopy(engine, await session.save('pdf'), password);
        await host.saveCopy(flat, `${name.replace(/\.pdf$/i, '')} (flattened).pdf`);
      } catch (error) {
        host.notify(`A flattened copy couldn't be made: ${(error as { message?: string })?.message ?? String(error)}`, 'error');
      }
    },

    async save() {
      // A reload after a page change is waited for; a document that never opened (still
      // waiting for its password, say) has nothing to save.
      if (!caps && generation === 0) throw new Error('The document is still opening.');
      const active = await ready();
      await flushAnnotations(active);
      return new Uint8Array(await active.export.saveAsCopy().toPromise());
    },

    viewState: () => ({
      page: viewer.page,
      zoom: viewer.zoom,
      thumbnails: viewer.thumbnails,
      comments: viewer.commentsOpen,
      panel: viewer.panel,
      spread: viewer.spread,
      reading: viewer.reading,
    }),
    restoreViewState(state) {
      restore = (state ?? null) as typeof restore;
      // The shell can hand this over after the document has opened.
      if (caps && restore) applyRestore(caps);
    },

    async print() {
      if (!caps) return;
      if (!session.allows('print')) return host.notify(RESTRICTED, 'warning');
      const active = caps;
      // Pages are printed from the PDF itself, so recent annotations must be in it first.
      await flushAnnotations(active);
      await printPages(active.render, viewer.pages || active.scroll.getTotalPages());
    },

    status: () =>
      viewer.ready ? `Page ${viewer.page} of ${viewer.pages} · ${Math.round(viewer.zoom * 100)}%` : 'Opening…',

    dispose() {
      for (const stop of stops.splice(0)) stop();
      listeners.clear();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      releasePageImages();
      caps = null;
    },
  };
  return session;
}

let flattenCounter = 0;

/**
 * A flattened copy: the PDF opened a second time in the engine, every page's annotations and
 * form fields turned into page content (what would print), saved, and closed again. A
 * protected file's copy keeps its password.
 */
async function flattenedCopy(engine: PdfEngine, bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await engine
    .openDocumentBuffer(
      { id: `folio-flatten-${++flattenCounter}`, content: bytes.slice().buffer },
      password ? { password } : undefined,
    )
    .toPromise();
  try {
    for (const page of doc.pages) {
      await engine.flattenPage(doc, page, { flag: PdfPageFlattenFlag.Print }).toPromise();
    }
    return new Uint8Array(await engine.saveAsCopy(doc).toPromise());
  } finally {
    await engine
      .closeDocument(doc)
      .toPromise()
      .catch(() => undefined);
  }
}

/** The annotation tools in the toolbar (ids are EmbedPDF's built-in tools). */
export const ANNOTATION_TOOLS = [
  { id: 'highlight', title: 'Highlight text' },
  { id: 'underline', title: 'Underline text' },
  { id: 'strikeout', title: 'Strike out text' },
  { id: 'squiggly', title: 'Squiggly underline' },
  { id: 'ink', title: 'Pen' },
  { id: 'inkHighlighter', title: 'Highlighter pen' },
  { id: 'square', title: 'Rectangle' },
  { id: 'circle', title: 'Ellipse' },
  { id: 'line', title: 'Line' },
  { id: 'lineArrow', title: 'Arrow' },
  { id: 'freeText', title: 'Text box' },
  { id: 'textComment', title: 'Sticky note' },
] as const;

function pdfCommands(session: PdfSession): Command[] {
  const caps = session.caps();
  const viewer = session.viewer();
  const ready = () => session.caps() !== null;
  const organizing = viewer.mode === 'organize';
  /** The organize grid's selection, or the page being read. */
  const selected = () =>
    session.viewer().mode === 'organize' ? session.viewer().pageSelection : [Math.max(0, session.viewer().page - 1)];
  /** Loaded, and the document's own restrictions allow it. */
  const can = (what: Permission) => () => session.allows(what);
  const hasPages = () => session.allows('organize') && selected().length > 0;
  /** New pages go after the last selected page (or the page being read). */
  const insertAt = () => {
    const pages = selected();
    return pages.length ? Math.max(...pages) + 1 : session.viewer().pages;
  };
  return [
    { id: 'edit.undo', title: 'Undo', group: 'Edit', keys: 'Ctrl+Z', enabled: () => session.canUndo(), run: () => session.undo() },
    { id: 'edit.redo', title: 'Redo', group: 'Edit', keys: 'Ctrl+Y', enabled: () => session.canRedo(), run: () => session.redo() },
    // One Delete and one Escape for both modes (two commands on one key would block each other).
    {
      id: 'edit.delete',
      title: organizing ? 'Delete selected pages' : viewer.mode === 'edit' ? 'Delete the selected picture' : 'Delete selected annotation',
      group: 'Edit',
      keys: 'Delete',
      enabled: () => {
        const v = session.viewer();
        if (v.mode === 'organize') return v.pageSelection.length > 0;
        if (v.mode === 'edit') return v.contentSelection !== null;
        return v.selection > 0;
      },
      run: () => {
        const v = session.viewer();
        if (v.mode === 'organize') return session.deletePages(v.pageSelection);
        if (v.mode === 'edit' && v.contentSelection) return session.removeContent(v.contentSelection.page, v.contentSelection.index);
        return session.deleteSelected();
      },
    },
    {
      id: 'edit.escape',
      title: organizing ? 'Clear the page selection' : 'Select',
      group: 'Edit',
      keys: 'Escape',
      enabled: () => {
        const v = session.viewer();
        if (v.mode === 'organize') return v.pageSelection.length > 0;
        if (v.mode === 'edit') return v.contentSelection !== null || v.editTool !== 'select';
        return v.tool !== null;
      },
      run: () => {
        const v = session.viewer();
        if (v.mode === 'organize') return session.selectPages([]);
        if (v.mode === 'edit') return session.setViewer({ contentSelection: null, editTool: 'select' });
        return session.setTool(null);
      },
    },
    { id: 'content.edit', title: viewer.mode === 'edit' ? 'Stop editing the content' : 'Edit text and pictures', group: 'Edit', enabled: can('edit'), run: () => session.setMode(session.viewer().mode === 'edit' ? 'view' : 'edit') },
    { id: 'content.addText', title: 'Add text', group: 'Edit', enabled: can('edit'), run: () => { session.setMode('edit'); session.setViewer({ editTool: 'text' }); } },
    { id: 'content.addPicture', title: 'Add a picture to the page', group: 'Edit', enabled: can('edit'), run: () => session.addPicture() },
    { id: 'content.whiteout', title: 'Whiteout an area', group: 'Edit', enabled: can('edit'), run: () => { session.setMode('edit'); session.setViewer({ editTool: 'whiteout' }); } },
    { id: 'content.redact', title: 'Redact areas', group: 'Edit', enabled: can('edit'), run: () => { session.setMode('edit'); session.setViewer({ editTool: 'redact' }); } },
    { id: 'pages.organize', title: organizing ? 'Stop organizing pages' : 'Organize pages', group: 'Pages', enabled: can('organize'), run: () => session.setMode(session.viewer().mode === 'organize' ? 'view' : 'organize') },
    { id: 'pages.selectAll', title: 'Select all pages', group: 'Pages', keys: 'Ctrl+A', enabled: () => session.viewer().mode === 'organize', run: () => session.selectPages([...Array(session.viewer().pages).keys()]) },
    { id: 'pages.rotateLeft', title: 'Rotate selected pages left', group: 'Pages', enabled: hasPages, run: () => session.rotatePages(selected(), -1) },
    { id: 'pages.rotateRight', title: 'Rotate selected pages right', group: 'Pages', enabled: hasPages, run: () => session.rotatePages(selected(), 1) },
    { id: 'pages.duplicate', title: 'Duplicate selected pages', group: 'Pages', enabled: hasPages, run: () => session.duplicatePages(selected()) },
    { id: 'pages.extract', title: 'Extract selected pages to a new PDF', group: 'Pages', enabled: hasPages, run: () => session.extractPages(selected()) },
    { id: 'pages.insertBlank', title: 'Insert a blank page', group: 'Pages', enabled: can('organize'), run: () => session.insertBlankPage(insertAt()) },
    { id: 'pages.insertFiles', title: 'Insert pages from files', group: 'Pages', enabled: can('organize'), run: () => session.insertFiles(insertAt()) },
    { id: 'pages.combine', title: 'Combine with other files', group: 'Pages', enabled: can('organize'), run: () => session.insertFiles(session.viewer().pages) },
    { id: 'pages.split', title: 'Split into several files', group: 'Pages', enabled: can('organize'), run: () => session.setViewer({ splitOpen: true }) },
    { id: 'find.open', title: 'Find in document', group: 'Find', keys: 'Ctrl+F', enabled: ready, run: () => session.setViewer({ findOpen: true }) },
    { id: 'find.next', title: 'Next result', group: 'Find', keys: 'F3', enabled: () => viewer.results > 0, run: () => caps?.search.nextResult(session.documentId) },
    { id: 'find.previous', title: 'Previous result', group: 'Find', keys: 'Shift+F3', enabled: () => viewer.results > 0, run: () => caps?.search.previousResult(session.documentId) },
    { id: 'view.zoomIn', title: 'Zoom in', group: 'View', keys: 'Ctrl+=', enabled: ready, run: () => caps?.zoom.zoomIn() },
    { id: 'view.zoomOut', title: 'Zoom out', group: 'View', keys: 'Ctrl+-', enabled: ready, run: () => caps?.zoom.zoomOut() },
    { id: 'view.actualSize', title: 'Actual size', group: 'View', keys: 'Ctrl+0', enabled: ready, run: () => caps?.zoom.requestZoom(1) },
    { id: 'view.fitWidth', title: 'Fit width', group: 'View', enabled: ready, run: () => caps?.zoom.requestZoom(ZoomMode.FitWidth) },
    { id: 'view.fitPage', title: 'Fit page', group: 'View', enabled: ready, run: () => caps?.zoom.requestZoom(ZoomMode.FitPage) },
    { id: 'view.rotate', title: 'Rotate view clockwise', group: 'View', keys: 'Ctrl+R', enabled: ready, run: () => caps?.rotate.rotateForward() },
    { id: 'view.thumbnails', title: viewer.thumbnails ? 'Hide the side panel' : 'Show page thumbnails', group: 'View', enabled: ready, run: () => session.setViewer({ thumbnails: !session.viewer().thumbnails, panel: 'pages' }) },
    { id: 'annotate.toggle', title: viewer.mode === 'annotate' ? 'Stop annotating' : 'Annotate', group: 'Annotate', enabled: can('annotate'), run: () => session.setMode(session.viewer().mode === 'annotate' ? 'view' : 'annotate') },
    ...ANNOTATION_TOOLS.map((tool) => ({ id: `annotate.${tool.id}`, title: tool.title, group: 'Annotate', enabled: can('annotate'), run: () => session.setTool(tool.id) })),
    { id: 'annotate.image', title: 'Insert a picture', group: 'Annotate', enabled: can('annotate'), run: () => session.insertImage() },
    { id: 'annotate.sign', title: 'Add a signature', group: 'Annotate', enabled: can('annotate'), run: () => session.setViewer({ signOpen: true }) },
    ...STAMPS.map((stamp) => ({ id: `annotate.stamp.${stamp.id}`, title: `Stamp: ${stamp.label}`, group: 'Annotate', enabled: can('annotate'), run: () => session.placeStamp(stamp.id) })),
    { id: 'view.comments', title: viewer.commentsOpen ? 'Hide comments' : 'Show comments', group: 'View', enabled: ready, run: () => session.setViewer({ commentsOpen: !session.viewer().commentsOpen }) },
    { id: 'file.saveFlattened', title: 'Save a flattened copy', group: 'File', enabled: can('edit'), run: () => session.saveFlattened() },
    { id: 'file.protect', title: viewer.encrypted ? 'Change the password…' : 'Protect with a password…', group: 'File', enabled: can('secure'), run: () => session.setViewer({ protectOpen: true }) },
    { id: 'file.unprotect', title: 'Remove the password', group: 'File', enabled: () => session.viewer().encrypted && session.allows('secure'), run: () => session.unprotect() },
    { id: 'file.properties', title: 'Document properties', group: 'File', keys: 'Ctrl+D', enabled: ready, run: () => session.setViewer({ propertiesOpen: true }) },
    { id: 'view.layout.single', title: 'Page layout: one page wide', group: 'View', enabled: ready, run: () => session.setSpread('none') },
    { id: 'view.layout.two', title: 'Page layout: two pages side by side', group: 'View', enabled: ready, run: () => session.setSpread('odd') },
    { id: 'view.layout.cover', title: 'Page layout: two pages, with a cover page', group: 'View', enabled: ready, run: () => session.setSpread('even') },
    { id: 'view.reading.normal', title: 'Reading mode: normal', group: 'View', enabled: ready, run: () => session.setReading('normal') },
    { id: 'view.reading.dark', title: 'Reading mode: dark pages', group: 'View', enabled: ready, run: () => session.setReading('dark') },
    { id: 'view.reading.sepia', title: 'Reading mode: sepia', group: 'View', enabled: ready, run: () => session.setReading('sepia') },
    { id: 'view.bookmarks', title: 'Show bookmarks', group: 'View', enabled: () => session.viewer().outline.length > 0, run: () => session.setViewer({ thumbnails: true, panel: 'bookmarks' }) },
    { id: 'view.attachments', title: 'Show attached files', group: 'View', enabled: () => session.viewer().attachments.length > 0, run: () => session.setViewer({ thumbnails: true, panel: 'attachments' }) },
    { id: 'go.next', title: 'Next page', group: 'Go', keys: 'PageDown', enabled: ready, run: () => caps?.scroll.scrollToNextPage() },
    { id: 'go.previous', title: 'Previous page', group: 'Go', keys: 'PageUp', enabled: ready, run: () => caps?.scroll.scrollToPreviousPage() },
    { id: 'go.first', title: 'First page', group: 'Go', keys: 'Ctrl+Home', enabled: ready, run: () => caps?.scroll.scrollToPage({ pageNumber: 1 }) },
    { id: 'go.last', title: 'Last page', group: 'Go', keys: 'Ctrl+End', enabled: ready, run: () => caps?.scroll.scrollToPage({ pageNumber: viewer.pages }) },
  ];
}

const useViewer = (session: PdfSession) =>
  useSyncExternalStore(session.subscribe, session.viewer);

/** A fresh EmbedPDF view for every generation of the document (see `reload`). */
function PdfHost({ session, engine, name }: { session: PdfSession; engine: PdfEngine; name: string }) {
  const generation = useSyncExternalStore(session.subscribe, session.generation);
  return <PdfView key={generation} session={session} engine={engine} name={name} />;
}

function PdfView({ session, engine, name }: { session: PdfSession; engine: PdfEngine; name: string }) {
  // Each generation opens its own copy of the bytes (the engine takes ownership of them).
  const buffer = useRef(session.buffer()).current;
  const plugins = useRef([
    createPluginRegistration(DocumentManagerPluginPackage),
    createPluginRegistration(ViewportPluginPackage, { viewportGap: 16 }),
    createPluginRegistration(ScrollPluginPackage),
    createPluginRegistration(RenderPluginPackage),
    createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 2.5, extraRings: 0 }),
    createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(SelectionPluginPackage),
    createPluginRegistration(SearchPluginPackage),
    createPluginRegistration(ThumbnailPluginPackage, { width: 132, gap: 14, labelHeight: 18 }),
    createPluginRegistration(RotatePluginPackage),
    createPluginRegistration(HistoryPluginPackage),
    createPluginRegistration(ExportPluginPackage),
    createPluginRegistration(AnnotationPluginPackage, {
      annotationAuthor: 'Folio',
      selectAfterCreate: true,
      // Links are handled by the session (web links never open from the app).
      autoOpenLinks: false,
      tools: TOOL_OVERRIDES,
    }),
    // Registers its form-field renderers itself (EmbedPDF auto-mounts them).
    createPluginRegistration(FormPluginPackage),
    createPluginRegistration(SignaturePluginPackage, { mode: SignatureMode.SignatureOnly }),
    // Offline: Folio's own stamps instead of EmbedPDF's library from its CDN.
    createPluginRegistration(StampPluginPackage, {
      manifests: [],
      defaultLibrary: false,
      libraries: [stampLibrary(session.stampLibraryId)],
    }),
    createPluginRegistration(BookmarkPluginPackage),
    createPluginRegistration(AttachmentPluginPackage),
    createPluginRegistration(SpreadPluginPackage, { defaultSpreadMode: SPREAD_MODES[session.viewer().spread] }),
  ]).current;

  return (
    // data-generation counts reloads after page and content changes (tests wait on it).
    <div className="pdf-root" data-generation={session.generation()}>
      <EmbedPDF engine={engine} plugins={plugins}>
        <Loader session={session} buffer={buffer} name={name} />
        <DocumentContent documentId={session.documentId}>
          {({ isLoaded, isError, documentState }) =>
            isLoaded ? (
              <Viewer session={session} />
            ) : isError && documentState.errorCode === PdfErrorCode.Password ? (
              <PasswordPrompt session={session} name={name} wrong={documentState.passwordProvided === true} />
            ) : isError ? (
              <div className="pdf-loading" role="alert">
                {name} couldn&rsquo;t be opened. It may be damaged, or not a PDF.
              </div>
            ) : (
              <div className="pdf-loading">Opening {name}…</div>
            )
          }
        </DocumentContent>
      </EmbedPDF>
    </div>
  );
}

/** Opens the document once the document manager is ready (with its password, if known). */
function Loader({ session, buffer, name }: { session: PdfSession; buffer: ArrayBuffer; name: string }) {
  const { provides: documents } = useDocumentManagerCapability();
  const opened = useRef(false);
  useEffect(() => {
    if (!documents || opened.current) return;
    opened.current = true;
    const password = session.password();
    documents.openDocumentBuffer({
      buffer,
      name,
      documentId: session.documentId,
      autoActivate: true,
      ...(password ? { password } : {}),
    });
  }, [documents, buffer, name, session]);
  return null;
}

/** Connects the session to the plugins, then draws toolbar, thumbnails and pages. */
function Viewer({ session }: { session: PdfSession }) {
  const id = session.documentId;
  const viewer = useViewer(session);
  const { provides: exporter } = useExportCapability();
  const { provides: history } = useHistoryCapability();
  const { provides: zoom } = useZoomCapability();
  const { provides: scroll } = useScrollCapability();
  const { provides: search } = useSearchCapability();
  const { provides: rotate } = useRotateCapability();
  const { provides: render } = useRenderCapability();
  const { provides: annotation } = useAnnotationCapability();
  const { provides: signature } = useSignatureCapability();
  const { provides: stamps } = useStampCapability();
  const { provides: bookmarks } = useBookmarkCapability();
  const { provides: attachments } = useAttachmentCapability();
  const { provides: spread } = useSpreadCapability();
  const { plugin: form } = useFormPlugin();
  const pdfDocument = useDocumentState(id)?.document;

  useEffect(() => {
    if (form) serializeFieldWrites(form);
  }, [form]);

  useEffect(() => {
    if (
      exporter && history && zoom && scroll && search && rotate && render && annotation && signature && stamps &&
      bookmarks && attachments && spread && pdfDocument
    ) {
      session.connect({
        export: exporter.forDocument(id),
        history,
        zoom: zoom.forDocument(id),
        scroll: scroll.forDocument(id),
        search,
        rotate: rotate.forDocument(id),
        render: render.forDocument(id),
        annotations: annotation,
        annotation: annotation.forDocument(id),
        signature,
        stamps,
        bookmarks: bookmarks.forDocument(id),
        attachments: attachments.forDocument(id),
        spread: spread.forDocument(id),
        document: pdfDocument,
        rotations: pdfDocument.pages.map((page) => page.rotation),
      });
    }
  }, [exporter, history, zoom, scroll, search, rotate, render, annotation, signature, stamps, bookmarks, attachments, spread, pdfDocument, session, id]);
  const menu = useRef(selectionMenu(session)).current;
  // Reading modes change how pages look while reading; editing shows their real colors.
  const reading = viewer.mode === 'edit' || viewer.mode === 'organize' ? 'normal' : viewer.reading;
  // Each viewer has its own filter: one inside a hidden tab may not apply.
  const sepia = `pdf-sepia-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    // No native drags out of the viewer (see .pdf-viewer img in pdf.css).
    <div
      className="pdf-viewer"
      data-reading={reading}
      style={{ '--pdf-sepia': `url(#${sepia})` } as CSSProperties}
      onDragStart={(event) => event.preventDefault()}
    >
      <svg className="pdf-filters" aria-hidden="true" focusable="false">
        {/* Multiplies by the paper color #f4ecd8: white turns to paper, black stays black. */}
        <filter id={sepia} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0.957 0 0 0 0  0 0.925 0 0 0  0 0 0.847 0 0  0 0 0 1 0" />
        </filter>
      </svg>
      <Button
        className="pdf-fullscreen-exit"
        size="small"
        icon={<FullScreenMinimizeRegular />}
        onClick={() => session.host.toggleFullscreen()}
      >
        Leave full screen
      </Button>
      <PdfToolbar session={session} />
      {viewer.mode === 'annotate' && <AnnotateBar session={session} />}
      {viewer.mode === 'organize' && <OrganizeBar session={session} />}
      {viewer.mode === 'edit' && <EditBar session={session} />}
      <SignDialog session={session} />
      <SplitDialog session={session} />
      <RedactDialog session={session} />
      <StrayDialog session={session} />
      <LinkDialog session={session} />
      <ProtectDialog session={session} />
      <PropertiesDialog session={session} />
      <div className="pdf-body" onPointerUp={() => session.notePointer()}>
        {viewer.mode === 'organize' ? (
          <OrganizeView session={session} />
        ) : (
          <>
        {viewer.thumbnails && <SidePanel session={session} />}
        <Viewport documentId={id} className={viewer.restoring ? 'pdf-viewport pdf-restoring' : 'pdf-viewport'}>
          <Scroller
            documentId={id}
            renderPage={({ width, height, pageIndex }) => (
              <div className="pdf-page" style={{ width, height }}>
                <PagePointerProvider documentId={id} pageIndex={pageIndex}>
                  <RenderLayer documentId={id} pageIndex={pageIndex} scale={1} />
                  <TilingLayer documentId={id} pageIndex={pageIndex} />
                  <SearchLayer documentId={id} pageIndex={pageIndex} />
                  <SelectionLayer documentId={id} pageIndex={pageIndex} />
                  <AnnotationLayer documentId={id} pageIndex={pageIndex} selectionMenu={menu} />
                </PagePointerProvider>
                {viewer.mode === 'edit' && <EditLayer session={session} page={pageIndex} width={width} height={height} />}
              </div>
            )}
          />
        </Viewport>
        {viewer.commentsOpen && <CommentsPanel session={session} />}
          </>
        )}
      </div>
    </div>
  );
}
