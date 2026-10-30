// Charts: Excel chart parts (DrawingML c:chartSpace) <-> a small model <-> ECharts options.
//
// The file's charts are read into the model to be drawn with ECharts, and kept byte for byte
// on save unless they're deleted. Charts inserted in Folio are written as real Excel charts
// (bar, column, line, area, pie, doughnut, scatter), with cached values so other apps show
// them without recalculating.

import { type XmlElement, escapeAttr, escapeText, parseXml } from '../xlsx/xml';

export type ChartType = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter';
export type Grouping = 'clustered' | 'stacked' | 'percentStacked' | 'standard';

export type ChartSeries = {
  /** References like 'Data'!$B$1 (name), 'Data'!$A$2:$A$5 (categories or x), 'Data'!$B$2:$B$5 (values). */
  nameRef?: string;
  name?: string;
  categoriesRef?: string;
  valuesRef?: string;
  /** Values as last saved in the file, for when a reference can't be followed. */
  cache: { categories: (string | number)[]; values: (number | null)[] };
};

export type ChartModel = {
  type: ChartType | 'unsupported';
  /** What the file calls it, for charts Folio keeps but can't draw. */
  kind?: string;
  grouping: Grouping;
  title?: string;
  legend: 't' | 'b' | 'l' | 'r' | 'tr' | null;
  series: ChartSeries[];
  /** The chart part it came from (charts inserted in Folio have none until saved). */
  part?: string;
};

const PLOTS: Record<string, ChartType | undefined> = {
  barChart: 'column',
  bar3DChart: 'column',
  lineChart: 'line',
  line3DChart: 'line',
  areaChart: 'area',
  area3DChart: 'area',
  pieChart: 'pie',
  pie3DChart: 'pie',
  ofPieChart: 'pie',
  doughnutChart: 'doughnut',
  scatterChart: 'scatter',
};

function cacheValues(ref: XmlElement | undefined): (string | number)[] {
  const cache = ref?.child('strCache') ?? ref?.child('numCache');
  if (!cache) return [];
  const count = Number(cache.child('ptCount')?.attr('val') ?? 0);
  const out: (string | number)[] = Array.from({ length: count }, () => '');
  for (const pt of cache.elements('pt')) {
    const text = pt.child('v')?.text() ?? '';
    const n = Number(text);
    out[Number(pt.attr('idx') ?? 0)] = ref?.local === 'numRef' && text !== '' && Number.isFinite(n) ? n : text;
  }
  return out;
}

function richText(el: XmlElement | undefined): string | undefined {
  if (!el) return undefined;
  const parts: string[] = [];
  const walk = (node: XmlElement) => {
    for (const child of node.elements()) {
      if (child.local === 't') parts.push(child.text());
      else walk(child);
    }
  };
  walk(el);
  return parts.length ? parts.join('') : undefined;
}

export function readChart(text: string, part: string): ChartModel {
  const root = parseXml(text);
  const chart = root.child('chart');
  const plotArea = chart?.child('plotArea');
  const plot = plotArea?.elements().find((el) => el.local.endsWith('Chart'));
  const model: ChartModel = { type: 'unsupported', kind: plot?.local, grouping: 'clustered', legend: null, series: [], part };
  if (!plot) return model;
  let type = PLOTS[plot.local];
  if (type === 'column' && plot.child('barDir')?.attr('val') === 'bar') type = 'bar';
  model.type = type ?? 'unsupported';
  model.grouping = (plot.child('grouping')?.attr('val') as Grouping | undefined) ?? (type === 'line' ? 'standard' : 'clustered');
  const titleEl = chart?.child('title');
  if (titleEl && chart?.child('autoTitleDeleted')?.attr('val') !== '1') {
    model.title = richText(titleEl.child('tx')) ?? (cacheValues(titleEl.path('tx/strRef'))[0] as string | undefined);
  }
  const legendPos = chart?.child('legend')?.child('legendPos')?.attr('val');
  model.legend = chart?.child('legend') ? ((legendPos as ChartModel['legend']) ?? 'r') : null;
  for (const ser of plot.elements('ser')) {
    const tx = ser.child('tx');
    const nameRef = tx?.child('strRef');
    const cat = ser.child('cat') ?? ser.child('xVal');
    const val = ser.child('val') ?? ser.child('yVal');
    const catRef = cat?.child('strRef') ?? cat?.child('numRef');
    const valRef = val?.child('numRef');
    const values = cacheValues(valRef).map((v) => (typeof v === 'number' ? v : null));
    model.series.push({
      nameRef: nameRef?.child('f')?.text(),
      name: (cacheValues(nameRef)[0] as string | undefined) ?? tx?.child('v')?.text(),
      categoriesRef: catRef?.child('f')?.text(),
      valuesRef: valRef?.child('f')?.text(),
      cache: { categories: cacheValues(catRef ?? cat?.child('strLit') ?? cat?.child('numLit')), values },
    });
  }
  return model;
}

/** Office's default series colors (accent 1-6). */
export const COLORS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'];

/** Reads a range reference's values (a getter from the workbook); null when it can't. */
export type Resolve = (ref: string) => (string | number | null)[] | null;

/** ECharts options for a chart, with values from the workbook where they can be followed. */
export function echartsOption(model: ChartModel, resolve: Resolve, dark: boolean): Record<string, unknown> {
  const text = dark ? '#E0E0E0' : '#404040';
  const series = model.series.map((s) => {
    const values = (s.valuesRef ? resolve(s.valuesRef) : null) ?? s.cache.values;
    const categories = (s.categoriesRef ? resolve(s.categoriesRef) : null) ?? s.cache.categories;
    const name = (s.nameRef ? resolve(s.nameRef)?.[0] : undefined) ?? s.name;
    return { name: name === undefined || name === null ? undefined : String(name), values: values.map((v) => (typeof v === 'number' ? v : v === null || v === '' ? null : Number(v))), categories };
  });
  const categories = (series[0]?.categories ?? []).map((c) => (c === null ? '' : String(c)));
  const base: Record<string, unknown> = {
    animation: false,
    color: COLORS,
    textStyle: { fontFamily: 'Segoe UI Variable Text, Segoe UI, sans-serif', color: text },
    title: model.title ? { text: model.title, left: 'center', top: 6, textStyle: { fontSize: 14, fontWeight: 'normal', color: text } } : undefined,
    legend: model.legend && series.length ? { [model.legend === 'b' ? 'bottom' : model.legend === 't' ? 'top' : model.legend === 'l' ? 'left' : 'right']: model.legend === 't' && model.title ? 30 : 4, ...(model.legend === 'r' || model.legend === 'l' || model.legend === 'tr' ? { orient: 'vertical', top: 'middle' } : {}), textStyle: { color: text } } : undefined,
    tooltip: { trigger: model.type === 'pie' || model.type === 'doughnut' || model.type === 'scatter' ? 'item' : 'axis' },
  };
  const percent = model.grouping === 'percentStacked';
  const stack = model.grouping === 'stacked' || percent ? 'total' : undefined;
  const totals = percent ? categories.map((_, i) => series.reduce((sum, s) => sum + Math.abs(s.values[i] ?? 0), 0) || 1) : null;
  const scaled = (values: (number | null)[]) => (totals ? values.map((v, i) => (v === null ? null : (v / totals[i]!) * 100)) : values);
  const grid = { left: 12, right: model.legend === 'r' ? 110 : 16, top: model.title ? 40 : 16, bottom: model.legend === 'b' ? 36 : 12, containLabel: true };
  const axisLine = { lineStyle: { color: dark ? '#666' : '#BFBFBF' } };
  const split = { lineStyle: { color: dark ? '#3A3A3A' : '#E7E7E7' } };
  switch (model.type) {
    case 'column':
    case 'bar': {
      const category = { type: 'category', data: categories, axisLine, axisTick: { show: false } };
      const value = { type: 'value', splitLine: split, ...(percent ? { max: 100, axisLabel: { formatter: '{value}%' } } : {}) };
      return {
        ...base,
        grid,
        xAxis: model.type === 'column' ? category : value,
        yAxis: model.type === 'column' ? value : { ...category, inverse: true },
        series: series.map((s) => ({ type: 'bar', name: s.name, stack, data: scaled(s.values), barMaxWidth: 48 })),
      };
    }
    case 'line':
    case 'area':
      return {
        ...base,
        grid,
        xAxis: { type: 'category', data: categories, axisLine, boundaryGap: model.type === 'line' },
        yAxis: { type: 'value', splitLine: split, ...(percent ? { max: 100 } : {}) },
        series: series.map((s) => ({ type: 'line', name: s.name, stack, data: scaled(s.values), symbol: 'circle', symbolSize: 5, ...(model.type === 'area' ? { areaStyle: { opacity: 0.85 } } : {}) })),
      };
    case 'pie':
    case 'doughnut': {
      const first = series[0];
      return {
        ...base,
        series: [
          {
            type: 'pie',
            name: first?.name,
            radius: model.type === 'doughnut' ? ['45%', '70%'] : '70%',
            center: ['50%', model.title ? '55%' : '50%'],
            label: { color: text },
            data: (first?.values ?? []).map((value, i) => ({ name: categories[i] ?? String(i + 1), value: value ?? 0 })),
          },
        ],
      };
    }
    case 'scatter':
      return {
        ...base,
        grid,
        xAxis: { type: 'value', splitLine: split, axisLine },
        yAxis: { type: 'value', splitLine: split },
        series: series.map((s) => ({ type: 'scatter', name: s.name, symbolSize: 7, data: s.values.map((v, i) => [Number(s.categories[i] ?? i + 1), v]) })),
      };
    default:
      return { ...base, title: { text: 'This chart is kept as it is', subtext: model.kind ?? '', left: 'center', top: 'middle', textStyle: { fontSize: 13, color: text } } };
  }
}

// ---- Writing new charts ----------------------------------------------------------------------

const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function cache(kind: 'str' | 'num', values: (string | number | null)[]): string {
  const points = values
    .map((v, i) => (v === null || v === '' ? '' : `<c:pt idx="${i}"><c:v>${escapeText(String(v))}</c:v></c:pt>`))
    .join('');
  return `<c:${kind}Cache>${kind === 'num' ? '<c:formatCode>General</c:formatCode>' : ''}<c:ptCount val="${values.length}"/>${points}</c:${kind}Cache>`;
}

/** A complete chart part for a chart made in Folio (with the values it shows as caches). */
export function chartXml(model: ChartModel, resolve: Resolve): string {
  const series = model.series
    .map((s, i) => {
      const values = (s.valuesRef ? resolve(s.valuesRef) : null) ?? s.cache.values;
      const categories = (s.categoriesRef ? resolve(s.categoriesRef) : null) ?? s.cache.categories;
      const name = (s.nameRef ? resolve(s.nameRef)?.[0] : null) ?? s.name;
      const tx = s.nameRef ? `<c:tx><c:strRef><c:f>${escapeText(s.nameRef)}</c:f>${cache('str', [name ?? ''])}</c:strRef></c:tx>` : name ? `<c:tx><c:v>${escapeText(String(name))}</c:v></c:tx>` : '';
      const color = COLORS[i % COLORS.length]!.slice(1);
      const look =
        model.type === 'line' || model.type === 'scatter'
          ? `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>${model.type === 'scatter' ? '' : '<c:marker><c:symbol val="none"/></c:marker>'}`
          : model.type === 'pie' || model.type === 'doughnut'
            ? ''
            : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`;
      const catTag = model.type === 'scatter' ? 'xVal' : 'cat';
      const valTag = model.type === 'scatter' ? 'yVal' : 'val';
      const numericCats = categories.every((c) => typeof c === 'number');
      const cat = s.categoriesRef
        ? `<c:${catTag}><c:${numericCats ? 'num' : 'str'}Ref><c:f>${escapeText(s.categoriesRef)}</c:f>${cache(numericCats ? 'num' : 'str', categories)}</c:${numericCats ? 'num' : 'str'}Ref></c:${catTag}>`
        : '';
      const val = s.valuesRef ? `<c:${valTag}><c:numRef><c:f>${escapeText(s.valuesRef)}</c:f>${cache('num', values)}</c:numRef></c:${valTag}>` : '';
      const extra = model.type === 'line' ? '<c:smooth val="0"/>' : model.type === 'scatter' ? '<c:smooth val="0"/>' : '';
      const invert = model.type === 'column' || model.type === 'bar' ? '<c:invertIfNegative val="0"/>' : '';
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${look}${invert}${cat}${val}${extra}</c:ser>`;
    })
    .join('');
  const grouping = model.grouping === 'standard' ? 'standard' : model.grouping;
  const axes = '<c:axId val="500000001"/><c:axId val="500000002"/>';
  let plot: string;
  switch (model.type) {
    case 'column':
    case 'bar':
      plot = `<c:barChart><c:barDir val="${model.type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="${grouping === 'standard' ? 'clustered' : grouping}"/><c:varyColors val="0"/>${series}<c:gapWidth val="150"/>${grouping === 'stacked' || grouping === 'percentStacked' ? '<c:overlap val="100"/>' : ''}${axes}</c:barChart>`;
      break;
    case 'line':
      plot = `<c:lineChart><c:grouping val="${grouping === 'clustered' ? 'standard' : grouping}"/><c:varyColors val="0"/>${series}<c:marker val="1"/>${axes}</c:lineChart>`;
      break;
    case 'area':
      plot = `<c:areaChart><c:grouping val="${grouping === 'clustered' ? 'standard' : grouping}"/><c:varyColors val="0"/>${series}${axes}</c:areaChart>`;
      break;
    case 'pie':
      plot = `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`;
      break;
    case 'doughnut':
      plot = `<c:doughnutChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart>`;
      break;
    default:
      plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}${axes}</c:scatterChart>`;
  }
  const round = model.type === 'pie' || model.type === 'doughnut';
  const catAx =
    model.type === 'scatter'
      ? '<c:valAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>'
      : `<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${model.type === 'bar' ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = `<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${model.type === 'bar' ? 'b' : 'l'}"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="${model.type === 'scatter' ? 'midCat' : 'between'}"/></c:valAx>`;
  const title = model.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="0"/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${escapeText(model.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  const legend = model.legend ? `<c:legend><c:legendPos val="${escapeAttr(model.legend)}"/><c:overlay val="0"/></c:legend>` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:roundedCorners val="0"/>` +
    `<c:chart>${title}<c:plotArea><c:layout/>${plot}${round ? '' : catAx + valAx}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
  );
}

const columnLetters = (column: number) => {
  let name = '';
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

/** The grouping a chart type starts with. */
export const defaultGrouping = (type: ChartType): Grouping => (type === 'line' || type === 'area' || type === 'scatter' ? 'standard' : 'clustered');

/**
 * A chart of the selected cells, the way Excel lays one out: text in the first row names the
 * series, text in the first column labels the categories (or gives x values for scatter).
 */
export function chartFromRange(
  sheetName: string,
  range: { startRow: number; endRow: number; startColumn: number; endColumn: number },
  value: (row: number, column: number) => unknown,
  type: ChartType,
): ChartModel {
  const sheet = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  const isText = (v: unknown) => typeof v === 'string' && v.trim() !== '' && !Number.isFinite(Number(v));
  const columns: number[] = [];
  for (let c = range.startColumn; c <= range.endColumn; c++) columns.push(c);
  const header = columns.some((c) => isText(value(range.startRow, c))) && range.endRow > range.startRow;
  const first = header ? range.startRow + 1 : range.startRow;
  let labels = false;
  if (columns.length > 1) {
    for (let r = first; r <= range.endRow && !labels; r++) labels = isText(value(r, range.startColumn));
    if (type === 'scatter') labels = true;
  }
  const cell = (row: number, column: number) => `${sheet}!$${columnLetters(column)}$${row + 1}`;
  const span = (column: number) => `${cell(first, column)}:$${columnLetters(column)}$${range.endRow + 1}`;
  const series = columns
    .filter((c) => !(labels && c === range.startColumn))
    .map((c) => ({
      ...(header ? { nameRef: cell(range.startRow, c) } : {}),
      ...(labels ? { categoriesRef: span(range.startColumn) } : {}),
      valuesRef: span(c),
      cache: { categories: [], values: [] },
    }));
  return { type, grouping: defaultGrouping(type), legend: 'b', series };
}
