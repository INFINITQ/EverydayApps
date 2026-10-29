import { Dialog, DialogSurface, Input } from '@fluentui/react-components';
import { SearchRegular } from '@fluentui/react-icons';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { fuzzyFilter } from './fuzzy';

export type PaletteCommand = {
  id: string;
  title: string;
  group?: string;
  /** Shortcut shown next to the command, e.g. "Ctrl+S". */
  keys?: string;
  disabled?: boolean;
  run(): void;
};

/** Alt+Q search for every command, like Office's "Search" box. */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  commands: PaletteCommand[];
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const results = useMemo(
    () => fuzzyFilter(commands.filter((c) => !c.disabled), query, (c) => `${c.group ?? ''} ${c.title}`),
    [commands, query],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  const run = (command: PaletteCommand | undefined) => {
    if (!command) return;
    onOpenChange(false);
    // Let the dialog close (and focus return) before the command runs.
    requestAnimationFrame(() => command.run());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, results.length - 1));
    else if (event.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
    else if (event.key === 'Enter') run(results[index]);
    else return;
    event.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface aria-label="Search commands" style={{ maxWidth: 560, alignSelf: 'flex-start', marginTop: 72 }}>
        <Input
          autoFocus
          appearance="filled-lighter"
          contentBefore={<SearchRegular />}
          placeholder="Search for a command"
          value={query}
          onChange={(_, data) => {
            setQuery(data.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          style={{ width: '100%' }}
          aria-controls="folio-palette-results"
        />
        <ul id="folio-palette-results" className="folio-palette-results" role="listbox">
          {results.map((command, i) => (
            <li
              key={command.id}
              className="folio-palette-item"
              role="option"
              aria-selected={i === index}
              onMouseMove={() => setIndex(i)}
              onClick={() => run(command)}
            >
              {command.group && <span className="folio-palette-group">{command.group}</span>}
              <span>{command.title}</span>
              {command.keys && <span className="folio-palette-keys">{command.keys}</span>}
            </li>
          ))}
          {results.length === 0 && <li className="folio-palette-item">No matching commands</li>}
        </ul>
      </DialogSurface>
    </Dialog>
  );
}
