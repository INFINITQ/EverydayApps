import type { DocHost } from '@folio/shell';
import { describe, expect, it, vi } from 'vitest';
import { notesOf, slidesOf } from './deck';
import { openPackage } from './pkg';
import { createSlidesSession } from './session';
import { SAMPLE, makePptx } from './testing/makePptx';
import { setNotes } from './text';

function host(fullscreen = false) {
  let on = fullscreen;
  const calls: string[] = [];
  const value: DocHost = {
    changed: () => undefined,
    notify: (message) => void calls.push(`notify:${message}`),
    openAnother: async () => null,
    openOthers: async () => [],
    saveCopy: async () => false,
    saveCopies: async () => 0,
    openLink: async (url) => void calls.push(`link:${url}`),
    toggleFullscreen: () => {
      on = !on;
      calls.push(`fullscreen:${on}`);
    },
    isFullscreen: () => on,
    secure: { put: async () => undefined, get: async () => new Uint8Array(), delete: async () => undefined, keys: async () => [] },
  };
  return { value, calls };
}

const open = async (h = host()) => createSlidesSession(await openPackage(await makePptx(SAMPLE)), h.value);
const parts = (session: Awaited<ReturnType<typeof open>>) => session.state.slides.map((s) => s.part.replace(/\D/g, ''));

describe('slides session', () => {
  it('undoes back to the saved state id', async () => {
    const session = await open();
    const saved = session.stateId();
    session.duplicate();
    expect(session.stateId()).not.toBe(saved);
    expect(session.state.slides).toHaveLength(5);
    session.undo();
    expect(session.stateId()).toBe(saved);
    expect(session.state.slides).toHaveLength(4);
    session.redo();
    expect(session.state.slides).toHaveLength(5);
  });

  it('moves several selected slides together', async () => {
    const session = await open();
    session.select(1);
    session.select(2, 'range');
    session.moveTo(0);
    expect(parts(session)).toEqual(['2', '3', '1', '4']);
    session.moveBy(1);
    expect(parts(session)).toEqual(['1', '2', '3', '4']);
  });

  it('never deletes the last slide, and lands on a neighbour after deleting', async () => {
    const h = host();
    const session = await open(h);
    session.go(1);
    session.remove();
    expect(parts(session)).toEqual(['1', '3', '4']);
    expect(session.state.current).toBe(1);
    session.select(0);
    session.select(2, 'range');
    session.remove();
    expect(parts(session)).toEqual(['1', '3', '4']);
    expect(h.calls.some((c) => c.includes('at least one slide'))).toBe(true);
  });

  it('typing notes quickly is one undo step', async () => {
    const session = await open();
    const slide = session.state.slides[0]!;
    session.apply('Edit notes', (pkg) => setNotes(pkg, slide, 'A'), { coalesce: true });
    session.apply('Edit notes', (pkg) => setNotes(pkg, slidesOf(pkg)[0]!, 'AB'), { coalesce: true });
    expect(notesOf(session.state.pkg, session.state.slides[0]!)).toBe('AB');
    session.undo();
    expect(notesOf(session.state.pkg, session.state.slides[0]!)).toBe('Welcome everyone.\nKeep it short.');
    expect(session.canUndo()).toBe(false);
  });

  it('presents visible slides only, and leaves full screen as it found it', async () => {
    const h = host();
    const session = await open(h);
    session.startShow('start');
    expect(h.calls).toContain('fullscreen:true');
    session.showStep(1);
    session.showStep(1);
    // Slide 3 is hidden: from slide 2 the show goes to slide 4.
    expect(session.state.show?.index).toBe(3);
    session.showBlank('black');
    session.showStep(1); // The first key only clears the blank screen.
    expect(session.state.show?.blank).toBeNull();
    session.showStep(1); // Past the end: the show ends.
    expect(session.state.show).toBeNull();
    expect(h.calls.filter((c) => c.startsWith('fullscreen'))).toEqual(['fullscreen:true', 'fullscreen:false']);

    const already = host(true);
    const second = await open(already);
    second.startShow('current');
    second.endShow();
    expect(already.calls.filter((c) => c.startsWith('fullscreen'))).toEqual([]);
  });

  it('asks before opening a link, and opens it only when told to', async () => {
    const h = host();
    const session = await open(h);
    session.navigate({ url: 'https://example.com/contact' });
    expect(session.state.linkPrompt).toBe('https://example.com/contact');
    session.answerLink(false);
    expect(h.calls.some((c) => c.startsWith('link:'))).toBe(false);
    session.navigate({ url: 'https://example.com/contact' });
    session.answerLink(true);
    await vi.waitFor(() => expect(h.calls).toContain('link:https://example.com/contact'));
  });

  it('refuses edits to a converted (read-only) deck', async () => {
    const h = host();
    const session = createSlidesSession(await openPackage(await makePptx(SAMPLE)), h.value, { converted: true });
    session.duplicate();
    expect(session.state.slides).toHaveLength(4);
    expect(h.calls.some((c) => c.includes('read-only'))).toBe(true);
  });
});
