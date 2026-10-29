import type { ReactNode } from 'react';

/** Thin bar along the bottom (page number, zoom, save state...). */
export function StatusBar({ children }: { children: ReactNode }) {
  return (
    <footer className="folio-statusbar" role="status">
      {children}
    </footer>
  );
}

/** Pushes the following status bar items to the right. */
export function StatusSpacer() {
  return <span className="folio-spacer" />;
}
