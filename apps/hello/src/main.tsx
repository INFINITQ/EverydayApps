import '@folio/ui/folio.css';
import { Shell, ShellApp, tauriBackend, textFormat } from '@folio/shell';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppIcon } from './AppIcon';

// Folio Hello: the dev testbed for the shared shell, with plain text as its format.
const shell = new Shell(tauriBackend(), [textFormat], 'Folio Hello');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShellApp shell={shell} tagline="The testbed for Folio's shared shell" icon={<AppIcon />} />
  </StrictMode>,
);
