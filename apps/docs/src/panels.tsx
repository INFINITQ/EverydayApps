// Side panels (find and replace, comments, headings), the link bar, and dialogs. Everything
// here is inside the engine's tree, so the adapter's hooks are available.

import { useDocumentOutline, useDocumentSearch, useHyperlinkPopup, usePageSetup } from '@docx-editor.dev/react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Radio,
  RadioGroup,
  SpinButton,
  Text,
} from '@fluentui/react-components';
import { ChevronDownRegular, ChevronUpRegular, DismissRegular, EditRegular, LinkDismissRegular, OpenRegular } from '@fluentui/react-icons';
import { useEffect, useRef, useState } from 'react';
import type { DocsSession, DocsState, Stats } from './session';

/** Only these open, after the user agrees (Rust checks again). */
export const OPENABLE = /^(https?:|mailto:)/i;

function PanelFrame({ title, session, children }: { title: string; session: DocsSession; children: React.ReactNode }) {
  return (
    <aside className="docs-panel" aria-label={title}>
      <header className="docs-panel-header">
        <Text weight="semibold">{title}</Text>
        <Button aria-label="Close" appearance="subtle" size="small" icon={<DismissRegular />} onClick={() => session.update({ panel: null })} />
      </header>
      <div className="docs-panel-body">{children}</div>
    </aside>
  );
}

export function FindPanel({ session, state }: { session: DocsSession; state: DocsState }) {
  const search = useDocumentSearch();
  const [replacement, setReplacement] = useState('');
  const editing = state.mode === 'edit';
  // The query is searched as it's typed; the engine highlights the matches. Closing the panel
  // clears the highlights.
  const clear = useRef(search.clear);
  clear.current = search.clear;
  useEffect(() => () => clear.current(), []);
  const replaceOne = () => {
    const match = search.activeMatch;
    if (!match || !session.editor) return;
    session.editor.exec({ type: 'replaceMatch', match, text: replacement });
    search.find(search.query, { matchCase: search.matchCase, wholeWord: search.wholeWord });
  };
  const replaceAll = () => {
    if (!session.editor || !search.query) return;
    const count = search.matches.length;
    session.editor.exec({
      type: 'replaceAllMatches',
      query: search.query,
      text: replacement,
      matchCase: search.matchCase,
      wholeWord: search.wholeWord,
    });
    search.find(search.query, { matchCase: search.matchCase, wholeWord: search.wholeWord });
    session.host.notify(`Replaced ${count} ${count === 1 ? 'match' : 'matches'}.`, 'success');
  };
  const total = search.matches.length;
  return (
    <PanelFrame title={state.replacing ? 'Find and replace' : 'Find'} session={session}>
      <Field label="Find">
        <Input
          autoFocus
          value={search.query}
          onChange={(_e, data) => search.setQuery(data.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.shiftKey ? search.previous : search.next)();
            if (e.key === 'Escape') session.update({ panel: null });
          }}
        />
      </Field>
      <div className="docs-find-row">
        <Text size={200} aria-live="polite">
          {search.query ? (total ? (search.activeIndex >= 0 ? `${search.activeIndex + 1} of ${total}${search.truncated ? '+' : ''}` : `${total}${search.truncated ? '+' : ''} ${total === 1 ? 'match' : 'matches'}`) : 'No matches') : ' '}
        </Text>
        <span className="folio-spacer" />
        <Button aria-label="Previous match" size="small" appearance="subtle" icon={<ChevronUpRegular />} disabled={!total} onClick={search.previous} />
        <Button aria-label="Next match" size="small" appearance="subtle" icon={<ChevronDownRegular />} disabled={!total} onClick={search.next} />
      </div>
      <Checkbox label="Match case" checked={search.matchCase} onChange={(_e, d) => search.setMatchCase(Boolean(d.checked))} />
      <Checkbox label="Whole words only" checked={search.wholeWord} onChange={(_e, d) => search.setWholeWord(Boolean(d.checked))} />
      {editing && !state.replacing && (
        <Button appearance="transparent" size="small" onClick={() => session.update({ replacing: true })}>
          Replace…
        </Button>
      )}
      {editing && state.replacing && (
        <>
          <Field label="Replace with">
            <Input value={replacement} onChange={(_e, data) => setReplacement(data.value)} />
          </Field>
          <div className="docs-find-row">
            <Button size="small" disabled={!search.activeMatch} onClick={replaceOne}>
              Replace
            </Button>
            <Button size="small" disabled={!total} onClick={replaceAll}>
              Replace all
            </Button>
          </div>
        </>
      )}
    </PanelFrame>
  );
}

const when = (date: string | null) => (date ? ` · ${new Date(date).toLocaleDateString()}` : '');
const CHANGE_LABEL = { insertion: 'Inserted', deletion: 'Deleted', move: 'Moved' } as const;

/** Comments and tracked changes from the file, read by Folio itself (the free engine core has no review UI). */
export function CommentsPanel({ session }: { session: DocsSession }) {
  const live = session.editor?.getComments() ?? [];
  const known = new Map(session.facts.comments.map((c) => [c.id, c]));
  const comments = live.length
    ? live.map((c) => ({ id: c.id, text: c.text, resolved: c.resolved, author: known.get(c.id)?.author ?? '', date: known.get(c.id)?.date ?? null }))
    : session.facts.comments.map((c) => ({ ...c, resolved: false }));
  const changes = session.facts.changes;
  return (
    <PanelFrame title="Review" session={session}>
      <Text weight="semibold">{`Comments (${comments.length})`}</Text>
      {comments.length === 0 && <Text size={200}>This document has no comments.</Text>}
      {comments.map((c) => (
        <article key={c.id} className={c.resolved ? 'docs-comment docs-comment-resolved' : 'docs-comment'}>
          <Text weight="semibold" size={200}>
            {c.author || 'Comment'}
            {when(c.date)}
            {c.resolved ? ' · resolved' : ''}
          </Text>
          <Text as="p" className="docs-comment-text">
            {c.text}
          </Text>
        </article>
      ))}
      <Text weight="semibold">{`Tracked changes (${session.facts.revisions})`}</Text>
      {changes.length === 0 && <Text size={200}>No tracked changes to text.</Text>}
      {changes.map((c, i) => (
        <article key={i} className="docs-comment">
          <Text weight="semibold" size={200}>
            {`${CHANGE_LABEL[c.kind]} by ${c.author}`}
            {when(c.date)}
          </Text>
          <Text as="p" className={c.kind === 'deletion' ? 'docs-comment-text docs-deleted' : 'docs-comment-text docs-inserted'}>
            {c.text}
          </Text>
        </article>
      ))}
      <Text size={200} className="docs-panel-note">
        Insertions are marked in the text; deleted text is listed here. Comments and tracked changes are kept when you save.
        Adding comments and accepting or rejecting changes aren’t available in Folio yet.
      </Text>
    </PanelFrame>
  );
}

export function OutlinePanel({ session }: { session: DocsSession }) {
  const outline = useDocumentOutline();
  return (
    <PanelFrame title="Navigation" session={session}>
      {outline.isEmpty && <Text>Headings in the document show here.</Text>}
      <nav className="docs-outline">
        {outline.items.map((item) => (
          <button
            type="button"
            key={item.heading.blockId}
            className={item.heading.blockId === outline.selectedBlockId ? 'docs-outline-item docs-outline-current' : 'docs-outline-item'}
            style={{ paddingInlineStart: 8 + item.depth * 14 }}
            onClick={() => outline.goTo(item.heading.blockId)}
          >
            {item.heading.text || '(empty heading)'}
          </button>
        ))}
      </nav>
    </PanelFrame>
  );
}

/** Shown while the caret is on a link: where it goes, open (after asking), edit, remove. */
export function LinkBar({ session }: { session: DocsSession }) {
  const links = useHyperlinkPopup();
  const { mode, link } = links.state;
  if (mode === 'closed') return null;
  if (mode === 'editing') {
    return (
      <div className="docs-linkbar" role="dialog" aria-label="Edit link">
        <Input size="small" aria-label="Text to show" placeholder="Text to show" value={links.state.text} onChange={(_e, d) => links.setText(d.value)} />
        <Input
          size="small"
          aria-label="Address"
          placeholder="https://"
          value={links.state.url}
          onChange={(_e, d) => links.setUrl(d.value)}
          onKeyDown={(e) => e.key === 'Enter' && links.commitEdit()}
        />
        <Button size="small" appearance="primary" onClick={() => links.commitEdit()}>
          Save
        </Button>
        <Button size="small" onClick={links.close}>
          Cancel
        </Button>
      </div>
    );
  }
  const href = link?.href ?? '';
  return (
    <div className="docs-linkbar" role="dialog" aria-label="Link">
      <Text className="docs-linkbar-url" title={href}>
        {link?.kind === 'internal' ? `Goes to “${link.anchor ?? ''}” in this document` : href || 'Link'}
      </Text>
      {link?.kind === 'external' && (
        <Button size="small" icon={<OpenRegular />} onClick={() => session.askToOpen(href)}>
          Open…
        </Button>
      )}
      {links.state.canEdit && (
        <>
          <Button size="small" icon={<EditRegular />} onClick={links.beginEdit}>
            Edit
          </Button>
          <Button size="small" icon={<LinkDismissRegular />} onClick={() => links.unlink()}>
            Remove link
          </Button>
        </>
      )}
      <Button aria-label="Close" size="small" appearance="subtle" icon={<DismissRegular />} onClick={links.close} />
    </div>
  );
}

/** "Open this link?" Only web and email links are offered. */
export function LinkDialog({ session, href }: { session: DocsSession; href: string | null }) {
  const openable = href !== null && OPENABLE.test(href.trim());
  const close = () => session.update({ linkPrompt: null });
  return (
    <Dialog open={href !== null} onOpenChange={(_e, data) => !data.open && close()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{openable ? 'Open this link?' : 'This link can’t be opened'}</DialogTitle>
          <DialogContent>
            <Text as="p" className="docs-link-target">
              {href}
            </Text>
            <Text as="p">
              {openable
                ? 'It opens in your web browser or mail app. Links in documents can lead anywhere, so only open it if you trust the document.'
                : 'Folio only opens web (http, https) and email (mailto) links.'}
            </Text>
          </DialogContent>
          <DialogActions>
            {openable && (
              <Button
                appearance="primary"
                onClick={() => {
                  close();
                  void session.host.openLink(href!.trim()).catch((error: unknown) =>
                    session.host.notify(error instanceof Error ? error.message : 'The link couldn’t be opened.', 'error'),
                  );
                }}
              >
                Open link
              </Button>
            )}
            <Button onClick={close}>{openable ? 'Cancel' : 'Close'}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function WordCountDialog({ session, stats }: { session: DocsSession; stats: Stats | null }) {
  const close = () => session.update({ dialog: null });
  const rows: [string, number | undefined][] = [
    ['Words', stats?.words],
    ['Characters (no spaces)', stats?.characters],
    ['Characters (with spaces)', stats?.charactersWithSpaces],
    ['Paragraphs', stats?.paragraphs],
  ];
  const editor = session.editor as unknown as { snapshot(): { page?: { total: number } } } | null;
  const pages = editor?.snapshot().page?.total;
  return (
    <Dialog open onOpenChange={(_e, data) => !data.open && close()}>
      <DialogSurface className="docs-dialog-small">
        <DialogBody>
          <DialogTitle>Word count</DialogTitle>
          <DialogContent>
            <table className="docs-stats">
              <tbody>
                {pages ? (
                  <tr>
                    <th scope="row">Pages</th>
                    <td>{pages.toLocaleString()}</td>
                  </tr>
                ) : null}
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{value === undefined ? '…' : value.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Text size={200}>The main text, as it reads with tracked changes accepted; notes, headers and text boxes aren’t counted.</Text>
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

export function InsertTableDialog({ session }: { session: DocsSession }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const close = () => session.update({ dialog: null });
  const insert = () => {
    close();
    session.insertTable(rows, cols);
  };
  return (
    <Dialog open onOpenChange={(_e, data) => !data.open && close()}>
      <DialogSurface className="docs-dialog-small">
        <DialogBody>
          <DialogTitle>Insert table</DialogTitle>
          <DialogContent className="docs-dialog-fields">
            <Field label="Columns">
              <SpinButton min={1} max={63} value={cols} onChange={(_e, d) => setCols(clamp(d.value ?? Number(d.displayValue), 1, 63, cols))} />
            </Field>
            <Field label="Rows">
              <SpinButton min={1} max={500} value={rows} onChange={(_e, d) => setRows(clamp(d.value ?? Number(d.displayValue), 1, 500, rows))} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={insert}>
              Insert
            </Button>
            <Button onClick={close}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const clamp = (value: number | null | undefined, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

const TWIPS_PER_CM = 1440 / 2.54;
const SIZES: Record<string, { label: string; width: number; height: number }> = {
  letter: { label: 'Letter (8.5 × 11 in)', width: 12240, height: 15840 },
  a4: { label: 'A4 (21 × 29.7 cm)', width: 11906, height: 16838 },
  legal: { label: 'Legal (8.5 × 14 in)', width: 12240, height: 20160 },
  a5: { label: 'A5 (14.8 × 21 cm)', width: 8391, height: 11906 },
};

export function PageSetupDialog({ session }: { session: DocsSession }) {
  const setup = usePageSetup();
  const page = setup.pageSetup;
  const short = page ? Math.min(page.pageWidthTwips, page.pageHeightTwips) : 12240;
  const long = page ? Math.max(page.pageWidthTwips, page.pageHeightTwips) : 15840;
  const known = Object.entries(SIZES).find(([, s]) => Math.abs(s.width - short) < 20 && Math.abs(s.height - long) < 20)?.[0] ?? 'custom';
  const [size, setSize] = useState(known);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(page?.orientation ?? 'portrait');
  const cm = (twips: number | undefined) => Math.round(((twips ?? 1440) / TWIPS_PER_CM) * 100) / 100;
  const [margins, setMargins] = useState({
    top: cm(page?.marginsTwips.top),
    bottom: cm(page?.marginsTwips.bottom),
    left: cm(page?.marginsTwips.left),
    right: cm(page?.marginsTwips.right),
  });
  const [scope, setScope] = useState<'document' | 'section'>('document');
  const close = () => session.update({ dialog: null });
  const apply = () => {
    const chosen = SIZES[size];
    const [w, h] = chosen ? [chosen.width, chosen.height] : [short, long];
    const ok = setup.apply({
      pageWidthTwips: orientation === 'portrait' ? w : h,
      pageHeightTwips: orientation === 'portrait' ? h : w,
      orientation,
      marginTopTwips: Math.round(margins.top * TWIPS_PER_CM),
      marginBottomTwips: Math.round(margins.bottom * TWIPS_PER_CM),
      marginLeftTwips: Math.round(margins.left * TWIPS_PER_CM),
      marginRightTwips: Math.round(margins.right * TWIPS_PER_CM),
      scope,
    });
    if (!ok) session.host.notify('The page setup couldn’t be changed here.', 'warning');
    close();
  };
  const margin = (key: keyof typeof margins, label: string) => (
    <Field label={label}>
      <SpinButton
        min={0}
        max={20}
        step={0.1}
        value={margins[key]}
        displayValue={`${margins[key]} cm`}
        onChange={(_e, d) => {
          const value = d.value ?? Number.parseFloat(d.displayValue ?? '');
          if (Number.isFinite(value)) setMargins((m) => ({ ...m, [key]: Math.min(20, Math.max(0, Math.round(value * 100) / 100)) }));
        }}
      />
    </Field>
  );
  return (
    <Dialog open onOpenChange={(_e, data) => !data.open && close()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Page setup</DialogTitle>
          <DialogContent className="docs-dialog-fields">
            <Field label="Paper size">
              <RadioGroup value={size} onChange={(_e, d) => setSize(d.value)}>
                {Object.entries(SIZES).map(([id, s]) => (
                  <Radio key={id} value={id} label={s.label} />
                ))}
                {known === 'custom' && <Radio value="custom" label="Keep the current size" />}
              </RadioGroup>
            </Field>
            <Field label="Orientation">
              <RadioGroup layout="horizontal" value={orientation} onChange={(_e, d) => setOrientation(d.value as 'portrait' | 'landscape')}>
                <Radio value="portrait" label="Portrait" />
                <Radio value="landscape" label="Landscape" />
              </RadioGroup>
            </Field>
            <div className="docs-margins">
              {margin('top', 'Top')}
              {margin('bottom', 'Bottom')}
              {margin('left', 'Left')}
              {margin('right', 'Right')}
            </div>
            <Field label="Apply to">
              <RadioGroup layout="horizontal" value={scope} onChange={(_e, d) => setScope(d.value as 'document' | 'section')}>
                <Radio value="document" label="Whole document" />
                <Radio value="section" label="This section" />
              </RadioGroup>
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!setup.isEnabled} onClick={apply}>
              Apply
            </Button>
            <Button onClick={close}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
