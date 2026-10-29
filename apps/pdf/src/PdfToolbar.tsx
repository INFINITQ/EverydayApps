import {
  Input,
  Menu,
  MenuDivider,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  SearchBox,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowRotateClockwiseRegular,
  BookOpenRegular,
  ChevronDownRegular,
  ChevronUpRegular,
  CommentMultipleRegular,
  DarkThemeRegular,
  DismissRegular,
  DocumentArrowDownRegular,
  DocumentEditRegular,
  EditRegular,
  FullScreenMaximizeRegular,
  GridRegular,
  InfoRegular,
  LockClosedRegular,
  LockOpenRegular,
  MoreHorizontalRegular,
  PanelLeftRegular,
  PrintRegular,
  SearchRegular,
  SignatureRegular,
  ZoomInRegular,
  ZoomOutRegular,
} from '@fluentui/react-icons';
import { ZoomMode } from '@embedpdf/plugin-zoom/react';
import { type ReactElement, useEffect, useState, useSyncExternalStore } from 'react';
import { type Permission, type PdfSession, type ViewerState, RESTRICTED } from './pdfFormat';

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip content={label} relationship="label" withArrow>
      {children}
    </Tooltip>
  );
}

/** Says why a button is off when the PDF's own restrictions forbid what it does. */
function Restricted({ blocked, children }: { blocked: boolean; children: ReactElement }) {
  return blocked ? (
    <Tooltip content={RESTRICTED} relationship="description" withArrow>
      {children}
    </Tooltip>
  ) : (
    children
  );
}

export function PdfToolbar({ session }: { session: PdfSession }) {
  const viewer = useSyncExternalStore(session.subscribe, session.viewer);
  const caps = session.caps();
  const [pageText, setPageText] = useState(String(viewer.page));
  useEffect(() => setPageText(String(viewer.page)), [viewer.page]);

  const goTo = () => {
    const page = Number.parseInt(pageText, 10);
    if (Number.isFinite(page) && page >= 1 && page <= viewer.pages) caps?.scroll.scrollToPage({ pageNumber: page });
    else setPageText(String(viewer.page));
  };

  // Off when the document's author forbids them (everything waits until it's open anyway).
  const blocked = (what: Permission) => caps !== null && !session.allows(what);

  return (
    <Toolbar className="pdf-toolbar" aria-label="Viewer" size="small">
      <Tip label={viewer.thumbnails ? 'Hide the side panel' : 'Show the side panel'}>
        <ToolbarButton
          icon={<PanelLeftRegular />}
          aria-pressed={viewer.thumbnails}
          onClick={() => session.setViewer({ thumbnails: !viewer.thumbnails })}
        />
      </Tip>
      <ToolbarDivider />
      <Tip label="Previous page (Page Up)">
        <ToolbarButton icon={<ChevronUpRegular />} disabled={viewer.page <= 1} onClick={() => caps?.scroll.scrollToPreviousPage()} />
      </Tip>
      <Input
        className="pdf-page-input"
        size="small"
        aria-label="Page number"
        value={pageText}
        onChange={(_, data) => setPageText(data.value)}
        onBlur={goTo}
        onKeyDown={(event) => event.key === 'Enter' && goTo()}
      />
      <span className="pdf-page-count">of {viewer.pages}</span>
      <Tip label="Next page (Page Down)">
        <ToolbarButton
          icon={<ChevronDownRegular />}
          disabled={viewer.page >= viewer.pages}
          onClick={() => caps?.scroll.scrollToNextPage()}
        />
      </Tip>
      <ToolbarDivider />
      <Tip label="Zoom out (Ctrl+-)">
        <ToolbarButton icon={<ZoomOutRegular />} onClick={() => caps?.zoom.zoomOut()} />
      </Tip>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton className="pdf-zoom-level" aria-label="Zoom level">
            {Math.round(viewer.zoom * 100)}%
          </ToolbarButton>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => caps?.zoom.requestZoom(ZoomMode.FitWidth)}>Fit width</MenuItem>
            <MenuItem onClick={() => caps?.zoom.requestZoom(ZoomMode.FitPage)}>Fit page</MenuItem>
            {ZOOM_PRESETS.map((level) => (
              <MenuItem key={level} onClick={() => caps?.zoom.requestZoom(level)}>
                {level * 100}%
              </MenuItem>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>
      <Tip label="Zoom in (Ctrl+=)">
        <ToolbarButton icon={<ZoomInRegular />} onClick={() => caps?.zoom.zoomIn()} />
      </Tip>
      <ToolbarDivider />
      <Tip label="Rotate view (Ctrl+R)">
        <ToolbarButton icon={<ArrowRotateClockwiseRegular />} onClick={() => caps?.rotate.rotateForward()} />
      </Tip>
      <ToolbarDivider />
      <Restricted blocked={blocked('annotate')}>
        <ToolbarButton
          icon={<EditRegular />}
          aria-pressed={viewer.mode === 'annotate'}
          className="pdf-mode-button"
          disabledFocusable={blocked('annotate')}
          onClick={() => session.setMode(viewer.mode === 'annotate' ? 'view' : 'annotate')}
        >
          Annotate
        </ToolbarButton>
      </Restricted>
      <Restricted blocked={blocked('annotate')}>
        <ToolbarButton
          icon={<SignatureRegular />}
          disabledFocusable={blocked('annotate')}
          onClick={() => session.setViewer({ signOpen: true })}
        >
          Sign
        </ToolbarButton>
      </Restricted>
      <Restricted blocked={blocked('organize')}>
        <ToolbarButton
          icon={<GridRegular />}
          aria-pressed={viewer.mode === 'organize'}
          className="pdf-mode-button"
          disabledFocusable={blocked('organize')}
          onClick={() => session.setMode(viewer.mode === 'organize' ? 'view' : 'organize')}
        >
          Organize
        </ToolbarButton>
      </Restricted>
      <Restricted blocked={blocked('edit')}>
        <ToolbarButton
          icon={<DocumentEditRegular />}
          aria-pressed={viewer.mode === 'edit'}
          className="pdf-mode-button"
          disabledFocusable={blocked('edit')}
          onClick={() => session.setMode(viewer.mode === 'edit' ? 'view' : 'edit')}
        >
          Edit
        </ToolbarButton>
      </Restricted>
      <div className="pdf-toolbar-spacer" />
      {viewer.findOpen ? (
        <FindBox session={session} />
      ) : (
        <Tip label="Find (Ctrl+F)">
          <ToolbarButton icon={<SearchRegular />} onClick={() => session.setViewer({ findOpen: true })} />
        </Tip>
      )}
      <Tip label="Comments">
        <ToolbarButton
          icon={<CommentMultipleRegular />}
          aria-pressed={viewer.commentsOpen}
          onClick={() => session.setViewer({ commentsOpen: !viewer.commentsOpen })}
        />
      </Tip>
      <Tip label={blocked('print') ? RESTRICTED : 'Print (Ctrl+P)'}>
        <ToolbarButton icon={<PrintRegular />} disabledFocusable={blocked('print')} onClick={() => void session.print?.()} />
      </Tip>
      <MoreMenu session={session} viewer={viewer} />
    </Toolbar>
  );
}

function MoreMenu({ session, viewer }: { session: PdfSession; viewer: ViewerState }) {
  const ready = session.caps() !== null;
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content="More options" relationship="label" withArrow>
          <ToolbarButton icon={<MoreHorizontalRegular />} />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <Menu
            checkedValues={{ spread: [viewer.spread] }}
            onCheckedValueChange={(_, data) => session.setSpread(data.checkedItems[0] as ViewerState['spread'])}
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem icon={<BookOpenRegular />} disabled={!ready}>
                Page layout
              </MenuItem>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItemRadio name="spread" value="none">
                  One page wide
                </MenuItemRadio>
                <MenuItemRadio name="spread" value="odd">
                  Two pages side by side
                </MenuItemRadio>
                <MenuItemRadio name="spread" value="even">
                  Two pages, with a cover page
                </MenuItemRadio>
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu
            checkedValues={{ reading: [viewer.reading] }}
            onCheckedValueChange={(_, data) => session.setReading(data.checkedItems[0] as ViewerState['reading'])}
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem icon={<DarkThemeRegular />}>Reading mode</MenuItem>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItemRadio name="reading" value="normal">
                  Normal
                </MenuItemRadio>
                <MenuItemRadio name="reading" value="dark">
                  Dark pages
                </MenuItemRadio>
                <MenuItemRadio name="reading" value="sepia">
                  Sepia
                </MenuItemRadio>
              </MenuList>
            </MenuPopover>
          </Menu>
          <MenuItem
            icon={<FullScreenMaximizeRegular />}
            secondaryContent="F11"
            onClick={() => session.host.toggleFullscreen()}
          >
            Full screen
          </MenuItem>
          <MenuDivider />
          <MenuItem
            icon={<LockClosedRegular />}
            disabled={!session.allows('secure')}
            onClick={() => session.setViewer({ protectOpen: true })}
          >
            {viewer.encrypted ? 'Change the password…' : 'Protect with a password…'}
          </MenuItem>
          {viewer.encrypted && (
            <MenuItem
              icon={<LockOpenRegular />}
              disabled={!session.allows('secure')}
              onClick={() => void session.unprotect()}
            >
              Remove the password
            </MenuItem>
          )}
          <MenuItem
            icon={<DocumentArrowDownRegular />}
            disabled={!session.allows('edit')}
            onClick={() => void session.saveFlattened()}
          >
            Save a flattened copy
          </MenuItem>
          <MenuDivider />
          <MenuItem
            icon={<InfoRegular />}
            secondaryContent="Ctrl+D"
            disabled={!ready}
            onClick={() => session.setViewer({ propertiesOpen: true })}
          >
            Document properties
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

function FindBox({ session }: { session: PdfSession }) {
  const viewer = useSyncExternalStore(session.subscribe, session.viewer);
  const [text, setText] = useState(viewer.query);
  const search = session.caps()?.search;
  const step = (direction: 1 | -1) => {
    if (!search || viewer.results === 0) return;
    const index = direction === 1 ? search.nextResult(session.documentId) : search.previousResult(session.documentId);
    session.setViewer({ activeResult: index });
  };
  const close = () => {
    search?.stopSearch(session.documentId);
    session.setViewer({ findOpen: false, query: '', results: 0, activeResult: -1 });
  };
  return (
    <div className="pdf-find" role="search">
      <SearchBox
        autoFocus
        size="small"
        placeholder="Find in document"
        value={text}
        onChange={(_, data) => setText(data.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            if (text === viewer.query && viewer.results > 0) step(event.shiftKey ? -1 : 1);
            else void session.find(text);
          } else if (event.key === 'Escape') close();
        }}
      />
      <span className="pdf-find-count" aria-live="polite">
        {viewer.query ? (viewer.results ? `${viewer.activeResult + 1} of ${viewer.results}` : 'No results') : ''}
      </span>
      <ToolbarButton aria-label="Previous result (Shift+F3)" icon={<ChevronUpRegular />} disabled={!viewer.results} onClick={() => step(-1)} />
      <ToolbarButton aria-label="Next result (F3)" icon={<ChevronDownRegular />} disabled={!viewer.results} onClick={() => step(1)} />
      <ToolbarButton aria-label="Close find" icon={<DismissRegular />} onClick={close} />
    </div>
  );
}
