/**
 * Deterministic chartability detection + ECharts option builder for the
 * server-side auto-chart pipeline (ToolNode). Rules mirror
 * echarts_generator_app description / echarts.html financial style.
 */
export declare const TIME_COMPARE_FIELDS: readonly ["yd_value", "m_begin_value", "q_begin_value", "y_begin_value", "ly_value"];
export type ChartType = 'bar' | 'line';
export type Chartability = {
    type: 'bar';
    analysisType: 'dimension_compare';
    dimCol: string;
    measureCols: string[];
    titleHint?: string;
} | {
    type: 'line';
    analysisType: 'trend_analysis';
    dateCol?: string;
    measureCols: string[];
    timeCompareCols?: string[];
    currentValueCol?: string;
    titleHint?: string;
};
export type RowRecord = Record<string, unknown>;
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
/**
 * Decide whether rows should produce a chart and of which type.
 * Returns null when no chart should be generated.
 */
export declare function detectChartability(rows: RowRecord[], columns?: string[]): Chartability | null;
export declare function buildAutoChartOption(rows: RowRecord[], chartability: Chartability, title: string): Record<string, unknown>;
export declare function buildAutoCharts(rows: RowRecord[], columns: string[] | undefined, chartId: string): AutoChartItem[] | null;
/** Bracket-matching JSON array parse from a text prefix starting with '['. */
export declare function parseJsonArrayPrefix(text: string): unknown[] | null;
/**
 * Extract rows/columns from because_jn sql-executor JSON output.
 */
export declare function extractFromBecauseJn(toolName: string, args: Record<string, unknown> | undefined, content: string): ExtractedTable | null;
/**
 * Extract rows from DAT MCP ask_data text that embeds `Query Results: [...]`.
 */
export declare function extractFromAskData(toolName: string, _args: Record<string, unknown> | undefined, content: string): ExtractedTable | null;
export declare function extractTableFromToolOutput(toolName: string, args: Record<string, unknown> | undefined, content: string): ExtractedTable | null;
export declare function isAutoChartTriggerTool(toolName: string): boolean;
/** Global kill switch: AUTO_CHART_PIPELINE_ENABLED=false|0 disables all agents. */
export declare function isAutoChartPipelineGloballyEnabled(): boolean;
