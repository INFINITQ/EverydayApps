import '@folio/ui/folio.css';
import '@docx-editor.dev/core/styles/editor.css';
import './docs.css';
import { Shell, ShellApp, tauriBackend } from '@folio/shell';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppIcon } from './AppIcon';
import { docsFormat } from './docsFormat';

const shell = new Shell(tauriBackend(), [docsFormat], 'Folio Docs');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShellApp shell={shell} tagline="Read, write and edit Word documents. Privately." icon={<AppIcon />} />
  </StrictMode>,
);
