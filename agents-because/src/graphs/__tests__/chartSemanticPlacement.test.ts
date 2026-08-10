import { StandardGraph } from '../Graph';
import { Providers } from '@/common';
import type { RunnableConfig } from '@langchain/core/runnables';

/**
 * Regression test for the semantic chart-placement duplication bug:
 * ChartPlacementBufferMap.flush() deletes the buffer entry on every flush
 * (paragraph boundary), so without an explicit "already injected this turn"
 * guard, the *next* paragraph's delta re-activates buffering (the registry
 * still holds the same charts mid-turn) and re-inserts the same placeholder.
 *
 * This exercises the real `applyChartPlacementToDelta` path via
 * `dispatchMessageDelta` (private method access is intentional — the bug
 * lives entirely inside Graph's own state machine, not in a copy of it).
 */
describe('Graph semantic chart placement — no duplicate injection', () => {
  function createGraph(): StandardGraph {
    return new StandardGraph({
      agents: [
        {
          agentId: 'agent-1',
          provider: Providers.OPENAI,
          instructions: 'test',
        },
      ],
    });
  }

  function makeConfig(): RunnableConfig {
    return {
      configurable: {
        chart_config: {
          preset: 'attribution',
          placement: 'semantic',
          marker: 'result',
        },
      },
    } as unknown as RunnableConfig;
  }

  function textDelta(text: string) {
    return { content: [{ type: 'text', text }] } as const;
  }

  function countPlaceholders(text: string, chartId: string): number {
    const re = new RegExp(`@ec@[^:@]+:${chartId}@ec@`, 'g');
    return (text.match(re) ?? []).length;
  }

  it('injects the placeholder exactly once across multiple paragraph flushes in the same reply', async () => {
    const graph = createGraph();
    graph.config = makeConfig();

    graph.chartRunRegistry.register('agent-1', 'current', {
      chartId: 'chart_1',
      role: 'indicator',
      source: 'server_auto',
    });

    const stepId = 'step-1';

    // First paragraph completes (double newline) — should flush with the
    // placeholder injected exactly once.
    const first = (graph as unknown as {
      applyChartPlacementToDelta: (
        id: string,
        delta: unknown,
      ) => { content: Array<{ type: string; text: string }> } | null;
    }).applyChartPlacementToDelta(stepId, textDelta('第一段分析。\n\n'));

    expect(first).not.toBeNull();
    const firstText = first!.content[0].text;
    expect(countPlaceholders(firstText, 'chart_1')).toBe(1);

    // Second paragraph also completes with a double newline. Before the fix,
    // this would re-activate the buffer (registry unchanged) and flush again
    // with the *same* placeholder inserted a second time.
    const second = (graph as unknown as {
      applyChartPlacementToDelta: (
        id: string,
        delta: unknown,
      ) => { content: Array<{ type: string; text: string }> } | null;
    }).applyChartPlacementToDelta(stepId, textDelta('第二段分析，不应重复出现图表占位符。\n\n'));

    // Passed straight through (unbuffered) since semantic injection for this
    // stepId is already done.
    expect(second).not.toBeNull();
    const secondText = second!.content[0].text;
    expect(countPlaceholders(secondText, 'chart_1')).toBe(0);

    // Across the whole reply, the placeholder must appear exactly once.
    const totalOccurrences =
      countPlaceholders(firstText, 'chart_1') +
      countPlaceholders(secondText, 'chart_1');
    expect(totalOccurrences).toBe(1);
  });

  it('resets the done-guard on resetValues() so the next turn can inject again', () => {
    const graph = createGraph();
    graph.config = makeConfig();
    graph.chartRunRegistry.register('agent-1', 'current', {
      chartId: 'chart_1',
      role: 'indicator',
      source: 'server_auto',
    });

    const applyDelta = (id: string, text: string) =>
      (graph as unknown as {
        applyChartPlacementToDelta: (
          id: string,
          delta: unknown,
        ) => { content: Array<{ type: string; text: string }> } | null;
      }).applyChartPlacementToDelta(id, textDelta(text));

    const turn1 = applyDelta('step-1', '第一轮分析。\n\n');
    expect(countPlaceholders(turn1!.content[0].text, 'chart_1')).toBe(1);

    graph.resetValues();
    graph.config = makeConfig();
    graph.chartRunRegistry.register('agent-1', 'current', {
      chartId: 'chart_1',
      role: 'indicator',
      source: 'server_auto',
    });

    const turn2 = applyDelta('step-2', '第二轮分析。\n\n');
    expect(countPlaceholders(turn2!.content[0].text, 'chart_1')).toBe(1);
  });
});

describe('Graph chart placement — multi-agent registry scope', () => {
  function textDelta(text: string) {
    return { content: [{ type: 'text', text }] } as const;
  }

  function countPlaceholders(text: string, chartId: string): number {
    const re = new RegExp(`@ec@[^:@]+:${chartId}@ec@`, 'g');
    return (text.match(re) ?? []).length;
  }

  function applyDelta(
    graph: StandardGraph,
    id: string,
    text: string,
  ): { content: Array<{ type: string; text: string }> } | null {
    return (graph as unknown as {
      applyChartPlacementToDelta: (
        id: string,
        delta: unknown,
      ) => { content: Array<{ type: string; text: string }> } | null;
    }).applyChartPlacementToDelta(id, textDelta(text));
  }

  /** Seed contentData so getRunStep(stepId) returns the given agentId. */
  function bindStepToAgent(
    graph: StandardGraph,
    stepId: string,
    agentId: string,
  ): void {
    const index = graph.contentData.length;
    graph.contentData.push({
      id: stepId,
      index,
      stepIndex: index,
      type: 'message_creation',
      stepDetails: {
        type: 'message_creation',
        message_creation: { message_id: `msg_${stepId}` },
      },
      usage: null,
      agentId,
    } as (typeof graph.contentData)[number]);
    graph.contentIndexMap.set(stepId, index);
  }

  it('reads charts from the message step agentId, not defaultAgentId', () => {
    const graph = new StandardGraph({
      agents: [
        {
          agentId: 'agent-default',
          provider: Providers.OPENAI,
          instructions: 'default',
        },
        {
          agentId: 'agent-b',
          provider: Providers.OPENAI,
          instructions: 'secondary',
        },
      ],
    });
    graph.config = {
      configurable: {
        chart_config: {
          preset: 'custom',
          placement: 'prepend',
          marker: 'result',
        },
      },
    } as unknown as RunnableConfig;

    // Only the non-default agent registered a chart this turn.
    graph.chartRunRegistry.register('agent-b', 'current', {
      chartId: 'chart_b',
      role: 'general',
      source: 'server_auto',
    });
    // Default agent has a different chart that must NOT leak into agent-b's reply.
    graph.chartRunRegistry.register('agent-default', 'current', {
      chartId: 'chart_default',
      role: 'general',
      source: 'server_auto',
    });

    const stepId = 'step-agent-b';
    bindStepToAgent(graph, stepId, 'agent-b');

    const result = applyDelta(graph, stepId, 'agent-b 的正文');
    expect(result).not.toBeNull();
    const text = result!.content[0].text;
    expect(countPlaceholders(text, 'chart_b')).toBe(1);
    expect(countPlaceholders(text, 'chart_default')).toBe(0);
  });

  it('does not inject placeholders for model-generated charts', () => {
    const graph = new StandardGraph({
      agents: [
        {
          agentId: 'agent-default',
          provider: Providers.OPENAI,
          instructions: 'default',
        },
      ],
    });
    graph.config = {
      configurable: {
        chart_config: {
          placement: 'prepend',
          marker: 'zb',
        },
      },
    } as unknown as RunnableConfig;

    graph.chartRunRegistry.register('agent-default', 'current', {
      chartId: 'chart_manual',
      role: 'general',
      source: 'model_legacy',
    });

    const result = applyDelta(graph, 'manual-step', '模型正文');
    expect(result).not.toBeNull();
    expect(result!.content[0].text).toBe('模型正文');
  });

  it('injects only server-generated charts when sources are mixed', () => {
    const graph = new StandardGraph({
      agents: [
        {
          agentId: 'agent-default',
          provider: Providers.OPENAI,
          instructions: 'default',
        },
      ],
    });
    graph.config = {
      configurable: {
        chart_config: {
          placement: 'prepend',
          marker: 'zb',
        },
      },
    } as unknown as RunnableConfig;

    graph.chartRunRegistry.register('agent-default', 'current', {
      chartId: 'chart_manual',
      role: 'general',
      source: 'model_simple',
    });
    graph.chartRunRegistry.register('agent-default', 'current', {
      chartId: 'chart_auto',
      role: 'general',
      source: 'server_auto',
      typeHint: 'line',
    });

    const result = applyDelta(graph, 'mixed-step', '混合来源正文');
    const text = result!.content[0].text;
    expect(countPlaceholders(text, 'chart_auto')).toBe(1);
    expect(text).toContain('@ec@line:chart_auto@ec@');
    expect(countPlaceholders(text, 'chart_manual')).toBe(0);
  });

  it('falls back to defaultAgentId when the message step has no agentId', () => {
    const graph = new StandardGraph({
      agents: [
        {
          agentId: 'agent-default',
          provider: Providers.OPENAI,
          instructions: 'default',
        },
      ],
    });
    graph.config = {
      configurable: {
        chart_config: {
          placement: 'prepend',
          marker: 'result',
        },
      },
    } as unknown as RunnableConfig;

    graph.chartRunRegistry.register('agent-default', 'current', {
      chartId: 'chart_d',
      role: 'general',
      source: 'server_auto',
    });

    // No contentData entry → getRunStep returns undefined → defaultAgentId.
    const result = applyDelta(graph, 'orphan-step', '单 Agent 正文');
    expect(countPlaceholders(result!.content[0].text, 'chart_d')).toBe(1);
  });
});
