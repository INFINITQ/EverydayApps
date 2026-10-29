// One open presentation: its package, undo history, what's selected, and the slideshow.
// UI-free (the views in SlidesView.tsx and Slideshow.tsx render it), so it can be tested.

import type { DocHost } from '@folio/shell';
import {
  type SlideInfo,
  deleteSlides,
  duplicateSlide,
  hasMacros,
  notesOf,
  reorderSlides,
  setHidden,
  slideSize,
  slidesOf,
} from './deck';
import { type Package, savePackage } from './pkg';
import { type Deck, buildDeck } from './render';

export type Show = {
  /** Same-window presenter view (notes, next slide, timer) instead of the slides alone. */
  presenter: boolean;
  /** Index into the deck's slides (hidden slides are skipped while presenting). */
  index: number;
  blank: 'black' | 'white' | null;
  /** Timer: when it started, and the time already counted before a pause. */
  startedAt: number | null;
  elapsed: number;
  /** Whether Folio turned full screen on for this show (and so turns it off after). */
  ownFullscreen: boolean;
};

export type SlidesState = {
  pkg: Package;
  deck: Deck;
  slides: SlideInfo[];
  /** Index of the slide shown in the editor. */
  current: number;
  /** Slides selected in the thumbnail rail (parts), always including the current one. */
  selected: string[];
  /** The shape selected on the current slide (its cNvPr id), and whether its text is open. */
  shape: string | null;
  editing: string | null;
  show: Show | null;
  /** A link someone clicked, waiting for "Open" or "Cancel". */
  linkPrompt: string | null;
  /** Read-only: an old .ppt converted for viewing (Save As makes a .pptx). */
  converted: boolean;
  revision: number;
};

type Step = { id: number; pkg: Package; label: string; at: number; current: string | null };

/** Typing in the notes within this long becomes one undo step. */
const COALESCE_MS = 800;

export type SlidesSession = ReturnType<typeof createSlidesSession>;

export function createSlidesSession(pkg: Package, host: DocHost, options: { converted?: boolean } = {}) {
  const listeners = new Set<() => void>();
  let steps: Step[] = [{ id: 0, pkg, label: 'Open', at: 0, current: null }];
  let pointer = 0;
  let nextId = 1;
  let state: SlidesState = {
    pkg,
    deck: buildDeck(pkg),
    slides: slidesOf(pkg),
    current: 0,
    selected: [],
    shape: null,
    editing: null,
    show: null,
    linkPrompt: null,
    converted: options.converted ?? false,
    revision: 0,
  };
  state.selected = state.slides[0] ? [state.slides[0].part] : [];

  const emit = () => {
    for (const listener of listeners) listener();
    host.changed();
  };
  const set = (patch: Partial<SlidesState>) => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    emit();
  };

  /** Moves to another version of the package (an edit, undo or redo). */
  const load = (next: Package, currentPart: string | null, keepShape = false) => {
    const slides = slidesOf(next);
    // Notes and other parts the slides don't show don't need the deck rebuilt.
    const deck = drawsDifferently(state.pkg, next) ? buildDeck(next) : { ...state.deck, pkg: next };
    let current = currentPart ? slides.findIndex((s) => s.part === currentPart) : -1;
    if (current < 0) current = Math.min(state.current, slides.length - 1);
    const part = slides[current]?.part;
    set({
      pkg: next,
      deck,
      slides,
      current: Math.max(0, current),
      selected: part ? [part] : [],
      shape: keepShape && part === state.slides[state.current]?.part ? state.shape : null,
      editing: null,
    });
  };

  /**
   * Applies an edit as one undo step. `coalesce` merges quick repeats of the same edit (typing);
   * `keepShape` keeps the selected shape selected (it was moved or its text edited).
   */
  const apply = (
    label: string,
    edit: (pkg: Package) => Package | { pkg: Package; current: string },
    { coalesce = false, keepShape = false }: { coalesce?: boolean; keepShape?: boolean } = {},
  ) => {
    if (state.converted) {
      host.notify('This is an old PowerPoint file, opened read-only. Save it as .pptx to edit it.', 'info');
      return false;
    }
    const result = edit(state.pkg);
    const next = 'parts' in result ? result : result.pkg;
    const current = 'parts' in result ? (state.slides[state.current]?.part ?? null) : result.current;
    if (next === state.pkg) return false;
    const now = Date.now();
    const top = steps[pointer]!;
    if (coalesce && pointer > 0 && top.label === label && now - top.at < COALESCE_MS) {
      steps[pointer] = { ...top, pkg: next, at: now, id: nextId++ };
    } else {
      steps = [...steps.slice(0, pointer + 1), { id: nextId++, pkg: next, label, at: now, current }];
      pointer = steps.length - 1;
    }
    load(next, current, keepShape);
    return true;
  };

  const move = (step: 1 | -1) => {
    const target = pointer + step;
    if (target < 0 || target >= steps.length) return;
    // Undo returns to the slide the undone edit was made on; redo to where it left off.
    const where = step < 0 ? steps[pointer]!.current : steps[target]!.current;
    pointer = target;
    load(steps[pointer]!.pkg, where);
  };

  const currentSlide = () => state.slides[state.current];

  const session = {
    get state() {
      return state;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    stateId: () => steps[pointer]!.id,
    canUndo: () => pointer > 0,
    canRedo: () => pointer < steps.length - 1,
    undo: () => move(-1),
    redo: () => move(1),
    apply,
    size: () => slideSize(state.pkg),
    macros: () => hasMacros(state.pkg),
    notes: (slide = currentSlide()) => (slide ? notesOf(state.pkg, slide) : ''),

    // ---- Navigation and selection -----------------------------------------------------
    go(index: number) {
      const clamped = Math.max(0, Math.min(index, state.slides.length - 1));
      const part = state.slides[clamped]?.part;
      set({ current: clamped, selected: part ? [part] : [], shape: null, editing: null });
    },
    /** Rail clicks: plain selects one, Ctrl toggles, Shift selects a range. */
    select(index: number, how: 'one' | 'toggle' | 'range' = 'one') {
      const part = state.slides[index]?.part;
      if (!part) return;
      if (how === 'one') return session.go(index);
      if (how === 'toggle') {
        const selected = state.selected.includes(part) ? state.selected.filter((p) => p !== part) : [...state.selected, part];
        if (selected.length === 0) return;
        return set({ selected, current: index, shape: null, editing: null });
      }
      const [from, to] = [Math.min(state.current, index), Math.max(state.current, index)];
      set({ selected: state.slides.slice(from, to + 1).map((s) => s.part), current: index, shape: null, editing: null });
    },
    selectShape(id: string | null) {
      if (id === state.shape && !state.editing) return;
      set({ shape: id, editing: null });
    },
    setEditing(id: string | null) {
      set({ editing: id, shape: id ?? state.shape });
    },

    // ---- Organize -----------------------------------------------------------------------
    /** The selected slides, in deck order. */
    selection(): SlideInfo[] {
      const chosen = new Set(state.selected);
      const list = state.slides.filter((s) => chosen.has(s.part));
      return list.length ? list : state.slides.slice(state.current, state.current + 1);
    },
    duplicate() {
      const chosen = session.selection();
      if (!chosen.length) return;
      apply(chosen.length > 1 ? 'Duplicate slides' : 'Duplicate slide', (pkg) => {
        let next = pkg;
        let last = '';
        // From the last one back, so each copy lands right after its original.
        for (const slide of [...chosen].reverse()) {
          const result = duplicateSlide(next, slide.part);
          next = result.pkg;
          if (!last) last = result.part;
        }
        return { pkg: next, current: last };
      });
    },
    remove() {
      const chosen = session.selection();
      if (chosen.length >= state.slides.length) {
        host.notify("A presentation needs at least one slide, so the last one can't be deleted.", 'warning');
        return;
      }
      const after = state.slides.find((s, i) => i > state.current && !chosen.includes(s))
        ?? [...state.slides].reverse().find((s) => !chosen.includes(s));
      apply(chosen.length > 1 ? `Delete ${chosen.length} slides` : 'Delete slide', (pkg) => ({
        pkg: deleteSlides(pkg, chosen.map((s) => s.part)),
        current: after?.part ?? '',
      }));
    },
    toggleHidden() {
      const chosen = session.selection();
      const hide = chosen.some((s) => !s.hidden);
      apply(hide ? 'Hide slide' : 'Show slide', (pkg) => chosen.reduce((next, s) => setHidden(next, s.part, hide), pkg));
    },
    /** Moves the selected slides so the first of them lands at `index` (in the order without them). */
    moveTo(index: number) {
      const chosen = session.selection();
      const parts = chosen.map((s) => s.part);
      const rest = state.slides.filter((s) => !parts.includes(s.part)).map((s) => s.part);
      const at = Math.max(0, Math.min(index, rest.length));
      const order = [...rest.slice(0, at), ...parts, ...rest.slice(at)];
      if (order.every((part, i) => part === state.slides[i]!.part)) return;
      const current = state.slides[state.current]!.part;
      apply(chosen.length > 1 ? 'Move slides' : 'Move slide', (pkg) => ({ pkg: reorderSlides(pkg, order), current }));
      set({ selected: parts });
    },
    moveBy(delta: -1 | 1) {
      const chosen = session.selection();
      const first = state.slides.findIndex((s) => s.part === chosen[0]!.part);
      const last = state.slides.findIndex((s) => s.part === chosen[chosen.length - 1]!.part);
      if ((delta < 0 && first === 0) || (delta > 0 && last === state.slides.length - 1)) return;
      // In the order without the moved slides, the first lands one place earlier or later.
      session.moveTo(first + delta);
    },

    // ---- Links ---------------------------------------------------------------------------
    navigate(target: { slideIndex?: number; url?: string }) {
      if (target.slideIndex !== undefined) {
        if (state.show) session.showGo(target.slideIndex);
        else session.go(target.slideIndex);
      } else if (target.url) {
        set({ linkPrompt: target.url });
      }
    },
    answerLink(open: boolean) {
      const url = state.linkPrompt;
      set({ linkPrompt: null });
      if (open && url) void host.openLink(url).catch(() => host.notify("That link couldn't be opened.", 'error'));
    },

    // ---- Slideshow ---------------------------------------------------------------------
    /** Slides shown while presenting: hidden ones are skipped unless you start on one. */
    showable(): number[] {
      return state.slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0);
    },
    startShow(from: 'start' | 'current', presenter = false) {
      const visible = session.showable();
      const index = from === 'start' ? (visible[0] ?? 0) : state.current;
      const ownFullscreen = !host.isFullscreen?.();
      if (ownFullscreen) host.toggleFullscreen();
      set({ show: { presenter, index, blank: null, startedAt: Date.now(), elapsed: 0, ownFullscreen }, shape: null, editing: null });
    },
    endShow() {
      const show = state.show;
      if (!show) return;
      if (show.ownFullscreen && host.isFullscreen?.() !== false) host.toggleFullscreen();
      const part = state.slides[show.index]?.part;
      set({ show: null, current: show.index, selected: part ? [part] : state.selected });
    },
    showGo(index: number) {
      const show = state.show;
      if (!show) return;
      if (index < 0 || index >= state.slides.length) return;
      set({ show: { ...show, index, blank: null } });
    },
    showStep(step: 1 | -1) {
      const show = state.show;
      if (!show) return;
      if (show.blank) return set({ show: { ...show, blank: null } });
      let index = show.index + step;
      while (index >= 0 && index < state.slides.length && state.slides[index]!.hidden) index += step;
      if (index >= state.slides.length) return session.endShow();
      if (index < 0) return;
      set({ show: { ...show, index } });
    },
    showBlank(color: 'black' | 'white') {
      const show = state.show;
      if (show) set({ show: { ...show, blank: show.blank === color ? null : color } });
    },
    toggleTimer() {
      const show = state.show;
      if (!show) return;
      if (show.startedAt === null) set({ show: { ...show, startedAt: Date.now() } });
      else set({ show: { ...show, startedAt: null, elapsed: show.elapsed + Date.now() - show.startedAt } });
    },
    resetTimer() {
      const show = state.show;
      if (show) set({ show: { ...show, elapsed: 0, startedAt: show.startedAt === null ? null : Date.now() } });
    },
    setPresenter(presenter: boolean) {
      const show = state.show;
      if (show) set({ show: { ...show, presenter } });
    },

    save: () => savePackage(state.pkg),
    /** The deck was saved as `ext`: a converted old deck saved as .pptx can now be edited. */
    saved(ext: string) {
      if (state.converted && ext === 'pptx') {
        set({ converted: false });
        host.notify('Saved as a .pptx: you can edit it now.', 'success');
      }
    },
    dispose() {
      listeners.clear();
    },
  };
  return session;
}

/** Parts that change how slides look (everything but notes, properties and the like). */
const DRAWN = /^(\[Content_Types\]\.xml$|ppt\/(presentation\.xml$|_rels\/|slides\/|slideLayouts\/|slideMasters\/|theme\/|media\/|charts\/|diagrams\/|fonts\/|tableStyles\.xml$))/;

function drawsDifferently(a: Package, b: Package): boolean {
  for (const [name, part] of b.parts) if (a.parts.get(name) !== part && DRAWN.test(name)) return true;
  for (const name of a.parts.keys()) if (!b.parts.has(name) && DRAWN.test(name)) return true;
  return false;
}

/** Elapsed show time in ms. */
export function elapsed(show: Show, now = Date.now()): number {
  return show.elapsed + (show.startedAt === null ? 0 : now - show.startedAt);
}
