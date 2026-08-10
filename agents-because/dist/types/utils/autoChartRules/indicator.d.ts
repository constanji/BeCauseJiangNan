import type { BuildChartsOptions, SimpleChartSpec } from './types';
type Row = Record<string, unknown>;
/**
 * Indicator preset: at most one chart by default (maxCharts override).
 * Always emits simple-protocol specs (role=indicator).
 */
export declare function buildIndicatorCharts(rows: Row[], options?: BuildChartsOptions): SimpleChartSpec[];
export {};
