// A chart over the grid: Univer places it (a "DOM drawing" that scrolls, zooms, moves and
// resizes with the sheet) and ECharts draws it from the workbook's current values.

import { CommandType, ICommandService, IUniverInstanceService, type Nullable, UniverInstanceType, type Workbook } from '@univerjs/core';
import { useDependency } from '@univerjs/ui';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { type ChartModel, type Resolve, echartsOption } from './model';

echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, SVGRenderer]);

export const CHART_COMPONENT = 'FolioChart';

/** "'My Sheet'!$A$2:$A$5" -> the cells' values in reading order, from a workbook. */
export function workbookResolver(workbook: Nullable<Workbook>): Resolve {
  return (ref) => {
    const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(ref.trim());
    if (!match || !workbook) return null;
    const sheet = workbook.getSheetBySheetName((match[1] ?? match[2]!).replace(/''/g, "'"));
    if (!sheet) return null;
    const col = (name: string) => [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const r1 = Number(match[4]) - 1;
    const c1 = col(match[3]!);
    const r2 = match[6] ? Number(match[6]) - 1 : r1;
    const c2 = match[5] ? col(match[5]) : c1;
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > 100_000) return null;
    const out: (string | number | null)[] = [];
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        const v = sheet.getCellRaw(r, c)?.v;
        out.push(v === undefined || v === null ? null : typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : String(v));
      }
    }
    return out;
  };
}

const dark = () => document.documentElement.dataset.theme === 'dark';

export function FolioChart({ data }: { data?: { chart?: ChartModel } }) {
  const instances = useDependency(IUniverInstanceService);
  const commands = useDependency(ICommandService);
  const holder = useRef<HTMLDivElement>(null);
  const model = data?.chart;

  useEffect(() => {
    const element = holder.current;
    if (!element || !model) return;
    const chart = echarts.init(element, undefined, { renderer: 'svg' });
    const draw = () => {
      const workbook = instances.getCurrentUnitOfType<Workbook>(UniverInstanceType.UNIVER_SHEET);
      chart.setOption(echartsOption(model, workbookResolver(workbook), dark()), true);
    };
    draw();
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(element);
    // Values change: draw again (once per frame at most).
    let frame = 0;
    const changes = commands.onCommandExecuted((info) => {
      if (info.type !== CommandType.MUTATION || !/range-values|insert|remove|move|worksheet-name/.test(info.id)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    });
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      cancelAnimationFrame(frame);
      changes.dispose();
      resize.disconnect();
      theme.disconnect();
      chart.dispose();
    };
  }, [model, instances, commands]);

  return <div ref={holder} className="sheets-chart" role="img" aria-label={model?.title ? `Chart: ${model.title}` : 'Chart'} />;
}
