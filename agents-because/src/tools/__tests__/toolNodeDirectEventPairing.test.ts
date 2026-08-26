import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GraphEvents } from '@/common';
import type * as t from '@/types';
import { ChartRunRegistry } from '../ChartRunRegistry';

/**
 * Regression test for the direct/event mixed-call output misalignment bug:
 * ToolNode.run() used to build `outputs = [...directOutputs, ...eventOutputs]`
 * (grouped by execution path) and hand that, together with the *original*
 * interleaved `filteredCalls`, to index-paired downstream logic. Whenever a
 * turn mixed direct and event-driven tool calls in a non-trivial order, the
 * i-th call and the i-th output stopped referring to the same tool call.
 *
 * This mocks `safeDispatchCustomEvent` to resolve ON_TOOL_EXECUTE (the event
 * path) in a deliberately *reversed* order relative to the request — exactly
 * the kind of reordering a real async host resolving calls by completion
 * time (not submission time) could produce — and exercises the real
 * `ToolNode.run()` via `.invoke()`, not a copy of its private logic.
 */
const resolvers: Array<(payload: t.ToolExecuteBatchRequest) => void> = [];
const dispatchedToolCallIds: string[][] = [];

jest.mock('@/utils/events', () => {
  const actual = jest.requireActual('@/utils/events');
  return {
    ...actual,
    safeDispatchCustomEvent: jest.fn(
      async (event: string, payload: unknown) => {
        if (event === GraphEvents.ON_TOOL_EXECUTE) {
          const request = payload as t.ToolExecuteBatchRequest;
          dispatchedToolCallIds.push(request.toolCalls.map((call) => call.id));
          // Resolve out of request order (reversed) to simulate a host that
          // completes calls by finish time, not submission order.
          const reversed = [...request.toolCalls].reverse();
          request.resolve(
            reversed.map((call) => ({
              toolCallId: call.id,
              status: 'success' as const,
              content:
                call.name === 'echarts_generator_app'
                  ? JSON.stringify({
                      success: true,
                      charts:
                        (call.args as { charts?: unknown[] }).charts ?? [],
                    })
                  : `event-result-for-${call.id}`,
            }))
          );
        }
        return undefined;
      }
    ),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ToolNode } = require('../ToolNode');

describe('ToolNode direct/event mixed-call pairing', () => {
  beforeEach(() => {
    dispatchedToolCallIds.length = 0;
  });

  it('associates each output with its own tool_call_id, in original call order, even when direct/event calls interleave and events resolve out of order', async () => {
    const directTool = tool(
      async ({ tag }: { tag: string }) => `direct-result-for-${tag}`,
      {
        name: 'direct_tool',
        description: 'test direct tool',
        schema: z.object({ tag: z.string() }),
      }
    );

    const toolNode = new ToolNode({
      tools: [directTool],
      eventDrivenMode: true,
      directToolNames: new Set(['direct_tool']),
    });

    // Interleaved: event, direct, event — the exact shape that broke under
    // `[...directOutputs, ...eventOutputs]` concatenation.
    const toolCalls = [
      { id: 'call_e1', name: 'event_tool', args: { tag: 'e1' } },
      { id: 'call_d1', name: 'direct_tool', args: { tag: 'd1' } },
      { id: 'call_e2', name: 'event_tool', args: { tag: 'e2' } },
    ];
    const aiMessage = new AIMessage({ content: '', tool_calls: toolCalls });

    const result = (await toolNode.invoke({ messages: [aiMessage] }, {})) as {
      messages: ToolMessage[];
    };

    expect(result.messages).toHaveLength(3);

    // Order must match the original tool_calls order exactly...
    expect(result.messages.map((m) => m.tool_call_id)).toEqual([
      'call_e1',
      'call_d1',
      'call_e2',
    ]);
    // ...and each message's content must belong to *its own* call, not a
    // neighbor's (this is what silently broke under index-based pairing).
    expect(result.messages[0].content).toBe('event-result-for-call_e1');
    expect(result.messages[1].content).toBe('direct-result-for-d1');
    expect(result.messages[2].content).toBe('event-result-for-call_e2');
  });

  it('does not dispatch a model chart when server Auto already generated the same role', async () => {
    const registry = new ChartRunRegistry();
    registry.register('agent-1', 'current', {
      chartId: 'chart_1',
      role: 'indicator',
      source: 'server_auto',
    });

    const toolNode = new ToolNode({
      tools: [],
      eventDrivenMode: true,
      agentId: 'agent-1',
      chartRunRegistry: registry,
    });
    const aiMessage = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call_model_chart',
          name: 'echarts_generator_app',
          args: {
            charts: [
              {
                id: 'model_chart',
                role: 'indicator',
                type: 'line',
                data: [{ label: '当前值', value: 1 }],
                xField: 'label',
                yFields: ['value'],
              },
            ],
          },
        },
      ],
    });

    const result = (await toolNode.invoke(
      { messages: [aiMessage] },
      { configurable: { chart_config: { max_charts: 2 } } }
    )) as { messages: ToolMessage[] };

    expect(dispatchedToolCallIds).toEqual([]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].tool_call_id).toBe('call_model_chart');
    expect(JSON.parse(result.messages[0].content as string)).toMatchObject({
      success: false,
      skipped: true,
    });
  });

  it('does not dispatch a hidden model chart in event mode even when it claims auto metadata', async () => {
    const toolNode = new ToolNode({
      tools: [],
      eventDrivenMode: true,
      agentId: 'agent-1',
      chartRunRegistry: new ChartRunRegistry(),
    });
    const aiMessage = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call_fake_auto',
          name: 'echarts_generator_app',
          args: {
            charts: JSON.stringify([
              { id: 'fake', role: 'indicator', type: 'bar', title: '错误图表' },
            ]),
            _autoGenerated: 'True',
          },
        },
      ],
    });

    const result = (await toolNode.invoke(
      { messages: [aiMessage] },
      {
        configurable: {
          chart_config: { hide_from_model: true, max_charts: 1 },
        },
      }
    )) as { messages: ToolMessage[] };

    expect(dispatchedToolCallIds).toEqual([]);
    expect(JSON.parse(result.messages[0].content as string)).toMatchObject({
      success: false,
      skipped: true,
    });
  });

  it('dispatches the repeated model chart when role dedupe is disabled', async () => {
    const registry = new ChartRunRegistry();
    registry.register('agent-1', 'current', {
      chartId: 'chart_1',
      role: 'indicator',
      source: 'server_auto',
    });

    const toolNode = new ToolNode({
      tools: [],
      eventDrivenMode: true,
      agentId: 'agent-1',
      chartRunRegistry: registry,
    });
    const aiMessage = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'call_model_chart',
          name: 'echarts_generator_app',
          args: {
            charts: [{ id: 'chart_2', role: 'indicator', type: 'line' }],
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
      }
    )) as { messages: ToolMessage[] };

    expect(dispatchedToolCallIds).toEqual([['call_model_chart']]);
    expect(result.messages[0].tool_call_id).toBe('call_model_chart');
    expect(JSON.parse(result.messages[0].content as string)).toMatchObject({
      success: true,
      charts: [{ id: 'chart_2', role: 'indicator' }],
    });
  });

  it('registers successful event charts so a later batch observes max_charts', async () => {
    const registry = new ChartRunRegistry();
    const toolNode = new ToolNode({
      tools: [],
      eventDrivenMode: true,
      agentId: 'agent-1',
      chartRunRegistry: registry,
    });
    const invokeChart = (id: string) =>
      toolNode.invoke(
        {
          messages: [
            new AIMessage({
              content: '',
              tool_calls: [
                {
                  id: `call_${id}`,
                  name: 'echarts_generator_app',
                  args: {
                    charts: [{ id, role: 'indicator', type: 'line' }],
                  },
                },
              ],
            }),
          ],
        },
        { configurable: { chart_config: { max_charts: 1 } } }
      ) as Promise<{ messages: ToolMessage[] }>;

    const first = await invokeChart('chart_1');
    const second = await invokeChart('chart_2');

    expect(JSON.parse(first.messages[0].content as string).success).toBe(true);
    expect(JSON.parse(second.messages[0].content as string)).toMatchObject({
      success: false,
      skipped: true,
    });
    expect(dispatchedToolCallIds).toEqual([['call_chart_1']]);
    expect(registry.countThisTurn('agent-1', 'current')).toBe(1);
  });
});
