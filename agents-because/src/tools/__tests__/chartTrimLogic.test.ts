import { ChartRunRegistry } from '../ChartRunRegistry';
import type { ChartRole } from '../../utils/autoChartRules/types';

/**
 * Mirrors ToolNode.trimChartsForRegistry semantics for unit coverage
 * without spinning up the full LangChain ToolNode graph.
 */
function trimChartsForRegistry(
  registry: ChartRunRegistry,
  agentId: string,
  stepId: string,
  maxCharts: number,
  charts: Array<Record<string, unknown>>,
): { charts: Array<Record<string, unknown>>; rejected: boolean } {
  const remaining = maxCharts - registry.countThisTurn(agentId, stepId);
  if (remaining <= 0) {
    return { charts: [], rejected: true };
  }

  const kept: Array<Record<string, unknown>> = [];
  for (const item of charts) {
    if (kept.length >= remaining) {
      break;
    }
    const role = (item.role as ChartRole | undefined) ?? 'general';
    if (role !== 'general' && registry.hasRole(agentId, stepId, role)) {
      continue;
    }
    if (
      role !== 'general' &&
      kept.some((k) => ((k.role as ChartRole | undefined) ?? 'general') === role)
    ) {
      continue;
    }
    kept.push(item);
  }
  return { charts: kept, rejected: kept.length === 0 && charts.length > 0 };
}

describe('chartTrimLogic (ToolNode max_charts / role dedupe)', () => {
  it('rejects when max_charts already reached', () => {
    const reg = new ChartRunRegistry();
    reg.register('a', 's', {
      chartId: 'c1',
      role: 'indicator',
      source: 'server_auto',
    });
    const result = trimChartsForRegistry(reg, 'a', 's', 1, [
      { role: 'contribution', id: 'c2' },
    ]);
    expect(result.rejected).toBe(true);
    expect(result.charts).toEqual([]);
  });

  it('trims excess charts by remaining capacity', () => {
    const reg = new ChartRunRegistry();
    const result = trimChartsForRegistry(reg, 'a', 's', 2, [
      { role: 'indicator', id: 'i' },
      { role: 'contribution', id: 'c' },
      { role: 'drag', id: 'd' },
    ]);
    expect(result.charts).toHaveLength(2);
    expect(result.charts.map((c) => c.id)).toEqual(['i', 'c']);
  });

  it('skips roles already registered this turn', () => {
    const reg = new ChartRunRegistry();
    reg.register('a', 's', {
      chartId: 'old',
      role: 'indicator',
      source: 'model_simple',
    });
    const result = trimChartsForRegistry(reg, 'a', 's', 3, [
      { role: 'indicator', id: 'dup' },
      { role: 'contribution', id: 'c' },
    ]);
    expect(result.charts).toHaveLength(1);
    expect(result.charts[0].id).toBe('c');
  });

  it('skips a model chart when Auto already owns the same role', () => {
    const reg = new ChartRunRegistry();
    reg.register('a', 'current', {
      chartId: 'auto_indicator',
      role: 'indicator',
      source: 'server_auto',
    });
    const result = trimChartsForRegistry(reg, 'a', 'current', 2, [
      { role: 'indicator', id: 'model_indicator' },
      { role: 'contribution', id: 'model_contribution' },
    ]);
    expect(result.charts.map((c) => c.id)).toEqual(['model_contribution']);
  });

  it('allows multiple general roles within capacity', () => {
    const reg = new ChartRunRegistry();
    const result = trimChartsForRegistry(reg, 'a', 's', 2, [
      { role: 'general', id: 'g1' },
      { role: 'general', id: 'g2' },
    ]);
    expect(result.charts).toHaveLength(2);
  });
});
