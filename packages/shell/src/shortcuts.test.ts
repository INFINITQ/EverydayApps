import { describe, expect, it, vi } from 'vitest';
import { findClashes, installShortcuts, parseKeys } from './shortcuts';

describe('shortcuts', () => {
  it('parses Office-style key names', () => {
    expect(parseKeys('Ctrl+Shift+S')).toEqual({ key: 'S', ctrl: true, shift: true, alt: false });
    expect(parseKeys('F12')).toEqual({ key: 'F12', ctrl: false, shift: false, alt: false });
    expect(parseKeys('Ctrl++').key).toBe('+');
    expect(parseKeys('Alt+Q')).toEqual({ key: 'Q', ctrl: false, shift: false, alt: true });
  });

  it('finds clashes', () => {
    expect(findClashes([{ id: 'a', keys: 'Ctrl+S' }, { id: 'b', keys: 'ctrl+s' }])).toHaveLength(1);
    expect(findClashes([{ id: 'a', keys: 'Ctrl+S' }, { id: 'b', keys: 'Ctrl+Shift+S' }])).toEqual([]);
  });

  it('runs commands, and ignores plain keys while typing', () => {
    const save = vi.fn();
    const highlight = vi.fn();
    const stop = installShortcuts(() => [
      { id: 'save', title: 'Save', keys: 'Ctrl+S', run: save },
      { id: 'highlight', title: 'Highlight', keys: 'H', run: highlight },
    ]);
    const input = document.createElement('input');
    document.body.append(input);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(highlight).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    expect(save).toHaveBeenCalledOnce();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(highlight).toHaveBeenCalledOnce();

    stop();
    input.remove();
  });

  it('leaves undo, copy and paste to the text field while typing', () => {
    const undo = vi.fn();
    const stop = installShortcuts(() => [{ id: 'undo', title: 'Undo', keys: 'Ctrl+Z', run: undo }]);
    const note = document.createElement('textarea');
    document.body.append(note);

    const typed = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    note.dispatchEvent(typed);
    expect(undo).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(undo).toHaveBeenCalledOnce();

    stop();
    note.remove();
  });
});
