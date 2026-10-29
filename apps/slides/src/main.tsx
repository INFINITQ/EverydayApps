import '@folio/ui/folio.css';
import './slides.css';
import { Shell, ShellApp, tauriBackend } from '@folio/shell';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppIcon } from './AppIcon';
import { slidesFormat } from './slidesFormat';

const root = document.getElementById('root')!;

if (location.hash === '#audience') {
  // The audience's window on a second screen (see audience.tsx): no shell, no IPC.
  void import('./audience').then(({ mountAudience }) => mountAudience(root));
} else {
  const shell = new Shell(tauriBackend(), [slidesFormat], 'Folio Slides');
  createRoot(root).render(
    <StrictMode>
      <ShellApp shell={shell} tagline="Present, edit and organize PowerPoint decks. Privately." icon={<AppIcon />} />
    </StrictMode>,
  );
}
