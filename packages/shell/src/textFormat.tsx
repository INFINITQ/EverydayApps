import { useSyncExternalStore } from 'react';
import type { DocumentSession, FormatModule } from './host';

export type TextSession = DocumentSession & { edit(text: string): void; text(): string };

/** Plain-text placeholder format. It exercises the whole shell (tabs, saving, recovery,
 *  shortcuts) before the real formats exist, and stands in for them in tests. */
export const textFormat: FormatModule = {
  id: 'text',
  fileTypes: [{ ext: 'txt', label: 'Text file', canSave: true }],
  open: async (file) => createTextSession(new TextDecoder().decode(file.bytes)),
};

export function createTextSession(initial: string): TextSession {
  let nextId = 1;
  const history = [{ text: initial, id: 0 }];
  let index = 0;
  let lastEdit = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const current = () => history[index]!;

  const edit = (text: string) => {
    const now = Date.now();
    history.length = index + 1;
    // Typing bursts become one undo step.
    if (index > 0 && now - lastEdit < 800) history[index] = { text, id: nextId++ };
    else {
      history.push({ text, id: nextId++ });
      index += 1;
    }
    lastEdit = now;
    emit();
  };
  const move = (step: number) => {
    const next = index + step;
    if (next < 0 || next >= history.length) return;
    index = next;
    lastEdit = 0;
    emit();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };

  function View() {
    const text = useSyncExternalStore(subscribe, () => current().text);
    return (
      <textarea
        className="folio-text"
        aria-label="Text"
        spellCheck={false}
        value={text}
        onChange={(event) => edit(event.target.value)}
      />
    );
  }

  return {
    View,
    edit,
    text: () => current().text,
    stateId: () => current().id,
    subscribe,
    lossy: () => [],
    commands: () => [
      { id: 'edit.undo', title: 'Undo', group: 'Edit', keys: 'Ctrl+Z', enabled: () => index > 0, run: () => move(-1) },
      { id: 'edit.redo', title: 'Redo', group: 'Edit', keys: 'Ctrl+Y', enabled: () => index < history.length - 1, run: () => move(1) },
    ],
    save: async () => new TextEncoder().encode(current().text),
    status: () => {
      const text = current().text;
      return `${text.split('\n').length} lines · ${text.length} characters`;
    },
    dispose: () => listeners.clear(),
  };
}
