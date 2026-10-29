import type { DocumentSession, FormatModule } from '@folio/shell';
import { type IWorkbookData, LocaleType } from '@univerjs/core';
import { useEffect, useRef } from 'react';
import { createEngine } from './engine';

export const sheetsFormat: FormatModule = {
  id: 'sheets',
  fileTypes: [
    { ext: 'xlsx', label: 'Excel workbook', canSave: true },
    { ext: 'csv', label: 'CSV file', canSave: true },
  ],
  open: async (file) => {
    const text = new TextDecoder().decode(file.bytes);
    const cellData: Record<number, Record<number, { v: string }>> = {};
    text.split(/\r?\n/).forEach((line, r) => {
      cellData[r] = Object.fromEntries(line.split(',').map((v, c) => [c, { v }]));
    });
    const data: IWorkbookData = {
      id: 'wb', name: file.name, appVersion: '1', locale: LocaleType.EN_US, styles: {},
      sheetOrder: ['s1'], sheets: { s1: { id: 's1', name: 'Sheet1', cellData, rowCount: 1000, columnCount: 26 } },
    } as IWorkbookData;
    const container = document.createElement('div');
    container.className = 'sheets-grid';
    const engine = createEngine(container, data, { dark: false });
    const session: DocumentSession = {
      View: () => {
        const host = useRef<HTMLDivElement>(null);
        useEffect(() => void host.current?.appendChild(container), []);
        return <div className="sheets-root" ref={host} />;
      },
      stateId: () => 0,
      subscribe: () => () => undefined,
      lossy: () => [],
      commands: () => [],
      save: async () => file.bytes,
      dispose: () => engine.univer.dispose(),
    };
    return session;
  },
};
