// Printing: the active sheet's used range as a plain table, printed by WebView2's own print
// dialog. (The content policy blocks frames, so the table is added to the page for the
// moment of printing, and print styles hide everything else.)

import type { ICellData } from '@univerjs/core';
import type { SheetsSession } from './session';

const MAX_CELLS = 200_000;

export async function printSheet(session: SheetsSession): Promise<void> {
  const sheet = session.engine.workbook.getActiveSheet();
  const matrix = sheet.getCellMatrix();
  const range = matrix.getDataRange();
  const table = document.createElement('table');
  const area = document.createElement('div');
  area.className = 'sheets-print';
  const title = document.createElement('h1');
  title.textContent = `${session.name} - ${sheet.getName()}`;
  area.append(title, table);
  let cells = 0;
  for (let r = range.startRow; r <= range.endRow && cells < MAX_CELLS; r++) {
    if (sheet.getRowRawVisible(r) === false) continue;
    const tr = document.createElement('tr');
    for (let c = range.startColumn; c <= range.endColumn; c++) {
      if (sheet.getColVisible(c) === false) continue;
      const td = document.createElement('td');
      const cell = sheet.getCell(r, c) as ICellData | null;
      const value = cell?.p?.body?.dataStream?.replace(/\r?\n$/, '') ?? cell?.v;
      td.textContent = value === undefined || value === null ? '' : String(value);
      if (typeof cell?.v === 'number') td.className = 'number';
      tr.append(td);
      cells++;
    }
    table.append(tr);
  }
  document.body.append(area);
  document.documentElement.classList.add('sheets-printing');
  try {
    window.print();
  } finally {
    document.documentElement.classList.remove('sheets-printing');
    area.remove();
  }
}
