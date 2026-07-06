import type { EChartsChartData } from './EChartsChart';

/** Matches @ec@type:id@ec@ or @ec@id@ec@ */
const EC_MARKER_REGEX = /@ec@([^:@]+(?::[^@]+)?)@ec@/g;

export type ParsedEChartsMarker = {
  fullMatch: string;
  chartType?: string;
  chartId: string;
};

/**
 * Parse a single @ec@ marker segment.
 * @ec@line:chart_1@ec@ -> { chartType: 'line', chartId: 'chart_1' }
 * @ec@chart_1@ec@ -> { chartId: 'chart_1' }
 */
export function parseEChartsMarker(segment: string): ParsedEChartsMarker | null {
  const match = segment.match(/^@ec@([^:@]+(?::[^@]+)?)@ec@$/);
  if (!match) {
    return null;
  }

  const inner = match[1];
  const colonIdx = inner.indexOf(':');
  if (colonIdx === -1) {
    return { fullMatch: match[0], chartId: inner };
  }

  return {
    fullMatch: match[0],
    chartType: inner.slice(0, colonIdx),
    chartId: inner.slice(colonIdx + 1),
  };
}

export function hasEChartsMarkers(text: string): boolean {
  if (!text) {
    return false;
  }
  EC_MARKER_REGEX.lastIndex = 0;
  return EC_MARKER_REGEX.test(text);
}

/** Escape a value for safe embedding inside a double-quoted HTML attribute. */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Replace @ec@ markers with placeholder divs for markdown rendering.
 */
export function preprocessEChartsMarkers(text: string): string {
  if (!text) {
    return text;
  }

  EC_MARKER_REGEX.lastIndex = 0;
  return text.replace(EC_MARKER_REGEX, (_match, inner: string) => {
    const parsed = parseEChartsMarker(`@ec@${inner}@ec@`);
    const chartId = parsed?.chartId ?? inner;
    return `<div class="echarts-marker" data-chart-id="${escapeHtmlAttr(chartId)}"></div>`;
  });
}

export type EChartsToolOutput = {
  success: boolean;
  __echartsConfig: boolean;
  charts: EChartsChartData[];
};

/**
 * Parse echarts_generator_app tool output into chart configs.
 */
export function parseEChartsToolOutput(output: string): EChartsChartData[] | null {
  if (!output) {
    return null;
  }

  try {
    const parsed = JSON.parse(output) as EChartsToolOutput;
    if (
      parsed &&
      parsed.__echartsConfig === true &&
      parsed.success === true &&
      Array.isArray(parsed.charts) &&
      parsed.charts.length > 0
    ) {
      return parsed.charts;
    }
  } catch {
    // not valid JSON
  }

  return null;
}

/**
 * Build a Map<id, chartData> from all echarts_generator_app tool outputs in message content.
 */
export function buildEChartsChartsById(
  toolOutputs: string[],
): Map<string, EChartsChartData> {
  const map = new Map<string, EChartsChartData>();

  for (const output of toolOutputs) {
    const charts = parseEChartsToolOutput(output);
    if (!charts) {
      continue;
    }
    for (const chart of charts) {
      if (chart.id) {
        map.set(chart.id, chart);
      }
    }
  }

  return map;
}
