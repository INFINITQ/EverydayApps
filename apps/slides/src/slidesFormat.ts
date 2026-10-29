// Folio Slides' format module: .pptx and .pptm open, edit and save (only changed parts
// are rewritten); old .ppt files open read-only, converted in memory, and Save As makes a
// .pptx. Macros never run: they're reported and kept in the file. Linked pictures, media
// and data are never fetched; links open only after the user says so.
// The editor and the renderer load when the first deck opens.

import type { FormatModule } from '@folio/shell';

export const slidesFormat: FormatModule = {
  id: 'slides',
  fileTypes: [
    { ext: 'pptx', label: 'PowerPoint presentation', canSave: true },
    { ext: 'pptm', label: 'PowerPoint macro-enabled presentation', canSave: true },
    { ext: 'ppt', label: 'PowerPoint 97-2003 presentation', canSave: false },
  ],
  open: async (file, host) => (await import('./deckSession')).openFile(file, host),
};
