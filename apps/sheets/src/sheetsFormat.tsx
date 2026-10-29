// Folio Sheets' format module: .xlsx, .xlsm and .csv open, edit and save; .xls opens
// read-only and saves as .xlsx. Univer draws and edits the workbook; xlsx/ and csv.ts turn
// files into Univer data and patch Univer's changes back into the original file.

import type { Command, DocHost, DocumentSession, FormatModule } from '@folio/shell';
import { MessageBar, MessageBarBody } from '@fluentui/react-components';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { printSheet } from './print';
import { SheetsSession, openBytes } from './session';
import { CMD, NUMBER_FORMATS } from './sheetCommands';
import { SheetsToolbar } from './SheetsToolbar';

export const sheetsFormat: FormatModule = {
  id: 'sheets',
  fileTypes: [
    { ext: 'xlsx', label: 'Excel workbook', canSave: true },
    { ext: 'xlsm', label: 'Excel macro-enabled workbook', canSave: true },
    { ext: 'csv', label: 'CSV file', canSave: true },
  ],
  open: async (file, host) => createSheetsDocument(file.bytes, file.name, host),
};

const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 });

export type SheetsDocument = DocumentSession & { session: SheetsSession };

export function createSheetsDocument(bytes: Uint8Array, name: string, host: DocHost): SheetsDocument {
  const opened = openBytes(bytes, name);
  const session = new SheetsSession(opened, name, host);
  const unsubscribe = session.subscribe(() => host.changed());

  function View() {
    const holder = useRef<HTMLDivElement>(null);
    const [notes, setNotes] = useState(opened.notes);
    useSyncExternalStore(
      (listener) => session.subscribe(listener),
      () => session.stateId(),
    );
    useEffect(() => {
      holder.current?.appendChild(session.container);
    }, []);
    return (
      <div className="sheets-root">
        <SheetsToolbar session={session} />
        {notes.length > 0 && (
          <MessageBar intent="info" className="sheets-note">
            <MessageBarBody>{notes.join(' ')}</MessageBarBody>
            <button type="button" className="sheets-note-close" aria-label="Dismiss" onClick={() => setNotes([])}>
              ×
            </button>
          </MessageBar>
        )}
        <div className="sheets-grid-holder" ref={holder} />
      </div>
    );
  }

  const run = (id: string, params?: object) => () => session.run(id, params);
  const commands = (): Command[] => [
    { id: 'edit.undo', title: 'Undo', group: 'Edit', keys: 'Ctrl+Z', enabled: () => session.canUndo(), run: run(CMD.undo) },
    { id: 'edit.redo', title: 'Redo', group: 'Edit', keys: 'Ctrl+Y', enabled: () => session.canRedo(), run: run(CMD.redo) },
    { id: 'find.open', title: 'Find', group: 'Find', keys: 'Ctrl+F', run: run(CMD.find) },
    { id: 'find.replace', title: 'Replace', group: 'Find', keys: 'Ctrl+H', run: run(CMD.replace) },
    // Univer handles Ctrl+B, Ctrl+I and Ctrl+U itself, in the grid and while typing in a cell.
    { id: 'format.bold', title: 'Bold (Ctrl+B)', group: 'Format', run: run(CMD.bold) },
    { id: 'format.italic', title: 'Italic (Ctrl+I)', group: 'Format', run: run(CMD.italic) },
    { id: 'format.underline', title: 'Underline (Ctrl+U)', group: 'Format', run: run(CMD.underline) },
    { id: 'format.strike', title: 'Strikethrough', group: 'Format', keys: 'Ctrl+5', run: run(CMD.strike) },
    { id: 'format.alignLeft', title: 'Align left', group: 'Format', run: run(CMD.horizontal, { value: 1 }) },
    { id: 'format.center', title: 'Center', group: 'Format', run: run(CMD.horizontal, { value: 2 }) },
    { id: 'format.alignRight', title: 'Align right', group: 'Format', run: run(CMD.horizontal, { value: 3 }) },
    { id: 'format.wrap', title: 'Wrap text', group: 'Format', run: run(CMD.wrap, { value: 3 }) },
    { id: 'format.merge', title: 'Merge cells', group: 'Format', run: run(CMD.mergeAll) },
    { id: 'format.unmerge', title: 'Unmerge cells', group: 'Format', run: run(CMD.unmerge) },
    { id: 'format.clear', title: 'Clear formatting', group: 'Format', run: run(CMD.clearFormat) },
    { id: 'format.painter', title: 'Format painter', group: 'Format', run: run(CMD.formatPainter) },
    { id: 'format.numbers', title: 'Number formats…', group: 'Format', keys: 'Ctrl+1', run: run(CMD.numfmtPanel) },
    ...NUMBER_FORMATS.map((format) => ({
      id: `format.number.${format.label.toLowerCase().replace(/\s+/g, '-')}`,
      title: `Number format: ${format.label}`,
      group: 'Format',
      run: run(CMD.style, { style: { type: 'n', value: format.pattern ? { pattern: format.pattern } : null } }),
    })),
    { id: 'format.moreDecimals', title: 'More decimals', group: 'Format', run: run(CMD.moreDecimals) },
    { id: 'format.lessDecimals', title: 'Fewer decimals', group: 'Format', run: run(CMD.lessDecimals) },
    { id: 'format.conditional', title: 'Conditional formatting…', group: 'Format', run: run(CMD.conditionalPanel) },
    { id: 'data.validation', title: 'Data validation…', group: 'Data', run: run(CMD.validationPanel) },
    { id: 'data.sortAscending', title: 'Sort A to Z', group: 'Data', run: run(CMD.sortAscending) },
    { id: 'data.sortDescending', title: 'Sort Z to A', group: 'Data', run: run(CMD.sortDescending) },
    { id: 'data.sortCustom', title: 'Custom sort…', group: 'Data', run: run(CMD.sortCustom) },
    { id: 'data.filter', title: 'Filter', group: 'Data', keys: 'Ctrl+Shift+L', run: run(CMD.filter) },
    { id: 'data.clearFilter', title: 'Clear filter', group: 'Data', run: run(CMD.clearFilter) },
    { id: 'rows.insertAbove', title: 'Insert row above', group: 'Rows and columns', run: run(CMD.insertRowAbove) },
    { id: 'rows.insertBelow', title: 'Insert row below', group: 'Rows and columns', run: run(CMD.insertRowBelow) },
    { id: 'columns.insertLeft', title: 'Insert column left', group: 'Rows and columns', run: run(CMD.insertColumnLeft) },
    { id: 'columns.insertRight', title: 'Insert column right', group: 'Rows and columns', run: run(CMD.insertColumnRight) },
    { id: 'rows.delete', title: 'Delete rows', group: 'Rows and columns', run: run(CMD.deleteRows) },
    { id: 'columns.delete', title: 'Delete columns', group: 'Rows and columns', run: run(CMD.deleteColumns) },
    { id: 'columns.autoWidth', title: 'Fit column width to contents', group: 'Rows and columns', run: run(CMD.autoWidth) },
    { id: 'view.freezeRow', title: 'Freeze top row', group: 'View', run: run(CMD.freezeRow) },
    { id: 'view.freezeColumn', title: 'Freeze first column', group: 'View', run: run(CMD.freezeColumn) },
    { id: 'view.freezeSelection', title: 'Freeze panes at the selection', group: 'View', run: run(CMD.freezeSelection) },
    { id: 'view.unfreeze', title: 'Unfreeze panes', group: 'View', run: run(CMD.unfreeze) },
    { id: 'view.zoomIn', title: 'Zoom in', group: 'View', keys: 'Ctrl+=', run: () => session.zoomBy(0.1) },
    { id: 'view.zoomOut', title: 'Zoom out', group: 'View', keys: 'Ctrl+-', run: () => session.zoomBy(-0.1) },
    { id: 'view.actualSize', title: 'Zoom to 100%', group: 'View', keys: 'Ctrl+0', run: () => session.zoomTo(1) },
    { id: 'insert.comment', title: 'Comments', group: 'Insert', run: run(CMD.commentsPanel) },
    { id: 'insert.picture', title: 'Insert a picture…', group: 'Insert', run: () => session.insertPicture() },
    { id: 'sheet.insert', title: 'Insert a sheet', group: 'Sheet', keys: 'Shift+F11', run: run(CMD.insertSheet) },
    { id: 'sheet.rename', title: 'Rename sheet', group: 'Sheet', run: run(CMD.renameSheet) },
    { id: 'sheet.remove', title: 'Delete sheet', group: 'Sheet', run: run(CMD.removeSheet) },
  ];

  return {
    session,
    View,
    stateId: () => session.stateId(),
    subscribe: (listener) => session.subscribe(listener),
    lossy: () => {
      if (opened.kind !== 'csv') return [];
      const out: { id: string; label: string }[] = [];
      if (session.engine.workbook.getSheets().length > 1) out.push({ id: 'csv-sheets', label: 'sheets other than the first' });
      if (session.formatted) out.push({ id: 'csv-formatting', label: 'formatting, formulas and pictures (values are kept)' });
      return out;
    },
    commands,
    settle: () => session.settle(),
    save: async (ext) => session.save(ext),
    print: async () => printSheet(session),
    status: () => {
      const s = session.selection;
      if (!s) return null;
      return s.numbers > 0
        ? `Average: ${formatter.format(s.average)} · Count: ${s.count} · Sum: ${formatter.format(s.sum)}`
        : `Count: ${s.count}`;
    },
    dispose: () => {
      unsubscribe();
      session.dispose();
    },
  };
}
