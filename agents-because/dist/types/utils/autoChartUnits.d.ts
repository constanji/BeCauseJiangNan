type Row = Record<string, unknown>;
/** Convert only the chart payload; query rows and answer text remain unchanged. */
export declare function normalizeAutoChartUnits(charts: unknown[], rows: Row[]): unknown[];
export {};
