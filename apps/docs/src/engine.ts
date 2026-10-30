// The parts of docx-editor.dev's editor Folio drives, and waiting for a document to finish
// opening. The app gets its editor from the React adapter; tests create one directly.

import type { DocxEditorConfig, Editor } from '@docx-editor.dev/core';

export type EngineEditor = Editor & { destroy?: () => void };

type Snapshot = { isLoading?: boolean; isOpening?: boolean; parseError?: unknown; openFailure?: unknown };

/** Resolves once the editor has the document open; rejects with the engine's reason if it can't. */
export async function whenOpened(editor: Editor, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    const snapshot = (editor as unknown as { snapshot(): Snapshot }).snapshot();
    if (snapshot.openFailure || snapshot.parseError) {
      const reason = describeFailure(snapshot.openFailure ?? snapshot.parseError);
      throw new Error(reason);
    }
    if (!snapshot.isLoading && !snapshot.isOpening) {
      try {
        editor.getDocumentHandle();
        return;
      } catch {
        // Not open yet.
      }
    }
    if (Date.now() - started > timeoutMs) throw new Error('The document took too long to open.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function describeFailure(failure: unknown): string {
  if (failure && typeof failure === 'object') {
    const f = failure as { message?: string; reason?: string; code?: string };
    return f.message ?? f.reason ?? f.code ?? 'The document couldn’t be opened.';
  }
  return typeof failure === 'string' ? failure : 'The document couldn’t be opened.';
}

/** Creates an editor in `host`, opens `bytes` and waits until it's ready. */
export async function openEngineDocument(
  create: (config: DocxEditorConfig) => unknown,
  host: HTMLElement,
  bytes: Uint8Array,
): Promise<EngineEditor> {
  const editor = create({ container: host, document: bytes, mode: 'edit' }) as EngineEditor;
  await whenOpened(editor);
  return editor;
}
