// The Fluent toolbar above the grid: common formatting, rows and columns, sort and filter,
// panels for conditional formatting, data validation and comments. Every button runs one of
// Univer's commands on the selection, so undo, redo and the grid stay in step.

import {
  Divider,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowRedoRegular,
  ArrowSortDownRegular,
  ArrowSortUpRegular,
  ArrowUndoRegular,
  BorderAllRegular,
  ChartMultipleRegular,
  ChevronDownRegular,
  CommentRegular,
  CurrencyDollarEuroRegular,
  DecimalArrowLeftRegular,
  DecimalArrowRightRegular,
  FilterRegular,
  HighlightRegular,
  ImageAddRegular,
  MoreHorizontalRegular,
  NumberSymbolRegular,
  PaintBucketRegular,
  SearchRegular,
  TableCellsMergeRegular,
  TableFreezeRowRegular,
  TableInsertRowRegular,
  TaskListSquareLtrRegular,
  TextAlignCenterRegular,
  TextAlignLeftRegular,
  TextAlignRightRegular,
  TextBoldRegular,
  TextColorRegular,
  TextItalicRegular,
  TextStrikethroughRegular,
  TextUnderlineRegular,
  TextWrapRegular,
} from '@fluentui/react-icons';
import { type ReactElement, useSyncExternalStore } from 'react';
import type { SheetsSession } from './session';
import { CHART_TYPES, CMD, CONDITIONAL_RULES, NUMBER_FORMATS } from './sheetCommands';

const TEXT_COLORS = ['#000000', '#C00000', '#FF0000', '#FFC000', '#00B050', '#0070C0', '#7030A0', '#808080'];
const FILL_COLORS = ['#FFFF00', '#FFC7CE', '#C6EFCE', '#FFEB9C', '#DDEBF7', '#FCE4D6', '#EDEDED', '#FFFFFF'];
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
const FONTS = ['Aptos', 'Calibri', 'Arial', 'Segoe UI', 'Times New Roman', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Verdana'];

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip content={label} relationship="label" withArrow>
      {children}
    </Tooltip>
  );
}

/** A toolbar button that opens a menu, with a Fluent tooltip (the trigger's props go to the button). */
function MenuTip({ label, icon }: { label: string; icon: ReactElement }) {
  return (
    <MenuTrigger disableButtonEnhancement>
      {(trigger: object) => (
        <Tooltip content={label} relationship="label" withArrow>
          <ToolbarButton {...trigger} icon={icon} />
        </Tooltip>
      )}
    </MenuTrigger>
  );
}

function Swatches({ colors, onPick }: { colors: string[]; onPick: (color: string | null) => void }) {
  return (
    <div className="sheets-swatches" role="group">
      {colors.map((color) => (
        <button key={color} type="button" className="sheets-swatch" style={{ background: color }} aria-label={color} onClick={() => onPick(color)} />
      ))}
      <button type="button" className="sheets-swatch-none" onClick={() => onPick(null)}>
        None
      </button>
    </div>
  );
}

export function SheetsToolbar({ session }: { session: SheetsSession }) {
  // Redraw when the undo history changes (Undo/Redo availability).
  useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.stateId(),
  );
  const run = (id: string, params?: object) => void session.run(id, params);
  const menuItems = (items: [string, () => void][]) => (
    <MenuList>
      {items.map(([label, action]) => (
        <MenuItem key={label} onClick={action}>
          {label}
        </MenuItem>
      ))}
    </MenuList>
  );

  return (
    <Toolbar className="sheets-toolbar" aria-label="Formatting" size="small">
      <Tip label="Undo (Ctrl+Z)">
        <ToolbarButton icon={<ArrowUndoRegular />} disabled={!session.canUndo()} onClick={() => run(CMD.undo)} />
      </Tip>
      <Tip label="Redo (Ctrl+Y)">
        <ToolbarButton icon={<ArrowRedoRegular />} disabled={!session.canRedo()} onClick={() => run(CMD.redo)} />
      </Tip>
      <ToolbarDivider />
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton className="sheets-font" aria-label="Font">
            Font <ChevronDownRegular />
          </ToolbarButton>
        </MenuTrigger>
        <MenuPopover>{menuItems(FONTS.map((font) => [font, () => run(CMD.fontFamily, { value: font })]))}</MenuPopover>
      </Menu>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton aria-label="Font size">
            Size <ChevronDownRegular />
          </ToolbarButton>
        </MenuTrigger>
        <MenuPopover>{menuItems(FONT_SIZES.map((size) => [String(size), () => run(CMD.fontSize, { value: size })]))}</MenuPopover>
      </Menu>
      <Tip label="Bold (Ctrl+B)">
        <ToolbarButton icon={<TextBoldRegular />} onClick={() => run(CMD.bold)} />
      </Tip>
      <Tip label="Italic (Ctrl+I)">
        <ToolbarButton icon={<TextItalicRegular />} onClick={() => run(CMD.italic)} />
      </Tip>
      <Tip label="Underline (Ctrl+U)">
        <ToolbarButton icon={<TextUnderlineRegular />} onClick={() => run(CMD.underline)} />
      </Tip>
      <Tip label="Strikethrough">
        <ToolbarButton icon={<TextStrikethroughRegular />} onClick={() => run(CMD.strike)} />
      </Tip>
      <Menu>
        <MenuTip label="Font color" icon={<TextColorRegular />} />
        <MenuPopover>
          <Swatches colors={TEXT_COLORS} onPick={(color) => (color ? run(CMD.textColor, { value: color }) : run(CMD.resetTextColor))} />
        </MenuPopover>
      </Menu>
      <Menu>
        <MenuTip label="Fill color" icon={<PaintBucketRegular />} />
        <MenuPopover>
          <Swatches colors={FILL_COLORS} onPick={(color) => (color ? run(CMD.fillColor, { value: color }) : run(CMD.resetFillColor))} />
        </MenuPopover>
      </Menu>
      <Menu>
        <MenuTip label="Borders" icon={<BorderAllRegular />} />
        <MenuPopover>
          {menuItems([
            ['All borders', () => run(CMD.border, borderParams('all'))],
            ['Outside borders', () => run(CMD.border, borderParams('outside'))],
            ['Bottom border', () => run(CMD.border, borderParams('bottom'))],
            ['Top border', () => run(CMD.border, borderParams('top'))],
            ['No border', () => run(CMD.border, borderParams('none'))],
          ])}
        </MenuPopover>
      </Menu>
      <ToolbarDivider />
      <Tip label="Align left">
        <ToolbarButton icon={<TextAlignLeftRegular />} onClick={() => run(CMD.horizontal, { value: 1 })} />
      </Tip>
      <Tip label="Center">
        <ToolbarButton icon={<TextAlignCenterRegular />} onClick={() => run(CMD.horizontal, { value: 2 })} />
      </Tip>
      <Tip label="Align right">
        <ToolbarButton icon={<TextAlignRightRegular />} onClick={() => run(CMD.horizontal, { value: 3 })} />
      </Tip>
      <Tip label="Wrap text">
        <ToolbarButton icon={<TextWrapRegular />} onClick={() => run(CMD.wrap, { value: 3 })} />
      </Tip>
      <Menu>
        <MenuTip label="Merge cells" icon={<TableCellsMergeRegular />} />
        <MenuPopover>
          {menuItems([
            ['Merge and center', () => void session.run(CMD.mergeAll).then(() => run(CMD.horizontal, { value: 2 }))],
            ['Merge cells', () => run(CMD.mergeAll)],
            ['Merge across', () => run(CMD.mergeHorizontal)],
            ['Unmerge cells', () => run(CMD.unmerge)],
          ])}
        </MenuPopover>
      </Menu>
      <ToolbarDivider />
      <Menu>
        <MenuTip label="Number format" icon={<NumberSymbolRegular />} />
        <MenuPopover>
          <MenuList>
            {NUMBER_FORMATS.map((format) => (
              <MenuItem key={format.label} onClick={() => run(CMD.style, { style: { type: 'n', value: format.pattern ? { pattern: format.pattern } : null } })}>
                {format.label}
              </MenuItem>
            ))}
            <Divider />
            <MenuItem onClick={() => run(CMD.numfmtPanel)}>More formats…</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <Tip label="Currency">
        <ToolbarButton icon={<CurrencyDollarEuroRegular />} onClick={() => run(CMD.currency)} />
      </Tip>
      <Tip label="Fewer decimals">
        <ToolbarButton icon={<DecimalArrowLeftRegular />} onClick={() => run(CMD.lessDecimals)} />
      </Tip>
      <Tip label="More decimals">
        <ToolbarButton icon={<DecimalArrowRightRegular />} onClick={() => run(CMD.moreDecimals)} />
      </Tip>
      <ToolbarDivider />
      <Menu>
        <MenuTip label="Insert or delete rows and columns" icon={<TableInsertRowRegular />} />
        <MenuPopover>
          {menuItems([
            ['Insert rows above', () => void session.insert('row', 'before')],
            ['Insert rows below', () => void session.insert('row', 'after')],
            ['Insert columns left', () => void session.insert('col', 'before')],
            ['Insert columns right', () => void session.insert('col', 'after')],
            ['Delete rows', () => run(CMD.deleteRows)],
            ['Delete columns', () => run(CMD.deleteColumns)],
          ])}
        </MenuPopover>
      </Menu>
      <Tip label="Sort A to Z">
        <ToolbarButton icon={<ArrowSortUpRegular />} onClick={() => run(CMD.sortAscending)} />
      </Tip>
      <Tip label="Sort Z to A">
        <ToolbarButton icon={<ArrowSortDownRegular />} onClick={() => run(CMD.sortDescending)} />
      </Tip>
      <Tip label="Filter">
        <ToolbarButton icon={<FilterRegular />} onClick={() => run(CMD.filter)} />
      </Tip>
      <Menu>
        <MenuTip label="Freeze panes" icon={<TableFreezeRowRegular />} />
        <MenuPopover>
          {menuItems([
            ['Freeze top row', () => run(CMD.freezeRow)],
            ['Freeze first column', () => run(CMD.freezeColumn)],
            ['Freeze at the selection', () => run(CMD.freezeSelection)],
            ['Unfreeze', () => run(CMD.unfreeze)],
          ])}
        </MenuPopover>
      </Menu>
      <ToolbarDivider />
      <Tip label="Conditional formatting">
        <ToolbarButton icon={<HighlightRegular />} onClick={() => run(CMD.conditionalPanel, CONDITIONAL_RULES)} />
      </Tip>
      <Tip label="Data validation">
        <ToolbarButton icon={<TaskListSquareLtrRegular />} onClick={() => run(CMD.validationPanel)} />
      </Tip>
      <Tip label="Comments">
        <ToolbarButton icon={<CommentRegular />} onClick={() => run(CMD.commentsPanel)} />
      </Tip>
      <Menu>
        <MenuTip label="Insert a chart" icon={<ChartMultipleRegular />} />
        <MenuPopover>
          {menuItems([
            ...CHART_TYPES.map(([type, label]): [string, () => void] => [label, () => void session.insertChart(type)]),
          ])}
        </MenuPopover>
      </Menu>
      <Tip label="Insert a picture">
        <ToolbarButton icon={<ImageAddRegular />} onClick={() => void session.insertPicture()} />
      </Tip>
      <div className="sheets-toolbar-spacer" />
      <Tip label="Find and replace (Ctrl+F)">
        <ToolbarButton icon={<SearchRegular />} onClick={() => run(CMD.find)} />
      </Tip>
      <Menu>
        <MenuTip label="More" icon={<MoreHorizontalRegular />} />
        <MenuPopover>
          {menuItems([
            ['Clear formatting', () => run(CMD.clearFormat)],
            ['Format painter', () => run(CMD.formatPainter)],
            ['Insert a sheet', () => run(CMD.insertSheet)],
            ['Rename sheet', () => run(CMD.renameSheet)],
            ['Delete sheet', () => void session.removeSheet()],
          ])}
        </MenuPopover>
      </Menu>
    </Toolbar>
  );
}

/** Univer's border command parameters (thin black lines). */
function borderParams(type: 'all' | 'outside' | 'bottom' | 'top' | 'none') {
  return { value: { type, color: '#000000', style: 1 } };
}
