import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import {
  CommandPalette,
  FolioProvider,
  type PaletteCommand,
  StartScreen,
  StatusBar,
  StatusSpacer,
  type SystemColors,
  TitleBar,
} from '@folio/ui';
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { type Doc, type Shell, isDirty } from './shell';
import { installShortcuts } from './shortcuts';

const FALLBACK_SYSTEM: SystemColors = {
  accent: ['#003e92', '#0049a4', '#005fb8', '#0078d4', '#3e9fe7', '#76b9ed', '#99ebff'],
  dark: typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  highContrast: false,
  transparency: true,
};

/** The whole app around the documents: title bar with tabs, start screen, dialogs, notices. */
export function ShellApp({ shell, tagline, icon }: { shell: Shell; tagline: string; icon?: ReactNode }) {
  const state = useStore(shell.store);
  const [system, setSystem] = useState<SystemColors>(() => window.__FOLIO_BOOT__?.system ?? FALLBACK_SYSTEM);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const stopSystem = shell.backend.onSystem(setSystem);
    const stopDrag = shell.backend.onDragState(setDragOver);
    const stopKeys = installShortcuts(() => shell.commands());
    // Escape leaves full screen (not a shortcut, so documents keep their own Escape).
    const leaveFullscreen = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && shell.state.fullscreen) void shell.setFullscreen(false);
    };
    window.addEventListener('keydown', leaveFullscreen);
    void shell.start(window.__FOLIO_BOOT__?.settings ?? {});
    requestAnimationFrame(() => void shell.backend.appReady());
    return () => {
      stopSystem();
      stopDrag();
      stopKeys();
      window.removeEventListener('keydown', leaveFullscreen);
      shell.stop();
    };
  }, [shell]);

  const active = shell.doc(state.activeId);
  const palette = useMemo<PaletteCommand[]>(
    () =>
      shell.commands().map((c) => ({
        id: c.id,
        title: c.title,
        ...(c.group ? { group: c.group } : {}),
        ...(c.keys ? { keys: c.keys } : {}),
        disabled: c.enabled ? !c.enabled() : false,
        run: () => void c.run(),
      })),
    // Commands depend on the active document and its state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shell, state.activeId, state.version, state.docs.length, state.paletteOpen],
  );

  return (
    <FolioProvider system={system} preference={state.settings.theme ?? 'system'}>
      <div className={state.fullscreen ? 'folio-app folio-fullscreen' : 'folio-app'}>
        <TitleBar
          appName={shell.appName}
          icon={icon}
          tabs={state.docs.map((d) => ({
            id: d.id,
            title: d.title,
            dirty: isDirty(d),
            tooltip: d.file?.displayPath ?? d.title,
          }))}
          activeId={state.activeId}
          onSelect={(id) => shell.activate(id)}
          onClose={(id) => void shell.close(id)}
          onReorder={(from, to) => shell.reorder(from, to)}
          onNewTab={() => void shell.openDialog()}
          newTabLabel="Open a file (Ctrl+O)"
          controls={shell.backend.window}
        />
        <div className="folio-content">
          {state.docs.length === 0 && (
            <StartScreen
              appName={shell.appName}
              tagline={tagline}
              icon={icon}
              onOpen={() => void shell.openDialog()}
              recent={state.recent}
              onOpenRecent={(key) => void shell.openRecent(key)}
              onRemoveRecent={(key) => void shell.backend.recentRemove(key).then(() => shell.refreshRecent())}
              recovered={state.recovered}
              onRestore={(doc) => void shell.restore(doc)}
              onDiscard={(doc) => void shell.discardRecovered(doc)}
            />
          )}
          {state.docs.map((doc) => (
            <DocumentPane key={doc.id} shell={shell} doc={doc} hidden={doc.id !== state.activeId} />
          ))}
          {dragOver && <div className="folio-drop">Drop to open</div>}
        </div>
        {active && (
          <StatusBar>
            {shell.session(active.id)?.status?.()}
            <StatusSpacer />
            <span>{active.saving ? 'Saving…' : isDirty(active) ? 'Unsaved changes' : 'Saved'}</span>
          </StatusBar>
        )}
      </div>

      <CommandPalette open={state.paletteOpen} onOpenChange={(open) => shell.setPaletteOpen(open)} commands={palette} />
      <QuestionDialog shell={shell} />
      <Notices shell={shell} />
    </FolioProvider>
  );
}

function DocumentPane({ shell, doc, hidden }: { shell: Shell; doc: Doc; hidden: boolean }) {
  const session = shell.session(doc.id);
  if (!session) return null;
  const { View } = session;
  return (
    <section className="folio-document" hidden={hidden} aria-label={doc.title}>
      {doc.lossy.length > 0 && !doc.lossyAcknowledged && (
        <MessageBar intent="warning" layout="singleline">
          <MessageBarBody>
            {shell.appName} can&apos;t keep {doc.lossy.map((l) => l.label).join(', ')} when saving. Save makes a copy
            unless you choose otherwise.
          </MessageBarBody>
        </MessageBar>
      )}
      <DocumentErrorBoundary title={doc.title}>
        <View />
      </DocumentErrorBoundary>
    </section>
  );
}

class DocumentErrorBoundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`folio: ${this.props.title} failed to render`, error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          {this.props.title} couldn&apos;t be displayed: {this.state.error.message}. Your file hasn&apos;t been changed.
        </MessageBarBody>
      </MessageBar>
    );
  }
}

function QuestionDialog({ shell }: { shell: Shell }) {
  const question = useStore(shell.store, (s) => s.question);
  const fallback = question?.choices[question.choices.length - 1]?.value ?? 'cancel';
  return (
    <Dialog open={question !== null} onOpenChange={(_, data) => !data.open && question?.answer(fallback)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{question?.title}</DialogTitle>
          <DialogContent>{question?.body}</DialogContent>
          <DialogActions>
            {question?.choices.map((choice) => (
              <Button key={choice.value} appearance={choice.appearance ?? 'secondary'} onClick={() => question.answer(choice.value)}>
                {choice.label}
              </Button>
            ))}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function Notices({ shell }: { shell: Shell }) {
  const notices = useStore(shell.store, (s) => s.notices);

  useEffect(() => {
    const timers = notices
      .filter((n) => n.intent === 'info' || n.intent === 'success')
      .map((n) => setTimeout(() => shell.dismiss(n.id), 6000));
    return () => timers.forEach(clearTimeout);
  }, [notices, shell]);

  return (
    <div className="folio-notices" aria-live="polite">
      {notices.map((notice) => (
        <MessageBar key={notice.id} intent={notice.intent}>
          <MessageBarBody>{notice.message}</MessageBarBody>
          <MessageBarActions
            containerAction={
              <Button aria-label="Dismiss" appearance="transparent" icon={<DismissRegular />} onClick={() => shell.dismiss(notice.id)} />
            }
          />
        </MessageBar>
      ))}
    </div>
  );
}
