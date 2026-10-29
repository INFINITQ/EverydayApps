import '@folio/ui/folio.css';
import './pdf.css';
import { Shell, ShellApp, tauriBackend } from '@folio/shell';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppIcon } from './AppIcon';
import { pdfFormat } from './pdfFormat';

const shell = new Shell(tauriBackend(), [pdfFormat], 'Folio PDF');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShellApp shell={shell} tagline="Read, annotate, sign and organize PDFs. Privately." icon={<AppIcon />} />
  </StrictMode>,
);
