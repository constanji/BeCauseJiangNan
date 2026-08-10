import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ToolNode } from '../ToolNode';
import { ChartRunRegistry } from '../ChartRunRegistry';

/**
 * Integration coverage for ToolNode's chart max_charts / role-dedupe trimming
 * (private `trimChartsForRegistry` + `registerChartsFromToolOutput`), driven
 * through the real `runTool` -> `tool.invoke` path via `.invoke()` — not a
 * standalone copy of the trimming algorithm (see chartTrimLogic.test.ts,
 * which intentionally covers the pure algorithm in isolation but was flagged
 * as insufficient on its own since it never exercises the real ToolNode).
 */
describe('ToolNode chart trimming — real echarts_generator_app call path', () => {
  function makeEchartsTool() {
    // Mimics EChartsGeneratorAPP.js's observable contract: echoes back
    // whatever `charts` it was invoked with, wrapped in {success, charts}.
    return tool(
      async (params: { charts: Array<Record<string, unknown>> }) =>
        JSON.stringify({ success: true, charts: params.charts }),
      {
        name: 'echarts_generator_app',
        description: 'test echarts generator stub',
        schema: z.object({
          charts: z.array(z.record(z.string(), z.any())),
        }),
      },
    );
  }

  it('drops a chart whose role was already registered this turn, keeps the rest', async () => {
    const registry = new ChartRunRegistry();
    registry.register('agent-1', 'current', {
      chartId: 'c0',
      role: 'indicator',
      source: 'model_simple',
    });

    const toolNode = new ToolNode({
      tools: [makeEchartsTool()],
      agentId: 'agent-1',
      chartRunRegistry: registry,
    });

    const aiMessage = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call1',
          name: 'echarts_generator_app',
          args: {
            charts: [
              { id: 'dup', role: 'indicator' },
              { id: 'keep', role: 'contribution' },
            ],
          },
        },
      ],
    });

    const result = (await toolNode.invoke(
      { messages: [aiMessage] },
      { configurable: { chart_config: { max_charts: 2 } } },
    )) as { messages: ToolMessage[] };

    const parsed = JSON.parse(result.messages[0].content as string);
    expect(parsed.success).toBe(true);
    expect(parsed.charts).toHaveLength(1);
    expect(parsed.charts[0].id).toBe('keep');
    expect(parsed.charts[0].role).toBe('contribution');
  });

  it('rejects the whole call once max_charts is already reached this turn', async () => {
    const registry = new ChartRunRegistry();
    registry.register('agent-1', 'current', {
      chartId: 'c0',
      role: 'indicator',
      source: 'model_simple',
    });
    registry.register('agent-1', 'current', {
      chartId: 'c1',
      role: 'contribution',
      source: 'model_simple',
    });

    const toolNode = new ToolNode({
      tools: [makeEchartsTool()],
      agentId: 'agent-1',
      chartRunRegistry: registry,
    });

    const aiMessage = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call1',
          name: 'echarts_generator_app',
          args: { charts: [{ id: 'new', role: 'drag' }] },
        },
      ],
    });

    const result = (await toolNode.invoke(
      { messages: [aiMessage] },
      { configurable: { chart_config: { max_charts: 2 } } },
    )) as { messages: ToolMessage[] };

    const parsed = JSON.parse(result.messages[0].content as string);
    expect(parsed.success).toBe(false);
    expect(parsed.skipped).toBe(true);
  });

  it('allows multiple general-role charts within capacity without dedupe', async () => {
    const registry = new ChartRunRegistry();
    const toolNode = new ToolNode({
      tools: [makeEchartsTool()],
      agentId: 'agent-1',
      chartRunRegistry: registry,
    });

    const aiMessage = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call1',
          name: 'echarts_generator_app',
          args: {
            charts: [
              { id: 'g1', role: 'general' },
              { id: 'g2', role: 'general' },
            ],
          },
        },
      ],
    });

    const result = (await toolNode.invoke(
      { messages: [aiMessage] },
      { configurable: { chart_config: { max_charts: 5 } } },
    )) as { messages: ToolMessage[] };

    const parsed = JSON.parse(result.messages[0].content as string);
    expect(parsed.success).toBe(true);
    expect(parsed.charts).toHaveLength(2);
  });

  it('allows repeated non-general roles when role dedupe is disabled', async () => {
    const registry = new ChartRunRegistry();
    registry.register('agent-1', 'current', {
      chartId: 'existing',
      role: 'indicator',
      source: 'server_auto',
    });
    const toolNode = new ToolNode({
      tools: [makeEchartsTool()],
      agentId: 'agent-1',
      chartRunRegistry: registry,
    });
    const aiMessage = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call1',
          name: 'echarts_generator_app',
          args: {
            charts: [
              { id: 'indicator_2', role: 'indicator' },
              { id: 'indicator_3', role: 'indicator' },
            ],
          },
        },
      ],
    });

    const result = (await toolNode.invoke(
      { messages: [aiMessage] },
      {
        configurable: {
          chart_config: { max_charts: 3, dedupe_roles: false },
        },
      },
    )) as { messages: ToolMessage[] };

    const parsed = JSON.parse(result.messages[0].content as string);
    expect(parsed.success).toBe(true);
    expect(parsed.charts.map((chart: { id: string }) => chart.id)).toEqual([
      'indicator_2',
      'indicator_3',
    ]);
  });

  it('still enforces max_charts when role dedupe is disabled', async () => {
    const registry = new ChartRunRegistry();
    registry.register('agent-1', 'current', {
      chartId: 'existing',
      role: 'indicator',
      source: 'server_auto',
    });
    const toolNode = new ToolNode({
      tools: [makeEchartsTool()],
      agentId: 'agent-1',
      chartRunRegistry: registry,
    });
    const aiMessage = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call1',
          name: 'echarts_generator_app',
          args: {
            charts: [
              { id: 'indicator_2', role: 'indicator' },
              { id: 'indicator_3', role: 'indicator' },
            ],
          },
        },
      ],
    });

    const result = (await toolNode.invoke(
      { messages: [aiMessage] },
      {
        configurable: {
          chart_config: { max_charts: 2, dedupe_roles: false },
        },
      },
    )) as { messages: ToolMessage[] };

    const parsed = JSON.parse(result.messages[0].content as string);
    expect(parsed.success).toBe(true);
    expect(parsed.charts).toHaveLength(1);
    expect(parsed.charts[0].id).toBe('indicator_2');
  });
});
