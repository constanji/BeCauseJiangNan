import {
  hasIndexValue,
  getIndexValue,
  selectComparisonBasis,
  resolveChangeValue,
  resolveColumnName,
  type BaselineGroup,
} from '../kpiFieldDictionary';
import type { BuildChartsOptions, SimpleChartSpec } from './types';

type Row = Record<string, unknown>;

const DIM_CANDIDATES = [
  'org_name',
  'org_nm',
  'org_short_name',
  '机构名称',
  '机构',
  'dim_name',
  'name',
  'index_name',
  '指标名称',
];

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, '').replace(/%$/, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function findDim(rows: Row[]): string | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  const columns = Object.keys(rows[0] ?? {});
  for (const c of DIM_CANDIDATES) {
    const hit = columns.find((col) => col === c || col.toLowerCase() === c);
    if (!hit) {
      continue;
    }
    const distinct = new Set(
      rows.map((r) => String(r[hit] ?? '')).filter(Boolean),
    );
    if (distinct.size >= 1) {
      return hit;
    }
  }
  return undefined;
}

function pickTitle(rows: Row[]): string {
  for (const col of ['index_name', '指标名称', 'name']) {
    const v = rows[0]?.[col];
    if (v != null && String(v).trim()) {
      return String(v).trim();
    }
  }
  return '指标波动';
}

export type AttributionBuildParams = BuildChartsOptions & {
  /** Prefer these over rows when provided (from fluctuation-attribution tool_call.args). */
  base_data?: Row[];
  current_data?: Row[];
  rows?: Row[];
};

/**
 * Attribution preset: up to 3 charts — indicator / contribution / drag.
 * Data: prefer tool_call.args base_data/current_data; else sql rows.
 */
export function buildAttributionCharts(
  params: AttributionBuildParams,
): SimpleChartSpec[] {
  const maxCharts = params.maxCharts ?? 3;
  const prefix = params.chartIdPrefix ?? 'attr';
  const charts: SimpleChartSpec[] = [];

  const currentRows =
    Array.isArray(params.current_data) && params.current_data.length > 0
      ? params.current_data
      : Array.isArray(params.rows) && params.rows.length > 0
        ? params.rows
        : [];

  if (currentRows.length === 0) {
    return [];
  }

  const sample = currentRows.find((r) => hasIndexValue(r)) ?? currentRows[0];
  const group = selectComparisonBasis(params.userQuestion, sample);
  if (!group) {
    return [];
  }

  const titleBase = pickTitle(currentRows);
  const dim = findDim(currentRows) ?? 'name';

  // 1) Indicator: baseline vs current (aggregate or first row)
  const indicatorChart = buildIndicatorPair(
    sample,
    group,
    titleBase,
    `${prefix}_indicator`,
  );
  if (indicatorChart) {
    charts.push(indicatorChart);
  }

  // Per-dimension change for contribution / drag
  const scored = currentRows
    .map((row) => {
      const change = resolveChangeValue(row, group);
      const label = String(row[dim] ?? row.index_name ?? '');
      return { label, change, row };
    })
    .filter((s) => s.change != null && s.label);

  const positives = scored
    .filter((s) => (s.change as number) > 0)
    .sort((a, b) => Math.abs(b.change as number) - Math.abs(a.change as number))
    .slice(0, 5);

  const negatives = scored
    .filter((s) => (s.change as number) < 0)
    .sort((a, b) => Math.abs(b.change as number) - Math.abs(a.change as number))
    .slice(0, 5);

  if (positives.length > 0 && charts.length < maxCharts) {
    charts.push({
      id: `${prefix}_contribution`,
      role: 'contribution',
      type: 'bar',
      data: positives.map((p) => ({
        [dim]: p.label,
        change: p.change,
      })),
      xField: dim,
      yFields: ['change'],
      unit: '万元',
      title: `${titleBase}主要贡献`,
    });
  }

  if (negatives.length > 0 && charts.length < maxCharts) {
    charts.push({
      id: `${prefix}_drag`,
      role: 'drag',
      type: 'bar',
      data: negatives.map((p) => ({
        [dim]: p.label,
        change: p.change,
      })),
      xField: dim,
      yFields: ['change'],
      unit: '万元',
      title: `${titleBase}主要拖累`,
    });
  }

  return charts.slice(0, maxCharts);
}

function buildIndicatorPair(
  row: Row,
  group: BaselineGroup,
  titleBase: string,
  id: string,
): SimpleChartSpec | null {
  const baselineCol = resolveColumnName(row, group.baseline);
  const baseline = baselineCol != null ? toNumber(row[baselineCol]) : null;
  const current = getIndexValue(row);
  if (baseline == null || current == null) {
    return null;
  }
  return {
    id,
    role: 'indicator',
    type: 'line',
    style: 'trend',
    data: [
      { label: group.label, value: baseline },
      { label: '当前值', value: current },
    ],
    xField: 'label',
    yFields: ['value'],
    unit: '万元',
    title: `${titleBase}总体变化`,
  };
}
