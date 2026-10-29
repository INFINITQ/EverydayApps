// Edit mode: change what's printed on the pages. Click text to retype it (in its own font,
// size and color), add new text, add, move, resize or delete pictures, white out an area, or
// mark areas for redaction. Changes go through the session (content.ts), which checks each one.

import {
  Button,
  ColorSwatch,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Input,
  Option,
  Spinner,
  SwatchPicker,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  ToolbarRadioButton,
  ToolbarToggleButton,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowRedoRegular,
  ArrowUndoRegular,
  CheckmarkRegular,
  CursorRegular,
  DeleteRegular,
  DismissRegular,
  EraserRegular,
  ImageAddRegular,
  ShieldRegular,
  TextAddTRegular,
  TextBoldRegular,
} from '@fluentui/react-icons';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Box, PageContentInfo, TextItem, TextStyle } from './content';
import type { PdfSession } from './pdfFormat';

const useViewer = (session: PdfSession) => useSyncExternalStore(session.subscribe, session.viewer);

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip content={label} relationship="label" withArrow>
      {children}
    </Tooltip>
  );
}

const TEXT_COLORS = [
  { value: '#000000', name: 'Black' },
  { value: '#555555', name: 'Gray' },
  { value: '#1F3FA8', name: 'Blue' },
  { value: '#C00000', name: 'Red' },
  { value: '#1E7B34', name: 'Green' },
];

const FAMILIES = [
  { value: 'sans', label: 'Sans serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
] as const;

const GENERIC = {
  sans: 'Arial, "Segoe UI", sans-serif',
  serif: '"Times New Roman", Georgia, serif',
  mono: '"Courier New", Consolas, monospace',
};

/** CSS for showing text like the PDF does: its own font if Windows has it, else one like it. */
export function cssFont(style: TextStyle, fontName: string, scale: number): string {
  const family = fontName ? `"${fontName.replace(/[-,](Bold|Italic|Regular|Oblique|BoldItalic)$/i, '').replace(/"/g, '')}", ` : '';
  return `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${Math.max(4, style.size * scale)}px ${family}${GENERIC[style.family]}`;
}

const HINTS = {
  select: 'Click text to change it. Click a picture to move or resize it.',
  text: 'Click where the new text should go.',
  whiteout: 'Drag over what to cover with white. It stays in the file underneath.',
  redact: 'Drag over what to remove for good, then apply.',
};

export function EditBar({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const style = viewer.textStyle;
  const setStyle = (patch: Partial<TextStyle>) => session.setViewer({ textStyle: { ...style, ...patch } });
  const selected = viewer.contentSelection;
  const marks = viewer.redactions.length;

  return (
    <Toolbar
      className="pdf-toolbar pdf-edit-bar"
      aria-label="Content tools"
      size="small"
      checkedValues={{ tool: [viewer.editTool] }}
      onCheckedValueChange={(_, data) => {
        const next = data.checkedItems[0] as typeof viewer.editTool | undefined;
        if (next) session.setViewer({ editTool: next, contentSelection: null });
      }}
    >
      <Tip label="Edit text and pictures">
        <ToolbarRadioButton name="tool" value="select" icon={<CursorRegular />} />
      </Tip>
      <Tip label="Add text">
        <ToolbarRadioButton name="tool" value="text" icon={<TextAddTRegular />} />
      </Tip>
      <Tip label="Add a picture">
        <ToolbarButton icon={<ImageAddRegular />} disabled={viewer.busy} onClick={() => void session.addPicture()} />
      </Tip>
      <Tip label="Whiteout">
        <ToolbarRadioButton name="tool" value="whiteout" icon={<EraserRegular />} />
      </Tip>
      <Tip label="Redact">
        <ToolbarRadioButton name="tool" value="redact" icon={<ShieldRegular />} />
      </Tip>
      <ToolbarDivider />
      {viewer.editTool === 'text' && (
        <span className="pdf-edit-style">
          <Dropdown
            size="small"
            className="pdf-edit-family"
            aria-label="Font"
            value={FAMILIES.find((f) => f.value === style.family)!.label}
            selectedOptions={[style.family]}
            onOptionSelect={(_, data) => setStyle({ family: data.optionValue as TextStyle['family'] })}
          >
            {FAMILIES.map((family) => (
              <Option key={family.value} value={family.value}>
                {family.label}
              </Option>
            ))}
          </Dropdown>
          <Input
            size="small"
            type="number"
            className="pdf-edit-size"
            aria-label="Text size"
            min={4}
            max={144}
            value={String(style.size)}
            onChange={(_, data) => {
              const size = Number(data.value);
              if (size >= 4 && size <= 144) setStyle({ size });
            }}
          />
          <Tip label="Bold">
            <ToolbarToggleButton
              name="bold"
              value="bold"
              icon={<TextBoldRegular />}
              aria-pressed={style.bold}
              onClick={() => setStyle({ bold: !style.bold })}
            />
          </Tip>
          <SwatchPicker
            layout="row"
            size="extra-small"
            shape="circular"
            aria-label="Text color"
            selectedValue={style.color}
            onSelectionChange={(_, data) => setStyle({ color: data.selectedValue })}
          >
            {TEXT_COLORS.map((color) => (
              <ColorSwatch key={color.value} color={color.value} value={color.value} aria-label={color.name} />
            ))}
          </SwatchPicker>
        </span>
      )}
      {viewer.editTool === 'redact' && (
        <span className="pdf-edit-style">
          <span className="pdf-annotate-hint">{marks ? `${marks} ${marks === 1 ? 'area' : 'areas'} marked` : HINTS.redact}</span>
          <Button size="small" appearance="primary" disabled={!marks || viewer.busy} onClick={() => session.setViewer({ redactOpen: true })}>
            Apply redactions
          </Button>
          {marks > 0 && (
            <Button size="small" appearance="subtle" onClick={() => session.setViewer({ redactions: [] })}>
              Clear marks
            </Button>
          )}
        </span>
      )}
      {viewer.editTool !== 'text' && viewer.editTool !== 'redact' && <span className="pdf-annotate-hint">{HINTS[viewer.editTool]}</span>}
      <div className="pdf-toolbar-spacer" />
      {viewer.busy && <Spinner size="extra-tiny" label="Changing the page…" />}
      {selected && (
        <ToolbarButton
          icon={<DeleteRegular />}
          disabled={viewer.busy}
          onClick={() => void session.removeContent(selected.page, selected.index)}
        >
          Delete picture
        </ToolbarButton>
      )}
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

type Point = { x: number; y: number };
type Editing = { index: number | null; at: Point; text: string; style: TextStyle; fontName: string; box: Box | null };
type Drag = { index: number; resize: boolean; start: Point; from: Box; box: Box };

const normalize = (a: Point, b: Point): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/** One page's edit layer: boxes over its text and pictures, and the editors. */
export function EditLayer({ session, page, width }: { session: PdfSession; page: number; width: number; height: number }) {
  const viewer = useViewer(session);
  const generation = useSyncExternalStore(session.subscribe, session.generation);
  const layer = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<PageContentInfo | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [area, setArea] = useState<{ start: Point; end: Point } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    let live = true;
    setInfo(null);
    setEditing(null);
    session.pageContent(page).then(
      (next) => live && setInfo(next),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [session, page, generation]);

  // Until the page's content is read (a moment after each change), nothing here can be edited.
  if (!info) return <div className="pdf-edit-layer" data-tool={viewer.editTool} data-ready={false} />;
  const scale = width / info.width;
  const px = (box: Box) => ({ left: box.x * scale, top: box.y * scale, width: box.width * scale, height: box.height * scale });
  const pointOf = (event: { clientX: number; clientY: number }): Point => {
    const rect = layer.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };
  const selected = viewer.contentSelection?.page === page ? viewer.contentSelection.index : null;
  const tool = viewer.editTool;

  const startText = (item: TextItem) => {
    setEditing({ index: item.index, at: { x: item.box.x, y: item.box.y }, text: item.text, style: item.style, fontName: item.fontName, box: item.box });
  };

  const onLayerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || viewer.busy || editing) return;
    const at = pointOf(event);
    if (tool === 'text') {
      event.preventDefault();
      setEditing({ index: null, at, text: '', style: viewer.textStyle, fontName: '', box: null });
    } else if (tool === 'whiteout' || tool === 'redact') {
      event.preventDefault();
      layer.current?.setPointerCapture(event.pointerId);
      setArea({ start: at, end: at });
    } else if (event.target === layer.current) {
      session.setViewer({ contentSelection: null });
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (area) setArea({ ...area, end: pointOf(event) });
    if (drag) {
      const at = pointOf(event);
      const dx = at.x - drag.start.x;
      const dy = at.y - drag.start.y;
      if (drag.resize) {
        // Corner drag keeps the picture's shape.
        const ratio = drag.from.height / drag.from.width;
        const w = Math.max(8, drag.from.width + dx);
        setDrag({ ...drag, box: { ...drag.from, width: w, height: w * ratio } });
      } else {
        setDrag({ ...drag, box: { ...drag.from, x: drag.from.x + dx, y: drag.from.y + dy } });
      }
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (layer.current?.hasPointerCapture(event.pointerId)) layer.current.releasePointerCapture(event.pointerId);
    if (area) {
      const box = normalize(area.start, pointOf(event));
      setArea(null);
      if (box.width < 3 || box.height < 3) return;
      if (tool === 'whiteout') void session.whiteout(page, box);
      else if (tool === 'redact') session.setViewer({ redactions: [...viewer.redactions, { page, box }] });
    }
    if (drag) {
      const { index, from, box } = drag;
      setDrag(null);
      if (Math.abs(box.x - from.x) + Math.abs(box.y - from.y) + Math.abs(box.width - from.width) > 0.5) {
        void session.moveContent(page, index, box);
      }
    }
  };

  const startDrag = (index: number, from: Box, resize: boolean, event: ReactPointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (event.button !== 0 || viewer.busy) return;
    session.setViewer({ contentSelection: { page, index } });
    layer.current?.setPointerCapture(event.pointerId);
    const start = pointOf(event);
    setDrag({ index, resize, start, from, box: from });
  };

  const commit = (value: string) => {
    const current = editing;
    setEditing(null);
    if (!current) return;
    if (current.index !== null) {
      if (value !== current.text) void session.editText(page, current.index, value);
    } else if (value.trim()) {
      // The click was the top of the new text; its baseline sits a bit lower.
      void session.addText(page, { x: current.at.x, y: current.at.y + current.style.size * 0.8 }, value);
    }
  };

  return (
    <div
      ref={layer}
      className="pdf-edit-layer"
      data-tool={tool}
      data-ready
      onPointerDown={onLayerPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {tool === 'select' &&
        info.items.map((item) =>
          item.kind === 'text' ? (
            <button
              key={item.index}
              className="pdf-edit-text"
              style={px(item.box)}
              aria-label={`Edit text: ${item.text}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => startText(item)}
            />
          ) : (
            <div
              key={item.index}
              className="pdf-edit-image"
              data-selected={selected === item.index}
              style={px(drag?.index === item.index ? drag.box : item.box)}
              role="button"
              aria-label="Picture"
              aria-pressed={selected === item.index}
              onPointerDown={(event) => startDrag(item.index, item.box, false, event)}
            >
              {selected === item.index && (
                <span
                  className="pdf-edit-handle"
                  aria-label="Resize"
                  onPointerDown={(event) => startDrag(item.index, item.box, true, event)}
                />
              )}
            </div>
          ),
        )}
      {viewer.redactions
        .filter((mark) => mark.page === page)
        .map((mark, i) => (
          <div key={`mark-${i}`} className="pdf-edit-redaction" style={px(mark.box)}>
            <button
              className="pdf-edit-unmark"
              aria-label="Remove this mark"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => session.setViewer({ redactions: viewer.redactions.filter((other) => other !== mark) })}
            >
              <DismissRegular />
            </button>
          </div>
        ))}
      {area && <div className="pdf-edit-area" data-tool={tool} style={px(normalize(area.start, area.end))} />}
      {editing && <TextEditor editing={editing} scale={scale} onDone={commit} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function TextEditor({
  editing,
  scale,
  onDone,
  onCancel,
}: {
  editing: Editing;
  scale: number;
  onDone: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(editing.text);
  const [width, setWidth] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const font = cssFont(editing.style, editing.fontName, scale);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  // Wide enough for what's typed, measured in the same font.
  useEffect(() => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    context.font = font;
    setWidth(context.measureText(value || ' ').width + 12);
  }, [value, font]);

  const box = editing.box;
  const height = (box ? box.height : editing.style.size * 1.25) * scale;
  const finish = (cancel: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (cancel) onCancel();
    else onDone(value);
  };

  return (
    <input
      ref={input}
      className="pdf-edit-input"
      aria-label={editing.index === null ? 'New text' : 'Edit text'}
      value={value}
      style={{
        left: (box ? box.x : editing.at.x) * scale - 3,
        top: (box ? box.y : editing.at.y) * scale - 2,
        height: height + 4,
        width: Math.max(width, (box?.width ?? 0) * scale + 8),
        font,
        color: editing.style.color,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(false)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(false);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(true);
        }
      }}
    />
  );
}

export function RedactDialog({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const count = viewer.redactions.length;
  const close = () => session.setViewer({ redactOpen: false });
  return (
    <Dialog open={viewer.redactOpen} onOpenChange={(_, data) => !data.open && close()}>
      <DialogSurface className="pdf-confirm-dialog">
        <DialogBody>
          <DialogTitle>
            Redact {count} {count === 1 ? 'area' : 'areas'}?
          </DialogTitle>
          <DialogContent className="pdf-confirm-content">
            <p>
              The text, pictures and drawings in the marked areas are removed from the PDF, and each area is blacked
              out. Until you save, Undo brings them back.
            </p>
            <p className="pdf-split-hint">
              Folio&apos;s backup of the original, kept on this PC for 14 days, still has them. You can clear backups from
              the command palette.
            </p>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={close}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={() => void session.applyRedactions()}>
              Redact
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Shown when the check found changes outside the edited area. */
export function StrayDialog({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const close = () => session.setViewer({ strayChange: false });
  return (
    <Dialog open={viewer.strayChange} onOpenChange={(_, data) => !data.open && close()}>
      <DialogSurface className="pdf-confirm-dialog">
        <DialogBody>
          <DialogTitle>Something else on the page changed</DialogTitle>
          <DialogContent>
            Folio compared the page before and after this change, and a part you didn&apos;t edit looks different. This
            can happen with unusual PDFs. Undo the change, or keep it if the page looks right.
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={close}>
              Keep it
            </Button>
            <Button
              appearance="primary"
              onClick={() => {
                close();
                session.undo();
              }}
            >
              Undo the change
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
