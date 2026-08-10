/**
 * Per-run chart registry owned by a Graph instance.
 * Scoped by agentId + stepId so multi-agent graphs cannot suppress each other.
 */
export type ChartRole = 'indicator' | 'contribution' | 'drag' | 'general';
export type ChartSource = 'model_legacy' | 'model_simple' | 'server_auto';
export type RegisteredChart = {
    chartId: string;
    role: ChartRole;
    source: ChartSource;
    toolCallId?: string;
    marker?: string;
    title?: string;
    typeHint?: string;
};
export declare class ChartRunRegistry {
    private charts;
    private autoGenerationKeys;
    private key;
    private scopePrefix;
    private autoKey;
    hasAutoGenerationKey(agentId: string, stepId: string, key: string): boolean;
    markAutoGenerationKey(agentId: string, stepId: string, key: string): void;
    private entriesInScope;
    /**
     * Register a chart. If chartId already exists in this (agentId, stepId)
     * scope, reassign with `_2`, `_3`, … suffixes — never silent overwrite.
     * Returns the final chartId that was stored.
     */
    register(agentId: string, stepId: string, chart: RegisteredChart): string;
    hasRole(agentId: string, stepId: string, role: ChartRole): boolean;
    hasSource(agentId: string, stepId: string, source: ChartSource): boolean;
    countThisTurn(agentId: string, stepId: string): number;
    getMissingRoles(agentId: string, stepId: string, expectedRoles: ChartRole[]): ChartRole[];
    getCharts(agentId: string, stepId: string): RegisteredChart[];
    /** Clear all scopes (called from Graph.resetValues / processStream finally). */
    clear(): void;
}
