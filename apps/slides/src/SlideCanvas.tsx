// One slide drawn by the renderer, scaled to a width. It redraws only when what the slide
// shows changes (its own parts, its position, or the shared layouts and themes), so edits
// to one slide don't redraw every thumbnail.

import type { SlideHandle } from '@aiden0z/pptx-renderer';
import { useEffect, useRef, useState } from 'react';
import { type Deck, type RenderOptions, renderInto, renderKey } from './render';

export function SlideCanvas({
  deck,
  index,
  width,
  options,
  label,
  interactive = true,
}: {
  deck: Deck;
  index: number;
  width: number;
  options: RenderOptions;
  label?: string;
  /** False for previews (thumbnails, the next slide): links in them can't be clicked or focused. */
  interactive?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const { width: slideWidth, height: slideHeight } = deck.presentation;
  const key = renderKey(deck, index);
  const latest = useRef({ deck, options });
  latest.current = { deck, options };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let handle: SlideHandle | null = null;
    try {
      handle = renderInto(latest.current.deck, index, latest.current.options);
      setFailed(false);
    } catch (error) {
      console.error('folio: slide could not be drawn', error);
      setFailed(true);
    }
    if (handle) element.replaceChildren(handle.element);
    // The renderer makes web links in text real <a target="_blank"> elements. Folio asks
    // first instead (and the window would refuse to open them anyway).
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.options.onNavigate?.({ url: link.getAttribute('href') ?? '' });
    };
    element.addEventListener('click', onClick, { capture: true });
    return () => {
      element.removeEventListener('click', onClick, { capture: true });
      handle?.dispose();
      element.replaceChildren();
    };
  }, [key, index]);

  const scale = width / slideWidth;
  return (
    <div
      className="slides-canvas"
      style={{ width, height: Math.round(slideHeight * scale) }}
      role="img"
      aria-label={label}
      data-failed={failed || undefined}
      data-preview={interactive ? undefined : true}
      inert={!interactive}
    >
      <div ref={host} className="slides-canvas-inner" style={{ width: slideWidth, height: slideHeight, transform: `scale(${scale})` }} />
      {failed && <div className="slides-canvas-error">This slide couldn&apos;t be drawn.</div>}
    </div>
  );
}

/** Mounts its children only once scrolled into view (thumbnails of long decks). */
export function WhenVisible({ height, children }: { height: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return (
    <div ref={ref} style={seen ? undefined : { height }}>
      {seen ? children : null}
    </div>
  );
}
