export type ChartRole = 'indicator' | 'contribution' | 'drag' | 'general';

/** Simple-protocol chart item consumed by echarts_generator_app (input_mode=simple). */
export type SimpleChartSpec = {
  id?: string;
  role: ChartRole;
  type: 'bar' | 'line' | 'pie';
  style?: string;
  data: Record<string, unknown>[];
  xField: string;
  yFields: string[];
  seriesField?: string;
  unit?: string;
  title: string;
};

export type BuildChartsOptions = {
  userQuestion?: string;
  maxCharts?: number;
  chartIdPrefix?: string;
  columns?: string[];
  matchRules?: ChartMatchRules;
};

export type ChartMatchRules = {
  time_series?: {
    enabled?: boolean;
    chart_type?: 'line' | 'bar';
    min_periods?: number;
    max_points?: number;
    sort?: 'time_asc' | 'time_desc';
  };
  /** @deprecated 指标自动生图不再读取问题关键词，历史配置会被忽略。 */
  composition?: Record<string, never>;
  dimension_compare?: {
    enabled?: boolean;
    chart_type?: 'pie' | 'bar';
    min_categories?: number;
    sort?: 'value_desc' | 'value_asc' | 'dimension_asc' | 'source';
    pie_top_n?: number;
    bar_max_items?: number;
  };
  baseline_compare?: {
    enabled?: boolean;
    chart_type?: 'line' | 'bar';
    min_points?: number;
    order?: 'history_to_current' | 'current_to_history';
  };
};

export type ResolvedChartMatchRules = {
  time_series: Required<Omit<NonNullable<ChartMatchRules['time_series']>, 'max_points'>> & {
    max_points?: number;
  };
  dimension_compare: Required<
    Omit<NonNullable<ChartMatchRules['dimension_compare']>, 'bar_max_items'>
  > & { bar_max_items?: number };
  baseline_compare: Required<NonNullable<ChartMatchRules['baseline_compare']>>;
};

export const DEFAULT_CHART_MATCH_RULES: ResolvedChartMatchRules = {
  time_series: {
    enabled: true,
    chart_type: 'line',
    min_periods: 2,
    max_points: undefined,
    sort: 'time_asc',
  },
  dimension_compare: {
    enabled: true,
    chart_type: 'bar',
    min_categories: 2,
    sort: 'value_desc',
    pie_top_n: 8,
    bar_max_items: undefined,
  },
  baseline_compare: {
    enabled: true,
    chart_type: 'line',
    min_points: 2,
    order: 'history_to_current',
  },
};

export function resolveChartMatchRules(rules?: ChartMatchRules): ResolvedChartMatchRules {
  return {
    time_series: { ...DEFAULT_CHART_MATCH_RULES.time_series, ...rules?.time_series },
    dimension_compare: {
      ...DEFAULT_CHART_MATCH_RULES.dimension_compare,
      ...rules?.dimension_compare,
    },
    baseline_compare: {
      ...DEFAULT_CHART_MATCH_RULES.baseline_compare,
      ...rules?.baseline_compare,
    },
  };
}
