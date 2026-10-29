// The side panel: page thumbnails, the document's bookmarks (its outline) and its attached
// files. Bookmarks and attached files get a tab only when the document has some.

import {
  Button,
  Tab,
  TabList,
  Tooltip,
  Tree,
  TreeItem,
  TreeItemLayout,
  treeItemLayoutClassNames,
  type TreeItemValue,
  type TreeOpenChangeData,
} from '@fluentui/react-components';
import { AttachRegular, BookmarkMultipleRegular, DocumentMultipleRegular, SaveRegular } from '@fluentui/react-icons';
import type { PdfAttachmentObject, PdfBookmarkObject } from '@embedpdf/models';
import { ThumbImg, ThumbnailsPane } from '@embedpdf/plugin-thumbnail/react';
import { type ReactElement, useState, useSyncExternalStore } from 'react';
import { fileSizeLabel } from './dialogs';
import type { PdfSession, ViewerState } from './pdfFormat';

const useViewer = (session: PdfSession) => useSyncExternalStore(session.subscribe, session.viewer);

type PanelTab = { id: ViewerState['panel']; label: string; icon: ReactElement };

export function SidePanel({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const tabs: PanelTab[] = [{ id: 'pages', label: 'Pages', icon: <DocumentMultipleRegular /> }];
  if (viewer.outline.length) tabs.push({ id: 'bookmarks', label: 'Bookmarks', icon: <BookmarkMultipleRegular /> });
  if (viewer.attachments.length) tabs.push({ id: 'attachments', label: 'Attached files', icon: <AttachRegular /> });
  const panel = tabs.some((tab) => tab.id === viewer.panel) ? viewer.panel : 'pages';

  return (
    <aside className="pdf-side" data-panel={panel} aria-label="Side panel">
      {tabs.length > 1 && (
        <TabList
          className="pdf-side-tabs"
          size="small"
          selectedValue={panel}
          onTabSelect={(_, data) => session.setViewer({ panel: data.value as ViewerState['panel'] })}
        >
          {tabs.map((tab) => (
            <Tooltip key={tab.id} content={tab.label} relationship="label" withArrow>
              <Tab value={tab.id} icon={tab.icon} />
            </Tooltip>
          ))}
        </TabList>
      )}
      <div className="pdf-side-content">
        {panel === 'pages' && <Thumbnails session={session} page={viewer.page} />}
        {panel === 'bookmarks' && <Bookmarks session={session} outline={viewer.outline} />}
        {panel === 'attachments' && <Attachments session={session} attachments={viewer.attachments} />}
      </div>
    </aside>
  );
}

function Thumbnails({ session, page }: { session: PdfSession; page: number }) {
  const id = session.documentId;
  return (
    <ThumbnailsPane documentId={id} className="pdf-thumbnails" aria-label="Pages">
      {(meta) => (
        <button
          key={meta.pageIndex}
          className="pdf-thumb"
          data-current={meta.pageIndex + 1 === page}
          style={{ position: 'absolute', top: meta.top, height: meta.wrapperHeight }}
          onClick={() => session.caps()?.scroll.scrollToPage({ pageNumber: meta.pageIndex + 1 })}
          aria-label={`Page ${meta.pageIndex + 1}`}
        >
          <span className="pdf-thumb-image" style={{ width: meta.width, height: meta.height }}>
            <ThumbImg documentId={id} meta={meta} />
          </span>
          <span className="pdf-thumb-label">{meta.pageIndex + 1}</span>
        </button>
      )}
    </ThumbnailsPane>
  );
}

function Bookmarks({ session, outline }: { session: PdfSession; outline: PdfBookmarkObject[] }) {
  const [open, setOpen] = useState<Set<TreeItemValue>>(() => new Set());
  // Clicking a bookmark (or pressing Enter) goes to it; its arrow and the arrow keys open and
  // close the ones inside it.
  const onOpenChange = (_: unknown, data: TreeOpenChangeData) => {
    if (data.type === 'Click' || data.type === 'Enter') return;
    setOpen(new Set(data.openItems));
  };
  return (
    <Tree className="pdf-bookmarks" aria-label="Bookmarks" size="small" openItems={open} onOpenChange={onOpenChange}>
      {outline.map((bookmark, index) => (
        <BookmarkItem key={index} value={String(index)} bookmark={bookmark} session={session} />
      ))}
    </Tree>
  );
}

function BookmarkItem({ bookmark, value, session }: { bookmark: PdfBookmarkObject; value: string; session: PdfSession }) {
  const children = bookmark.children ?? [];
  return (
    <TreeItem
      itemType={children.length ? 'branch' : 'leaf'}
      value={value}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        // Clicks on a bookmark inside this one reach here too, and the arrow only opens it.
        if (target.closest('[role="treeitem"]') !== event.currentTarget) return;
        if (target.closest(`.${treeItemLayoutClassNames.expandIcon}`)) return;
        if (bookmark.target) session.goToBookmark(bookmark.target);
      }}
    >
      <TreeItemLayout className="pdf-bookmark">{bookmark.title.trim() || 'Untitled'}</TreeItemLayout>
      {children.length > 0 && (
        <Tree>
          {children.map((child, index) => (
            <BookmarkItem key={index} value={`${value}.${index}`} bookmark={child} session={session} />
          ))}
        </Tree>
      )}
    </TreeItem>
  );
}

function Attachments({ session, attachments }: { session: PdfSession; attachments: PdfAttachmentObject[] }) {
  return (
    <div className="pdf-attachments">
      <ul className="pdf-attachment-list" aria-label="Attached files">
        {attachments.map((attachment) => (
          <li key={attachment.index} className="pdf-attachment">
            <AttachRegular className="pdf-attachment-icon" />
            <span className="pdf-attachment-text">
              <span className="pdf-attachment-name" title={attachment.name}>
                {attachment.name}
              </span>
              <span className="pdf-attachment-meta">
                {[fileSizeLabel(attachment.size), attachment.description].filter(Boolean).join(' · ')}
              </span>
            </span>
            <Tooltip content={`Save ${attachment.name}…`} relationship="label" withArrow>
              <Button
                size="small"
                appearance="subtle"
                icon={<SaveRegular />}
                onClick={() => void session.saveAttachment(attachment)}
              />
            </Tooltip>
          </li>
        ))}
      </ul>
      <p className="pdf-side-hint">Folio PDF never opens attached files. Save one to open it with another app.</p>
    </div>
  );
}
