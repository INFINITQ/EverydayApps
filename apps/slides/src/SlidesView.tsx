// The editor around one presentation: toolbar, slide thumbnails (select, drag to reorder,
// right-click for slide actions), the current slide, and its speaker notes.

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Textarea,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowDownRegular,
  ArrowRedoRegular,
  ArrowUndoRegular,
  ArrowUpRegular,
  ChevronDownRegular,
  CopyRegular,
  DeleteRegular,
  DocumentPdfRegular,
  EyeOffRegular,
  EyeRegular,
  ImageAddRegular,
  NotepadRegular,
  PlayRegular,
  PresenterRegular,
} from '@fluentui/react-icons';
import { type ReactElement, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { EditLayer } from './EditLayer';
import { type RenderOptions, nodesOf } from './render';
import type { SlidesSession } from './session';
import { SlideCanvas, WhenVisible } from './SlideCanvas';
import { Slideshow } from './Slideshow';

const THUMB_WIDTH = 168;

export type ViewProps = {
  session: SlidesSession;
  options: RenderOptions;
  /** Actions that need the host (files, export), supplied by the format. */
  actions: SlideActions;
};

export type SlideActions = {
  exportPdf(): void;
  replacePicture(): void;
  insertPicture(): void;
  deleteShape(): void;
  setNotes(text: string): void;
  canEditNotes(): boolean;
  /** Says why a double-clicked shape's text can't be edited (a table, a chart...). */
  cantEditText(kind: string): void;
};

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip content={label} relationship="label" withArrow>
      {children}
    </Tooltip>
  );
}

export function SlidesView({ session, options, actions }: ViewProps) {
  const state = useSyncExternalStore(session.subscribe, () => session.state);
  const [notesOpen, setNotesOpen] = useState(true);
  return (
    <div className="slides-root">
      <SlidesToolbar session={session} actions={actions} notesOpen={notesOpen} toggleNotes={() => setNotesOpen(!notesOpen)} />
      <div className="slides-body">
        <Rail session={session} options={options} />
        <div className="slides-main">
          <Stage session={session} options={options} actions={actions} />
          {notesOpen && <NotesPane session={session} actions={actions} />}
        </div>
      </div>
      {state.show && <Slideshow session={session} options={options} />}
      <LinkDialog session={session} />
      {state.slides.length === 0 && <div className="slides-empty">This presentation has no slides.</div>}
    </div>
  );
}

function SlidesToolbar({
  session,
  actions,
  notesOpen,
  toggleNotes,
}: {
  session: SlidesSession;
  actions: SlideActions;
  notesOpen: boolean;
  toggleNotes(): void;
}) {
  const state = useSyncExternalStore(session.subscribe, () => session.state);
  const readOnly = state.converted;
  const selection = session.selection();
  const allHidden = selection.length > 0 && selection.every((s) => s.hidden);
  const shape = state.shape ? nodesOf(state.deck, state.current).find((n) => n.id === state.shape) : undefined;
  return (
    <Toolbar className="slides-toolbar" aria-label="Slides" size="small">
      <Menu positioning="below-start">
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton appearance="primary" icon={<PlayRegular />} className="slides-present">
            Present <ChevronDownRegular className="slides-chevron" />
          </ToolbarButton>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<PlayRegular />} secondaryContent="F5" onClick={() => session.startShow('start')}>
              From the beginning
            </MenuItem>
            <MenuItem secondaryContent="Shift+F5" onClick={() => session.startShow('current')}>
              From this slide
            </MenuItem>
            <MenuItem icon={<PresenterRegular />} secondaryContent="Alt+F5" onClick={() => session.startShow('current', true)}>
              Presenter view
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <ToolbarDivider />
      <Tip label="Undo (Ctrl+Z)">
        <ToolbarButton aria-label="Undo" icon={<ArrowUndoRegular />} disabled={!session.canUndo()} onClick={session.undo} />
      </Tip>
      <Tip label="Redo (Ctrl+Y)">
        <ToolbarButton aria-label="Redo" icon={<ArrowRedoRegular />} disabled={!session.canRedo()} onClick={session.redo} />
      </Tip>
      <ToolbarDivider />
      <Tip label="Duplicate slide (Ctrl+D)">
        <ToolbarButton aria-label="Duplicate slide" icon={<CopyRegular />} disabled={readOnly} onClick={() => session.duplicate()} />
      </Tip>
      <Tip label="Delete slide">
        <ToolbarButton
          aria-label="Delete slide"
          icon={<DeleteRegular />}
          disabled={readOnly || state.slides.length <= selection.length}
          onClick={() => session.remove()}
        />
      </Tip>
      <Tip label={allHidden ? 'Show slide in slideshows' : 'Hide slide in slideshows'}>
        <ToolbarButton
          aria-label={allHidden ? 'Show slide' : 'Hide slide'}
          aria-pressed={allHidden}
          icon={allHidden ? <EyeRegular /> : <EyeOffRegular />}
          disabled={readOnly}
          onClick={() => session.toggleHidden()}
        />
      </Tip>
      <Tip label="Move slide up (Ctrl+Up)">
        <ToolbarButton aria-label="Move slide up" icon={<ArrowUpRegular />} disabled={readOnly} onClick={() => session.moveBy(-1)} />
      </Tip>
      <Tip label="Move slide down (Ctrl+Down)">
        <ToolbarButton aria-label="Move slide down" icon={<ArrowDownRegular />} disabled={readOnly} onClick={() => session.moveBy(1)} />
      </Tip>
      <ToolbarDivider />
      <Tip label="Insert picture">
        <ToolbarButton aria-label="Insert picture" icon={<ImageAddRegular />} disabled={readOnly} onClick={actions.insertPicture} />
      </Tip>
      {shape && !readOnly && (
        <>
          <ToolbarDivider />
          {shape.nodeType === 'picture' && (
            <ToolbarButton onClick={actions.replacePicture}>Replace picture…</ToolbarButton>
          )}
          {shape.nodeType === 'shape' && (
            <ToolbarButton onClick={() => session.setEditing(shape.id)}>Edit text</ToolbarButton>
          )}
          <Tip label="Delete (Del)">
            <ToolbarButton aria-label="Delete shape" icon={<DeleteRegular />} onClick={actions.deleteShape} />
          </Tip>
        </>
      )}
      <div className="slides-toolbar-spacer" />
      <Tip label="Export to PDF">
        <ToolbarButton aria-label="Export to PDF" icon={<DocumentPdfRegular />} onClick={actions.exportPdf} />
      </Tip>
      <Tip label={notesOpen ? 'Hide notes' : 'Show notes'}>
        <ToolbarButton aria-label="Notes" aria-pressed={notesOpen} icon={<NotepadRegular />} onClick={toggleNotes} />
      </Tip>
    </Toolbar>
  );
}

function Rail({ session, options }: { session: SlidesSession; options: RenderOptions }) {
  const state = useSyncExternalStore(session.subscribe, () => session.state);
  const { deck, slides, current, selected } = state;
  const [drop, setDrop] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const height = Math.round((THUMB_WIDTH * deck.presentation.height) / deck.presentation.width);

  // Keep the current slide in view.
  useEffect(() => {
    list.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current, slides.length]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'PageDown') {
      if (event.ctrlKey) session.moveBy(1);
      else session.select(current + 1, event.shiftKey ? 'range' : 'one');
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'PageUp') {
      if (event.ctrlKey) session.moveBy(-1);
      else session.select(current - 1, event.shiftKey ? 'range' : 'one');
    } else if (event.key === 'Home') session.go(0);
    else if (event.key === 'End') session.go(slides.length - 1);
    else if (event.key === 'Delete' || event.key === 'Backspace') session.remove();
    else return;
    event.preventDefault();
  };

  const dropIndex = (event: React.DragEvent, index: number) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientY < box.top + box.height / 2 ? index : index + 1;
  };

  return (
    <div
      ref={list}
      className="slides-rail"
      role="listbox"
      aria-label="Slides"
      aria-multiselectable="true"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragLeave={(event) => {
        if (!list.current?.contains(event.relatedTarget as Node)) setDrop(null);
      }}
    >
      {slides.map((slide, index) => (
        <div
          key={slide.part}
          className="slides-thumb"
          role="option"
          aria-selected={selected.includes(slide.part)}
          aria-label={`Slide ${index + 1}${slide.hidden ? ', hidden' : ''}`}
          data-current={index === current}
          data-hidden={slide.hidden || undefined}
          data-drop={drop === index ? 'before' : drop === index + 1 && index === slides.length - 1 ? 'after' : undefined}
          draggable={!state.converted}
          onClick={(event) => session.select(index, event.shiftKey ? 'range' : event.ctrlKey ? 'toggle' : 'one')}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!selected.includes(slide.part)) session.select(index);
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          onDragStart={(event) => {
            if (!selected.includes(slide.part)) session.select(index);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-folio-slides', 'move');
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('application/x-folio-slides')) return;
            event.preventDefault();
            setDrop(dropIndex(event, index));
          }}
          onDrop={(event) => {
            event.preventDefault();
            const at = dropIndex(event, index);
            setDrop(null);
            // Dropping between slides: count only the slides that stay where they are.
            const moving = new Set(session.selection().map((s) => s.part));
            const before = slides.slice(0, at).filter((s) => !moving.has(s.part)).length;
            session.moveTo(before);
          }}
          onDragEnd={() => setDrop(null)}
        >
          <span className="slides-thumb-number">{index + 1}</span>
          <div className="slides-thumb-image">
            <WhenVisible height={height}>
              <SlideCanvas deck={deck} index={index} width={THUMB_WIDTH} options={options} interactive={false} />
            </WhenVisible>
            {slide.hidden && (
              <span className="slides-thumb-hidden" title="Hidden in slideshows">
                <EyeOffRegular />
              </span>
            )}
          </div>
        </div>
      ))}
      <Menu
        open={menu !== null}
        onOpenChange={(_, data) => !data.open && setMenu(null)}
        positioning={{
          target: menu
            ? { getBoundingClientRect: () => DOMRect.fromRect({ x: menu.x, y: menu.y, width: 0, height: 0 }) }
            : undefined,
          position: 'below',
          align: 'start',
        }}
      >
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<PlayRegular />} onClick={() => session.startShow('current')}>
              Present from this slide
            </MenuItem>
            <MenuDivider />
            <MenuItem icon={<CopyRegular />} disabled={state.converted} onClick={() => session.duplicate()}>
              Duplicate
            </MenuItem>
            <MenuItem
              icon={<DeleteRegular />}
              disabled={state.converted || session.selection().length >= slides.length}
              onClick={() => session.remove()}
            >
              Delete
            </MenuItem>
            <MenuItem
              icon={session.selection().every((s) => s.hidden) ? <EyeRegular /> : <EyeOffRegular />}
              disabled={state.converted}
              onClick={() => session.toggleHidden()}
            >
              {session.selection().every((s) => s.hidden) ? 'Show slide' : 'Hide slide'}
            </MenuItem>
            <MenuDivider />
            <MenuItem icon={<ArrowUpRegular />} disabled={state.converted} onClick={() => session.moveBy(-1)}>
              Move up
            </MenuItem>
            <MenuItem icon={<ArrowDownRegular />} disabled={state.converted} onClick={() => session.moveBy(1)}>
              Move down
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}

/** Fits a box of `aspect` (width / height) inside an element, with a margin. */
function useFit(aspect: number, margin: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const w = element.clientWidth - margin * 2;
      const h = element.clientHeight - margin * 2;
      setWidth(Math.max(80, Math.floor(Math.min(w, h * aspect))));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [aspect, margin]);
  return { ref, width };
}

function Stage({ session, options, actions }: ViewProps) {
  const state = useSyncExternalStore(session.subscribe, () => session.state);
  const { deck, current, slides } = state;
  const { ref, width } = useFit(deck.presentation.width / deck.presentation.height, 24);
  const slide = slides[current];
  return (
    <div ref={ref} className="slides-stage" onPointerDown={(event) => event.target === event.currentTarget && session.selectShape(null)}>
      {slide && width > 0 && (
        <div className="slides-current" style={{ width }}>
          <SlideCanvas deck={deck} index={current} width={width} options={options} label={`Slide ${current + 1}`} />
          {!state.converted && <EditLayer session={session} width={width} actions={actions} />}
        </div>
      )}
    </div>
  );
}

function NotesPane({ session, actions }: { session: SlidesSession; actions: SlideActions }) {
  const state = useSyncExternalStore(session.subscribe, () => session.state);
  const slide = state.slides[state.current];
  const notes = slide ? session.notes(slide) : '';
  const editable = !state.converted && actions.canEditNotes();
  return (
    <div className="slides-notes">
      <Textarea
        className="slides-notes-text"
        aria-label="Speaker notes"
        placeholder={editable ? 'Click to add speaker notes' : 'No speaker notes'}
        value={notes}
        readOnly={!editable}
        resize="none"
        appearance="filled-lighter"
        onChange={(_, data) => actions.setNotes(data.value)}
      />
    </div>
  );
}

function LinkDialog({ session }: { session: SlidesSession }) {
  const url = useSyncExternalStore(session.subscribe, () => session.state.linkPrompt);
  return (
    <Dialog open={url !== null} onOpenChange={(_, data) => !data.open && session.answerLink(false)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Open this link?</DialogTitle>
          <DialogContent>
            <p>The presentation links to:</p>
            <p className="slides-link-url">{url}</p>
            <p>It opens in your browser or mail app, outside Folio.</p>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => session.answerLink(true)}>
              Open link
            </Button>
            <Button onClick={() => session.answerLink(false)}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function StatusText({ session }: { session: SlidesSession }): ReactNode {
  const { current, slides, converted } = session.state;
  const slide = slides[current];
  return (
    <span>
      {slides.length ? `Slide ${current + 1} of ${slides.length}` : 'No slides'}
      {slide?.hidden ? ' · Hidden' : ''}
      {converted ? ' · Read-only (old format)' : ''}
    </span>
  );
}
