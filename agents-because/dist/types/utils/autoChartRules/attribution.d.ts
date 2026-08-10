import type { BuildChartsOptions, SimpleChartSpec } from './types';
type Row = Record<string, unknown>;
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
export declare function buildAttributionCharts(params: AttributionBuildParams): SimpleChartSpec[];
export {};
