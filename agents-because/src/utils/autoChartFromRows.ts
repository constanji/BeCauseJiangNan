/**
 * Deterministic chartability detection + ECharts option builder for the
 * server-side auto-chart pipeline (ToolNode). Rules mirror
 * echarts_generator_app description / echarts.html financial style.
 */

import {
  TIME_COMPARE_FIELDS,
  BASELINE_GROUPS,
  INDEX_VALUE_FIELD,
  isBlacklistedNumericField,
  isBaselineField,
  isIndexValueField,
} from './kpiFieldDictionary';
import type { RowRecord } from './kpiFieldDictionary';
import {
  resolveChartMatchRules,
  type ChartMatchRules,
} from './autoChartRules/types';

export { TIME_COMPARE_FIELDS } from './kpiFieldDictionary';
export type { RowRecord } from './kpiFieldDictionary';

const TIME_COMPARE_LABELS: Record<string, string> = {
  ly_value: '上年同期',
  y_begin_value: '上年末',
  q_begin_value: '上季末',
  m_begin_value: '上月末',
  yd_value: '上一日',
  [INDEX_VALUE_FIELD]: '当前值',
  value: '当前值',
};

const DATE_FIELD_CANDIDATES = new Set([
  'data_dt',
  'date',
  'dt',
  'biz_date',
  'data_date',
  'stat_dt',
  '数据日期',
  '日期',
  '时间',
  '时间维度',
]);

const DIMENSION_FIELD_PRIORITY = [
  'brchna',
  'brch_name',
  'branch_name',
  'org_name',
  'org_nm',
  'org_short_name',
  '机构名称',
  '机构',
  'standard_name',
  'index_name',
  'kpi_name',
  '指标名称',
  'index_number',
  '指标编码',
  '指标号',
  'dim_name',
  'name',
  'org_code',
  'brchno',
  '机构号',
];

const INSTITUTION_DIMENSION_FIELDS = new Set([
  'brchna',
  'brch_name',
  'branch_name',
  'org_name',
  'org_nm',
  'org_short_name',
  '机构名称',
  '机构',
  'org_code',
  'brchno',
  '机构号',
]);

const METRIC_DIMENSION_FIELDS = new Set([
  'index_number',
  'standard_name',
  'index_name',
  'kpi_name',
  '指标名称',
  '指标编码',
  '指标号',
]);

const BAR_PALETTE = [
  '#5470c6',
  '#91cc75',
  '#fac858',
  '#ee6666',
  '#73c0de',
  '#3ba272',
  '#fc8452',
];

export type ChartType = 'bar' | 'line' | 'pie';

export type Chartability =
  | {
      type: 'bar';
      analysisType: 'dimension_compare' | 'trend_analysis';
      dimCol: string;
      measureCols: string[];
      titleHint?: string;
    }
  | {
      type: 'pie';
      analysisType: 'dimension_compare';
      dimCol: string;
      measureCol: string;
      titleHint?: string;
    }
  | {
      type: 'line';
      analysisType: 'trend_analysis';
      dateCol?: string;
      measureCols: string[];
      timeCompareCols?: string[];
      currentValueCol?: string;
      titleHint?: string;
    };

export type ChartMatchRuleName =
  | 'time_series'
  | 'dimension_compare'
  | 'baseline_compare';

export type AutoChartMatchResult =
  | {
      status: 'matched';
      rule: ChartMatchRuleName;
      chartability: Chartability;
      rows: RowRecord[];
      columns: string[];
      rowCount: number;
      categoryCount: number;
    }
  | {
      status: 'disabled';
      rule: ChartMatchRuleName;
      rows: RowRecord[];
      columns: string[];
      rowCount: number;
      categoryCount: number;
    }
  | {
      status: 'no_match';
      rows: RowRecord[];
      columns: string[];
      rowCount: number;
      categoryCount: number;
    };

export type ExtractedTable = {
  rows: RowRecord[];
  columns: string[];
};

export type AutoChartItem = {
  id: string;
  title: string;
  analysisType: string;
  echartsOption: Record<string, unknown>;
};

function isNumericValue(value: unknown): boolean {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return true;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n);
  }
  return false;
}

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

function looksLikeDate(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  const s = String(value).trim();
  if (!s) {
    return false;
  }
  // YYYY-MM-DD / YYYYMMDD / YYYY-MM / YYYY/MM/DD
  return (
    /^\d{4}-\d{1,2}(-\d{1,2})?$/.test(s) ||
    /^\d{8}$/.test(s) ||
    /^\d{4}\/\d{1,2}(\/\d{1,2})?$/.test(s)
  );
}

function classifyColumns(rows: RowRecord[], columns: string[]) {
  const dimensions: string[] = [];
  const measures: string[] = [];
  const dateCols: string[] = [];
  const timeCompareCols: string[] = [];
  let indexValueCol: string | undefined;

  for (const col of columns) {
    const lower = col.toLowerCase();

    if (isBlacklistedNumericField(col)) {
      continue;
    }

    if (isIndexValueField(col)) {
      indexValueCol = col;
      measures.push(col);
      continue;
    }

    if (isBaselineField(col)) {
      // Only baseline *value* columns participate in time-compare sparklines
      if ((TIME_COMPARE_FIELDS as readonly string[]).includes(lower)) {
        timeCompareCols.push(col);
      }
      continue;
    }

    if (DATE_FIELD_CANDIDATES.has(lower) || DATE_FIELD_CANDIDATES.has(col)) {
      dateCols.push(col);
      continue;
    }

    const sample = rows
      .map((r) => r[col])
      .filter((v) => v != null && String(v).trim() !== '');
    if (sample.length === 0) {
      continue;
    }

    const numericCount = sample.filter(isNumericValue).length;
    const dateCount = sample.filter(looksLikeDate).length;

    if (dateCount >= Math.ceil(sample.length * 0.7)) {
      dateCols.push(col);
    } else if (numericCount >= Math.ceil(sample.length * 0.7)) {
      measures.push(col);
    } else {
      const isKnownDimension =
        INSTITUTION_DIMENSION_FIELDS.has(lower) ||
        INSTITUTION_DIMENSION_FIELDS.has(col) ||
        METRIC_DIMENSION_FIELDS.has(lower) ||
        METRIC_DIMENSION_FIELDS.has(col);
      if (isKnownDimension) {
        dimensions.push(col);
      }
    }
  }

  return { dimensions, measures, dateCols, timeCompareCols, indexValueCol };
}

function pickTitleHint(
  rows: RowRecord[],
  columns: string[]
): string | undefined {
  const preferred = [
    'standard_name',
    'index_name',
    'kpi_name',
    '指标名称',
    '名称',
    'title',
  ];
  const nameCols = [
    ...preferred.flatMap((candidate) =>
      columns.filter(
        (column) => column === candidate || column.toLowerCase() === candidate
      )
    ),
    ...columns.filter(
      (column) =>
        /name|指标|名称|kpi|title/i.test(column) &&
        !/code|number|编号|编码/i.test(column)
    ),
  ];
  for (const col of nameCols) {
    const v = rows[0]?.[col];
    if (v != null && String(v).trim()) {
      return String(v).trim();
    }
  }
  return undefined;
}

function orderedDimensionFields(dimensions: string[]): string[] {
  const priority = new Map(
    DIMENSION_FIELD_PRIORITY.map((field, index) => [field.toLowerCase(), index])
  );
  return [...dimensions].sort((a, b) => {
    const aRank = priority.get(a.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const bRank = priority.get(b.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

/**
 * Decide whether rows should produce a chart and of which type.
 * Returns null when no chart should be generated.
 */
export function detectChartability(
  rows: RowRecord[],
  columns?: string[],
  userQuestion?: string,
  matchRules?: ChartMatchRules
): Chartability | null {
  const result = matchAutoChartData(rows, columns, userQuestion, matchRules);
  return result.status === 'matched' ? result.chartability : null;
}

function sortRows(
  rows: RowRecord[],
  field: string,
  mode: 'value_desc' | 'value_asc' | 'dimension_asc' | 'source'
): RowRecord[] {
  if (mode === 'source') {
    return [...rows];
  }
  return [...rows].sort((a, b) => {
    if (mode === 'dimension_asc') {
      return String(a[field] ?? '').localeCompare(String(b[field] ?? ''));
    }
    const av = toNumber(a[field]) ?? 0;
    const bv = toNumber(b[field]) ?? 0;
    return mode === 'value_asc' ? av - bv : bv - av;
  });
}

function sortableDateValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .slice(0, 6)
      .map((part) => String(part ?? '').padStart(2, '0'))
      .join('-');
  }
  return String(value ?? '');
}

function hasDimensionValue(value: unknown): boolean {
  return value != null && String(value).trim() !== '';
}

function hasFiniteMeasures(row: RowRecord, fields: string[]): boolean {
  return (
    fields.length > 0 && fields.every((field) => toNumber(row[field]) != null)
  );
}

function preparePieRows(
  rows: RowRecord[],
  dimCol: string,
  measureCol: string,
  topN: number,
  sort: 'value_desc' | 'value_asc' | 'dimension_asc' | 'source'
): RowRecord[] {
  const sorted = sortRows(
    rows,
    sort === 'dimension_asc' ? dimCol : measureCol,
    sort
  );
  if (sorted.length <= topN) {
    return sorted;
  }
  const head = sorted.slice(0, topN);
  const otherValue = sorted
    .slice(topN)
    .reduce((sum, row) => sum + (toNumber(row[measureCol]) ?? 0), 0);
  return [...head, { [dimCol]: '其他', [measureCol]: otherValue }];
}

/** Shared classifier and row preprocessor used by Simple and Legacy Auto. */
export function matchAutoChartData(
  rows: RowRecord[],
  columns?: string[],
  userQuestion?: string,
  matchRules?: ChartMatchRules
): AutoChartMatchResult {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      status: 'no_match',
      rows: [],
      columns: [],
      rowCount: 0,
      categoryCount: 0,
    };
  }

  const cols =
    Array.isArray(columns) && columns.length > 0
      ? columns
      : Object.keys(rows[0] ?? {});
  if (cols.length === 0) {
    return {
      status: 'no_match',
      rows,
      columns: [],
      rowCount: rows.length,
      categoryCount: 0,
    };
  }

  const classified = classifyColumns(rows, cols);
  const titleHint = pickTitleHint(rows, cols);
  const rules = resolveChartMatchRules(matchRules);

  // Prefer explicit index_value as the sole measure when present (all Agents).
  const preferredMeasures = classified.indexValueCol
    ? [classified.indexValueCol]
    : classified.measures.filter((c) => !isBaselineField(c));
  const trendMeasures = preferredMeasures.slice(0, 3);

  // Priority 1: multi-period date trend.
  if (rows.length >= 2 && classified.dateCols.length > 0) {
    const dateCol = classified.dateCols[0];
    const validTrendRows = rows.filter(
      (row) =>
        hasDimensionValue(row[dateCol]) && hasFiniteMeasures(row, trendMeasures)
    );
    const distinctDates = new Set(
      validTrendRows.map((r) => sortableDateValue(r[dateCol])).filter(Boolean)
    );
    if (
      distinctDates.size >= rules.time_series.min_periods &&
      preferredMeasures.length >= 1
    ) {
      if (!rules.time_series.enabled) {
        return {
          status: 'disabled',
          rule: 'time_series',
          rows: validTrendRows,
          columns: cols,
          rowCount: validTrendRows.length,
          categoryCount: distinctDates.size,
        };
      }
      let prepared = [...validTrendRows].sort((a, b) =>
        sortableDateValue(a[dateCol]).localeCompare(
          sortableDateValue(b[dateCol])
        )
      );
      if (rules.time_series.sort === 'time_desc') prepared.reverse();
      if (rules.time_series.max_points)
        prepared = prepared.slice(0, rules.time_series.max_points);
      const type = rules.time_series.chart_type;
      return {
        status: 'matched',
        rule: 'time_series',
        rows: prepared,
        columns: cols,
        rowCount: validTrendRows.length,
        categoryCount: distinctDates.size,
        chartability:
          type === 'bar'
            ? {
                type: 'bar',
                analysisType: 'trend_analysis',
                dimCol: dateCol,
                measureCols: trendMeasures,
                titleHint,
              }
            : {
                type: 'line',
                analysisType: 'trend_analysis',
                dateCol,
                measureCols: trendMeasures,
                titleHint,
              },
      };
    }
  }

  // Only institution and metric dimensions are valid for KPI comparisons.
  const comparisonMeasure = preferredMeasures[0];
  let dimension: string | undefined;
  let categoryCount = 0;
  for (const dim of orderedDimensionFields(classified.dimensions)) {
    const distinct = new Set(
      rows
        .filter(
          (row) =>
            hasDimensionValue(row[dim]) &&
            comparisonMeasure != null &&
            toNumber(row[comparisonMeasure]) != null
        )
        .map((r) => String(r[dim]).trim())
    );
    if (distinct.size > categoryCount) {
      dimension = dim;
      categoryCount = distinct.size;
    }
    if (distinct.size >= 2) break;
  }

  // Priority 2: multi-institution or multi-metric comparison (bar by default).
  if (
    rows.length >= 2 &&
    comparisonMeasure &&
    dimension &&
    categoryCount >= rules.dimension_compare.min_categories
  ) {
    const validComparisonRows = rows.filter(
      (row) =>
        hasDimensionValue(row[dimension!]) &&
        hasFiniteMeasures(
          row,
          rules.dimension_compare.chart_type === 'bar'
            ? preferredMeasures.slice(0, 6)
            : [comparisonMeasure]
        )
    );
    const validCategoryCount = new Set(
      validComparisonRows.map((row) => String(row[dimension!]).trim())
    ).size;
    if (validCategoryCount < rules.dimension_compare.min_categories) {
      return {
        status: 'no_match',
        rows: validComparisonRows,
        columns: cols,
        rowCount: validComparisonRows.length,
        categoryCount: validCategoryCount,
      };
    }
    if (!rules.dimension_compare.enabled) {
      return {
        status: 'disabled',
        rule: 'dimension_compare',
        rows: validComparisonRows,
        columns: cols,
        rowCount: validComparisonRows.length,
        categoryCount: validCategoryCount,
      };
    }
    const measure = comparisonMeasure;
    const type = rules.dimension_compare.chart_type;
    let prepared =
      type === 'pie'
        ? preparePieRows(
            validComparisonRows,
            dimension,
            measure,
            rules.dimension_compare.pie_top_n,
            rules.dimension_compare.sort
          )
        : sortRows(
            validComparisonRows,
            rules.dimension_compare.sort === 'dimension_asc'
              ? dimension
              : measure,
            rules.dimension_compare.sort
          );
    if (type === 'bar' && rules.dimension_compare.bar_max_items) {
      prepared = prepared.slice(0, rules.dimension_compare.bar_max_items);
    }
    return {
      status: 'matched',
      rule: 'dimension_compare',
      rows: prepared,
      columns: cols,
      rowCount: validComparisonRows.length,
      categoryCount: validCategoryCount,
      chartability:
        type === 'bar'
          ? {
              type: 'bar',
              analysisType: 'dimension_compare',
              dimCol: dimension,
              measureCols: preferredMeasures.slice(0, 6),
              titleHint,
            }
          : {
              type: 'pie',
              analysisType: 'dimension_compare',
              dimCol: dimension,
              measureCol: measure,
              titleHint,
            },
    };
  }

  // Priority 4: one row with baseline fields.
  if (rows.length === 1 && classified.timeCompareCols.length >= 1) {
    const currentValueCol = classified.indexValueCol;
    if (!currentValueCol) {
      return {
        status: 'no_match',
        rows,
        columns: cols,
        rowCount: 1,
        categoryCount: 0,
      };
    }
    const baselinePoints = BASELINE_GROUPS.map((group) =>
      classified.timeCompareCols.find(
        (c) => c === group.baseline || c.toLowerCase() === group.baseline
      )
    ).filter(
      (c): c is string => Boolean(c) && toNumber(rows[0][c as string]) != null
    );
    if (toNumber(rows[0][currentValueCol]) == null) {
      return {
        status: 'no_match',
        rows,
        columns: cols,
        rowCount: 1,
        categoryCount: baselinePoints.length,
      };
    }
    const pointCount = baselinePoints.length + 1;
    if (pointCount < rules.baseline_compare.min_points) {
      return {
        status: 'no_match',
        rows,
        columns: cols,
        rowCount: 1,
        categoryCount: pointCount,
      };
    }
    if (!rules.baseline_compare.enabled) {
      return {
        status: 'disabled',
        rule: 'baseline_compare',
        rows,
        columns: cols,
        rowCount: 1,
        categoryCount: pointCount,
      };
    }
    let pointRows: RowRecord[] = baselinePoints.map((c) => ({
      label: TIME_COMPARE_LABELS[c.toLowerCase()] ?? c,
      value: toNumber(rows[0][c]),
    }));
    pointRows.push({
      label: '当前值',
      value: toNumber(rows[0][currentValueCol]),
    });
    if (rules.baseline_compare.order === 'current_to_history')
      pointRows = pointRows.reverse();
    const type = rules.baseline_compare.chart_type;
    return {
      status: 'matched',
      rule: 'baseline_compare',
      rows: pointRows,
      columns: ['label', 'value'],
      rowCount: 1,
      categoryCount: pointCount,
      chartability:
        type === 'bar'
          ? {
              type: 'bar',
              analysisType: 'trend_analysis',
              dimCol: 'label',
              measureCols: ['value'],
              titleHint,
            }
          : {
              type: 'line',
              analysisType: 'trend_analysis',
              dateCol: 'label',
              measureCols: ['value'],
              timeCompareCols: baselinePoints,
              currentValueCol,
              titleHint,
            },
    };
  }

  return {
    status: 'no_match',
    rows,
    columns: cols,
    rowCount: rows.length,
    categoryCount,
  };
}

function buildPieOption(
  rows: RowRecord[],
  chartability: Extract<Chartability, { type: 'pie' }>,
  title: string
): Record<string, unknown> {
  const { dimCol, measureCol } = chartability;
  return {
    title: { left: 'center', text: title },
    tooltip: { trigger: 'item', confine: true },
    legend: { orient: 'vertical', left: 'left', top: '15%' },
    series: [
      {
        name: title,
        type: 'pie',
        radius: '55%',
        center: ['50%', '55%'],
        data: rows.map((row) => ({
          name: String(row[dimCol] ?? ''),
          value: toNumber(row[measureCol]),
        })),
      },
    ],
  };
}

function buildBarOption(
  rows: RowRecord[],
  chartability: Extract<Chartability, { type: 'bar' }>,
  title: string
): Record<string, unknown> {
  const { dimCol, measureCols } = chartability;
  const categories = rows.map((r) => String(r[dimCol] ?? ''));

  // Single measure: one series, x = dimension values
  if (measureCols.length === 1) {
    const m = measureCols[0];
    return {
      title: { left: 'center', text: title },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        confine: true,
      },
      legend: { data: [m], top: '10%' },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '22%',
        containLabel: true,
      },
      xAxis: { type: 'category', data: categories },
      yAxis: { type: 'value', name: '数值' },
      series: [
        {
          name: m,
          type: 'bar',
          data: rows.map((r) => toNumber(r[m])),
          itemStyle: { color: BAR_PALETTE[0] },
        },
      ],
    };
  }

  // Multi measure: x = measure names, series = each dimension row (org)
  return {
    title: { left: 'center', text: title },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      confine: true,
    },
    legend: { data: categories, top: '10%' },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '22%',
      containLabel: true,
    },
    xAxis: { type: 'category', data: measureCols },
    yAxis: { type: 'value', name: '数值' },
    series: rows.map((row, i) => ({
      name: String(row[dimCol] ?? `系列${i + 1}`),
      type: 'bar',
      data: measureCols.map((m) => toNumber(row[m])),
      itemStyle: { color: BAR_PALETTE[i % BAR_PALETTE.length] },
    })),
  };
}

function buildLineOption(
  rows: RowRecord[],
  chartability: Extract<Chartability, { type: 'line' }>,
  title: string
): Record<string, unknown> {
  // Single-row time-compare sparkline
  if (
    chartability.timeCompareCols &&
    chartability.timeCompareCols.length > 0 &&
    rows[0]?.[chartability.timeCompareCols[0]] != null
  ) {
    const row = rows[0] ?? {};
    // Display order: 上年同期 → 上年末 → 上季末 → 上月末 → 上一日
    const orderedCanonical = BASELINE_GROUPS.map((g) => g.baseline);
    const colsInOrder = orderedCanonical
      .map((canonical) =>
        chartability.timeCompareCols!.find(
          (c) => c === canonical || c.toLowerCase() === canonical
        )
      )
      .filter((c): c is string => Boolean(c));

    const xData = colsInOrder.map(
      (c) => TIME_COMPARE_LABELS[c.toLowerCase()] ?? TIME_COMPARE_LABELS[c] ?? c
    );
    const yData = colsInOrder.map((c) => toNumber(row[c]));

    if (chartability.currentValueCol) {
      xData.push('当前值');
      yData.push(toNumber(row[chartability.currentValueCol]));
    }

    const seriesName = chartability.titleHint || title;
    return {
      title: { left: 'center', text: title },
      tooltip: { trigger: 'axis', confine: true },
      legend: { data: [seriesName], left: 'right' },
      grid: { left: '3%', bottom: '3%', right: '4%', containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        axisLabel: { rotate: 45 },
        data: xData,
      },
      yAxis: { type: 'value', name: '数值' },
      series: [
        {
          name: seriesName,
          type: 'line',
          data: yData,
          markPoint: { data: [{ type: 'max' }, { type: 'min' }] },
          markLine: { data: [{ type: 'average' }] },
        },
      ],
    };
  }

  // Multi-row date trend
  const dateCol = chartability.dateCol!;
  const measureCols = chartability.measureCols;
  const sorted = [...rows].sort((a, b) =>
    String(a[dateCol] ?? '').localeCompare(String(b[dateCol] ?? ''))
  );
  const xData = sorted.map((r) => String(r[dateCol] ?? ''));

  return {
    title: { left: 'center', text: title },
    tooltip: { trigger: 'axis', confine: true },
    legend: {
      data: measureCols,
      left: 'right',
    },
    grid: { left: '3%', bottom: '3%', right: '4%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      axisLabel: { rotate: 45 },
      data: xData,
    },
    yAxis: { type: 'value', name: '数值' },
    series: measureCols.map((m) => ({
      name: m,
      type: 'line',
      data: sorted.map((r) => toNumber(r[m])),
      markPoint: { data: [{ type: 'max' }, { type: 'min' }] },
      markLine: { data: [{ type: 'average' }] },
    })),
  };
}

export function buildAutoChartOption(
  rows: RowRecord[],
  chartability: Chartability,
  title: string
): Record<string, unknown> {
  if (chartability.type === 'bar') {
    return buildBarOption(rows, chartability, title);
  }
  if (chartability.type === 'pie') {
    return buildPieOption(rows, chartability, title);
  }
  return buildLineOption(rows, chartability, title);
}

export function buildAutoCharts(
  rows: RowRecord[],
  columns: string[] | undefined,
  chartId: string,
  userQuestion?: string,
  matchRules?: ChartMatchRules
): AutoChartItem[] | null {
  const match = matchAutoChartData(rows, columns, userQuestion, matchRules);
  if (match.status !== 'matched') {
    return null;
  }
  const chartability = match.chartability;

  const baseTitle =
    chartability.titleHint ||
    (chartability.type === 'line'
      ? '指标趋势图'
      : chartability.type === 'pie'
        ? '指标机构占比'
        : '指标对比图');
  const title =
    chartability.type === 'line' && !/趋势/.test(baseTitle)
      ? `${baseTitle}趋势图`
      : baseTitle;

  return [
    {
      id: chartId,
      title,
      analysisType: chartability.analysisType,
      echartsOption: buildAutoChartOption(match.rows, chartability, title),
    },
  ];
}

/** Bracket-matching JSON array parse from a text prefix starting with '['. */
function parseJsonArrayPrefixOnce(trimmed: string): unknown[] | null {
  if (!trimmed.startsWith('[')) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(trimmed.slice(0, i + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseJsonArrayPrefix(text: string): unknown[] | null {
  const trimmed = text.trim();
  const direct = parseJsonArrayPrefixOnce(trimmed);
  if (direct) {
    return direct;
  }

  // Some DAT MCP transports remove the outer JSON-string quotes but leave
  // object field quotes escaped: [{\"field\":\"value\"}]. Only apply this
  // fallback to that recognizable shape so valid JSON string escapes remain
  // untouched on the normal path.
  if (/^\[\s*\{\s*\\"/.test(trimmed)) {
    return parseJsonArrayPrefixOnce(trimmed.replace(/\\"/g, '"'));
  }
  return null;
}

/** Unwrap tool output that was JSON-stringified one or more times by MCP. */
export function unwrapJsonEncodedText(text: string): string {
  let current = String(text ?? '').trim();
  for (let depth = 0; depth < 2; depth++) {
    if (!current.startsWith('"')) {
      break;
    }
    try {
      const parsed = JSON.parse(current);
      if (typeof parsed !== 'string') {
        break;
      }
      current = parsed.trim();
    } catch {
      break;
    }
  }
  return current;
}

/**
 * Extract rows/columns from because_jn sql-executor JSON output.
 */
export function extractFromBecauseJn(
  toolName: string,
  args: Record<string, unknown> | undefined,
  content: string
): ExtractedTable | null {
  if (toolName !== 'because_jn') {
    return null;
  }
  if (args?.command !== 'sql-executor') {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as {
      success?: boolean;
      rows?: RowRecord[];
      columns?: string[] | Array<{ name?: string; field?: string }>;
    };
    if (
      !parsed?.success ||
      !Array.isArray(parsed.rows) ||
      parsed.rows.length === 0
    ) {
      return null;
    }
    let columns: string[] = [];
    if (Array.isArray(parsed.columns) && parsed.columns.length > 0) {
      columns = parsed.columns.map((c) =>
        typeof c === 'string' ? c : c?.name || c?.field || String(c)
      );
    } else {
      columns = Object.keys(parsed.rows[0] ?? {});
    }
    return { rows: parsed.rows, columns };
  } catch {
    return null;
  }
}

/**
 * Extract rows from DAT MCP ask_data text that embeds `Query Results: [...]`.
 */
export function extractFromAskData(
  toolName: string,
  _args: Record<string, unknown> | undefined,
  content: string
): ExtractedTable | null {
  if (!/^ask_data(_mcp_.+)?$/i.test(toolName)) {
    return null;
  }
  if (typeof content !== 'string') {
    return null;
  }

  const normalizedContent = unwrapJsonEncodedText(content);
  if (!normalizedContent.includes('Query Results:')) {
    return null;
  }

  const marker = 'Query Results:';
  const idx = normalizedContent.lastIndexOf(marker);
  if (idx < 0) {
    return null;
  }
  const after = normalizedContent.slice(idx + marker.length);
  const rows = parseJsonArrayPrefix(after) as RowRecord[] | null;
  if (!rows || rows.length === 0) {
    return null;
  }
  if (!rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    return null;
  }
  const columns = Object.keys(rows[0] ?? {});
  return { rows, columns };
}

export function extractTableFromToolOutput(
  toolName: string,
  args: Record<string, unknown> | undefined,
  content: string
): ExtractedTable | null {
  return (
    extractFromBecauseJn(toolName, args, content) ??
    extractFromAskData(toolName, args, content)
  );
}

export function isAutoChartTriggerTool(toolName: string): boolean {
  if (toolName === 'because_jn') {
    return true;
  }
  return /^ask_data(_mcp_.+)?$/i.test(toolName);
}

/** Global kill switch: AUTO_CHART_PIPELINE_ENABLED=false|0 disables all agents. */
export function isAutoChartPipelineGloballyEnabled(): boolean {
  const raw = process.env.AUTO_CHART_PIPELINE_ENABLED;
  if (raw == null || raw === '') {
    return true;
  }
  const normalized = String(raw).trim().toLowerCase();
  return normalized !== 'false' && normalized !== '0' && normalized !== 'off';
}
