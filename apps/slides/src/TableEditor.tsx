// Editing a table's text: a grid with one box per cell (merged cells are skipped). Each
// changed cell is patched like any text, so its formatting stays.

import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Textarea } from '@fluentui/react-components';
import { useState } from 'react';

export function TableEditor({
  cells,
  onDone,
}: {
  cells: (string | null)[][];
  onDone(cells: (string | null)[][] | null): void;
}) {
  const [value, setValue] = useState(cells);
  const columns = Math.max(1, ...cells.map((row) => row.length));
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onDone(null)}>
      <DialogSurface className="slides-table-dialog">
        <DialogBody>
          <DialogTitle>Edit table</DialogTitle>
          <DialogContent>
            <div className="slides-table-grid" role="grid" aria-label="Table cells" style={{ gridTemplateColumns: `repeat(${columns}, minmax(96px, 1fr))` }}>
              {value.map((row, r) =>
                row.map((cell, c) =>
                  cell === null ? (
                    <div key={`${r}-${c}`} className="slides-table-merged" aria-hidden="true" />
                  ) : (
                    <Textarea
                      key={`${r}-${c}`}
                      aria-label={`Row ${r + 1}, column ${c + 1}`}
                      value={cell}
                      resize="vertical"
                      rows={1}
                      onChange={(_, data) =>
                        setValue((old) => old.map((oldRow, i) => (i === r ? oldRow.map((x, j) => (j === c ? data.value : x)) : oldRow)))
                      }
                    />
                  ),
                ),
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => onDone(value)}>
              Apply
            </Button>
            <Button onClick={() => onDone(null)}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
