import { describe, expect, it, vi } from 'vitest';
import type { DocHost, FormatModule } from './host';
import { SNAPSHOT_AFTER_IDLE_MS, Shell, isDirty } from './shell';
import { findClashes } from './shortcuts';
import { fakeBackend } from './testing';
import { type TextSession, textFormat } from './textFormat';

const A = 'C:\\Docs\\a.txt';

function setup(files: Record<string, string> = { [A]: 'hello' }, readOnly: string[] = []) {
  const fake = fakeBackend(files, readOnly);
  let now = 1_000_000;
  const shell = new Shell(fake.backend, [textFormat], 'Folio Test', () => now);
  const active = () => shell.session(shell.state.activeId) as TextSession;
  const doc = () => shell.doc(shell.state.activeId)!;
  const answer = async (value: string) => {
    await vi.waitFor(() => expect(shell.state.question).not.toBeNull());
    shell.state.question!.answer(value);
  };
  return { fake, shell, active, doc, answer, advance: (ms: number) => void (now += ms) };
}

describe('opening', () => {
  it('opens a file into a tab, and the same file only once', async () => {
    const { fake, shell } = setup();
    await shell.openFile(fake.grant(A));
    const again = fake.grant(A);
    await shell.openFile(again);
    expect(shell.state.docs).toHaveLength(1);
    expect(fake.calls).toContain(`release:${again.token}`);
  });

  it("refuses files it can't open", async () => {
    const { fake, shell } = setup({ 'C:\\Docs\\b.pdf': '%PDF' });
    await shell.openFile(fake.grant('C:\\Docs\\b.pdf'));
    expect(shell.state.docs).toHaveLength(0);
    expect(shell.state.notices.at(-1)?.intent).toBe('error');
  });
});

describe('unsaved changes', () => {
  it('are tracked, and undoing back to the saved state clears them', async () => {
    const { fake, shell, active, doc } = setup();
    await shell.openFile(fake.grant(A));
    expect(isDirty(doc())).toBe(false);
    active().edit('hello world');
    expect(isDirty(doc())).toBe(true);
    shell.commands().find((c) => c.id === 'edit.undo')!.run();
    expect(isDirty(doc())).toBe(false);
  });
});

describe('saving', () => {
  it('writes the file and clears the unsaved marker', async () => {
    const { fake, shell, active, doc } = setup();
    await shell.openFile(fake.grant(A));
    active().edit('edited');
    expect(await shell.save()).toBe(true);
    expect(fake.text(A)).toBe('edited');
    expect(isDirty(doc())).toBe(false);
  });

  it('waits for an edit still being applied, and counts it as saved', async () => {
    const { fake, shell, active, doc } = setup();
    await shell.openFile(fake.grant(A));
    const session = active();
    session.settle = async () => session.edit('finished late');
    expect(await shell.save()).toBe(true);
    expect(fake.text(A)).toBe('finished late');
    expect(isDirty(doc())).toBe(false);
  });

  it('asks before overwriting a change made by another program', async () => {
    const { fake, shell, active, answer } = setup();
    await shell.openFile(fake.grant(A));
    active().edit('mine');
    fake.changeOnDisk(A, 'theirs');
    const saving = shell.save();
    await answer('cancel');
    expect(await saving).toBe(false);
    expect(fake.text(A)).toBe('theirs');

    const again = shell.save();
    await answer('overwrite');
    expect(await again).toBe(true);
    expect(fake.text(A)).toBe('mine');
    expect(fake.calls).toContain('save:force');
  });

  it('sends read-only files to Save As', async () => {
    const B = 'C:\\Docs\\copy.txt';
    const { fake, shell, active, doc } = setup({ [A]: 'hello' }, [A]);
    await shell.openFile(fake.grant(A));
    active().edit('changed');
    fake.nextSave(B);
    expect(await shell.save()).toBe(true);
    expect(fake.text(B)).toBe('changed');
    expect(fake.text(A)).toBe('hello');
    expect(doc().title).toBe('copy.txt');
  });

  it('keeps the changes when another program has the file locked', async () => {
    const { fake, shell, active, doc } = setup();
    await shell.openFile(fake.grant(A));
    active().edit('changed');
    fake.failNextSave({ kind: 'locked', message: 'locked' });
    expect(await shell.save()).toBe(false);
    expect(isDirty(doc())).toBe(true);
    expect(shell.state.notices.at(-1)?.message).toMatch(/Another program is using/);
  });

  it('saves a copy without changing which file the tab is for', async () => {
    const C = 'C:\\Docs\\a (copy).txt';
    const { fake, shell, active, doc } = setup();
    await shell.openFile(fake.grant(A));
    active().edit('draft');
    fake.nextSave(C);
    expect(await shell.save(shell.state.activeId, 'saveCopy')).toBe(true);
    expect(fake.text(C)).toBe('draft');
    expect(doc().title).toBe('a.txt');
    expect(isDirty(doc())).toBe(true);
  });
});

describe('what a document can ask of the shell', () => {
  const PICTURE = 'C:\\Pictures\\signature.png';
  const FLAT = 'C:\\Docs\\a (flattened).txt';

  function setupWithHost() {
    const fake = fakeBackend({ [A]: 'hello', [PICTURE]: 'picture bytes' });
    let host: DocHost | null = null;
    const capture: FormatModule = {
      ...textFormat,
      open: (file, given) => {
        host = given;
        return textFormat.open(file, given);
      },
    };
    const shell = new Shell(fake.backend, [capture], 'Folio Test');
    return { fake, shell, host: () => host! };
  }

  it('picks other files through an Open dialog for those file types only', async () => {
    const { fake, shell, host } = setupWithHost();
    await shell.openFile(fake.grant(A));
    fake.nextOpen([PICTURE]);
    const picked = await host().openAnother(['png', 'jpg'], 'Pictures');
    expect(picked?.name).toBe('signature.png');
    expect(new TextDecoder().decode(picked?.bytes)).toBe('picture bytes');
    expect(fake.calls).toContain('pickOpen:png,jpg');
  });

  it('picks several other files at once', async () => {
    const { fake, shell, host } = setupWithHost();
    await shell.openFile(fake.grant(A));
    fake.nextOpen([PICTURE, A]);
    const picked = await host().openOthers(['png'], 'Pictures');
    expect(picked.map((p) => p.name)).toEqual(['signature.png']);
    expect(fake.calls).toContain('pickOpen:png');
    expect(shell.state.notices.at(-1)?.message).toMatch(/a\.txt isn't a supported file/);
  });

  it('saves several new files into a picked folder without overwriting any', async () => {
    const { fake, shell, host } = setupWithHost();
    await shell.openFile(fake.grant(A));
    fake.nextFolder('C:\\Docs');
    const files = [
      { name: 'a.txt', bytes: new TextEncoder().encode('first') },
      { name: 'b.txt', bytes: new TextEncoder().encode('second') },
    ];
    expect(await host().saveCopies(files, 'Choose a folder')).toBe(2);
    expect(fake.text(A)).toBe('hello');
    expect(fake.text('C:\\Docs\\a (2).txt')).toBe('first');
    expect(fake.text('C:\\Docs\\b.txt')).toBe('second');
    expect(fake.calls.some((c) => c.startsWith('releaseFolder:'))).toBe(true);
    expect(shell.state.notices.at(-1)?.message).toBe('Saved 2 files in Docs.');
  });

  it('saves bytes a document made as a new file, leaving the tab on the original', async () => {
    const { fake, shell, host } = setupWithHost();
    await shell.openFile(fake.grant(A));
    fake.nextSave(FLAT);
    expect(await host().saveCopy(new TextEncoder().encode('flat'), 'a (flattened).txt')).toBe(true);
    expect(fake.text(FLAT)).toBe('flat');
    expect(shell.doc(shell.state.activeId)?.title).toBe('a.txt');
    expect(shell.state.notices.at(-1)?.intent).toBe('success');
  });

  it('turns on and off from a document, saying how to leave it', async () => {
    const { fake, shell, host } = setupWithHost();
    await shell.openFile(fake.grant(A));
    host().toggleFullscreen();
    await vi.waitFor(() => expect(shell.state.fullscreen).toBe(true));
    expect(shell.state.notices.at(-1)?.message).toMatch(/Esc or F11/);
    host().toggleFullscreen();
    await vi.waitFor(() => expect(shell.state.fullscreen).toBe(false));
    expect(fake.calls.filter((c) => c.startsWith('fullscreen:'))).toEqual(['fullscreen:true', 'fullscreen:false']);
  });

  it('says whether the window is full screen', async () => {
    const { fake, shell, host } = setupWithHost();
    await shell.openFile(fake.grant(A));
    expect(host().isFullscreen?.()).toBe(false);
    host().toggleFullscreen();
    await vi.waitFor(() => expect(host().isFullscreen?.()).toBe(true));
  });
});

describe('a document told about its saves', () => {
  it('hears when its bytes became its file, but not for a copy', async () => {
    const fake = fakeBackend({ [A]: 'hello' });
    const saved: string[] = [];
    const listening: FormatModule = {
      ...textFormat,
      open: async (file, host) => ({ ...(await textFormat.open(file, host)), saved: (ext: string) => void saved.push(ext) }),
    };
    const shell = new Shell(fake.backend, [listening], 'Folio Test');
    await shell.openFile(fake.grant(A));
    fake.nextSave('C:\\Docs\\copy.txt');
    await shell.save(shell.state.activeId, 'saveCopy');
    expect(saved).toEqual([]);
    await shell.save(shell.state.activeId, 'save');
    expect(saved).toEqual(['txt']);
  });
});

describe('closing', () => {
  it('asks about unsaved changes, and Cancel keeps the tab', async () => {
    const { fake, shell, active, answer } = setup();
    await shell.openFile(fake.grant(A));
    active().edit('unsaved');
    const closing = shell.close(shell.state.activeId!);
    await answer('cancel');
    expect(await closing).toBe(false);
    expect(shell.state.docs).toHaveLength(1);

    const discard = shell.close(shell.state.activeId!);
    await answer('discard');
    expect(await discard).toBe(true);
    expect(shell.state.docs).toHaveLength(0);
    expect(fake.text(A)).toBe('hello');
  });

  it('asks about an edit that was still being applied when closing began', async () => {
    const { fake, shell, active, answer } = setup();
    await shell.openFile(fake.grant(A));
    const session = active();
    session.settle = async () => session.edit('finished late');
    const closing = shell.close(shell.state.activeId!);
    await answer('cancel');
    expect(await closing).toBe(false);
    expect(shell.state.docs).toHaveLength(1);
  });
});

describe('recovery', () => {
  it('snapshots unsaved changes once typing pauses, and drops them after saving', async () => {
    const { fake, shell, active, advance } = setup();
    await shell.openFile(fake.grant(A));
    const id = shell.state.activeId!;
    active().edit('important draft');
    await shell.snapshotDirty();
    expect(fake.recovery.has(id)).toBe(false);
    advance(SNAPSHOT_AFTER_IDLE_MS + 1);
    await shell.snapshotDirty();
    expect(new TextDecoder().decode(fake.recovery.get(id)?.bytes)).toBe('important draft');
    await shell.save();
    expect(fake.recovery.has(id)).toBe(false);
  });
});

describe('commands', () => {
  it('have no clashing shortcuts', async () => {
    const { fake, shell } = setup();
    await shell.openFile(fake.grant(A));
    expect(findClashes(shell.commands())).toEqual([]);
  });
});
