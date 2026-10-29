// A workbook open in Folio Sheets: Univer showing it, plus what saving needs (the file it came
// from and Univer's snapshot of it as opened). "Unsaved" follows Univer's undo history: each
// undo step gets an id, so undoing back to the saved step clears the marker.

import type { DocHost } from '@folio/shell';
import {
  CommandType,
  type ICellData,
  ICommandService,
  type IDisposable,
  IResourceLoaderService,
  IUndoRedoService,
  type IWorkbookData,
  RedoCommand,
  ThemeService,
  UndoCommand,
} from '@univerjs/core';
import { DeviceInputEventType } from '@univerjs/engine-render';
import { SheetsSelectionsService } from '@univerjs/sheets';
import { IEditorBridgeService, SetCellEditVisibleOperation } from '@univerjs/sheets-ui';
import { type CsvSource, readCsv, writeCsv } from './csv';
import { readXls } from './xls/biff';
import { type SheetEngine, createEngine } from './engine';
import { type Region, affected, protectedRegions, structuralChange } from './guard';
import { CMD } from './sheetCommands';
import { BLANK_WORKBOOK, readWorkbook, type SourceBook } from './xlsx/read';
import { writeWorkbook } from './xlsx/write';

export type SourceKind = 'xlsx' | 'xlsm' | 'csv' | 'xls';

export type Opened = {
  kind: SourceKind;
  data: IWorkbookData;
  /** The package it came from (.xlsx, .xlsm). */
  book?: SourceBook;
  csv?: CsvSource;
  /** Notes about the file to show once it's open (macros, pivot tables...). */
  notes: string[];
};

export type Selection = { sum: number; numbers: number; count: number; average: number } | null;

/** A change Folio asks about before making it. */
export type Question = { title: string; body: string; confirm: string; run(): void };

/** Thrown to stop a Univer command until the user has answered (see `guard.ts`). */
export class EditPaused extends Error {
  constructor() {
    super('Folio Sheets is asking before making this change.');
  }
}

// Univer's own menus run commands without waiting for them; a paused one isn't an error.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason instanceof EditPaused) event.preventDefault();
  });
}

/** Mutations that aren't edits: formula results arriving, and the like. */
const NOT_EDITS = /formula|calculation|numfmt\.mutation\.set-numfmt-cache|^sheet\.mutation\.set-worksheet-row-auto-height|auto-height|set-worksheet-col-auto-width/;

export class SheetsSession {
  readonly container: HTMLDivElement;
  readonly engine: SheetEngine;
  readonly unitId: string;
  /** Univer's snapshot as the workbook was opened: what saving compares against. */
  readonly baseline: IWorkbookData;
  private readonly listeners = new Set<() => void>();
  private readonly disposables: IDisposable[] = [];
  private readonly stepIds = new WeakMap<object, number>();
  private nextStep = 1;
  private undoing = 0;
  private observer: MutationObserver | null = null;
  selection: Selection = null;
  /** Edits that a CSV file can't keep (formats, formulas, more sheets). */
  formatted = false;
  question: Question | null = null;
  /** Places Folio can't update when rows and columns move (pivot tables, tables, charts). */
  private readonly regions: Region[];
  private readonly accepted = new Set<Region>();
  private allowOnce = false;

  constructor(
    readonly opened: Opened,
    readonly name: string,
    readonly host: DocHost,
  ) {
    this.container = document.createElement('div');
    this.container.className = 'sheets-grid';
    this.engine = createEngine(this.container, opened.data, { dark: currentTheme() === 'dark' });
    this.unitId = this.engine.workbook.getUnitId();
    this.baseline = this.snapshot();

    this.regions = opened.book ? protectedRegions(opened.book) : [];
    const commands = this.engine.injector.get(ICommandService);
    this.disposables.push(
      commands.beforeCommandExecuted((info) => this.guard(info.id, info.params as Record<string, unknown> | undefined)),
      commands.beforeCommandExecuted((info) => {
        if (info.id === UndoCommand.id || info.id === RedoCommand.id) this.undoing += 1;
      }),
      commands.onCommandExecuted((info, options) => {
        if (info.id === UndoCommand.id || info.id === RedoCommand.id) {
          this.undoing = Math.max(0, this.undoing - 1);
          this.emit();
          return;
        }
        if (info.type !== CommandType.MUTATION || NOT_EDITS.test(info.id)) return;
        // Formula results and the cell editor's own text are consequences, not edits.
        const local = options as { onlyLocal?: boolean; fromFormula?: boolean } | undefined;
        if (local?.fromFormula || local?.onlyLocal || info.id.startsWith('doc.mutation.')) {
          this.updateSelection();
          this.host.changed();
          return;
        }
        if (!this.undoing) {
          // The top undo step now stands for a new state (steps can grow while on top).
          const top = this.undoRedo.pitchTopUndoElement();
          if (top) this.stepIds.set(top, this.nextStep++);
          if (/style|merge|insert-sheet|formula|conditional|data-validation|drawing/.test(info.id)) this.formatted = true;
        }
        this.updateSelection();
        this.emit();
      }),
    );
    const selections = this.engine.injector.get(SheetsSelectionsService);
    const subscription = selections.selectionMoveEnd$.subscribe(() => {
      this.updateSelection();
      this.host.changed();
    });
    this.disposables.push({ dispose: () => subscription.unsubscribe() });
    // Follow Folio's light and dark themes.
    this.observer = new MutationObserver(() => this.engine.injector.get(ThemeService).setDarkMode(currentTheme() === 'dark'));
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /** Asks before rows or columns move under a pivot table, a table or a chart's data. */
  private guard(id: string, params: Record<string, unknown> | undefined) {
    if (this.allowOnce || this.regions.length === 0) return;
    const sheet = this.engine.workbook.getActiveSheet();
    const selection = this.engine.injector.get(SheetsSelectionsService).getCurrentLastSelection()?.range;
    const change = structuralChange(id, params, sheet.getSheetId(), selection);
    if (!change) return;
    const hit = affected(this.regions, change).filter((r) => !this.accepted.has(r));
    if (hit.length === 0) return;
    const what = [...new Set(hit.map((r) => r.what))];
    const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what.at(-1)}` : what[0]!;
    this.question = {
      title: change.rows !== undefined ? 'Move rows anyway?' : 'Move columns anyway?',
      body: `This moves cells that ${list} use. Folio keeps ${what.length > 1 ? 'them' : 'it'} as ${what.length > 1 ? 'they were' : 'it was'} but can't update ${what.length > 1 ? 'them' : 'it'}, so after saving ${what.length > 1 ? 'they' : 'it'} may point at the wrong cells until refreshed in Excel.`,
      confirm: 'Make the change',
      run: () => {
        for (const region of hit) this.accepted.add(region);
        this.allowOnce = true;
        void this.run(id, params).finally(() => (this.allowOnce = false));
      },
    };
    this.emit();
    throw new EditPaused();
  }

  answer(confirmed: boolean) {
    const question = this.question;
    this.question = null;
    this.emit();
    if (confirmed) question?.run();
  }

  private get undoRedo() {
    return this.engine.injector.get(IUndoRedoService);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Bumped on every change, for views that redraw on any of them. */
  version = 0;

  private emit() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** The id of the state the workbook is in (0 = as opened). */
  stateId(): number {
    const top = this.undoRedo.pitchTopUndoElement();
    if (!top) return 0;
    let id = this.stepIds.get(top);
    if (id === undefined) {
      id = this.nextStep++;
      this.stepIds.set(top, id);
    }
    return id;
  }

  canUndo(): boolean {
    return this.undoRedo.pitchTopUndoElement() != null;
  }

  canRedo(): boolean {
    return this.undoRedo.pitchTopRedoElement() != null;
  }

  run(id: string, params?: object): Promise<boolean> {
    return this.engine.injector
      .get(ICommandService)
      .executeCommand(id, params)
      .catch((error: unknown) => {
        if (error instanceof EditPaused) return false;
        throw error;
      });
  }

  /** Univer's full snapshot of the workbook, with its plugins' data. */
  snapshot(): IWorkbookData {
    return this.engine.injector.get(IResourceLoaderService).saveUnit<IWorkbookData>(this.unitId) as IWorkbookData;
  }

  /** Commits a cell that's still being typed in, so saving includes it. */
  async settle(): Promise<void> {
    const editor = this.engine.injector.get(IEditorBridgeService);
    if (editor.isVisible().visible) {
      await this.run(SetCellEditVisibleOperation.id, { visible: false, eventType: DeviceInputEventType.PointerDown, unitId: this.unitId });
    }
  }

  /** The workbook as `ext` bytes, patched into the original file where there is one. */
  save(ext: string): Uint8Array {
    const current = this.snapshot();
    if (ext === 'csv') return writeCsv(this.opened.csv ?? null, this.opened.kind === 'csv' ? this.baseline : null, current);
    if (this.opened.book) return writeWorkbook(this.opened.book, this.baseline, current);
    // CSV and old .xls files become new workbooks.
    const blank = readWorkbook(BLANK_WORKBOOK(), this.name, current.sheetOrder.slice(0, 1));
    return writeWorkbook(blank.book, blank.data, current);
  }

  /** Inserts as many rows or columns as are selected, before or after the selection (like Excel). */
  insert(kind: 'row' | 'col', where: 'before' | 'after'): Promise<boolean> {
    const range = this.engine.injector.get(SheetsSelectionsService).getCurrentLastSelection()?.range;
    const count = range ? (kind === 'row' ? range.endRow - range.startRow + 1 : range.endColumn - range.startColumn + 1) : 1;
    return this.run(`sheet.command.insert-${kind}-${where}`, { value: Math.max(1, Math.min(count, 1000)) });
  }

  zoomTo(ratio: number) {
    const sheet = this.engine.workbook.getActiveSheet();
    const zoomRatio = Math.min(4, Math.max(0.1, Math.round(ratio * 10) / 10));
    void this.run(CMD.zoom, { unitId: this.unitId, subUnitId: sheet.getSheetId(), zoomRatio });
  }

  zoomBy(step: number) {
    this.zoomTo((this.engine.workbook.getActiveSheet().getZoomRatio() || 1) + step);
  }

  /** A picture the user picks, placed over the grid at the selection. */
  async insertPicture(): Promise<void> {
    const file = await this.host.openAnother(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'], 'Pictures');
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop() ?? 'png';
    const type = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const picture = new File([new Uint8Array(file.bytes)], file.name, { type });
    const done = await this.run(CMD.insertImage, { files: [picture] });
    if (!done) this.host.notify(`${file.name} couldn't be added.`, 'error');
  }

  /** Sum, average and count of the selected cells (like Excel's status bar). */
  private updateSelection() {
    const selections = this.engine.injector.get(SheetsSelectionsService).getCurrentSelections();
    const sheet = this.engine.workbook.getActiveSheet();
    if (!sheet || selections.length === 0) {
      this.selection = null;
      return;
    }
    const matrix = sheet.getCellMatrix();
    let sum = 0;
    let numbers = 0;
    let count = 0;
    let cells = 0;
    const seen = new Set<string>();
    for (const { range } of selections) {
      const endRow = Math.min(range.endRow, sheet.getMaxRows() - 1);
      const endColumn = Math.min(range.endColumn, sheet.getMaxColumns() - 1);
      for (let r = Math.max(0, range.startRow); r <= endRow; r++) {
        const row = matrix.getRow(r);
        if (!row) continue;
        for (const key of Object.keys(row)) {
          const c = Number(key);
          if (c < range.startColumn || c > endColumn) continue;
          const id = `${r},${c}`;
          if (seen.has(id)) continue;
          seen.add(id);
          if (++cells > 2_000_000) break;
          const cell = row[c] as ICellData | undefined;
          const value = cell?.v;
          if (value === undefined || value === null || value === '') continue;
          count += 1;
          if (typeof value === 'number' && cell?.t !== 3) {
            sum += value;
            numbers += 1;
          }
        }
      }
    }
    this.selection = count > 1 ? { sum, numbers, count, average: numbers ? sum / numbers : 0 } : null;
  }

  dispose() {
    for (const d of this.disposables.splice(0)) d.dispose();
    this.observer?.disconnect();
    this.listeners.clear();
    this.engine.univer.dispose();
    this.container.remove();
  }
}

function currentTheme(): 'light' | 'dark' {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'dark') return 'dark';
  if (theme === 'light' || theme === 'contrast') return 'light';
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Reads a file into what Univer shows. */
export function openBytes(bytes: Uint8Array, name: string): Opened {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'csv' || ext === 'tsv') {
    const { data, source } = readCsv(bytes, name);
    return { kind: 'csv', data, csv: source, notes: [] };
  }
  if (ext === 'xls') {
    const { data, skippedFormulas, macros } = readXls(bytes, name);
    const notes = ['Saving makes a new .xlsx workbook; the .xls file stays as it is.'];
    if (macros) notes.push("Its macros can't be carried over to the new workbook (Folio never runs them).");
    if (skippedFormulas) notes.push(`${skippedFormulas} ${skippedFormulas === 1 ? "formula couldn't" : "formulas couldn't"} be read; ${skippedFormulas === 1 ? 'its last value is' : 'their last values are'} kept.`);
    return { kind: 'xls', data, notes };
  }
  const { data, book } = readWorkbook(bytes, name);
  const notes: string[] = [];
  if (book.features.macros) notes.push("This workbook has macros. Folio never runs them, and keeps them in the file when you save.");
  if (book.features.pivotTables.length) notes.push('Pivot tables are shown as they were last refreshed, and kept as they are.');
  if (book.features.externalLinks) notes.push('Links to other workbooks are never followed; their last values are shown.');
  if (book.features.chartsheets.length) notes.push(`Chart sheets (${book.features.chartsheets.join(', ')}) aren't shown, but are kept.`);
  return { kind: book.kind === 'xlsm' || book.kind === 'xltm' ? 'xlsm' : 'xlsx', data, book, notes };
}
