import '@folio/ui/folio.css';
import './sheets.css';
import { Shell, ShellApp, tauriBackend } from '@folio/shell';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppIcon } from './AppIcon';
import { sheetsFormat } from './sheetsFormat';

const shell = new Shell(tauriBackend(), [sheetsFormat], 'Folio Sheets');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShellApp shell={shell} tagline="Open, edit and save Excel workbooks and CSV files. Privately." icon={<AppIcon />} />
  </StrictMode>,
);
