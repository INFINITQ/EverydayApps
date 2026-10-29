// The main window's side of a presentation on two screens: while the presenter view is up
// and a second monitor is there, the audience window shows the slides, and this keeps it in
// step (the deck once, then every slide change). Keys pressed on the audience screen (a
// clicker sends them to whichever window has the focus) come back here.

import type { DocHost } from '@folio/shell';
import { SHOW_CHANNEL, type ShowMessage } from './audience';
import { savePackage } from './pkg';
import type { SlidesSession } from './session';

let shows = 0;

export function linkAudience(session: SlidesSession, host: DocHost): () => void {
  let bus: BroadcastChannel | null = null;
  let show = '';
  let opening = false;
  let last = '';

  const sendDeck = async () => {
    if (!bus) return;
    bus.postMessage({ type: 'deck', show, bytes: await savePackage(session.state.pkg) } satisfies ShowMessage);
    last = '';
    sendSlide();
  };
  const sendSlide = () => {
    const state = session.state.show;
    if (!bus || !state) return;
    const key = `${state.index}|${state.blank}`;
    if (key === last) return;
    last = key;
    bus.postMessage({ type: 'slide', show, index: state.index, blank: state.blank } satisfies ShowMessage);
  };
  const onKey = (key: string) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(key)) session.showStep(1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(key)) session.showStep(-1);
    else if (key === 'Home') session.showGo(session.showable()[0] ?? 0);
    else if (key === 'End') session.showGo(session.showable().at(-1) ?? 0);
    else if (key === 'b' || key === 'B' || key === '.') session.showBlank('black');
    else if (key === 'w' || key === 'W' || key === ',') session.showBlank('white');
    else if (key === 'Escape') session.endShow();
  };

  const start = async () => {
    if (bus || opening || !host.presenterScreen) return;
    opening = true;
    try {
      if (!(await host.presenterScreen(true))) return;
      show = `show-${Date.now().toString(36)}-${++shows}`;
      bus = new BroadcastChannel(SHOW_CHANNEL);
      bus.onmessage = (event: MessageEvent<ShowMessage>) => {
        if (event.data.type === 'hello') void sendDeck();
        else if (event.data.type === 'key') onKey(event.data.key);
      };
      await sendDeck();
      host.notify('The audience sees the slides on the second screen.', 'info');
    } finally {
      opening = false;
    }
  };
  const stop = () => {
    if (!bus) return;
    bus.postMessage({ type: 'end', show } satisfies ShowMessage);
    bus.close();
    bus = null;
    void host.presenterScreen?.(false);
  };

  const unsubscribe = session.subscribe(() => {
    const state = session.state.show;
    if (state?.presenter) {
      if (bus) sendSlide();
      else void start();
    } else {
      stop();
    }
  });
  return () => {
    unsubscribe();
    stop();
  };
}
