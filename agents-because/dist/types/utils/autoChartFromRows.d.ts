/**
 * Deterministic chartability detection + ECharts option builder for the
 * server-side auto-chart pipeline (ToolNode). Rules mirror
 * echarts_generator_app description / echarts.html financial style.
 */
import type { RowRecord } from './kpiFieldDictionary';
import { type ChartMatchRules } from './autoChartRules/types';
export { TIME_COMPARE_FIELDS } from './kpiFieldDictionary';
export type { RowRecord } from './kpiFieldDictionary';
export type ChartType = 'bar' | 'line' | 'pie';
export type Chartability = {
    type: 'bar';
    analysisType: 'dimension_compare' | 'trend_analysis';
    dimCol: string;
    measureCols: string[];
    titleHint?: string;
} | {
    type: 'pie';
    analysisType: 'dimension_compare';
    dimCol: string;
    measureCol: string;
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
export type ChartMatchRuleName = 'time_series' | 'dimension_compare' | 'baseline_compare';
export type AutoChartMatchResult = {
    status: 'matched';
    rule: ChartMatchRuleName;
    chartability: Chartability;
    rows: RowRecord[];
    columns: string[];
    rowCount: number;
    categoryCount: number;
} | {
    status: 'disabled';
    rule: ChartMatchRuleName;
    rows: RowRecord[];
    columns: string[];
    rowCount: number;
    categoryCount: number;
} | {
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
/**
 * Decide whether rows should produce a chart and of which type.
 * Returns null when no chart should be generated.
 */
export declare function detectChartability(rows: RowRecord[], columns?: string[], userQuestion?: string, matchRules?: ChartMatchRules): Chartability | null;
/** Shared classifier and row preprocessor used by Simple and Legacy Auto. */
export declare function matchAutoChartData(rows: RowRecord[], columns?: string[], userQuestion?: string, matchRules?: ChartMatchRules): AutoChartMatchResult;
export declare function buildAutoChartOption(rows: RowRecord[], chartability: Chartability, title: string): Record<string, unknown>;
export declare function buildAutoCharts(rows: RowRecord[], columns: string[] | undefined, chartId: string, userQuestion?: string, matchRules?: ChartMatchRules): AutoChartItem[] | null;
export declare function parseJsonArrayPrefix(text: string): unknown[] | null;
/** Unwrap tool output that was JSON-stringified one or more times by MCP. */
export declare function unwrapJsonEncodedText(text: string): string;
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
