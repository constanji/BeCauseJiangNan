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
    dimension_compare: Required<Omit<NonNullable<ChartMatchRules['dimension_compare']>, 'bar_max_items'>> & {
        bar_max_items?: number;
    };
    baseline_compare: Required<NonNullable<ChartMatchRules['baseline_compare']>>;
};
export declare const DEFAULT_CHART_MATCH_RULES: ResolvedChartMatchRules;
export declare function resolveChartMatchRules(rules?: ChartMatchRules): ResolvedChartMatchRules;
