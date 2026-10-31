import { Button, Tooltip } from '@fluentui/react-components';
import { DismissRegular, DocumentRegular, FolderOpenRegular, HistoryRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';

export type RecentFile = { key: string; name: string; displayPath: string; openedMs: number; exists: boolean };
export type RecoveredFile = { doc: string; name: string; displayPath?: string | null; savedMs: number };

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const date = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function when(ms: number, now = Date.now()): string {
  const day = (t: number) => Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / 86_400_000);
  const days = day(now) - day(ms);
  if (days === 0) return `Today ${time.format(ms)}`;
  if (days === 1) return `Yesterday ${time.format(ms)}`;
  return date.format(ms);
}

/** Shown when no document is open: Open, recovered documents, recent files. */
export function StartScreen({
  appName,
  tagline,
  icon,
  onOpen,
  recent,
  onOpenRecent,
  onRemoveRecent,
  recovered,
  onRestore,
  onDiscard,
  notice,
}: {
  appName: string;
  tagline: string;
  icon?: ReactNode;
  onOpen(): void;
  recent: RecentFile[];
  onOpenRecent(key: string): void;
  onRemoveRecent(key: string): void;
  recovered: RecoveredFile[];
  onRestore(doc: string): void;
  onDiscard(doc: string): void;
  /** Shown under the Open button, e.g. the offer to become the default app. */
  notice?: ReactNode;
}) {
  return (
    <main className="folio-start">
      <div className="folio-start-inner">
        <div className="folio-start-head">
          {icon && <div className="folio-start-icon">{icon}</div>}
          <div>
            <h1>{appName}</h1>
            <p>{tagline}</p>
          </div>
        </div>

        <div className="folio-start-actions">
          <Button appearance="primary" icon={<FolderOpenRegular />} onClick={onOpen}>
            Open…
          </Button>
          <span>or drop a file anywhere in this window</span>
        </div>

        {notice}

        {recovered.length > 0 && (
          <section className="folio-card" aria-labelledby="folio-recovered">
            <h2 id="folio-recovered" className="folio-section-title">
              Recovered after an unexpected close
            </h2>
            <ul className="folio-list">
              {recovered.map((item) => (
                <li key={item.doc} className="folio-list-item">
                  <HistoryRegular aria-hidden="true" />
                  <div className="folio-list-main">
                    <span className="folio-list-name">{item.name}</span>
                    <span className="folio-list-detail">Unsaved changes from {when(item.savedMs)}</span>
                  </div>
                  <Button size="small" appearance="primary" onClick={() => onRestore(item.doc)}>
                    Restore
                  </Button>
                  <Button size="small" appearance="subtle" onClick={() => onDiscard(item.doc)}>
                    Discard
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="folio-recent">
          <h2 id="folio-recent" className="folio-section-title">
            Recent
          </h2>
          {recent.length === 0 ? (
            <p className="folio-list-detail">Files you open appear here. They stay on this PC.</p>
          ) : (
            <ul className="folio-list">
              {recent.map((item) => (
                <li key={item.key} className="folio-list-item" data-missing={!item.exists}>
                  <DocumentRegular aria-hidden="true" />
                  <button
                    className="folio-list-main"
                    disabled={!item.exists}
                    title={item.displayPath}
                    onClick={() => onOpenRecent(item.key)}
                  >
                    <span className="folio-list-name">{item.name}</span>
                    <span className="folio-list-detail">
                      {item.exists ? `${when(item.openedMs)} · ${item.displayPath}` : 'Moved or deleted'}
                    </span>
                  </button>
                  <Tooltip content="Remove from the list" relationship="label">
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<DismissRegular />}
                      onClick={() => onRemoveRecent(item.key)}
                    />
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
