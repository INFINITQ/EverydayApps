// The comments panel: every annotation in the document, page by page, with its note. Typing
// a note here is how sticky notes get their text; clicking a card shows its annotation.

import { Button, Textarea, Tooltip } from '@fluentui/react-components';
import {
  ArrowUpRightRegular,
  CheckmarkStarburstRegular,
  CircleRegular,
  CommentRegular,
  DeleteRegular,
  DismissRegular,
  HighlightRegular,
  InkStrokeRegular,
  LineHorizontal1Regular,
  NoteRegular,
  PenRegular,
  RectangleLandscapeRegular,
  TextboxRegular,
  TextStrikethroughRegular,
  TextUnderlineRegular,
} from '@fluentui/react-icons';
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import type { TrackedAnnotation } from '@embedpdf/plugin-annotation/react';
import { type ReactElement, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { colorOf } from './annotate';
import type { PdfSession } from './pdfFormat';

/** Form fields, links and pop-up windows aren't comments. */
const HIDDEN = [PdfAnnotationSubtype.WIDGET, PdfAnnotationSubtype.LINK, PdfAnnotationSubtype.POPUP];

function describe(object: PdfAnnotationObject): { label: string; icon: ReactElement } {
  switch (object.type) {
    case PdfAnnotationSubtype.HIGHLIGHT:
      return { label: 'Highlight', icon: <HighlightRegular /> };
    case PdfAnnotationSubtype.UNDERLINE:
      return { label: 'Underline', icon: <TextUnderlineRegular /> };
    case PdfAnnotationSubtype.SQUIGGLY:
      return { label: 'Squiggly underline', icon: <TextUnderlineRegular /> };
    case PdfAnnotationSubtype.STRIKEOUT:
      return { label: 'Strike-out', icon: <TextStrikethroughRegular /> };
    case PdfAnnotationSubtype.INK:
      return object.intent === 'InkHighlight'
        ? { label: 'Highlighter', icon: <InkStrokeRegular /> }
        : { label: 'Drawing', icon: <PenRegular /> };
    case PdfAnnotationSubtype.SQUARE:
      return { label: 'Rectangle', icon: <RectangleLandscapeRegular /> };
    case PdfAnnotationSubtype.CIRCLE:
      return { label: 'Ellipse', icon: <CircleRegular /> };
    case PdfAnnotationSubtype.LINE:
      return object.intent === 'LineArrow'
        ? { label: 'Arrow', icon: <ArrowUpRightRegular /> }
        : { label: 'Line', icon: <LineHorizontal1Regular /> };
    case PdfAnnotationSubtype.FREETEXT:
      return { label: 'Text box', icon: <TextboxRegular /> };
    case PdfAnnotationSubtype.TEXT:
      return { label: 'Note', icon: <NoteRegular /> };
    case PdfAnnotationSubtype.STAMP:
      return { label: 'Stamp', icon: <CheckmarkStarburstRegular /> };
    default:
      return { label: 'Annotation', icon: <CommentRegular /> };
  }
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function dated(object: PdfAnnotationObject): string {
  const date = object.modified ?? object.created;
  return date instanceof Date && !Number.isNaN(date.getTime()) ? when.format(date) : '';
}

/** Comments in reading order: by page, then top to bottom, then left to right. */
export function commentsOf(all: TrackedAnnotation[]): PdfAnnotationObject[] {
  return all
    .filter((item) => item.commitState !== 'deleted' && !HIDDEN.includes(item.object.type))
    .map((item) => item.object)
    .sort(
      (a, b) =>
        a.pageIndex - b.pageIndex ||
        a.rect.origin.y - b.rect.origin.y ||
        a.rect.origin.x - b.rect.origin.x,
    );
}

export function CommentsPanel({ session }: { session: PdfSession }) {
  const viewer = useSyncExternalStore(session.subscribe, session.viewer);
  const caps = session.caps();
  const [, redraw] = useState(0);
  useEffect(() => caps?.annotation.onStateChange(() => redraw((n) => n + 1)), [caps]);
  if (!caps) return null;

  const comments = commentsOf(caps.annotation.getAnnotations());
  const selected = new Set(caps.annotation.getSelectedAnnotationIds());
  let lastPage = -1;

  return (
    <aside className="pdf-comments" aria-label="Comments">
      <div className="pdf-comments-head">
        <span>Comments</span>
        <Tooltip content="Close comments" relationship="label" withArrow>
          <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={() => session.setViewer({ commentsOpen: false })} />
        </Tooltip>
      </div>
      {comments.length === 0 ? (
        <p className="pdf-comments-empty">No comments yet. Use Annotate to add sticky notes, highlights and more.</p>
      ) : (
        <ol className="pdf-comments-list">
          {comments.map((object) => {
            const heading = object.pageIndex !== lastPage;
            lastPage = object.pageIndex;
            return (
              <li key={object.id}>
                {heading && <h3 className="pdf-comments-page">Page {object.pageIndex + 1}</h3>}
                <CommentCard
                  session={session}
                  object={object}
                  selected={selected.has(object.id)}
                  focus={viewer.focusComment === object.id}
                />
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function CommentCard({
  session,
  object,
  selected,
  focus,
}: {
  session: PdfSession;
  object: PdfAnnotationObject;
  selected: boolean;
  focus: boolean;
}) {
  const { label, icon } = describe(object);
  const saved = object.contents ?? '';
  const [draft, setDraft] = useState(saved);
  const editing = useRef(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // Another change (undo, the text box itself) shows here unless this note is being typed in.
  useEffect(() => {
    if (!editing.current) setDraft(saved);
  }, [saved]);
  useEffect(() => {
    if (!focus) return;
    box.current?.focus();
    session.setViewer({ focusComment: null });
  }, [focus, session]);

  const commit = () => {
    editing.current = false;
    if (draft !== saved) session.setComment(object.pageIndex, object.id, draft);
  };
  const color = colorOf(object as unknown as Record<string, unknown>);
  const author = object.author?.trim();

  return (
    <div className="pdf-comment" data-selected={selected}>
      <div className="pdf-comment-head">
        <button className="pdf-comment-show" onClick={() => session.revealAnnotation(object.pageIndex, object.id)}>
          <span className="pdf-comment-icon" style={color ? { color } : undefined}>
            {icon}
          </span>
          <span className="pdf-comment-title">{label}</span>
          <span className="pdf-comment-meta">{[author, dated(object)].filter(Boolean).join(' · ')}</span>
        </button>
        <Tooltip content="Delete" relationship="label" withArrow>
          <Button
            appearance="subtle"
            size="small"
            icon={<DeleteRegular />}
            onClick={() => session.deleteAnnotation(object.pageIndex, object.id)}
          />
        </Tooltip>
      </div>
      <Textarea
        ref={box}
        className="pdf-comment-text"
        resize="vertical"
        placeholder={object.type === PdfAnnotationSubtype.FREETEXT ? 'Text in the box' : 'Add a note…'}
        aria-label={`Comment on ${label.toLowerCase()}`}
        value={draft}
        onFocus={() => (editing.current = true)}
        onChange={(_, data) => setDraft(data.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          // Ctrl+Enter keeps the note; Escape puts it back as it was.
          if (event.key === 'Enter' && event.ctrlKey) box.current?.blur();
          if (event.key === 'Escape') {
            setDraft(saved);
            editing.current = false;
            event.stopPropagation();
          }
        }}
      />
    </div>
  );
}
