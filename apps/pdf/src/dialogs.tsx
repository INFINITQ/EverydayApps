// Dialogs for reading: the question before a link opens, the password a protected file needs,
// setting a password, and the document's properties.

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
} from '@fluentui/react-components';
import { LockClosedRegular } from '@fluentui/react-icons';
import { useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DocumentProperties, PdfSession } from './pdfFormat';

const useViewer = (session: PdfSession) => useSyncExternalStore(session.subscribe, session.viewer);

/**
 * Which links Folio offers to open: web pages and email addresses. Anything else (files,
 * programs, scripts) is only shown. Rust checks the same rules again before opening.
 */
export function linkKind(url: string): 'web' | 'mail' | null {
  if (url.length > 2048 || /\s|"/.test(url) || [...url].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) return 'web';
    if (parsed.protocol === 'mailto:' && parsed.pathname) return 'mail';
  } catch {
    // Not a URL at all.
  }
  return null;
}

const PAPER: [string, number, number][] = [
  ['Letter', 612, 792],
  ['Legal', 612, 1008],
  ['Tabloid', 792, 1224],
  ['A3', 842, 1191],
  ['A4', 595, 842],
  ['A5', 420, 595],
];

/** A page size in points as people know it: "A4, 8.27 × 11.69 in (210 × 297 mm)". */
export function pageSizeLabel(size: { width: number; height: number }): string {
  const inches = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  const mm = (points: number) => Math.round((points / 72) * 25.4);
  const short = Math.min(size.width, size.height);
  const long = Math.max(size.width, size.height);
  const paper = PAPER.find(([, w, h]) => Math.abs(w - short) <= 2 && Math.abs(h - long) <= 2)?.[0];
  const measures =
    `${inches.format(size.width / 72)} × ${inches.format(size.height / 72)} in ` +
    `(${mm(size.width)} × ${mm(size.height)} mm)`;
  return paper ? `${paper}, ${measures}` : measures;
}

export function fileSizeLabel(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '';
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} KB`;
  return `${number.format(bytes / (1024 * 1024))} MB`;
}

/** An attachment's name as a plain file name: no folders, nothing Windows refuses in names. */
export function attachmentName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? '';
  const clean = [...last]
    .map((ch) => (ch.charCodeAt(0) < 32 || '<>:"|?*'.includes(ch) ? '_' : ch))
    .join('')
    .trim()
    .replace(/[. ]+$/, '');
  return clean || 'attachment';
}

/** "a, b and c" */
const listOf = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** Asks before a link in the document opens in the browser or mail app. */
export function LinkDialog({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const url = viewer.linkPrompt;
  const kind = url ? linkKind(url) : null;
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [url]);
  const close = () => session.setViewer({ linkPrompt: null });

  let where = '';
  try {
    if (url && kind === 'web') where = new URL(url).hostname;
    if (url && kind === 'mail') where = decodeURIComponent(new URL(url).pathname);
  } catch {
    where = '';
  }

  const open = async () => {
    if (!url) return;
    close();
    try {
      await session.host.openLink(url);
    } catch (error) {
      session.host.notify(`The link couldn't be opened: ${(error as { message?: string })?.message ?? String(error)}`, 'error');
    }
  };
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      session.host.notify("The link couldn't be copied.", 'error');
    }
  };

  return (
    // A fresh dialog per link, gone at once when answered: one still fading out can swallow the
    // next click on the page, and reopening it mid-fade can leave it stuck out of sight.
    <Dialog key={url ?? ''} open={url !== null} onOpenChange={(_, data) => !data.open && close()}>
      <DialogSurface className="pdf-link-dialog">
        <DialogBody>
          <DialogTitle>{kind === 'mail' ? 'Write an email?' : kind === 'web' ? 'Open this link?' : 'This link stays closed'}</DialogTitle>
          <DialogContent className="pdf-link-content">
            {kind === 'web' && (
              <p>
                It goes to <strong>{where}</strong> and opens in your web browser, outside Folio.
              </p>
            )}
            {kind === 'mail' && (
              <p>
                It writes to <strong>{where}</strong> in your mail app.
              </p>
            )}
            {kind === null && <p>Folio PDF opens only web and email links. This one goes to:</p>}
            <p className="pdf-link-url">{url}</p>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button appearance="secondary" onClick={close}>
              {kind ? 'Cancel' : 'Close'}
            </Button>
            {kind && (
              <Button appearance="primary" onClick={() => void open()}>
                {kind === 'mail' ? 'Open mail app' : 'Open in browser'}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Shown in place of the pages while a protected file waits for its password. */
export function PasswordPrompt({ session, name, wrong }: { session: PdfSession; name: string; wrong: boolean }) {
  const { provides: documents } = useDocumentManagerCapability();
  const [text, setText] = useState('');
  const submit = () => {
    if (!documents || !text) return;
    // The prompt goes away while the file opens, and comes back if the password was wrong.
    session.enterPassword(text);
    documents.retryDocument(session.documentId, { password: text });
  };
  return (
    <div className="pdf-password" role="group" aria-label="Password needed">
      <LockClosedRegular className="pdf-password-icon" />
      <h2 className="pdf-password-title">{name} is protected</h2>
      <p className="pdf-password-text">Type its password to open it.</p>
      <Field
        className="pdf-password-field"
        label="Password"
        validationState={wrong ? 'error' : 'none'}
        validationMessage={wrong ? "That password isn't right. Try again." : undefined}
      >
        <Input
          type="password"
          autoFocus
          value={text}
          onChange={(_, data) => setText(data.value)}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
        />
      </Field>
      <Button appearance="primary" disabled={!text || !documents} onClick={submit}>
        Open
      </Button>
    </div>
  );
}

/** Sets (or changes) the password needed to open the file. */
export function ProtectDialog({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  useEffect(() => {
    if (!viewer.protectOpen) {
      setFirst('');
      setSecond('');
    }
  }, [viewer.protectOpen]);
  const close = () => session.setViewer({ protectOpen: false });
  const mismatch = second.length > 0 && first !== second;
  const ready = first.length > 0 && first === second;
  const submit = () => {
    if (ready) void session.protect(first);
  };

  return (
    <Dialog open={viewer.protectOpen} onOpenChange={(_, data) => !data.open && close()}>
      <DialogSurface className="pdf-protect-dialog">
        <DialogBody>
          <DialogTitle>{viewer.encrypted ? 'Change the password' : 'Protect with a password'}</DialogTitle>
          <DialogContent className="pdf-protect-content">
            <p>Opening this file will take the password. Keep it somewhere safe: a forgotten password can&rsquo;t be recovered.</p>
            <Field label="Password">
              <Input
                type="password"
                autoFocus
                value={first}
                onChange={(_, data) => setFirst(data.value)}
                onKeyDown={(event) => event.key === 'Enter' && submit()}
              />
            </Field>
            <Field
              label="Type it again"
              validationState={mismatch ? 'error' : 'none'}
              validationMessage={mismatch ? "The passwords don't match." : undefined}
            >
              <Input
                type="password"
                value={second}
                onChange={(_, data) => setSecond(data.value)}
                onKeyDown={(event) => event.key === 'Enter' && submit()}
              />
            </Field>
            <p className="pdf-dialog-hint">
              Save the file afterwards to keep the password. Pages you extract or split from it get the same password.
            </p>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={close}>
              Cancel
            </Button>
            <Button appearance="primary" disabled={!ready} onClick={submit}>
              Set password
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Title, author, dates, page size, security... */
export function PropertiesDialog({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const [properties, setProperties] = useState<DocumentProperties | null>(null);
  useEffect(() => {
    if (!viewer.propertiesOpen) return;
    let live = true;
    session
      .properties()
      .then((found) => live && setProperties(found))
      .catch(() => live && setProperties(null));
    return () => {
      live = false;
    };
  }, [viewer.propertiesOpen, session]);
  const close = () => session.setViewer({ propertiesOpen: false });
  const date = (value: Date | null) => (value && !Number.isNaN(value.getTime()) ? value.toLocaleString() : null);

  const rows: [string, string | null][] = properties
    ? [
        ['File', properties.fileName],
        ['Title', properties.title],
        ['Author', properties.author],
        ['Subject', properties.subject],
        ['Keywords', properties.keywords],
        ['Created', date(properties.created)],
        ['Modified', date(properties.modified)],
        ['Made with', properties.creator],
        ['PDF producer', properties.producer],
        ['Pages', String(properties.pages)],
        ['Page size', properties.pageSize && pageSizeLabel(properties.pageSize)],
        ['File size', fileSizeLabel(properties.fileSize)],
        [
          'Security',
          properties.encrypted
            ? properties.opensWithPassword
              ? 'A password is needed to open it'
              : 'Encrypted; opens without a password'
            : 'None',
        ],
        ['Restrictions', properties.restrictions.length ? `The author doesn't allow ${listOf(properties.restrictions)}.` : null],
      ]
    : [];

  return (
    <Dialog open={viewer.propertiesOpen} onOpenChange={(_, data) => !data.open && close()}>
      <DialogSurface className="pdf-properties-dialog">
        <DialogBody>
          <DialogTitle>Document properties</DialogTitle>
          <DialogContent>
            {properties ? (
              <dl className="pdf-properties">
                {rows
                  .filter((row): row is [string, string] => Boolean(row[1]))
                  .map(([label, value]) => (
                    <div key={label} className="pdf-properties-row">
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <p>Reading the properties…</p>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={close}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
