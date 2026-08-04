/**
 * Deterministic chartability detection + ECharts option builder.
 * JS mirror of agents-because/src/utils/autoChartFromRows.ts for API-side tests
 * and documentation alignment. Runtime injection lives in ToolNode (agents-because).
 */

const TIME_COMPARE_FIELDS = [
  'yd_value',
  'm_begin_value',
  'q_begin_value',
  'y_begin_value',
  'ly_value',
];

const TIME_COMPARE_LABELS = {
  ly_value: '上年同期',
  y_begin_value: '上年末',
  q_begin_value: '上季末',
  m_begin_value: '上月末',
  yd_value: '上一日',
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

const BAR_PALETTE = [
  '#5470c6',
  '#91cc75',
  '#fac858',
  '#ee6666',
  '#73c0de',
  '#3ba272',
  '#fc8452',
];

function isNumericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return true;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n);
  }
  return false;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, '').replace(/%$/, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function looksLikeDate(value) {
  if (value == null) {
    return false;
  }
  const s = String(value).trim();
  if (!s) {
    return false;
  }
  return (
    /^\d{4}-\d{1,2}(-\d{1,2})?$/.test(s) ||
    /^\d{8}$/.test(s) ||
    /^\d{4}\/\d{1,2}(\/\d{1,2})?$/.test(s)
  );
}

function classifyColumns(rows, columns) {
  const dimensions = [];
  const measures = [];
  const dateCols = [];
  const timeCompareCols = [];

  for (const col of columns) {
    const lower = col.toLowerCase();
    if (TIME_COMPARE_FIELDS.includes(lower) || TIME_COMPARE_FIELDS.includes(col)) {
      timeCompareCols.push(col);
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
      dimensions.push(col);
    }
  }

  return { dimensions, measures, dateCols, timeCompareCols };
}

function pickTitleHint(rows, columns) {
  const nameCols = columns.filter((c) => /name|指标|名称|index|kpi|title/i.test(c));
  for (const col of nameCols) {
    const v = rows[0]?.[col];
    if (v != null && String(v).trim()) {
      return String(v).trim();
    }
  }
  return undefined;
}

function detectChartability(rows, columns) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const cols =
    Array.isArray(columns) && columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  if (cols.length === 0) {
    return null;
  }

  const classified = classifyColumns(rows, cols);
  const titleHint = pickTitleHint(rows, cols);

  if (rows.length >= 2 && classified.dateCols.length > 0) {
    const dateCol = classified.dateCols[0];
    const distinctDates = new Set(
      rows.map((r) => String(r[dateCol] ?? '')).filter(Boolean),
    );
    if (distinctDates.size >= 2 && classified.measures.length >= 1) {
      return {
        type: 'line',
        analysisType: 'trend_analysis',
        dateCol,
        measureCols: classified.measures.slice(0, 3),
        titleHint,
      };
    }
  }

  if (rows.length >= 2) {
    for (const dim of classified.dimensions) {
      const distinct = new Set(
        rows.map((r) => String(r[dim] ?? '')).filter((v) => v !== ''),
      );
      if (distinct.size >= 2 && classified.measures.length >= 1) {
        return {
          type: 'bar',
          analysisType: 'dimension_compare',
          dimCol: dim,
          measureCols: classified.measures.slice(0, 6),
          titleHint,
        };
      }
    }
  }

  if (rows.length === 1 && classified.timeCompareCols.length >= 1) {
    const currentValueCol =
      classified.measures.find((c) => /^(value|dqz|当前值|指标值)$/i.test(c)) ??
      classified.measures[0];
    return {
      type: 'line',
      analysisType: 'trend_analysis',
      timeCompareCols: classified.timeCompareCols,
      currentValueCol,
      measureCols: currentValueCol ? [currentValueCol] : [],
      titleHint,
    };
  }

  return null;
}

function buildBarOption(rows, chartability, title) {
  const { dimCol, measureCols } = chartability;
  const categories = rows.map((r) => String(r[dimCol] ?? ''));

  if (measureCols.length === 1) {
    const m = measureCols[0];
    return {
      title: { left: 'center', text: title },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
      legend: { data: [m], top: '10%' },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '22%', containLabel: true },
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

  return {
    title: { left: 'center', text: title },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
    legend: { data: categories, top: '10%' },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '22%', containLabel: true },
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

function buildLineOption(rows, chartability, title) {
  if (chartability.timeCompareCols && chartability.timeCompareCols.length > 0) {
    const row = rows[0] ?? {};
    const ordered = TIME_COMPARE_FIELDS.filter((f) =>
      chartability.timeCompareCols.some((c) => c === f || c.toLowerCase() === f),
    );
    const colsInOrder = ordered
      .map(
        (canonical) =>
          chartability.timeCompareCols.find(
            (c) => c === canonical || c.toLowerCase() === canonical,
          ),
      )
      .filter(Boolean);

    const xData = colsInOrder.map(
      (c) => TIME_COMPARE_LABELS[c.toLowerCase()] ?? TIME_COMPARE_LABELS[c] ?? c,
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

  const dateCol = chartability.dateCol;
  const measureCols = chartability.measureCols;
  const sorted = [...rows].sort((a, b) =>
    String(a[dateCol] ?? '').localeCompare(String(b[dateCol] ?? '')),
  );
  const xData = sorted.map((r) => String(r[dateCol] ?? ''));

  return {
    title: { left: 'center', text: title },
    tooltip: { trigger: 'axis', confine: true },
    legend: { data: measureCols, left: 'right' },
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

function buildAutoChartOption(rows, chartability, title) {
  if (chartability.type === 'bar') {
    return buildBarOption(rows, chartability, title);
  }
  return buildLineOption(rows, chartability, title);
}

function buildAutoCharts(rows, columns, chartId) {
  const chartability = detectChartability(rows, columns);
  if (!chartability) {
    return null;
  }

  const baseTitle =
    chartability.titleHint || (chartability.type === 'line' ? '指标趋势图' : '指标对比图');
  const title =
    chartability.type === 'line' && !/趋势/.test(baseTitle) ? `${baseTitle}趋势图` : baseTitle;

  return [
    {
      id: chartId,
      title,
      analysisType: chartability.analysisType,
      echartsOption: buildAutoChartOption(rows, chartability, title),
    },
  ];
}

function parseJsonArrayPrefix(text) {
  const trimmed = text.trim();
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

function extractFromBecauseJn(toolName, args, content) {
  if (toolName !== 'because_jn') {
    return null;
  }
  if (args?.command !== 'sql-executor') {
    return null;
  }
  try {
    const parsed = JSON.parse(content);
    if (!parsed?.success || !Array.isArray(parsed.rows) || parsed.rows.length === 0) {
      return null;
    }
    let columns = [];
    if (Array.isArray(parsed.columns) && parsed.columns.length > 0) {
      columns = parsed.columns.map((c) =>
        typeof c === 'string' ? c : c?.name || c?.field || String(c),
      );
    } else {
      columns = Object.keys(parsed.rows[0] ?? {});
    }
    return { rows: parsed.rows, columns };
  } catch {
    return null;
  }
}

function extractFromAskData(toolName, _args, content) {
  if (!/^ask_data(_mcp_.+)?$/i.test(toolName)) {
    return null;
  }
  if (typeof content !== 'string' || !content.includes('Query Results:')) {
    return null;
  }

  const marker = 'Query Results:';
  const idx = content.lastIndexOf(marker);
  if (idx < 0) {
    return null;
  }
  const after = content.slice(idx + marker.length);
  const rows = parseJsonArrayPrefix(after);
  if (!rows || rows.length === 0) {
    return null;
  }
  if (!rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    return null;
  }
  const columns = Object.keys(rows[0] ?? {});
  return { rows, columns };
}

function extractTableFromToolOutput(toolName, args, content) {
  return (
    extractFromBecauseJn(toolName, args, content) || extractFromAskData(toolName, args, content)
  );
}

function isAutoChartTriggerTool(toolName) {
  if (toolName === 'because_jn') {
    return true;
  }
  return /^ask_data(_mcp_.+)?$/i.test(toolName);
}

function isAutoChartPipelineGloballyEnabled() {
  const raw = process.env.AUTO_CHART_PIPELINE_ENABLED;
  if (raw == null || raw === '') {
    return true;
  }
  const normalized = String(raw).trim().toLowerCase();
  return normalized !== 'false' && normalized !== '0' && normalized !== 'off';
}

module.exports = {
  TIME_COMPARE_FIELDS,
  BAR_PALETTE,
  detectChartability,
  buildAutoChartOption,
  buildAutoCharts,
  parseJsonArrayPrefix,
  extractFromBecauseJn,
  extractFromAskData,
  extractTableFromToolOutput,
  isAutoChartTriggerTool,
  isAutoChartPipelineGloballyEnabled,
};
