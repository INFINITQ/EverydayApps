// Editing on the slide: click a shape to select it, drag it to move it, drag a handle to
// resize it, double-click (or Enter) to edit its text right where it is. Arrow keys nudge,
// Delete removes. Everything happens on an overlay above the drawn slide; the edit goes to
// the slide's XML when the gesture ends.

import type { SlideNode } from '@aiden0z/pptx-renderer';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { nodesOf } from './render';
import type { SlidesSession } from './session';
import { EMU_PER_PX, setBounds } from './shapes';
import type { SlideActions } from './SlidesView';
import { LINE_BREAK, setShapeText, shapeText } from './text';

type Box = { x: number; y: number; w: number; h: number };
type Drag = { kind: 'move' | 'resize'; handle?: string; start: { x: number; y: number }; box: Box; moved: boolean };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const boxOf = (node: SlideNode): Box => ({ x: node.position.x, y: node.position.y, w: node.size.w, h: node.size.h });

export function EditLayer({ session, width, actions }: { session: SlidesSession; width: number; actions: SlideActions }) {
  const state = useSyncExternalStore(session.subscribe, () => session.state);
  const { deck, current } = state;
  const scale = width / deck.presentation.width;
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Box | null>(null);
  const nodes = nodesOf(deck, current).filter((n) => !n.hidden);
  const selected = nodes.find((n) => n.id === state.shape) ?? null;
  const editing = state.editing ? nodes.find((n) => n.id === state.editing) ?? null : null;

  useEffect(() => setPreview(null), [state.revision]);

  const toSlide = (event: { clientX: number; clientY: number }) => {
    const rect = layer.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };
  const hit = (point: { x: number; y: number }) =>
    [...nodes].reverse().find((n) => {
      const b = boxOf(n);
      return point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h;
    }) ?? null;

  const part = state.slides[current]?.part;
  const commit = (box: Box) => {
    if (!selected || !part) return;
    const emu = { x: box.x * EMU_PER_PX, y: box.y * EMU_PER_PX, w: box.w * EMU_PER_PX, h: box.h * EMU_PER_PX };
    session.apply(drag?.kind === 'resize' ? 'Resize shape' : 'Move shape', (pkg) => setBounds(pkg, part, selected.id, emu), {
      keepShape: true,
    });
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || editing) return;
    const point = toSlide(event);
    const handle = (event.target as HTMLElement).dataset.handle;
    const target = handle ? selected : hit(point);
    session.selectShape(target?.id ?? null);
    layer.current?.focus();
    if (!target) return;
    layer.current!.setPointerCapture(event.pointerId);
    setDrag({ kind: handle ? 'resize' : 'move', handle, start: point, box: boxOf(target), moved: false });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const point = toSlide(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx * scale, dy * scale) < 3) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });
    const b = drag.box;
    if (drag.kind === 'move') return setPreview({ ...b, x: b.x + dx, y: b.y + dy });
    const h = drag.handle ?? 'se';
    let { x, y, w, h: height } = b;
    if (h.includes('e')) w = b.w + dx;
    if (h.includes('s')) height = b.h + dy;
    if (h.includes('w')) {
      x = b.x + dx;
      w = b.w - dx;
    }
    if (h.includes('n')) {
      y = b.y + dy;
      height = b.h - dy;
    }
    // Pictures keep their proportions from a corner (Shift does it for any shape).
    if (h.length === 2 && (event.shiftKey || selected?.nodeType === 'picture') && b.w > 0 && b.h > 0) {
      const ratio = Math.max(w / b.w, height / b.h);
      const nw = b.w * ratio;
      const nh = b.h * ratio;
      if (h.includes('w')) x = b.x + b.w - nw;
      if (h.includes('n')) y = b.y + b.h - nh;
      w = nw;
      height = nh;
    }
    setPreview({ x, y, w: Math.max(4, w), h: Math.max(4, height) });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (!drag) return;
    layer.current?.releasePointerCapture(event.pointerId);
    if (drag.moved && preview) commit(preview);
    else setPreview(null);
    setDrag(null);
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const target = hit(toSlide(event));
    if (target?.nodeType === 'shape') session.setEditing(target.id);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing || !selected) return;
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = moves[event.key];
    if (delta) {
      const b = boxOf(selected);
      commit({ ...b, x: b.x + delta[0], y: b.y + delta[1] });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      actions.deleteShape();
    } else if ((event.key === 'Enter' || event.key === 'F2') && selected.nodeType === 'shape') {
      session.setEditing(selected.id);
    } else if (event.key === 'Escape') {
      session.selectShape(null);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const shown = preview ?? (selected ? boxOf(selected) : null);
  return (
    <div
      ref={layer}
      className="slides-edit-layer"
      tabIndex={-1}
      aria-label="Slide editing area"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      {shown && !editing && (
        <div
          className="slides-selection"
          data-shape={selected?.id}
          style={{ left: shown.x * scale, top: shown.y * scale, width: shown.w * scale, height: shown.h * scale }}
        >
          {HANDLES.map((h) => (
            <span key={h} className="slides-handle" data-handle={h} data-pos={h} />
          ))}
        </div>
      )}
      {editing && (
        <TextEditor
          key={`${editing.id}-${state.revision}`}
          session={session}
          node={editing}
          scale={scale}
          onDone={(paragraphs) => {
            session.setEditing(null);
            if (paragraphs && part) {
              session.apply('Edit text', (pkg) => setShapeText(pkg, part, editing.id, paragraphs), { keepShape: true });
            }
            layer.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function TextEditor({
  session,
  node,
  scale,
  onDone,
}: {
  session: SlidesSession;
  node: SlideNode;
  scale: number;
  onDone(paragraphs: string[] | null): void;
}) {
  const { pkg, slides, current } = session.state;
  const part = slides[current]!.part;
  const initial = (shapeText(pkg, part, node.id) ?? []).join('\n');
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }, []);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(keep && value !== initial ? value.split('\n') : null);
  };
  const b = boxOf(node);
  return (
    <textarea
      ref={ref}
      className="slides-text-editor"
      aria-label="Shape text"
      spellCheck
      value={value}
      style={{ left: b.x * scale, top: b.y * scale, width: Math.max(160, b.w * scale), minHeight: Math.max(48, b.h * scale) }}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || (event.key === 'Enter' && event.ctrlKey)) {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Enter' && event.shiftKey) {
          // A line break inside the paragraph, as Shift+Enter does in PowerPoint.
          event.preventDefault();
          const area = event.currentTarget;
          const { selectionStart: s, selectionEnd: e } = area;
          const next = `${value.slice(0, s)}${LINE_BREAK}${value.slice(e)}`;
          setValue(next);
          requestAnimationFrame(() => area.setSelectionRange(s + 1, s + 1));
        }
      }}
    />
  );
}
