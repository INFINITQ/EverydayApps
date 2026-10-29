// Organize pages: a grid of the document's pages to select, drag into a new order, rotate,
// delete, duplicate, insert, extract and split. Every change goes through the session, which
// applies it with pages.ts and reloads the document.

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Radio,
  RadioGroup,
  Spinner,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowRedoRegular,
  ArrowRotateClockwiseRegular,
  ArrowRotateCounterclockwiseRegular,
  ArrowUndoRegular,
  CheckmarkRegular,
  CopyRegular,
  DeleteRegular,
  DocumentAddRegular,
  DocumentArrowUpRegular,
  SelectAllOnRegular,
  SplitVerticalRegular,
} from '@fluentui/react-icons';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { chunks, pagesLabel, parseRanges } from './pages';
import type { PdfSession } from './pdfFormat';

const useViewer = (session: PdfSession) => useSyncExternalStore(session.subscribe, session.viewer);

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip content={label} relationship="label" withArrow>
      {children}
    </Tooltip>
  );
}

/** For buttons that show their own text: the tooltip adds to it instead of replacing it. */
function Hint({ text, children }: { text: string; children: ReactElement }) {
  return (
    <Tooltip content={text} relationship="description" withArrow>
      {children}
    </Tooltip>
  );
}

/** Where inserted pages go: after the last selected page, or at the end. */
const insertPoint = (selection: number[], pages: number) => (selection.length ? Math.max(...selection) + 1 : pages);

export function OrganizeBar({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const selection = viewer.pageSelection;
  const none = selection.length === 0 || viewer.busy;
  const all = [...Array(viewer.pages).keys()];

  return (
    <Toolbar className="pdf-toolbar pdf-organize-bar" aria-label="Page tools" size="small">
      <Tip label="Select all pages (Ctrl+A)">
        <ToolbarButton icon={<SelectAllOnRegular />} onClick={() => session.selectPages(all)} />
      </Tip>
      <ToolbarDivider />
      <Tip label="Rotate left">
        <ToolbarButton icon={<ArrowRotateCounterclockwiseRegular />} disabled={none} onClick={() => void session.rotatePages(selection, -1)} />
      </Tip>
      <Tip label="Rotate right">
        <ToolbarButton icon={<ArrowRotateClockwiseRegular />} disabled={none} onClick={() => void session.rotatePages(selection, 1)} />
      </Tip>
      <Tip label="Delete pages (Del)">
        <ToolbarButton
          icon={<DeleteRegular />}
          disabled={none || selection.length >= viewer.pages}
          onClick={() => void session.deletePages(selection)}
        />
      </Tip>
      <Tip label="Duplicate pages">
        <ToolbarButton icon={<CopyRegular />} disabled={none} onClick={() => void session.duplicatePages(selection)} />
      </Tip>
      <ToolbarDivider />
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton icon={<DocumentAddRegular />} disabled={viewer.busy}>
            Insert
          </ToolbarButton>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => void session.insertBlankPage(insertPoint(selection, viewer.pages))}>Blank page</MenuItem>
            <MenuItem onClick={() => void session.insertFiles(insertPoint(selection, viewer.pages))}>
              Pages from PDFs or pictures…
            </MenuItem>
            <MenuItem onClick={() => void session.insertFiles(viewer.pages)}>Files at the end (combine)…</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <Hint text="Save the selected pages as a new PDF">
        <ToolbarButton icon={<DocumentArrowUpRegular />} disabled={none} onClick={() => void session.extractPages(selection)}>
          Extract
        </ToolbarButton>
      </Hint>
      <Hint text="Split into several files">
        <ToolbarButton icon={<SplitVerticalRegular />} disabled={viewer.busy} onClick={() => session.setViewer({ splitOpen: true })}>
          Split
        </ToolbarButton>
      </Hint>
      <div className="pdf-toolbar-spacer" />
      <span className="pdf-annotate-hint" aria-live="polite">
        {viewer.busy ? (
          <Spinner size="extra-tiny" label="Changing pages…" />
        ) : selection.length ? (
          `${selection.length} of ${viewer.pages} selected`
        ) : (
          `${viewer.pages} pages`
        )}
      </span>
      <Tip label="Undo (Ctrl+Z)">
        <ToolbarButton icon={<ArrowUndoRegular />} disabled={viewer.busy || !session.canUndo()} onClick={() => session.undo()} />
      </Tip>
      <Tip label="Redo (Ctrl+Y)">
        <ToolbarButton icon={<ArrowRedoRegular />} disabled={viewer.busy || !session.canRedo()} onClick={() => session.redo()} />
      </Tip>
      <ToolbarDivider />
      <ToolbarButton icon={<CheckmarkRegular />} onClick={() => session.setMode('view')}>
        Done
      </ToolbarButton>
    </Toolbar>
  );
}

type Drag = { pages: number[]; before: number; x: number; y: number };

/** The page grid. */
export function OrganizeView({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const generation = useSyncExternalStore(session.subscribe, session.generation);
  const grid = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const press = useRef<{ index: number; x: number; y: number; pointer: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [focus, setFocus] = useState(viewer.pageSelection[0] ?? 0);
  const selected = new Set(viewer.pageSelection);
  const count = viewer.pages;

  // Escape cancels a drag (before the shell's Escape clears the selection).
  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      press.current = null;
      setDrag(null);
    };
    window.addEventListener('keydown', cancel, { capture: true });
    return () => window.removeEventListener('keydown', cancel, { capture: true });
  }, [drag]);

  // While dragging near the top or bottom edge, the grid scrolls.
  useEffect(() => {
    if (!drag || !grid.current) return;
    let frame = 0;
    const step = () => {
      const box = grid.current?.getBoundingClientRect();
      if (box) {
        const edge = 48;
        if (drag.y < box.top + edge) grid.current!.scrollTop -= 12;
        else if (drag.y > box.bottom - edge) grid.current!.scrollTop += 12;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [drag]);

  /** Which gap the pointer is over: the index of the page the drop goes before. */
  const gapAt = (x: number, y: number): number => {
    const cards = [...(grid.current?.querySelectorAll<HTMLElement>('.pdf-organize-card') ?? [])];
    let best = count;
    let bestDistance = Infinity;
    cards.forEach((card, index) => {
      const r = card.getBoundingClientRect();
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const distance = dy * 4 + dx;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = x < r.left + r.width / 2 ? index : index + 1;
      }
    });
    return best;
  };

  const select = (index: number, event: { ctrlKey: boolean; shiftKey: boolean }) => {
    if (event.shiftKey && anchor.current !== null) {
      const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      const range = [...Array(to - from + 1).keys()].map((i) => from + i);
      session.selectPages(event.ctrlKey ? [...viewer.pageSelection, ...range] : range);
      return;
    }
    anchor.current = index;
    if (event.ctrlKey) {
      session.selectPages(selected.has(index) ? viewer.pageSelection.filter((i) => i !== index) : [...viewer.pageSelection, index]);
    } else if (!selected.has(index)) {
      session.selectPages([index]);
    }
  };

  const onPointerDown = (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || viewer.busy) return;
    setFocus(index);
    select(index, event);
    press.current = { index, x: event.clientX, y: event.clientY, pointer: event.pointerId };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (!start) return;
    if (!drag) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      // Captured only once a drag starts, so clicks and double-clicks still reach the page.
      grid.current?.setPointerCapture(start.pointer);
    }
    const pages = drag?.pages ?? (selected.has(start.index) ? viewer.pageSelection : [start.index]);
    setDrag({ pages, before: gapAt(event.clientX, event.clientY), x: event.clientX, y: event.clientY });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    press.current = null;
    if (grid.current?.hasPointerCapture(event.pointerId)) grid.current.releasePointerCapture(event.pointerId);
    if (drag) {
      setDrag(null);
      const sorted = [...drag.pages].sort((a, b) => a - b);
      // Dropping a block of pages onto itself changes nothing.
      const contiguous = sorted.every((page, i) => i === 0 || page === sorted[i - 1]! + 1);
      const noChange = contiguous && drag.before >= sorted[0]! && drag.before <= sorted[sorted.length - 1]! + 1;
      if (!noChange) void session.movePages(drag.pages, drag.before);
    } else if (start && !event.ctrlKey && !event.shiftKey) {
      // A plain click on a page that was part of a selection selects just that page.
      session.selectPages([start.index]);
    }
  };

  const open = (index: number) => {
    session.setMode('view');
    setTimeout(() => session.caps()?.scroll.scrollToPage({ pageNumber: index + 1, behavior: 'instant' }), 50);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const move = { ArrowLeft: -1, ArrowRight: 1, Home: -count, End: count }[event.key];
    if (move !== undefined) {
      event.preventDefault();
      const next = Math.min(count - 1, Math.max(0, focus + move));
      setFocus(next);
      select(next, { ctrlKey: false, shiftKey: event.shiftKey });
      if (!event.shiftKey) {
        anchor.current = next;
        session.selectPages([next]);
      }
      grid.current?.querySelectorAll<HTMLElement>('.pdf-organize-card')[next]?.focus();
    } else if (event.key === 'Enter') {
      open(focus);
    } else if (event.key === ' ') {
      event.preventDefault();
      select(focus, { ctrlKey: true, shiftKey: false });
    }
  };

  const marker = drag ? markerAt(grid.current, drag.before) : null;

  return (
    <div
      ref={grid}
      className="pdf-organize"
      role="listbox"
      aria-label="Pages"
      aria-multiselectable
      aria-busy={viewer.busy}
      data-dragging={drag !== null}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current = null;
        setDrag(null);
      }}
      onKeyDown={onKeyDown}
    >
      {Array.from({ length: count }, (_, index) => (
        <PageCard
          key={`${generation}:${index}`}
          session={session}
          index={index}
          selected={selected.has(index)}
          focusable={index === focus}
          onPointerDown={(event) => onPointerDown(index, event)}
          onOpen={() => open(index)}
        />
      ))}
      {marker && <div className="pdf-organize-marker" style={marker} aria-hidden />}
      {drag && (
        <div className="pdf-organize-ghost" style={{ left: drag.x + 14, top: drag.y + 14 }} aria-hidden>
          {drag.pages.length === 1 ? `Page ${drag.pages[0]! + 1}` : `${drag.pages.length} pages`}
        </div>
      )}
    </div>
  );
}

/** The insertion line for a drop before page `before`, in the grid's own coordinates. */
function markerAt(grid: HTMLDivElement | null, before: number) {
  if (!grid) return null;
  const cards = grid.querySelectorAll<HTMLElement>('.pdf-organize-card');
  const card = cards[Math.min(before, cards.length - 1)];
  if (!card) return null;
  const box = grid.getBoundingClientRect();
  const r = card.getBoundingClientRect();
  const atEnd = before >= cards.length;
  return {
    left: (atEnd ? r.right + 6 : r.left - 6) - box.left + grid.scrollLeft - 1.5,
    top: r.top - box.top + grid.scrollTop,
    height: r.height,
  };
}

function PageCard({
  session,
  index,
  selected,
  focusable,
  onPointerDown,
  onOpen,
}: {
  session: PdfSession;
  index: number;
  selected: boolean;
  focusable: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onOpen: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);

  // Pages are drawn when they come into view.
  useEffect(() => {
    const element = card.current;
    if (!element) return;
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        session.pageImage(index).then(
          (url) => live && setSrc(url),
          () => undefined,
        );
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [session, index]);

  return (
    <div
      ref={card}
      className="pdf-organize-card"
      role="option"
      aria-selected={selected}
      aria-label={`Page ${index + 1}`}
      tabIndex={focusable ? 0 : -1}
      data-selected={selected}
      onPointerDown={onPointerDown}
      onDoubleClick={onOpen}
    >
      <div className="pdf-organize-thumb">{src && <img src={src} alt="" draggable={false} />}</div>
      <span className="pdf-organize-label">{index + 1}</span>
    </div>
  );
}

export function SplitDialog({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const [how, setHow] = useState<'every' | 'ranges'>('every');
  const [every, setEvery] = useState('1');
  const [ranges, setRanges] = useState('');
  const perFile = Number(every);
  const groups =
    how === 'every'
      ? Number.isInteger(perFile) && perFile >= 1
        ? chunks(viewer.pages, perFile)
        : 'Type how many pages go in each file.'
      : parseRanges(ranges, viewer.pages);
  const error = typeof groups === 'string' ? groups : null;
  const close = () => session.setViewer({ splitOpen: false });

  let summary = '';
  if (typeof groups !== 'string') {
    const names = groups.slice(0, 4).map((group) => pagesLabel(group));
    summary = `Makes ${groups.length} ${groups.length === 1 ? 'file' : 'files'}: ${names.join('; ')}${groups.length > 4 ? '; …' : ''}.`;
  }

  return (
    <Dialog open={viewer.splitOpen} onOpenChange={(_, data) => !data.open && close()}>
      <DialogSurface className="pdf-split-dialog">
        <DialogBody>
          <DialogTitle>Split into several files</DialogTitle>
          <DialogContent className="pdf-split-content">
            <RadioGroup value={how} onChange={(_, data) => setHow(data.value as 'every' | 'ranges')}>
              <div className="pdf-split-row">
                <Radio value="every" label="Every" />
                <Input
                  className="pdf-split-every"
                  type="number"
                  min={1}
                  aria-label="Pages in each file"
                  value={every}
                  onFocus={() => setHow('every')}
                  onChange={(_, data) => setEvery(data.value)}
                />
                <span>pages</span>
              </div>
              <div className="pdf-split-row">
                <Radio value="ranges" label="By page ranges" />
                <Input
                  className="pdf-split-ranges"
                  aria-label="Page ranges"
                  placeholder="1-3, 4, 5-8"
                  value={ranges}
                  onFocus={() => setHow('ranges')}
                  onChange={(_, data) => setRanges(data.value)}
                />
              </div>
            </RadioGroup>
            <p className="pdf-split-summary" data-error={error !== null} aria-live="polite">
              {error ?? summary}
            </p>
            <p className="pdf-split-hint">The files are saved in a folder you choose. This document stays as it is.</p>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              disabled={error !== null}
              onClick={() => typeof groups !== 'string' && void session.splitPages(groups)}
            >
              Split
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
