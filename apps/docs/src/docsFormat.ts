// Folio Docs' format module. The engine (several megabytes) loads with the first document, not
// with the window: the start screen paints without it.

import type { FormatModule } from '@folio/shell';

export const docsFormat: FormatModule = {
  id: 'docs',
  fileTypes: [
    { ext: 'docx', label: 'Word document', canSave: true },
    { ext: 'docm', label: 'Word macro-enabled document', canSave: true },
    { ext: 'doc', label: 'Word 97-2003 document', canSave: false },
  ],
  open: async (file, host) => (await import('./session')).openDocument(file, host),
};
