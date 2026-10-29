// Folio Slides' format module: .pptx and .pptm open, edit and save (only changed parts
// are rewritten); old .ppt files open read-only, converted in memory, and Save As makes a
// .pptx. Macros never run: they're reported and kept in the file. Linked pictures, media
// and data are never fetched; links open only after the user says so.

import type { Command, DocHost, DocumentSession, FormatModule } from '@folio/shell';
import { hasMacros, slideSize, slidesOf } from './deck';
import {
  type Package,
  contentTypeOf,
  editContentTypes,
  mainPart,
  openPackage,
  related,
  relationships,
  relsNameOf,
  savePackage,
  withParts,
  xmlOf,
} from './pkg';
import { printDeck } from './print';
import { type RenderOptions, loadFonts } from './render';
import { createSlidesSession } from './session';
import { PICTURE_TYPES, deleteShape, insertPicture, isAnimated, replacePicture } from './shapes';
import { type SlideActions, SlidesView, StatusText } from './SlidesView';
import { canEditNotes, setNotes } from './text';
import { NS, REL, children } from './xml';

const PRESENTATION = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const MACRO_PRESENTATION = 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml';

export const slidesFormat: FormatModule = {
  id: 'slides',
  fileTypes: [
    { ext: 'pptx', label: 'PowerPoint presentation', canSave: true },
    { ext: 'pptm', label: 'PowerPoint macro-enabled presentation', canSave: true },
    { ext: 'ppt', label: 'PowerPoint 97-2003 presentation', canSave: false },
  ],
  open: async (file, host) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'ppt') {
      const { convertPpt } = await import('./ppt');
      const converted = await convertPpt(file.bytes);
      return openDeck(await openPackage(converted), file.name, host, true);
    }
    return openDeck(await openPackage(file.bytes), file.name, host, false);
  },
};

/** The same deck without its macros, for saving as .pptx (PowerPoint refuses macros there). */
export function withoutMacros(pkg: Package): Package {
  const main = mainPart(pkg);
  const projects = related(pkg, main, REL.vbaProject);
  const types = xmlOf(pkg, '[Content_Types].xml')!;
  editContentTypes(types, { add: { [main]: PRESENTATION }, remove: projects.map((p) => p.part) });
  const rels = xmlOf(pkg, relsNameOf(main))!;
  for (const rel of children(rels.documentElement, NS.rel, 'Relationship')) {
    if (rel.getAttribute('Type') === REL.vbaProject) rel.remove();
  }
  const changes: Record<string, Document | null> = { '[Content_Types].xml': types, [relsNameOf(main)]: rels };
  for (const project of projects) {
    changes[project.part] = null;
    if (pkg.parts.has(relsNameOf(project.part))) changes[relsNameOf(project.part)] = null;
  }
  return withParts(pkg, changes);
}

/** A .pptx deck saved as .pptm needs the macro-enabled content type, and the reverse. */
function forExtension(pkg: Package, ext: string): Package {
  if (ext === 'pptx' && hasMacros(pkg)) return withoutMacros(pkg);
  if (ext === 'pptm' && contentTypeOf(pkg, mainPart(pkg)) === PRESENTATION) {
    const types = xmlOf(pkg, '[Content_Types].xml')!;
    editContentTypes(types, { add: { [mainPart(pkg)]: MACRO_PRESENTATION } });
    return withParts(pkg, { '[Content_Types].xml': types });
  }
  return pkg;
}

/** Decodes a picture the user picked, for its size. */
async function pictureSize(bytes: Uint8Array, ext: string): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: PICTURE_TYPES[ext] }));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    throw new Error("That picture couldn't be read.");
  }
}

export async function openDeck(pkg: Package, name: string, host: DocHost, converted: boolean): Promise<DocumentSession> {
  slidesOf(pkg); // Fails early, with a clear message, on a damaged presentation.
  await loadFonts(pkg);
  const session = createSlidesSession(pkg, host, { converted });
  const mediaUrlCache = new Map<string, string>();
  const options: RenderOptions = { mediaUrlCache, onNavigate: (target) => session.navigate(target) };
  /** Media names used in this session (so undo + a new picture never reuse a cached name). */
  const reserved = new Set<string>([...pkg.parts.keys()].filter((n) => n.startsWith('ppt/media/')));

  if (hasMacros(pkg)) {
    host.notify(`${name} contains macros. Folio Slides never runs them; they stay in the file when you save.`, 'warning');
  }
  const linked = slidesOf(pkg).some((slide) =>
    relationships(pkg, slide.part).some((rel) => rel.external && /\/(image|video|audio|media|oleObject)$/.test(rel.type)),
  );
  if (linked) host.notify('This presentation links to pictures or media outside the file. Folio never loads them.', 'info');
  if (converted) host.notify('Converted from an old PowerPoint file: text, pictures and notes are kept, but layout may differ.', 'info');

  const currentPart = () => session.state.slides[session.state.current]?.part;
  const pickPicture = async () => {
    const file = await host.openAnother(Object.keys(PICTURE_TYPES), 'Pictures');
    if (!file) return null;
    const ext = file.name.split('.').pop()!.toLowerCase();
    return { ...file, ext, ...(await pictureSize(file.bytes, ext)) };
  };
  const fail = (error: unknown) => host.notify(error instanceof Error ? error.message : 'That didn\'t work.', 'error');

  const actions: SlideActions = {
    exportPdf: () => {
      host.notify('Choose "Microsoft Print to PDF" (or "Save as PDF") as the printer to export a PDF.', 'info');
      void printDeck(session.state.deck, options).catch(fail);
    },
    replacePicture: () =>
      void (async () => {
        const id = session.state.shape;
        const part = currentPart();
        if (!id || !part) return;
        const picture = await pickPicture();
        if (picture) session.apply('Replace picture', (pkg) => replacePicture(pkg, part, id, picture, reserved));
      })().catch(fail),
    insertPicture: () =>
      void (async () => {
        const part = currentPart();
        if (!part) return;
        const picture = await pickPicture();
        if (!picture) return;
        let added = '';
        session.apply('Insert picture', (pkg) => {
          const result = insertPicture(pkg, part, slideSize(pkg), picture, reserved);
          added = result.id;
          return result.pkg;
        });
        if (added) session.selectShape(added);
      })().catch(fail),
    deleteShape: () => {
      const id = session.state.shape;
      const part = currentPart();
      if (!id || !part) return;
      const animated = isAnimated(session.state.pkg, part, id);
      session.apply('Delete shape', (pkg) => deleteShape(pkg, part, id));
      if (animated) host.notify('The shape’s animations were removed with it.', 'info');
    },
    setNotes: (text) => {
      const slide = session.state.slides[session.state.current];
      if (!slide) return;
      try {
        session.apply('Edit notes', (pkg) => setNotes(pkg, slide, text), true);
      } catch (error) {
        fail(error);
      }
    },
    canEditNotes: () => {
      const slide = session.state.slides[session.state.current];
      return Boolean(slide && canEditNotes(session.state.pkg, slide));
    },
  };

  function View() {
    return <SlidesView session={session} options={options} actions={actions} />;
  }

  const editable = () => !session.state.converted;
  const commands = (): Command[] => [
    { id: 'slides.present', title: 'Present from the beginning', group: 'Slideshow', keys: 'F5', run: () => !session.state.show && session.startShow('start') },
    { id: 'slides.presentCurrent', title: 'Present from this slide', group: 'Slideshow', keys: 'Shift+F5', run: () => !session.state.show && session.startShow('current') },
    { id: 'slides.presenter', title: 'Presenter view', group: 'Slideshow', keys: 'Alt+F5', run: () => !session.state.show && session.startShow('current', true) },
    { id: 'edit.undo', title: 'Undo', group: 'Edit', keys: 'Ctrl+Z', enabled: session.canUndo, run: session.undo },
    { id: 'edit.redo', title: 'Redo', group: 'Edit', keys: 'Ctrl+Y', enabled: session.canRedo, run: session.redo },
    { id: 'slides.duplicate', title: 'Duplicate slide', group: 'Slides', keys: 'Ctrl+D', enabled: editable, run: () => session.duplicate() },
    { id: 'slides.delete', title: 'Delete slide', group: 'Slides', enabled: () => editable() && session.state.slides.length > session.selection().length, run: () => session.remove() },
    { id: 'slides.hide', title: 'Hide or show slide', group: 'Slides', enabled: editable, run: () => session.toggleHidden() },
    { id: 'slides.moveUp', title: 'Move slide up', group: 'Slides', enabled: editable, run: () => session.moveBy(-1) },
    { id: 'slides.moveDown', title: 'Move slide down', group: 'Slides', enabled: editable, run: () => session.moveBy(1) },
    { id: 'slides.next', title: 'Next slide', group: 'View', keys: 'PageDown', run: () => session.go(session.state.current + 1) },
    { id: 'slides.previous', title: 'Previous slide', group: 'View', keys: 'PageUp', run: () => session.go(session.state.current - 1) },
    { id: 'slides.insertPicture', title: 'Insert picture…', group: 'Insert', enabled: editable, run: actions.insertPicture },
    {
      id: 'slides.replacePicture',
      title: 'Replace picture…',
      group: 'Edit',
      enabled: () => editable() && session.state.deck.presentation.slides[session.state.current]?.nodes.find((n) => n.id === session.state.shape)?.nodeType === 'picture',
      run: actions.replacePicture,
    },
    { id: 'slides.exportPdf', title: 'Export to PDF…', group: 'File', run: actions.exportPdf },
  ];

  return {
    View,
    stateId: session.stateId,
    subscribe: session.subscribe,
    lossy: () => [],
    commands,
    save: async (ext) => savePackage(forExtension(session.state.pkg, ext)),
    viewState: () => ({ slide: session.state.current }),
    restoreViewState: (value) => {
      const slide = (value as { slide?: unknown } | null)?.slide;
      if (typeof slide === 'number') session.go(slide);
    },
    print: () => printDeck(session.state.deck, options),
    status: () => <StatusText session={session} />,
    dispose: () => {
      if (session.state.show) session.endShow();
      session.dispose();
      for (const url of mediaUrlCache.values()) URL.revokeObjectURL(url);
      mediaUrlCache.clear();
    },
  };
}
