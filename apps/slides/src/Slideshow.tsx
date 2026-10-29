// Presenting: the slides alone, full screen, or the presenter view (current and next
// slide, notes, a timer) in the same window. Keys: Right/Down/Page Down/Space/Enter/N go
// forward, Left/Up/Page Up/Backspace/P go back, Home/End, a slide number then Enter jumps,
// B or . blacks the screen, W or , whitens it, Esc ends the show.

import { Button, Tooltip } from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  ArrowResetRegular,
  ArrowRightRegular,
  DismissRegular,
  PauseRegular,
  PlayRegular,
  PresenterRegular,
  SlideMultipleRegular,
  TextFontSizeRegular,
} from '@fluentui/react-icons';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RenderOptions } from './render';
import { type SlidesSession, elapsed } from './session';
import { SlideCanvas } from './SlideCanvas';

function useFitBox(aspect: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(Math.min(element.clientWidth, element.clientHeight * aspect)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [aspect]);
  return { ref, width };
}

export const formatTime = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
};

/** Handles the show's keys before anything else (the shell's shortcuts included). */
function useShowKeys(session: SlidesSession) {
  useEffect(() => {
    let typed = '';
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog (a link waiting for Open or Cancel) has the keys first.
      if (!session.state.show || session.state.linkPrompt || event.isComposing) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key;
      if (/^[0-9]$/.test(key)) {
        typed = (typed + key).slice(-4);
      } else if (key === 'Enter' && typed) {
        session.showGo(Number(typed) - 1);
        typed = '';
      } else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(key)) {
        session.showStep(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(key)) {
        session.showStep(-1);
      } else if (key === 'Home') {
        session.showGo(session.showable()[0] ?? 0);
      } else if (key === 'End') {
        session.showGo(session.showable().at(-1) ?? 0);
      } else if (key === 'b' || key === 'B' || key === '.') {
        session.showBlank('black');
      } else if (key === 'w' || key === 'W' || key === ',') {
        session.showBlank('white');
      } else if (key === 'Escape') {
        session.endShow();
      } else {
        return;
      }
      if (!/^[0-9]$/.test(key)) typed = key === 'Enter' ? '' : typed;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [session]);
}

export function Slideshow({ session, options }: { session: SlidesSession; options: RenderOptions }) {
  const state = useSyncExternalStore(session.subscribe, () => session.state);
  useShowKeys(session);
  const show = state.show!;
  return show.presenter ? <PresenterView session={session} options={options} /> : <AudienceView session={session} options={options} />;
}

function AudienceView({ session, options }: { session: SlidesSession; options: RenderOptions }) {
  const state = useSyncExternalStore(session.subscribe, () => session.state);
  const show = state.show!;
  const { deck } = state;
  const { ref, width } = useFitBox(deck.presentation.width / deck.presentation.height);
  const [idle, setIdle] = useState(false);
  const timer = useRef<number>(0);
  const wake = () => {
    setIdle(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), 2500);
  };
  useEffect(() => {
    wake();
    return () => window.clearTimeout(timer.current);
  }, []);
  return (
    <div
      className="slides-show"
      role="dialog"
      aria-label="Slideshow"
      data-idle={idle || undefined}
      onPointerMove={wake}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('.slides-show-controls')) return;
        if ((event.target as HTMLElement).closest('a')) return;
        session.showStep(1);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        session.showStep(-1);
      }}
    >
      <div ref={ref} className="slides-show-stage">
        {width > 0 && (
          <SlideCanvas
            key={show.index}
            deck={deck}
            index={show.index}
            width={width}
            options={options}
            label={`Slide ${show.index + 1} of ${state.slides.length}`}
          />
        )}
      </div>
      {show.blank && <div className="slides-show-blank" data-color={show.blank} aria-label={`${show.blank} screen`} />}
      <div className="slides-show-controls">
        <Button appearance="transparent" aria-label="Previous slide" icon={<ArrowLeftRegular />} onClick={() => session.showStep(-1)} />
        <span className="slides-show-count">
          {show.index + 1} / {state.slides.length}
        </span>
        <Button appearance="transparent" aria-label="Next slide" icon={<ArrowRightRegular />} onClick={() => session.showStep(1)} />
        <Tooltip content="Presenter view" relationship="label">
          <Button appearance="transparent" aria-label="Presenter view" icon={<PresenterRegular />} onClick={() => session.setPresenter(true)} />
        </Tooltip>
        <Tooltip content="End show (Esc)" relationship="label">
          <Button appearance="transparent" aria-label="End show" icon={<DismissRegular />} onClick={() => session.endShow()} />
        </Tooltip>
      </div>
    </div>
  );
}

function PresenterView({ session, options }: { session: SlidesSession; options: RenderOptions }) {
  const state = useSyncExternalStore(session.subscribe, () => session.state);
  const show = state.show!;
  const { deck, slides } = state;
  const aspect = deck.presentation.width / deck.presentation.height;
  const main = useFitBox(aspect);
  const upcoming = useFitBox(aspect);
  const [now, setNow] = useState(() => Date.now());
  const [notesSize, setNotesSize] = useState(20);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const next = session.showable().find((i) => i > show.index);
  const notes = session.notes(slides[show.index]);
  return (
    <div className="slides-presenter" role="dialog" aria-label="Presenter view">
      <header className="slides-presenter-bar">
        <span className="slides-presenter-timer" aria-label="Elapsed time">
          {formatTime(elapsed(show, now))}
        </span>
        <Button
          appearance="subtle"
          aria-label={show.startedAt === null ? 'Resume timer' : 'Pause timer'}
          icon={show.startedAt === null ? <PlayRegular /> : <PauseRegular />}
          onClick={() => session.toggleTimer()}
        />
        <Button appearance="subtle" aria-label="Restart timer" icon={<ArrowResetRegular />} onClick={() => session.resetTimer()} />
        <span className="slides-presenter-clock">{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <span className="slides-presenter-spacer" />
        <span className="slides-presenter-count">
          Slide {show.index + 1} of {slides.length}
          {slides[show.index]?.hidden ? ' (hidden)' : ''}
        </span>
        <Button appearance="subtle" icon={<SlideMultipleRegular />} onClick={() => session.setPresenter(false)}>
          Slides only
        </Button>
        <Button appearance="subtle" icon={<DismissRegular />} onClick={() => session.endShow()}>
          End show
        </Button>
      </header>
      <div className="slides-presenter-body">
        <section className="slides-presenter-current" aria-label="Current slide">
          <div ref={main.ref} className="slides-presenter-fit" onClick={() => session.showStep(1)}>
            {main.width > 0 && <SlideCanvas key={show.index} deck={deck} index={show.index} width={main.width} options={options} />}
            {show.blank && <div className="slides-show-blank" data-color={show.blank} />}
          </div>
          <div className="slides-presenter-nav">
            <Button aria-label="Previous slide" icon={<ArrowLeftRegular />} onClick={() => session.showStep(-1)} />
            <Button appearance="primary" aria-label="Next slide" icon={<ArrowRightRegular />} onClick={() => session.showStep(1)} />
            <Button appearance={show.blank === 'black' ? 'primary' : 'secondary'} onClick={() => session.showBlank('black')}>
              Black screen (B)
            </Button>
          </div>
        </section>
        <aside className="slides-presenter-side">
          <section className="slides-presenter-next" aria-label="Next slide">
            <h2>Next</h2>
            <div ref={upcoming.ref} className="slides-presenter-fit">
              {next === undefined ? (
                <p className="slides-presenter-end">End of the slideshow</p>
              ) : (
                upcoming.width > 0 && (
                  <SlideCanvas key={next} deck={deck} index={next} width={upcoming.width} options={options} interactive={false} />
                )
              )}
            </div>
          </section>
          <section className="slides-presenter-notes" aria-label="Speaker notes">
            <h2>
              Notes
              <span className="slides-presenter-spacer" />
              <Button
                appearance="subtle"
                size="small"
                aria-label="Smaller notes text"
                icon={<TextFontSizeRegular />}
                onClick={() => setNotesSize((s) => Math.max(12, s - 2))}
              >
                −
              </Button>
              <Button
                appearance="subtle"
                size="small"
                aria-label="Larger notes text"
                icon={<TextFontSizeRegular />}
                onClick={() => setNotesSize((s) => Math.min(48, s + 2))}
              >
                +
              </Button>
            </h2>
            <div className="slides-presenter-notes-text" style={{ fontSize: notesSize }}>
              {notes ? notes.split('\n').map((line, i) => <p key={i}>{line || ' '}</p>) : <p className="slides-presenter-end">No notes for this slide.</p>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
