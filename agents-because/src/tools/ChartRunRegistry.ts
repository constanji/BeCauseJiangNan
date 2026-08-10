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

export class ChartRunRegistry {
  private charts = new Map<string, RegisteredChart>();
  private autoGenerationKeys = new Set<string>();

  private key(agentId: string, stepId: string, chartId: string): string {
    return `${agentId}:${stepId}:${chartId}`;
  }

  private scopePrefix(agentId: string, stepId: string): string {
    return `${agentId}:${stepId}:`;
  }

  private autoKey(agentId: string, stepId: string, key: string): string {
    return `${agentId}:${stepId}:auto:${key}`;
  }

  hasAutoGenerationKey(agentId: string, stepId: string, key: string): boolean {
    return this.autoGenerationKeys.has(this.autoKey(agentId, stepId, key));
  }

  markAutoGenerationKey(agentId: string, stepId: string, key: string): void {
    this.autoGenerationKeys.add(this.autoKey(agentId, stepId, key));
  }

  private entriesInScope(
    agentId: string,
    stepId: string,
  ): Array<[string, RegisteredChart]> {
    const prefix = this.scopePrefix(agentId, stepId);
    const out: Array<[string, RegisteredChart]> = [];
    for (const [k, v] of this.charts) {
      if (k.startsWith(prefix)) {
        out.push([k, v]);
      }
    }
    return out;
  }

  /**
   * Register a chart. If chartId already exists in this (agentId, stepId)
   * scope, reassign with `_2`, `_3`, … suffixes — never silent overwrite.
   * Returns the final chartId that was stored.
   */
  register(
    agentId: string,
    stepId: string,
    chart: RegisteredChart,
  ): string {
    let finalId = chart.chartId;
    let suffix = 2;
    while (this.charts.has(this.key(agentId, stepId, finalId))) {
      finalId = `${chart.chartId}_${suffix}`;
      suffix += 1;
    }
    const stored: RegisteredChart = { ...chart, chartId: finalId };
    this.charts.set(this.key(agentId, stepId, finalId), stored);
    return finalId;
  }

  hasRole(agentId: string, stepId: string, role: ChartRole): boolean {
    return this.entriesInScope(agentId, stepId).some(([, c]) => c.role === role);
  }

  hasSource(agentId: string, stepId: string, source: ChartSource): boolean {
    return this.entriesInScope(agentId, stepId).some(([, c]) => c.source === source);
  }

  countThisTurn(agentId: string, stepId: string): number {
    return this.entriesInScope(agentId, stepId).length;
  }

  getMissingRoles(
    agentId: string,
    stepId: string,
    expectedRoles: ChartRole[],
  ): ChartRole[] {
    const present = new Set(
      this.entriesInScope(agentId, stepId).map(([, c]) => c.role),
    );
    return expectedRoles.filter((r) => !present.has(r));
  }

  getCharts(agentId: string, stepId: string): RegisteredChart[] {
    return this.entriesInScope(agentId, stepId).map(([, c]) => c);
  }

  /** Clear all scopes (called from Graph.resetValues / processStream finally). */
  clear(): void {
    this.charts.clear();
    this.autoGenerationKeys.clear();
  }
}
