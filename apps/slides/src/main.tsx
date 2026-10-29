import '@folio/ui/folio.css';
import './slides.css';
import { Shell, ShellApp, tauriBackend } from '@folio/shell';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppIcon } from './AppIcon';
import { slidesFormat } from './slidesFormat';

const shell = new Shell(tauriBackend(), [slidesFormat], 'Folio Slides');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShellApp shell={shell} tagline="Present, edit and organize PowerPoint decks. Privately." icon={<AppIcon />} />
  </StrictMode>,
);
