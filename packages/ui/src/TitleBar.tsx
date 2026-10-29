import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';

export type TabInfo = { id: string; title: string; dirty: boolean; tooltip?: string };

export type CaptionState = 'enter' | 'leave' | 'press' | 'release';

/** Window controls. The shell implements them over Tauri; the UI stays framework-free. */
export interface WindowControls {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onResized(listener: () => void): () => void;
  /** Tells Rust where the HTML maximize button is, for Windows 11's Snap Layouts. */
  reportMaximizeRect(rect: { right: number; top: number; width: number; height: number }): void;
  /** Hover and press state from the native Snap Layouts overlay. */
  onCaption(listener: (state: CaptionState) => void): () => void;
}

type TitleBarProps = {
  appName: string;
  icon?: ReactNode;
  tabs: TabInfo[];
  activeId: string | null;
  onSelect(id: string): void;
  onClose(id: string): void;
  onReorder(from: number, to: number): void;
  onNewTab?(): void;
  newTabLabel?: string;
  controls: WindowControls;
};

/** Windows 11 title bar: icon, tabs, a drag area, and the caption buttons. */
export function TitleBar(props: TitleBarProps) {
  const focused = useWindowFocus();
  const label = props.newTabLabel ?? 'Open';
  return (
    <header className="folio-titlebar" data-focused={focused}>
      <div className="folio-titlebar-icon" aria-hidden="true">
        {props.icon}
      </div>
      {props.tabs.length === 0 ? (
        <span className="folio-titlebar-name">{props.appName}</span>
      ) : (
        <TabStrip {...props} />
      )}
      {props.onNewTab && (
        <button className="folio-newtab" aria-label={label} title={label} onClick={props.onNewTab}>
          {''}
        </button>
      )}
      <div className="folio-drag" />
      <CaptionButtons controls={props.controls} />
    </header>
  );
}

function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return focused;
}

type Drag = { id: string; from: number; startX: number; dx: number; moved: boolean };

/** Tabs with pointer-based reordering (native file drops disable HTML drag and drop). */
function TabStrip({ tabs, activeId, onSelect, onClose, onReorder }: TitleBarProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());

  const dropIndex = (clientX: number, dragged: string) => {
    let index = 0;
    for (const tab of tabs) {
      if (tab.id === dragged) continue;
      const box = elements.current.get(tab.id)?.getBoundingClientRect();
      if (box && clientX > box.left + box.width / 2) index += 1;
    }
    return index;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, id: string, index: number) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id, from: index, startX: event.clientX, dx: 0, moved: false });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    setDrag({ ...drag, dx, moved: drag.moved || Math.abs(dx) > 4 });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (drag.moved) {
      const to = dropIndex(event.clientX, drag.id);
      if (to !== drag.from) onReorder(drag.from, to);
    } else {
      onSelect(drag.id);
    }
    setDrag(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step) {
      const next = tabs[(index + step + tabs.length) % tabs.length];
      if (next) {
        onSelect(next.id);
        elements.current.get(next.id)?.focus();
      }
      event.preventDefault();
    }
  };

  return (
    <div className="folio-tabs" role="tablist" aria-label="Open documents">
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;
        const dragging = drag?.id === tab.id && drag.moved;
        return (
          <div
            key={tab.id}
            ref={(el) => {
              if (el) elements.current.set(tab.id, el);
              else elements.current.delete(tab.id);
            }}
            className="folio-tab"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={tab.tooltip ?? tab.title}
            data-dirty={tab.dirty}
            data-dragging={dragging}
            style={dragging ? { transform: `translateX(${drag.dx}px)` } : undefined}
            onPointerDown={(e) => onPointerDown(e, tab.id, index)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            onAuxClick={(e) => e.button === 1 && onClose(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            <span className="folio-tab-title">{tab.title}</span>
            <button
              className="folio-tab-close"
              aria-label={`Close ${tab.title}`}
              tabIndex={-1}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <span className="folio-glyph-dot" aria-hidden="true" />
              <span className="folio-glyph-close" aria-hidden="true">
                {''}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Minimize, maximize/restore (with Windows 11 Snap Layouts) and close. */
function CaptionButtons({ controls }: { controls: WindowControls }) {
  const maximize = useRef<HTMLButtonElement>(null);
  const [maximized, setMaximized] = useState(false);
  const [state, setState] = useState<'idle' | 'hover' | 'pressed'>('idle');

  useEffect(() => {
    const report = () => {
      const box = maximize.current?.getBoundingClientRect();
      if (!box) return;
      controls.reportMaximizeRect({
        right: window.innerWidth - box.right,
        top: box.top,
        width: box.width,
        height: box.height,
      });
      void controls.isMaximized().then(setMaximized);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(document.documentElement);
    const stopResize = controls.onResized(report);
    const stopCaption = controls.onCaption((caption) => {
      setState(caption === 'press' ? 'pressed' : caption === 'leave' ? 'idle' : 'hover');
    });
    return () => {
      observer.disconnect();
      stopResize();
      stopCaption();
    };
  }, [controls]);

  return (
    <div className="folio-caption">
      <button aria-label="Minimize" title="Minimize" onClick={() => controls.minimize()}>
        {''}
      </button>
      <button
        ref={maximize}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        data-state={state}
        onClick={() => controls.toggleMaximize()}
      >
        {maximized ? '' : ''}
      </button>
      <button className="folio-close" aria-label="Close" title="Close" onClick={() => controls.close()}>
        {''}
      </button>
    </div>
  );
}
