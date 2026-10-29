// The audience's screen during a presentation: a full-screen window on a second monitor
// that shows the slide the presenter is on. It has no IPC permissions and no file access:
// the main window sends it the deck and each slide change over a BroadcastChannel (same
// origin only), and it sends back the keys a clicker presses while it has the focus.

import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { openPackage } from './pkg';
import { type Deck, buildDeck, loadFonts } from './render';
import { SlideCanvas } from './SlideCanvas';

export const SHOW_CHANNEL = 'folio-slides-show';

export type ShowMessage =
  | { type: 'hello' }
  | { type: 'deck'; show: string; bytes: Uint8Array }
  | { type: 'slide'; show: string; index: number; blank: 'black' | 'white' | null }
  | { type: 'end'; show: string }
  | { type: 'key'; key: string };

/** Keys a presenter (or a clicker) uses, passed back to the main window. */
const SHOW_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N', 'ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P', 'Home', 'End', 'b', 'B', '.', 'w', 'W', ',', 'Escape']);

export function AudienceApp() {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [slide, setSlide] = useState<{ index: number; blank: 'black' | 'white' | null }>({ index: 0, blank: null });
  const [ended, setEnded] = useState(false);
  const [width, setWidth] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const urls = useRef(new Map<string, string>());

  useEffect(() => {
    const bus = new BroadcastChannel(SHOW_CHANNEL);
    channel.current = bus;
    let show = '';
    bus.onmessage = async (event: MessageEvent<ShowMessage>) => {
      const message = event.data;
      if (message.type === 'deck') {
        show = message.show;
        const pkg = await openPackage(message.bytes);
        await loadFonts(pkg);
        setDeck(buildDeck(pkg));
        setEnded(false);
      } else if (message.type === 'slide' && message.show === show) {
        setSlide({ index: message.index, blank: message.blank });
      } else if (message.type === 'end' && message.show === show) {
        setEnded(true);
      }
    };
    bus.postMessage({ type: 'hello' } satisfies ShowMessage);
    const onKey = (event: KeyboardEvent) => {
      if (!SHOW_KEYS.has(event.key) && !/^[0-9]$/.test(event.key)) return;
      event.preventDefault();
      bus.postMessage({ type: 'key', key: event.key } satisfies ShowMessage);
    };
    window.addEventListener('keydown', onKey);
    const cached = urls.current;
    return () => {
      window.removeEventListener('keydown', onKey);
      bus.close();
      for (const url of cached.values()) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    const element = stage.current;
    if (!element || !deck) return;
    const aspect = deck.presentation.width / deck.presentation.height;
    const measure = () => setWidth(Math.floor(Math.min(element.clientWidth, element.clientHeight * aspect)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [deck]);

  return (
    <div
      ref={stage}
      className="slides-audience"
      onClick={() => channel.current?.postMessage({ type: 'key', key: 'ArrowRight' } satisfies ShowMessage)}
    >
      {deck && width > 0 && !ended && (
        <SlideCanvas
          key={slide.index}
          deck={deck}
          index={slide.index}
          width={width}
          options={{ mediaUrlCache: urls.current, onNavigate: () => undefined }}
          interactive={false}
        />
      )}
      {slide.blank && !ended && <div className="slides-show-blank" data-color={slide.blank} />}
      {!deck && <p className="slides-audience-wait">Waiting for the presentation…</p>}
      {ended && <p className="slides-audience-wait">The slideshow has ended.</p>}
    </div>
  );
}

export function mountAudience(root: HTMLElement) {
  document.title = 'Slideshow';
  createRoot(root).render(<AudienceApp />);
}
