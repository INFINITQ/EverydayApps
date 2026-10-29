// Annotation UI for Folio PDF: the tools bar shown in annotate mode, the small menu next to a
// selected annotation, and the signature dialog (draw, type or picture; saved encrypted).

import {
  Button,
  Checkbox,
  ColorSwatch,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Menu,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  SwatchPicker,
  Tab,
  TabList,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  ToolbarRadioButton,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowRedoRegular,
  ArrowUndoRegular,
  ArrowUpRightRegular,
  CheckmarkRegular,
  CheckmarkStarburstRegular,
  CircleRegular,
  CursorRegular,
  DeleteRegular,
  HighlightRegular,
  ImageRegular,
  InkStrokeRegular,
  LineHorizontal1Regular,
  LineThicknessRegular,
  NoteRegular,
  PenRegular,
  RectangleLandscapeRegular,
  SignatureRegular,
  TextboxRegular,
  TextStrikethroughRegular,
  TextUnderlineRegular,
} from '@fluentui/react-icons';
import type { AnnotationSelectionMenuRenderFn } from '@embedpdf/plugin-annotation/react';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import {
  SignatureDrawPad,
  SignatureTypePad,
  type SignatureEntry,
  type SignatureFieldDefinition,
} from '@embedpdf/plugin-signature/react';
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { PdfSession } from './pdfFormat';
import { imageSignature, savedSignatures } from './signatures';
import { STAMPS } from './stamps';

export const COLORS = [
  { value: '#FFCD45', name: 'Yellow' },
  { value: '#5CC96E', name: 'Green' },
  { value: '#25D2D1', name: 'Teal' },
  { value: '#597CE2', name: 'Blue' },
  { value: '#C544CE', name: 'Purple' },
  { value: '#E44234', name: 'Red' },
  { value: '#FF8D00', name: 'Orange' },
  { value: '#000000', name: 'Black' },
];

const WIDTHS = [
  { value: 1, name: 'Fine' },
  { value: 2, name: 'Thin' },
  { value: 4, name: 'Medium' },
  { value: 8, name: 'Thick' },
];

type ToolButton = { id: string; title: string; icon: ReactElement; keys?: string };

const TOOL_GROUPS: ToolButton[][] = [
  [
    { id: 'highlight', title: 'Highlight text', icon: <HighlightRegular /> },
    { id: 'underline', title: 'Underline text', icon: <TextUnderlineRegular /> },
    { id: 'strikeout', title: 'Strike out text', icon: <TextStrikethroughRegular /> },
  ],
  [
    { id: 'ink', title: 'Pen', icon: <PenRegular /> },
    { id: 'inkHighlighter', title: 'Highlighter pen', icon: <InkStrokeRegular /> },
  ],
  [
    { id: 'square', title: 'Rectangle', icon: <RectangleLandscapeRegular /> },
    { id: 'circle', title: 'Ellipse', icon: <CircleRegular /> },
    { id: 'line', title: 'Line', icon: <LineHorizontal1Regular /> },
    { id: 'lineArrow', title: 'Arrow', icon: <ArrowUpRightRegular /> },
  ],
  [
    { id: 'freeText', title: 'Text box', icon: <TextboxRegular /> },
    { id: 'textComment', title: 'Sticky note', icon: <NoteRegular /> },
  ],
];

/** Which property holds an annotation's main color (none for pictures, links, form fields). */
const TEXT_MARKUP = [
  PdfAnnotationSubtype.HIGHLIGHT,
  PdfAnnotationSubtype.UNDERLINE,
  PdfAnnotationSubtype.STRIKEOUT,
  PdfAnnotationSubtype.SQUIGGLY,
  PdfAnnotationSubtype.INK,
];
const STROKED = [
  PdfAnnotationSubtype.SQUARE,
  PdfAnnotationSubtype.CIRCLE,
  PdfAnnotationSubtype.LINE,
  PdfAnnotationSubtype.POLYGON,
  PdfAnnotationSubtype.POLYLINE,
  PdfAnnotationSubtype.TEXT,
];
const WIDTHED = [
  PdfAnnotationSubtype.INK,
  PdfAnnotationSubtype.SQUARE,
  PdfAnnotationSubtype.CIRCLE,
  PdfAnnotationSubtype.LINE,
  PdfAnnotationSubtype.POLYGON,
  PdfAnnotationSubtype.POLYLINE,
];

export function colorPatch(type: PdfAnnotationSubtype, color: string): Record<string, string> | null {
  if (type === PdfAnnotationSubtype.FREETEXT) return { fontColor: color };
  // `color` is EmbedPDF's older name for the same value on text markup and ink.
  if (TEXT_MARKUP.includes(type)) return { strokeColor: color, color };
  if (STROKED.includes(type)) return { strokeColor: color };
  return null;
}

export function colorOf(object: Record<string, unknown>): string | undefined {
  const value = object.type === PdfAnnotationSubtype.FREETEXT ? object.fontColor : object.strokeColor;
  return typeof value === 'string' ? value.toUpperCase() : undefined;
}

export const hasWidth = (type: PdfAnnotationSubtype) => WIDTHED.includes(type);

const useViewer = (session: PdfSession) => useSyncExternalStore(session.subscribe, session.viewer);

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip content={label} relationship="label" withArrow>
      {children}
    </Tooltip>
  );
}

/** The annotation tools, shown under the main toolbar in annotate mode. */
export function AnnotateBar({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const caps = session.caps();
  const style = session.style();
  const placing = viewer.tool === 'stamp' || viewer.tool === 'rubberStamp' || viewer.tool?.startsWith('signature');

  return (
    <Toolbar
      className="pdf-toolbar pdf-annotate-bar"
      aria-label="Annotation tools"
      size="small"
      checkedValues={{ tool: [viewer.tool ?? 'select'] }}
      onCheckedValueChange={(_, data) => {
        const next = data.checkedItems[0];
        if (next) session.setTool(next === 'select' ? null : next);
      }}
    >
      <Tip label="Select (Esc)">
        <ToolbarRadioButton name="tool" value="select" icon={<CursorRegular />} />
      </Tip>
      {TOOL_GROUPS.map((group, index) => (
        <span key={index} className="pdf-tool-group">
          <ToolbarDivider />
          {group.map((tool) => (
            <Tip key={tool.id} label={tool.title}>
              <ToolbarRadioButton name="tool" value={tool.id} icon={tool.icon} />
            </Tip>
          ))}
        </span>
      ))}
      <Tip label="Picture">
        <ToolbarButton icon={<ImageRegular />} aria-pressed={viewer.tool === 'stamp'} onClick={() => void session.insertImage()} />
      </Tip>
      <StampMenu session={session} active={viewer.tool === 'rubberStamp'} />
      <Tip label="Signature">
        <ToolbarButton icon={<SignatureRegular />} onClick={() => session.setViewer({ signOpen: true })} />
      </Tip>
      <ToolbarDivider />
      {placing ? (
        <span className="pdf-annotate-hint">Click on the page to place it. Esc cancels.</span>
      ) : (
        <>
          <SwatchPicker
            className="pdf-swatches"
            // Dimmed rather than crossed out when the tool or selection has no color.
            data-off={!style.color}
            aria-disabled={!style.color}
            layout="row"
            size="extra-small"
            shape="circular"
            aria-label="Color"
            selectedValue={style.color ?? ''}
            onSelectionChange={(_, data) => session.setStyle({ color: data.selectedValue })}
          >
            {COLORS.map((color) => (
              <ColorSwatch key={color.value} color={color.value} value={color.value} aria-label={color.name} />
            ))}
          </SwatchPicker>
          <Menu
            checkedValues={{ width: style.width ? [String(style.width)] : [] }}
            onCheckedValueChange={(_, data) => session.setStyle({ width: Number(data.checkedItems[0]) })}
          >
            <MenuTrigger disableButtonEnhancement>
              <Tooltip content="Line thickness" relationship="label" withArrow>
                <ToolbarButton icon={<LineThicknessRegular />} disabled={!style.width} />
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {WIDTHS.map((width) => (
                  <MenuItemRadio key={width.value} name="width" value={String(width.value)}>
                    {width.name}
                  </MenuItemRadio>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        </>
      )}
      <div className="pdf-toolbar-spacer" />
      <Tip label="Delete (Del)">
        <ToolbarButton icon={<DeleteRegular />} disabled={viewer.selection === 0} onClick={() => session.deleteSelected()} />
      </Tip>
      <Tip label="Undo (Ctrl+Z)">
        <ToolbarButton icon={<ArrowUndoRegular />} disabled={!caps?.history.canUndo()} onClick={() => session.undo()} />
      </Tip>
      <Tip label="Redo (Ctrl+Y)">
        <ToolbarButton icon={<ArrowRedoRegular />} disabled={!caps?.history.canRedo()} onClick={() => session.redo()} />
      </Tip>
      <ToolbarDivider />
      <ToolbarButton icon={<CheckmarkRegular />} onClick={() => session.setMode('view')}>
        Done
      </ToolbarButton>
    </Toolbar>
  );
}

/** The built-in stamps, each shown as the engine draws it. */
function StampMenu({ session, active }: { session: PdfSession; active: boolean }) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const loadPreviews = () => {
    const stamps = session.caps()?.stamps;
    if (!stamps || urls.current.length > 0) return;
    STAMPS.forEach((stamp, pageIndex) => {
      stamps
        .renderStamp(session.stampLibraryId, pageIndex, 150, window.devicePixelRatio)
        .toPromise()
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          setPreviews((shown) => ({ ...shown, [stamp.id]: url }));
        })
        .catch(() => undefined);
    });
  };

  return (
    <Menu onOpenChange={(_, data) => data.open && loadPreviews()}>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content="Stamp" relationship="label" withArrow>
          <ToolbarButton icon={<CheckmarkStarburstRegular />} aria-pressed={active} />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList className="pdf-stamp-menu">
          {STAMPS.map((stamp) => (
            <MenuItem key={stamp.id} onClick={() => session.placeStamp(stamp.id)}>
              {previews[stamp.id] ? (
                <img className="pdf-stamp-preview" src={previews[stamp.id]} alt={stamp.label} />
              ) : (
                stamp.label
              )}
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/** The small menu above a selected annotation: color and delete. */
export function selectionMenu(session: PdfSession): AnnotationSelectionMenuRenderFn {
  return function SelectionMenu({ selected, menuWrapperProps, rect, placement, context }) {
    if (!selected || context.structurallyLocked) return null;
    const object = context.annotation.object;
    const current = colorOf(object as unknown as Record<string, unknown>);
    const canColor = colorPatch(object.type, '#000000') !== null;
    return (
      <div {...menuWrapperProps}>
        <MenuBox top={placement.suggestTop ? -44 : rect.size.height + 8}>
          {canColor && (
            <SwatchPicker
              layout="row"
              size="extra-small"
              shape="circular"
              aria-label="Annotation color"
              selectedValue={current ?? ''}
              onSelectionChange={(_, data) => session.setStyle({ color: data.selectedValue })}
            >
              {COLORS.map((color) => (
                <ColorSwatch key={color.value} color={color.value} value={color.value} aria-label={color.name} />
              ))}
            </SwatchPicker>
          )}
          <Tooltip content="Delete (Del)" relationship="label" withArrow>
            <Button appearance="subtle" size="small" icon={<DeleteRegular />} onClick={() => session.deleteSelected()} />
          </Tooltip>
        </MenuBox>
      </div>
    );
  };
}

/** Keeps the floating menu on the page: near the right edge it lines up with the annotation's right side. */
function MenuBox({ top, children }: { top: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);
  useLayoutEffect(() => {
    const menu = box.current;
    if (!menu) return;
    // Measured as if left-aligned (annotation's left edge + menu width), so it can't flip-flop.
    // Re-checked when the menu or the page changes size (zoom, the comments panel opening).
    const page = menu.closest('.pdf-page');
    const check = () => {
      const anchor = menu.parentElement;
      if (!page || !anchor) return;
      const left = anchor.getBoundingClientRect().left;
      setAlignRight(left + menu.offsetWidth > page.getBoundingClientRect().right - 4);
    };
    check();
    const frame = requestAnimationFrame(check);
    const observer = new ResizeObserver(check);
    observer.observe(menu);
    if (page) observer.observe(page);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <div
      ref={box}
      className="pdf-selection-menu"
      style={alignRight ? { top, left: 'auto', right: 0 } : { top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

/** Handwriting fonts that ship with Windows 11 (nothing is downloaded). */
const FONTS = ['Segoe Script', 'Ink Free', 'Segoe Print', 'Gabriola'];
const INKS = [
  { value: '#000000', name: 'Black' },
  { value: '#1F3FA8', name: 'Blue' },
];

type SignTab = 'saved' | 'draw' | 'type' | 'image';

/** Draw, type or pick a signature, then place it on the page. */
export function SignDialog({ session }: { session: PdfSession }) {
  const viewer = useViewer(session);
  const saved = useSyncExternalStore(savedSignatures.subscribe, savedSignatures.list);
  const [tab, setTab] = useState<SignTab>('draw');
  const [result, setResult] = useState<SignatureFieldDefinition | null>(null);
  const [ink, setInk] = useState(INKS[0]!.value);
  const [font, setFont] = useState(FONTS[0]!);
  const [keep, setKeep] = useState(true);
  const [clearWhite, setClearWhite] = useState(true);
  const [picture, setPicture] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const pad = useRef<{ clear(): void } | null>(null);
  const open = viewer.signOpen;

  useEffect(() => {
    if (!open) return;
    setTab(savedSignatures.list().length > 0 ? 'saved' : 'draw');
    setResult(null);
    setPicture(null);
  }, [open]);

  // A picked picture is re-processed when "remove white background" changes.
  useEffect(() => {
    if (!picture) return;
    let current = true;
    imageSignature(picture, clearWhite).then(
      (signature) => current && setResult(signature),
      () => current && session.host.notify('That picture could not be read. Try a PNG or JPEG file.', 'error'),
    );
    return () => {
      current = false;
    };
  }, [picture, clearWhite, session]);

  const close = () => session.setViewer({ signOpen: false });

  const choose = (next: SignTab) => {
    setTab(next);
    setResult(null);
    setPicture(null);
  };

  const pickPicture = async () => {
    const file = await session.host.openAnother(['png', 'jpg', 'jpeg'], 'Pictures');
    if (file) setPicture(file.bytes);
  };

  const place = async (entry?: SignatureEntry) => {
    if (entry) return session.placeSignature(entry);
    if (!result) return;
    setBusy(true);
    try {
      const next = keep ? await savedSignatures.add(session.host, result) : savedSignatures.temporary(result);
      session.placeSignature(next);
    } catch (error) {
      session.host.notify(`The signature could not be saved: ${String((error as { message?: string })?.message ?? error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && close()}>
      <DialogSurface className="pdf-sign-dialog">
        <DialogBody>
          <DialogTitle>Add a signature</DialogTitle>
          <DialogContent className="pdf-sign-content">
            <TabList selectedValue={tab} onTabSelect={(_, data) => choose(data.value as SignTab)}>
              {saved.length > 0 && <Tab value="saved">Saved</Tab>}
              <Tab value="draw">Draw</Tab>
              <Tab value="type">Type</Tab>
              <Tab value="image">Picture</Tab>
            </TabList>

            {tab === 'saved' && (
              <div className="pdf-sign-saved">
                {saved.map((entry) => (
                  <div key={entry.id} className="pdf-sign-card">
                    <button className="pdf-sign-card-pick" aria-label="Use this signature" onClick={() => void place(entry)}>
                      <img src={entry.signature.previewDataUrl} alt="" />
                    </button>
                    <Tooltip content="Delete this saved signature" relationship="label" withArrow>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<DeleteRegular />}
                        onClick={() => void savedSignatures.remove(session.host, entry.id)}
                      />
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}

            {(tab === 'draw' || tab === 'type') && (
              <div className="pdf-sign-options">
                <SwatchPicker
                  layout="row"
                  size="extra-small"
                  shape="circular"
                  aria-label="Ink color"
                  selectedValue={ink}
                  onSelectionChange={(_, data) => setInk(data.selectedValue)}
                >
                  {INKS.map((color) => (
                    <ColorSwatch key={color.value} color={color.value} value={color.value} aria-label={color.name} />
                  ))}
                </SwatchPicker>
                {tab === 'draw' && (
                  <Button size="small" appearance="subtle" onClick={() => pad.current?.clear()}>
                    Clear
                  </Button>
                )}
              </div>
            )}

            {tab === 'draw' && (
              <div className="pdf-sign-pad">
                <SignatureDrawPad
                  key={ink}
                  onResult={setResult}
                  padRef={(handle) => (pad.current = handle)}
                  strokeColor={ink}
                  strokeWidth={2.5}
                  className="pdf-sign-surface"
                />
                <span className="pdf-sign-hint">Sign above the line</span>
              </div>
            )}

            {tab === 'type' && (
              <>
                <div className="pdf-sign-pad">
                  <SignatureTypePad
                    onResult={setResult}
                    fontFamily={`'${font}', cursive`}
                    fontSize={44}
                    color={ink}
                    placeholder="Type your name"
                    className="pdf-sign-surface"
                  />
                </div>
                <div className="pdf-sign-fonts" role="radiogroup" aria-label="Handwriting style">
                  {FONTS.map((name) => (
                    <button
                      key={name}
                      role="radio"
                      aria-checked={font === name}
                      aria-label={name}
                      className="pdf-sign-font"
                      style={{ fontFamily: `'${name}', cursive` }}
                      onClick={() => setFont(name)}
                    >
                      {result?.label || 'Signature'}
                    </button>
                  ))}
                </div>
              </>
            )}

            {tab === 'image' && (
              <div className="pdf-sign-picture">
                <div className="pdf-sign-pad pdf-sign-preview">
                  {result?.previewDataUrl ? <img src={result.previewDataUrl} alt="Signature preview" /> : <span>No picture yet</span>}
                </div>
                <div className="pdf-sign-options">
                  <Button size="small" icon={<ImageRegular />} onClick={() => void pickPicture()}>
                    Choose a picture…
                  </Button>
                  <Checkbox
                    label="Remove white background"
                    checked={clearWhite}
                    onChange={(_, data) => setClearWhite(data.checked === true)}
                  />
                </div>
              </div>
            )}

            {tab !== 'saved' && (
              <Checkbox
                label="Save it on this PC for next time (encrypted)"
                checked={keep}
                onChange={(_, data) => setKeep(data.checked === true)}
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={close}>
              Cancel
            </Button>
            {tab !== 'saved' && (
              <Button appearance="primary" disabled={!result || busy} onClick={() => void place()}>
                Place signature
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
