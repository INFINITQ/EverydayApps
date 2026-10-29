// Conditional formatting, data validation and filters: worksheet XML <-> Univer's plugin data.
//
// Reading turns them into Univer's resources so the grid shows and edits them. Saving rewrites
// a sheet's rules only when they changed, and even then a rule that's still the same keeps its
// original XML (with any Excel 2010+ extensions it points to).

import type { IRange, IStyleData } from '@univerjs/core';
import { type Range, parseSqref, sqrefOf } from './refs';
import { type StyleSheet, colorOf } from './styles';
import { type XmlElement, attrsText, escapeAttr, escapeText } from './xml';

export const RESOURCE = {
  cf: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN',
  dv: 'SHEET_DATA_VALIDATION_PLUGIN',
  filter: 'SHEET_FILTER_PLUGIN',
  comments: 'SHEET_UNIVER_THREAD_COMMENT_PLUGIN',
  drawings: 'SHEET_DRAWING_PLUGIN',
} as const;

const NUMBER_OPERATORS = ['greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual', 'notBetween', 'between', 'equal', 'notEqual'];
const toRanges = (ranges: Range[]): IRange[] => ranges.map((r) => ({ ...r }));
const fromRanges = (ranges: IRange[] | undefined): Range[] => (ranges ?? []).map(({ startRow, startColumn, endRow, endColumn }) => ({ startRow, startColumn, endRow, endColumn }));
const formulaText = (el: XmlElement | undefined) => el?.text().trim() ?? '';
const isNumber = (text: string) => text !== '' && Number.isFinite(Number(text));
const rgb = (color: string | undefined) => `FF${(color ?? '#000000').replace('#', '').toUpperCase().slice(0, 6).padEnd(6, '0')}`;

// ---- Conditional formatting --------------------------------------------------------------

/** A Univer rule (sheets-conditional-formatting's IConditionFormattingRule). */
export type CfRule = { cfId: string; ranges: IRange[]; stopIfTrue: boolean; rule: Record<string, unknown> };

/** Each rule's original XML, so unchanged rules are written back exactly. */
export type CfSource = Map<string, { xml: string; sqref: string; rule: string }>;

function valueOf(cfvo: XmlElement | undefined): { type: string; value?: number | string } {
  const type = cfvo?.attr('type') ?? 'min';
  const val = cfvo?.attr('val');
  const t = type === 'autoMin' ? 'min' : type === 'autoMax' ? 'max' : type;
  if (val === undefined || t === 'min' || t === 'max') return { type: t };
  return { type: t, value: t === 'formula' ? `=${val}` : isNumber(val) ? Number(val) : val };
}

function cfvoXml(p: string, value: { type?: string; value?: number | string } | undefined): string {
  const type = value?.type ?? 'min';
  if (type === 'min' || type === 'max') return `<${p}cfvo type="${type}"/>`;
  const raw = value?.value ?? 0;
  const val = type === 'formula' ? String(raw).replace(/^=/, '') : String(raw);
  return `<${p}cfvo type="${type}" val="${escapeAttr(val)}"/>`;
}

export function readConditionalFormatting(sheetId: string, root: XmlElement, text: string, styles: StyleSheet): { rules: CfRule[]; source: CfSource } {
  const found: { priority: number; rule: CfRule; xml: string; sqref: string }[] = [];
  let n = 0;
  for (const cf of root.elements('conditionalFormatting')) {
    const sqref = cf.attr('sqref') ?? '';
    const ranges = toRanges(parseSqref(sqref));
    if (ranges.length === 0) continue;
    for (const el of cf.elements('cfRule')) {
      const rule = cfRule(el, styles);
      if (!rule) continue;
      const cfId = `${sheetId}-cf${n++}`;
      found.push({
        priority: Number(el.attr('priority') ?? 1e9),
        rule: { cfId, ranges, stopIfTrue: el.attr('stopIfTrue') === '1', rule },
        xml: text.slice(el.start, el.end),
        sqref,
      });
    }
  }
  found.sort((a, b) => a.priority - b.priority);
  const source: CfSource = new Map();
  for (const f of found) source.set(f.rule.cfId, { xml: f.xml, sqref: f.sqref, rule: JSON.stringify(f.rule) });
  return { rules: found.map((f) => f.rule), source };
}

function cfRule(el: XmlElement, styles: StyleSheet): Record<string, unknown> | null {
  const type = el.attr('type') ?? '';
  const dxf = el.attr('dxfId');
  const style: IStyleData = dxf === undefined ? {} : styles.dxfStyle(Number(dxf));
  const formulas = el.elements('formula').map(formulaText);
  const highlight = (subType: string, extra: Record<string, unknown>) => ({ type: 'highlightCell', subType, style, ...extra });
  switch (type) {
    case 'cellIs': {
      const operator = el.attr('operator') ?? 'equal';
      if (!NUMBER_OPERATORS.includes(operator)) return null;
      const [a = '', b = ''] = formulas;
      if (operator === 'between' || operator === 'notBetween') {
        if (isNumber(a) && isNumber(b)) return highlight('number', { operator, value: [Number(a), Number(b)] });
        return null;
      }
      if (isNumber(a)) return highlight('number', { operator, value: Number(a) });
      if (/^".*"$/.test(a) && (operator === 'equal' || operator === 'notEqual')) {
        return highlight('text', { operator, value: a.slice(1, -1).replace(/""/g, '"') });
      }
      return null;
    }
    case 'expression':
      return formulas[0] ? highlight('formula', { value: `=${formulas[0]}` }) : null;
    case 'containsText':
      return highlight('text', { operator: 'containsText', value: el.attr('text') ?? '' });
    case 'notContainsText':
      return highlight('text', { operator: 'notContainsText', value: el.attr('text') ?? '' });
    case 'beginsWith':
      return highlight('text', { operator: 'beginsWith', value: el.attr('text') ?? '' });
    case 'endsWith':
      return highlight('text', { operator: 'endsWith', value: el.attr('text') ?? '' });
    case 'containsBlanks':
    case 'notContainsBlanks':
    case 'containsErrors':
    case 'notContainsErrors':
      return highlight('text', { operator: type });
    case 'duplicateValues':
      return highlight('duplicateValues', {});
    case 'uniqueValues':
      return highlight('uniqueValues', {});
    case 'top10':
      return highlight('rank', { isBottom: el.attr('bottom') === '1', isPercent: el.attr('percent') === '1', value: Number(el.attr('rank') ?? 10) });
    case 'aboveAverage': {
      const above = el.attr('aboveAverage') !== '0';
      const equal = el.attr('equalAverage') === '1';
      return highlight('average', { operator: above ? (equal ? 'greaterThanOrEqual' : 'greaterThan') : equal ? 'lessThanOrEqual' : 'lessThan' });
    }
    case 'timePeriod':
      return highlight('timePeriod', { operator: el.attr('timePeriod') ?? 'today' });
    case 'colorScale': {
      const scale = el.child('colorScale');
      const cfvos = scale?.elements('cfvo') ?? [];
      const colors = scale?.elements('color') ?? [];
      return {
        type: 'colorScale',
        config: cfvos.map((cfvo, index) => ({ index, color: colorOf(colors[index], styles.palette) ?? '#FFFFFF', value: valueOf(cfvo) })),
      };
    }
    case 'dataBar': {
      const bar = el.child('dataBar');
      const [min, max] = bar?.elements('cfvo') ?? [];
      const color = colorOf(bar?.child('color'), styles.palette) ?? '#638EC6';
      return {
        type: 'dataBar',
        isShowValue: bar?.attr('showValue') !== '0',
        config: { min: valueOf(min), max: valueOf(max), isGradient: true, positiveColor: color, nativeColor: '#FF0000' },
      };
    }
    case 'iconSet': {
      const set = el.child('iconSet');
      const iconType = set?.attr('iconSet') ?? '3TrafficLights1';
      const cfvos = set?.elements('cfvo') ?? [];
      const reverse = set?.attr('reverse') === '1';
      const n = cfvos.length;
      if (n < 2) return null;
      const config = [];
      for (let k = 0; k < n; k++) {
        const iconId = String(reverse ? n - 1 - k : k);
        if (k === n - 1) {
          config.push({ iconType, iconId, operator: 'lessThanOrEqual', value: { type: 'num', value: Number.MAX_SAFE_INTEGER } });
        } else {
          const cfvo = cfvos[n - 1 - k];
          config.push({ iconType, iconId, operator: cfvo?.attr('gte') === '0' ? 'greaterThan' : 'greaterThanOrEqual', value: valueOf(cfvo) });
        }
      }
      return { type: 'iconSet', isShowValue: set?.attr('showValue') !== '0', config };
    }
    default:
      return null;
  }
}

/** The sheet's <conditionalFormatting> elements for Univer's rules (unchanged ones as written). */
export function conditionalFormattingXml(p: string, rules: CfRule[], before: CfRule[], source: CfSource, styles: StyleSheet): string {
  const unchanged = new Map(before.map((rule) => [rule.cfId, JSON.stringify(rule)]));
  let out = '';
  rules.forEach((rule, index) => {
    const priority = index + 1;
    const sqref = sqrefOf(fromRanges(rule.ranges));
    if (!sqref) return;
    const original = source.get(rule.cfId);
    let xml: string | null;
    if (original && unchanged.get(rule.cfId) === JSON.stringify(rule)) {
      xml = original.xml.replace(/\spriority="\d+"/, ` priority="${priority}"`);
    } else xml = cfRuleXml(p, rule, priority, styles, rule.ranges[0]);
    if (xml) out += `<${p}conditionalFormatting sqref="${sqref}">${xml}</${p}conditionalFormatting>`;
  });
  return out;
}

function cfRuleXml(p: string, cf: CfRule, priority: number, styles: StyleSheet, first: IRange | undefined): string | null {
  const rule = cf.rule as Record<string, unknown> & { type: string; subType?: string; operator?: string; value?: unknown; style?: IStyleData };
  const stop = cf.stopIfTrue ? ' stopIfTrue="1"' : '';
  const dxf = () => ` dxfId="${styles.addDxf(rule.style ?? {})}"`;
  const topLeft = first ? cellRef(first.startRow, first.startColumn) : 'A1';
  const f = (text: string) => `<${p}formula>${escapeText(text)}</${p}formula>`;
  const quote = (text: string) => `"${String(text).replace(/"/g, '""')}"`;
  if (rule.type === 'highlightCell') {
    switch (rule.subType) {
      case 'number': {
        const values = Array.isArray(rule.value) ? rule.value : [rule.value ?? 0];
        return `<${p}cfRule type="cellIs"${dxf()} priority="${priority}"${stop} operator="${rule.operator ?? 'equal'}">${values.map((v) => f(String(v))).join('')}</${p}cfRule>`;
      }
      case 'text': {
        const value = String(rule.value ?? '');
        const op = rule.operator ?? 'containsText';
        if (op === 'equal' || op === 'notEqual') return `<${p}cfRule type="cellIs"${dxf()} priority="${priority}"${stop} operator="${op}">${f(quote(value))}</${p}cfRule>`;
        const expression: Record<string, string> = {
          containsText: `NOT(ISERROR(SEARCH(${quote(value)},${topLeft})))`,
          notContainsText: `ISERROR(SEARCH(${quote(value)},${topLeft}))`,
          beginsWith: `LEFT(${topLeft},LEN(${quote(value)}))=${quote(value)}`,
          endsWith: `RIGHT(${topLeft},LEN(${quote(value)}))=${quote(value)}`,
          containsBlanks: `LEN(TRIM(${topLeft}))=0`,
          notContainsBlanks: `LEN(TRIM(${topLeft}))>0`,
          containsErrors: `ISERROR(${topLeft})`,
          notContainsErrors: `NOT(ISERROR(${topLeft}))`,
        };
        const textAttr = ['containsText', 'notContainsText', 'beginsWith', 'endsWith'].includes(op) ? ` operator="${op === 'containsText' ? 'containsText' : op === 'notContainsText' ? 'notContains' : op}" text="${escapeAttr(value)}"` : '';
        return `<${p}cfRule type="${op}"${dxf()} priority="${priority}"${stop}${textAttr}>${f(expression[op] ?? `ISERROR(${topLeft})`)}</${p}cfRule>`;
      }
      case 'formula':
        return `<${p}cfRule type="expression"${dxf()} priority="${priority}"${stop}>${f(String(rule.value ?? '').replace(/^=/, ''))}</${p}cfRule>`;
      case 'duplicateValues':
      case 'uniqueValues':
        return `<${p}cfRule type="${rule.subType}"${dxf()} priority="${priority}"${stop}/>`;
      case 'rank': {
        const r = rule as unknown as { isBottom?: boolean; isPercent?: boolean; value?: number };
        return `<${p}cfRule type="top10"${dxf()} priority="${priority}"${stop}${r.isPercent ? ' percent="1"' : ''}${r.isBottom ? ' bottom="1"' : ''} rank="${r.value ?? 10}"/>`;
      }
      case 'average': {
        const op = rule.operator ?? 'greaterThan';
        const above = op.startsWith('greater') || op === 'equal';
        const equal = op.endsWith('OrEqual');
        return `<${p}cfRule type="aboveAverage"${dxf()} priority="${priority}"${stop}${above ? '' : ' aboveAverage="0"'}${equal ? ' equalAverage="1"' : ''}/>`;
      }
      case 'timePeriod':
        return `<${p}cfRule type="timePeriod"${dxf()} priority="${priority}"${stop} timePeriod="${rule.operator ?? 'today'}"><${p}formula>FLOOR(${topLeft},1)=TODAY()</${p}formula></${p}cfRule>`;
      default:
        return null;
    }
  }
  if (rule.type === 'colorScale') {
    const config = (rule as unknown as { config: { color: string; value: { type: string; value?: number | string } }[] }).config ?? [];
    return `<${p}cfRule type="colorScale" priority="${priority}"${stop}><${p}colorScale>${config.map((c) => cfvoXml(p, c.value)).join('')}${config.map((c) => `<${p}color rgb="${rgb(c.color)}"/>`).join('')}</${p}colorScale></${p}cfRule>`;
  }
  if (rule.type === 'dataBar') {
    const r = rule as unknown as { isShowValue?: boolean; config: { min: { type: string; value?: number }; max: { type: string; value?: number }; positiveColor: string } };
    return `<${p}cfRule type="dataBar" priority="${priority}"${stop}><${p}dataBar${r.isShowValue === false ? ' showValue="0"' : ''}>${cfvoXml(p, r.config.min)}${cfvoXml(p, r.config.max)}<${p}color rgb="${rgb(r.config.positiveColor)}"/></${p}dataBar></${p}cfRule>`;
  }
  if (rule.type === 'iconSet') {
    const r = rule as unknown as { isShowValue?: boolean; config: { iconType: string; iconId: string; operator: string; value: { type: string; value?: number | string } }[] };
    const n = r.config.length;
    if (n < 2) return null;
    const iconType = r.config[0]!.iconType;
    // Thresholds from the lowest icon up; the lowest icon's threshold is always 0.
    const cfvos = [`<${p}cfvo type="${r.config[n - 2]!.value.type === 'num' ? 'num' : 'percent'}" val="0"/>`];
    for (let i = 1; i < n; i++) {
      const c = r.config[n - 1 - i]!;
      cfvos.push(cfvoXml(p, c.value).replace(/\/>$/, c.operator === 'greaterThan' ? ' gte="0"/>' : '/>'));
    }
    const reverse = r.config[0]!.iconId !== '0' ? ' reverse="1"' : '';
    return `<${p}cfRule type="iconSet" priority="${priority}"${stop}><${p}iconSet iconSet="${escapeAttr(iconType)}"${reverse}${r.isShowValue === false ? ' showValue="0"' : ''}>${cfvos.join('')}</${p}iconSet></${p}cfRule>`;
  }
  return null;
}

function cellRef(row: number, column: number): string {
  let name = '';
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return `${name}${row + 1}`;
}

// ---- Data validation ---------------------------------------------------------------------

export type DvRule = {
  uid: string;
  type: string;
  ranges: IRange[];
  operator?: string;
  formula1?: string;
  formula2?: string;
  allowBlank?: boolean;
  showDropDown?: boolean;
  showErrorMessage?: boolean;
  showInputMessage?: boolean;
  error?: string;
  errorTitle?: string;
  errorStyle?: number;
  prompt?: string;
  promptTitle?: string;
};

export type DvSource = Map<string, { xml: string; rule: string }>;

const ERROR_STYLES: Record<string, number> = { information: 0, stop: 1, warning: 2 };

export function readDataValidation(sheetId: string, root: XmlElement, text: string): { rules: DvRule[]; source: DvSource } {
  const rules: DvRule[] = [];
  const source: DvSource = new Map();
  let n = 0;
  for (const el of root.child('dataValidations')?.elements('dataValidation') ?? []) {
    const type = el.attr('type') ?? 'none';
    if (type === 'none') continue;
    const ranges = toRanges(parseSqref(el.attr('sqref') ?? ''));
    if (ranges.length === 0) continue;
    let formula1 = formulaText(el.child('formula1'));
    const formula2 = formulaText(el.child('formula2'));
    if (type === 'list') formula1 = /^".*"$/.test(formula1) ? formula1.slice(1, -1).replace(/""/g, '"') : `=${formula1}`;
    else if (formula1 && !isNumber(formula1)) formula1 = `=${formula1}`;
    const rule: DvRule = {
      uid: `${sheetId}-dv${n++}`,
      type,
      ranges,
      operator: type === 'list' || type === 'custom' ? undefined : (el.attr('operator') ?? 'between'),
      formula1,
      formula2: formula2 ? (isNumber(formula2) ? formula2 : `=${formula2}`) : undefined,
      allowBlank: el.attr('allowBlank') === '1',
      // In Excel, showDropDown="1" hides the in-cell list.
      showDropDown: el.attr('showDropDown') !== '1',
      showErrorMessage: el.attr('showErrorMessage') === '1',
      showInputMessage: el.attr('showInputMessage') === '1',
      error: el.attr('error'),
      errorTitle: el.attr('errorTitle'),
      errorStyle: ERROR_STYLES[el.attr('errorStyle') ?? 'stop'] ?? 1,
      prompt: el.attr('prompt'),
      promptTitle: el.attr('promptTitle'),
    };
    for (const key of Object.keys(rule) as (keyof DvRule)[]) if (rule[key] === undefined) delete rule[key];
    rules.push(rule);
    source.set(rule.uid, { xml: text.slice(el.start, el.end), rule: JSON.stringify(rule) });
  }
  return { rules, source };
}

export function dataValidationsXml(p: string, rules: DvRule[], before: DvRule[], source: DvSource, original: XmlElement | undefined): string | null {
  const unchanged = new Map(before.map((rule) => [rule.uid, JSON.stringify(rule)]));
  const items: string[] = [];
  for (const rule of rules) {
    const kept = source.get(rule.uid);
    if (kept && unchanged.get(rule.uid) === JSON.stringify(rule)) {
      items.push(kept.xml);
      continue;
    }
    const xml = dataValidationXml(p, rule);
    if (xml) items.push(xml);
  }
  if (items.length === 0) return null;
  const extra = original ? original.attrs.filter(([k]) => k !== 'count') : [];
  return `<${p}dataValidations count="${items.length}"${attrsText(extra)}>${items.join('')}</${p}dataValidations>`;
}

function dataValidationXml(p: string, rule: DvRule): string | null {
  let type = rule.type;
  let formula1 = rule.formula1 ?? '';
  if (type === 'listMultiple') type = 'list';
  if (type === 'checkbox') {
    type = 'list';
    formula1 = 'TRUE,FALSE';
  }
  if (!['whole', 'decimal', 'list', 'date', 'time', 'textLength', 'custom'].includes(type)) return null;
  const sqref = sqrefOf(fromRanges(rule.ranges));
  if (!sqref) return null;
  const toFile = (value: string | undefined) => (value === undefined ? undefined : value.startsWith('=') ? value.slice(1) : value);
  let f1 = toFile(formula1);
  if (type === 'list' && !formula1.startsWith('=')) f1 = `"${formula1.replace(/"/g, '""')}"`;
  const attrs: [string, string][] = [['type', type]];
  const style = Object.entries(ERROR_STYLES).find(([, v]) => v === rule.errorStyle)?.[0];
  if (style && style !== 'stop') attrs.push(['errorStyle', style]);
  if (rule.operator && rule.operator !== 'between' && type !== 'list' && type !== 'custom') attrs.push(['operator', rule.operator]);
  if (rule.allowBlank) attrs.push(['allowBlank', '1']);
  if (rule.showDropDown === false) attrs.push(['showDropDown', '1']);
  if (rule.showInputMessage) attrs.push(['showInputMessage', '1']);
  if (rule.showErrorMessage) attrs.push(['showErrorMessage', '1']);
  if (rule.errorTitle) attrs.push(['errorTitle', rule.errorTitle]);
  if (rule.error) attrs.push(['error', rule.error]);
  if (rule.promptTitle) attrs.push(['promptTitle', rule.promptTitle]);
  if (rule.prompt) attrs.push(['prompt', rule.prompt]);
  attrs.push(['sqref', sqref]);
  const f2 = toFile(rule.formula2);
  const body = `${f1 ? `<${p}formula1>${escapeText(f1)}</${p}formula1>` : ''}${f2 ? `<${p}formula2>${escapeText(f2)}</${p}formula2>` : ''}`;
  return `<${p}dataValidation${attrsText(attrs)}>${body}</${p}dataValidation>`;
}

// ---- Filters -----------------------------------------------------------------------------

export type AutoFilter = {
  ref: IRange;
  filterColumns?: { colId: number; filters?: { blank?: true; filters?: string[] }; customFilters?: { and?: 1; customFilters: { val: string | number; operator?: string }[] } }[];
  cachedFilteredOut?: number[];
};

export function readFilter(root: XmlElement, hiddenRows: Set<number>): AutoFilter | null {
  const el = root.child('autoFilter');
  const ref = parseSqref(el?.attr('ref') ?? '')[0];
  if (!el || !ref) return null;
  const filterColumns: NonNullable<AutoFilter['filterColumns']> = [];
  for (const column of el.elements('filterColumn')) {
    const colId = ref.startColumn + Number(column.attr('colId') ?? 0);
    const filters = column.child('filters');
    const custom = column.child('customFilters');
    if (filters) {
      const values = filters.elements('filter').map((f) => f.attr('val') ?? '');
      filterColumns.push({ colId, filters: { ...(filters.attr('blank') === '1' ? { blank: true as const } : {}), filters: values } });
    } else if (custom) {
      const list = custom.elements('customFilter').map((c) => {
        const val = c.attr('val') ?? '';
        const operator = c.attr('operator');
        return { val: isNumber(val) ? Number(val) : val, ...(operator ? { operator } : {}) };
      });
      if (list.length) filterColumns.push({ colId, customFilters: { ...(custom.attr('and') === '1' ? { and: 1 as const } : {}), customFilters: list } });
    }
  }
  const cachedFilteredOut = filterColumns.length ? [...hiddenRows].filter((r) => r > ref.startRow && r <= ref.endRow).sort((a, b) => a - b) : [];
  return { ref: { ...ref }, filterColumns, cachedFilteredOut };
}

export function autoFilterXml(p: string, filter: AutoFilter | null | undefined, original: { xml: string; filter: string } | null): string | null {
  if (!filter?.ref) return null;
  if (original && original.filter === JSON.stringify({ ...filter, cachedFilteredOut: undefined })) return original.xml;
  const ref = sqrefOf(fromRanges([filter.ref]));
  let columns = '';
  for (const column of [...(filter.filterColumns ?? [])].sort((a, b) => a.colId - b.colId)) {
    const colId = column.colId - filter.ref.startColumn;
    if (colId < 0) continue;
    if (column.filters) {
      const values = (column.filters.filters ?? []).map((v) => `<${p}filter val="${escapeAttr(String(v))}"/>`).join('');
      columns += `<${p}filterColumn colId="${colId}"><${p}filters${column.filters.blank ? ' blank="1"' : ''}>${values}</${p}filters></${p}filterColumn>`;
    } else if (column.customFilters) {
      const list = column.customFilters.customFilters
        .map((c) => `<${p}customFilter${c.operator ? ` operator="${c.operator}"` : ''} val="${escapeAttr(String(c.val))}"/>`)
        .join('');
      columns += `<${p}filterColumn colId="${colId}"><${p}customFilters${column.customFilters.and ? ' and="1"' : ''}>${list}</${p}customFilters></${p}filterColumn>`;
    }
  }
  return columns ? `<${p}autoFilter ref="${ref}">${columns}</${p}autoFilter>` : `<${p}autoFilter ref="${ref}"/>`;
}
