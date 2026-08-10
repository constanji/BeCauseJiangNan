import { matchAutoChartData } from '../autoChartFromRows';
import type { BuildChartsOptions, SimpleChartSpec } from './types';

type Row = Record<string, unknown>;

function pickTitle(rows: Row[]): string {
  for (const col of [
    'standard_name',
    'index_name',
    '指标名称',
    'name',
    'kpi_name',
  ]) {
    const v = rows[0]?.[col];
    if (v != null && String(v).trim()) {
      return String(v).trim();
    }
  }
  return '指标';
}

/**
 * Indicator preset: at most one chart by default (maxCharts override).
 * Always emits simple-protocol specs (role=indicator).
 */
export function buildIndicatorCharts(
  rows: Row[],
  options: BuildChartsOptions = {},
): SimpleChartSpec[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const prefix = options.chartIdPrefix ?? 'ind';
  const columns =
    options.columns && options.columns.length > 0
      ? options.columns
      : Object.keys(rows[0] ?? {});

  const titleBase = pickTitle(rows);
  const match = matchAutoChartData(
    rows,
    columns,
    options.userQuestion,
    options.matchRules,
  );
  if (match.status !== 'matched') return [];

  const c = match.chartability;
  const xField = c.type === 'line' ? c.dateCol ?? 'label' : c.dimCol;
  const yFields = c.type === 'pie' ? [c.measureCol] : c.measureCols;
  const title =
    c.type === 'pie'
      ? `${titleBase}机构占比`
      : match.rule === 'dimension_compare'
        ? `${titleBase}对比图`
        : `${titleBase}趋势图`;

  const chart: SimpleChartSpec = {
    id: `${prefix}_${match.rule}`,
    role: 'indicator',
    type: c.type,
    style: c.type === 'pie' ? 'composition' : c.type === 'line' ? 'trend' : undefined,
    data: match.rows,
    xField,
    yFields,
    unit: '万元',
    title,
  };
  return [chart].slice(0, options.maxCharts ?? 1);
}
