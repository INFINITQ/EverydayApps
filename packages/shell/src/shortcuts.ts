import type { Command } from './host';

export type Shortcut = { key: string; ctrl: boolean; shift: boolean; alt: boolean };

const ALIASES: Record<string, string> = { esc: 'Escape', del: 'Delete', plus: '+', space: ' ' };

/** "Ctrl+Shift+S" -> { key: "S", ctrl, shift }. */
export function parseKeys(keys: string): Shortcut {
  const parts = keys.split('+').map((p) => p.trim());
  // "Ctrl++" ends with an empty part: the key is "+".
  if (keys.endsWith('++')) parts.splice(parts.length - 2, 2, '+');
  const raw = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const key = ALIASES[raw.toLowerCase()] ?? (raw.length === 1 ? raw.toUpperCase() : raw);
  return { key, ctrl: mods.has('ctrl'), shift: mods.has('shift'), alt: mods.has('alt') };
}

export function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return (
    key === shortcut.key &&
    event.ctrlKey === shortcut.ctrl &&
    event.altKey === shortcut.alt &&
    // Shift is part of typing symbols like "+", so it only matters for letters and named keys.
    (event.shiftKey === shortcut.shift || (!shortcut.shift && /^[^A-Z0-9]$/.test(shortcut.key)))
  );
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** While typing, these keep their usual meaning in the text field (undo typing, copy...). */
const TEXT_EDITING_KEYS = ['Z', 'Y', 'A', 'C', 'X', 'V'];

/**
 * Plain-key shortcuts ("H") don't fire while typing; Ctrl/Alt/F-key ones do, except the
 * standard text-editing keys, so Ctrl+Z undoes typing instead of a document change.
 */
export function worksWhileTyping(shortcut: Shortcut): boolean {
  if (shortcut.ctrl && !shortcut.alt && TEXT_EDITING_KEYS.includes(shortcut.key.toUpperCase())) return false;
  return shortcut.ctrl || shortcut.alt || /^F\d{1,2}$/.test(shortcut.key);
}

/** Commands that share a shortcut, as readable lines. Empty means no clashes. */
export function findClashes(commands: Pick<Command, 'id' | 'keys'>[]): string[] {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const command of commands) {
    if (!command.keys) continue;
    const s = parseKeys(command.keys);
    const id = `${s.ctrl ? 'Ctrl+' : ''}${s.alt ? 'Alt+' : ''}${s.shift ? 'Shift+' : ''}${s.key}`;
    const other = seen.get(id);
    if (other) clashes.push(`${id}: ${other} and ${command.id}`);
    else seen.set(id, command.id);
  }
  return clashes;
}

/** One capture-phase listener for every command's shortcut. Returns the uninstaller. */
export function installShortcuts(getCommands: () => Command[]): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const typing = isEditable(event.target);
    for (const command of getCommands()) {
      if (!command.keys) continue;
      const shortcut = parseKeys(command.keys);
      if (typing && !worksWhileTyping(shortcut)) continue;
      if (!matches(event, shortcut)) continue;
      event.preventDefault();
      // A matching but disabled command still swallows the key (no browser fallback).
      if (command.enabled && !command.enabled()) return;
      event.stopPropagation();
      void command.run();
      return;
    }
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });
  return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
}
