// Folio Docs' toolbar: Fluent controls driving the engine's commands. It lives inside the
// engine's tree, so it can use the adapter's hooks for styles, fonts and zoom.

import { useFontFamily, useParagraphStyle, useZoom } from '@docx-editor.dev/react';
import {
  Combobox,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  Tooltip,
} from '@fluentui/react-components';
import {
  AddRegular,
  ArrowRedoRegular,
  ArrowUndoRegular,
  CommentMultipleRegular,
  DocumentOnePageRegular,
  MoreHorizontalRegular,
  SearchRegular,
  TextAlignCenterRegular,
  TextAlignJustifyRegular,
  TextAlignLeftRegular,
  TextAlignRightRegular,
  TextBoldRegular,
  TextBulletListLtrRegular,
  TextBulletListTreeRegular,
  TextClearFormattingRegular,
  TextIndentDecreaseLtrRegular,
  TextIndentIncreaseLtrRegular,
  TextItalicRegular,
  TextNumberListLtrRegular,
  TextStrikethroughRegular,
  TextUnderlineRegular,
  ZoomInRegular,
  ZoomOutRegular,
} from '@fluentui/react-icons';
import type { ReactElement } from 'react';
import type { DocsSession, DocsState } from './session';
import type { SlotId } from './text';

const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip content={label} relationship="label" withArrow>
      {children}
    </Tooltip>
  );
}

/** A toolbar button for one of the engine's commands; pressed when it applies to the selection. */
function SlotButton({ session, slot, label, icon, toggle = false }: { session: DocsSession; slot: SlotId; label: string; icon: ReactElement; toggle?: boolean }) {
  const { enabled, active } = session.slot(slot);
  if (toggle) {
    return (
      <Tip label={label}>
        <ToolbarButton
          aria-label={label}
          icon={icon}
          appearance="subtle"
          aria-pressed={active}
          className={active ? 'docs-on' : undefined}
          disabled={!enabled}
          onClick={() => session.run(slot)}
        />
      </Tip>
    );
  }
  return (
    <Tip label={label}>
      <ToolbarButton aria-label={label} icon={icon} appearance="subtle" disabled={!enabled} onClick={() => session.run(slot)} />
    </Tip>
  );
}

function StylePicker({ session }: { session: DocsSession }) {
  const style = useParagraphStyle();
  const current = style.options.find((o) => o.styleId === style.value);
  const label = (o: (typeof style.options)[number]) => ('name' in o && typeof o.name === 'string' ? o.name : o.styleId);
  return (
    <Combobox
      aria-label="Paragraph style"
      className="docs-style"
      style={{ minWidth: 0, width: 140 }}
      size="small"
      readOnly
      disabled={!style.isEnabled || session.ui.mode === 'view'}
      value={current ? label(current) : ''}
      selectedOptions={style.value ? [style.value] : []}
      onOptionSelect={(_e, data) => data.optionValue && style.setValue(data.optionValue)}
    >
      {style.options.map((o) => (
        <Option key={o.styleId} value={o.styleId}>
          {label(o)}
        </Option>
      ))}
    </Combobox>
  );
}

function FontPicker({ session }: { session: DocsSession }) {
  const font = useFontFamily();
  const fonts = [...new Set([...(session.editor?.getDocumentFonts() ?? []), ...(session.editor?.getAvailableFonts() ?? [])])].sort();
  return (
    <Combobox
      aria-label="Font"
      className="docs-font"
      style={{ minWidth: 0, width: 140 }}
      size="small"
      freeform
      disabled={!session.slot('font.family').enabled}
      value={font.value ?? ''}
      onOptionSelect={(_e, data) => data.optionValue && session.run('font.family', data.optionValue)}
    >
      {fonts.map((f) => (
        <Option key={f} value={f} text={f}>
          <span style={{ fontFamily: `"${f}"` }}>{f}</span>
        </Option>
      ))}
    </Combobox>
  );
}

function SizePicker({ session }: { session: DocsSession }) {
  const half = session.editor && session.ui.ready ? session.editor.getSelectionFormatting()?.fontSizeHalfPoints : undefined;
  const value = half ? String(half / 2) : '';
  const apply = (text: string) => {
    const size = Number(text);
    if (Number.isFinite(size) && size >= 1 && size <= 1638) session.run('font.size', size);
  };
  return (
    <Combobox
      aria-label="Font size"
      className="docs-size"
      style={{ minWidth: 0, width: 64 }}
      size="small"
      freeform
      disabled={!session.slot('font.size').enabled}
      value={value}
      onOptionSelect={(_e, data) => data.optionValue && apply(data.optionValue)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') apply((e.target as HTMLInputElement).value);
      }}
    >
      {SIZES.map((s) => (
        <Option key={s} value={String(s)}>
          {String(s)}
        </Option>
      ))}
    </Combobox>
  );
}

function ZoomControls() {
  const zoom = useZoom();
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <ToolbarButton aria-label="Zoom" appearance="subtle" className="docs-zoom" icon={<ZoomInRegular />}>
          {`${Math.round(zoom.zoom * 100)}%`}
        </ToolbarButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<ZoomInRegular />} disabled={!zoom.canZoomIn} onClick={zoom.zoomIn}>
            Zoom in
          </MenuItem>
          <MenuItem icon={<ZoomOutRegular />} disabled={!zoom.canZoomOut} onClick={zoom.zoomOut}>
            Zoom out
          </MenuItem>
          <MenuDivider />
          <MenuItem onClick={zoom.auto}>Fit to window</MenuItem>
          <MenuItem onClick={zoom.fitToWidth}>Page width</MenuItem>
          <MenuDivider />
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((level) => (
            <MenuItem key={level} onClick={() => zoom.setZoom(level)}>{`${level * 100}%`}</MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function DocsToolbar({ session, state }: { session: DocsSession; state: DocsState }) {
  const editing = state.ready && state.mode === 'edit';
  const enabled = (slot: SlotId) => session.slot(slot).enabled;
  const togglePanel = (panel: DocsState['panel']) => session.update({ panel: state.panel === panel ? null : panel });
  return (
    <Toolbar aria-label="Document tools" className="docs-toolbar" size="small">
      <SlotButton session={session} slot="history.undo" label="Undo (Ctrl+Z)" icon={<ArrowUndoRegular />} />
      <SlotButton session={session} slot="history.redo" label="Redo (Ctrl+Y)" icon={<ArrowRedoRegular />} />
      <ToolbarDivider />
      <StylePicker session={session} />
      <FontPicker session={session} />
      <SizePicker session={session} />
      <ToolbarDivider />
      <SlotButton session={session} slot="text.bold" label="Bold (Ctrl+B)" icon={<TextBoldRegular />} toggle />
      <SlotButton session={session} slot="text.italic" label="Italic (Ctrl+I)" icon={<TextItalicRegular />} toggle />
      <SlotButton session={session} slot="text.underline" label="Underline (Ctrl+U)" icon={<TextUnderlineRegular />} toggle />
      <SlotButton session={session} slot="text.strike" label="Strikethrough" icon={<TextStrikethroughRegular />} toggle />
      <SlotButton session={session} slot="format.clear" label="Clear formatting" icon={<TextClearFormattingRegular />} />
      <ToolbarDivider />
      <SlotButton session={session} slot="alignment.left" label="Align left (Ctrl+L)" icon={<TextAlignLeftRegular />} toggle />
      <SlotButton session={session} slot="alignment.center" label="Center (Ctrl+E)" icon={<TextAlignCenterRegular />} toggle />
      <SlotButton session={session} slot="alignment.right" label="Align right (Ctrl+R)" icon={<TextAlignRightRegular />} toggle />
      <SlotButton session={session} slot="alignment.justify" label="Justify (Ctrl+J)" icon={<TextAlignJustifyRegular />} toggle />
      <ToolbarDivider />
      <SlotButton session={session} slot="list.bullet" label="Bulleted list" icon={<TextBulletListLtrRegular />} toggle />
      <SlotButton session={session} slot="list.numbered" label="Numbered list" icon={<TextNumberListLtrRegular />} toggle />
      <SlotButton session={session} slot="list.outdent" label="Decrease indent" icon={<TextIndentDecreaseLtrRegular />} />
      <SlotButton session={session} slot="list.indent" label="Increase indent" icon={<TextIndentIncreaseLtrRegular />} />
      <ToolbarDivider />
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton icon={<AddRegular />} appearance="subtle" disabled={!editing}>
            Insert
          </ToolbarButton>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem disabled={!enabled('table.insert')} onClick={() => session.update({ dialog: 'insertTable' })}>
              Table…
            </MenuItem>
            <MenuItem onClick={() => void session.insertPicture()}>Picture…</MenuItem>
            <MenuItem disabled={!enabled('text.link')} onClick={() => session.run('text.link')} secondaryContent="Ctrl+K">
              Link…
            </MenuItem>
            <MenuDivider />
            <MenuItem disabled={!enabled('insert.pageBreak')} onClick={() => session.run('insert.pageBreak')} secondaryContent="Ctrl+Enter">
              Page break
            </MenuItem>
            <MenuItem disabled={!enabled('insert.sectionBreakNextPage')} onClick={() => session.run('insert.sectionBreakNextPage')}>
              Section break (next page)
            </MenuItem>
            <MenuItem disabled={!enabled('insert.sectionBreakContinuous')} onClick={() => session.run('insert.sectionBreakContinuous')}>
              Section break (continuous)
            </MenuItem>
            <MenuDivider />
            <MenuItem disabled={!enabled('insert.footnote')} onClick={() => session.run('insert.footnote')}>
              Footnote
            </MenuItem>
            <MenuItem disabled={!enabled('insert.endnote')} onClick={() => session.run('insert.endnote')}>
              Endnote
            </MenuItem>
            <MenuItem disabled={!enabled('insert.toc')} onClick={() => session.run('insert.toc')}>
              Table of contents
            </MenuItem>
            <MenuDivider />
            <MenuItem disabled={!enabled('insert.pageNumber')} onClick={() => session.run('insert.pageNumber')}>
              Page number
            </MenuItem>
            <MenuItem disabled={!enabled('insert.pageXofY')} onClick={() => session.run('insert.pageXofY')}>
              Page X of Y
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton aria-label="Layout" title="Layout: page setup, header and footer" icon={<DocumentOnePageRegular />} appearance="subtle" disabled={!editing} />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => session.update({ dialog: 'pageSetup' })}>Page setup…</MenuItem>
            <MenuDivider />
            <MenuItem onClick={() => session.editor?.exec({ type: 'editHeaderFooter', position: 'header' })}>Edit header</MenuItem>
            <MenuItem onClick={() => session.editor?.exec({ type: 'editHeaderFooter', position: 'footer' })}>Edit footer</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <ToolbarDivider />
      <Tip label="Find and replace (Ctrl+F)">
        <ToolbarButton
          aria-label="Find and replace"
          icon={<SearchRegular />}
          appearance="subtle"
          aria-pressed={state.panel === 'find'}
          className={state.panel === 'find' ? 'docs-on' : undefined}
          disabled={!state.ready}
          onClick={() => togglePanel('find')}
        />
      </Tip>
      <Tip label={`Comments and tracked changes (${session.facts.comments.length + session.facts.revisions})`}>
        <ToolbarButton
          aria-label="Comments"
          icon={<CommentMultipleRegular />}
          appearance="subtle"
          aria-pressed={state.panel === 'comments'}
          className={state.panel === 'comments' ? 'docs-on' : undefined}
          disabled={!state.ready}
          onClick={() => togglePanel('comments')}
        />
      </Tip>
      <Tip label="Navigation (headings)">
        <ToolbarButton
          aria-label="Navigation"
          icon={<TextBulletListTreeRegular />}
          appearance="subtle"
          aria-pressed={state.panel === 'outline'}
          className={state.panel === 'outline' ? 'docs-on' : undefined}
          disabled={!state.ready}
          onClick={() => togglePanel('outline')}
        />
      </Tip>
      <ToolbarDivider />
      <ZoomControls />
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton aria-label="More" icon={<MoreHorizontalRegular />} appearance="subtle" />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem disabled={!state.ready} onClick={() => void session.print()} secondaryContent="Ctrl+P">
              Print…
            </MenuItem>
            <MenuItem disabled={!state.ready} onClick={() => void session.exportPdf()}>
              Export as PDF…
            </MenuItem>
            <MenuDivider />
            <MenuItem disabled={!state.ready} onClick={() => session.update({ dialog: 'wordCount' })} secondaryContent="Ctrl+Shift+G">
              Word count
            </MenuItem>
            <MenuItem disabled={!enabled('script.super')} onClick={() => session.run('script.super')} secondaryContent="Ctrl+Shift++">
              Superscript
            </MenuItem>
            <MenuItem disabled={!enabled('script.sub')} onClick={() => session.run('script.sub')} secondaryContent="Ctrl+=">
              Subscript
            </MenuItem>
            <MenuDivider />
            <MenuItem disabled={!enabled('review.paragraphMarks')} onClick={() => session.run('review.paragraphMarks')}>
              Show formatting marks
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </Toolbar>
  );
}
