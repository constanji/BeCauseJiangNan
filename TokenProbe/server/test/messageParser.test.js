const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeToolCall, resolveStepId, parseMessages } = require('../src/services/MessageParser');
const { analyzeChain } = require('../src/services/ChainAnalyzer');

describe('MessageParser', () => {
  it('normalizes function.arguments / output and nested command', () => {
    const n = normalizeToolCall({
      function: {
        name: 'because_skills_2',
        arguments: JSON.stringify({ command: 'fluctuation-attribution', base_data: [1] }),
        output: '{"ok":true}',
      },
    });
    assert.equal(n.name, 'because_skills_2');
    assert.equal(n.command, 'fluctuation-attribution');
    assert.equal(resolveStepId(n.name, n.command), 'tool_attribution');
  });

  it('parses Message.content tool_call parts', () => {
    const messages = [
      { isCreatedByUser: true, content: [{ type: 'text', text: '存款下降原因？' }] },
      {
        isCreatedByUser: false,
        content: [
          {
            type: 'tool_call',
            tool_call: {
              function: {
                name: 'because_skills_2',
                arguments: '{"command":"database-schema"}',
                output: '{"semantic_models":[{"table":"t1"}]}',
              },
            },
          },
          { type: 'text', text: '结论：机构 A 贡献最大' },
        ],
      },
    ];
    const parsed = parseMessages(messages);
    assert.equal(parsed.userQuestion, '存款下降原因？');
    assert.equal(parsed.toolEvents[0].stepId, 'tool_schema');
    assert.match(parsed.finalAnswer, /机构 A/);
  });
});

describe('ChainAnalyzer', () => {
  it('builds reconstructed report with methodology disclaimer', () => {
    const report = analyzeChain({
      messages: [
        { isCreatedByUser: true, text: 'hello', content: [{ type: 'text', text: 'hello' }] },
        {
          content: [
            {
              type: 'tool_call',
              tool_call: {
                name: 'sql-executor',
                args: { sql: 'SELECT 1' },
                output: { rows: [{ a: 1 }] },
              },
            },
            { type: 'text', text: 'done' },
          ],
        },
      ],
      agent: { id: 'agent_x', instructions: 'You are a data agent.', tools: ['because_skills_2'] },
      encoding: 'cl100k_base',
      meta: { source: 'test' },
    });
    assert.ok(report.summary.chainTotalTokens > 0);
    assert.match(report.methodology.summary, /重构统计/);
    assert.ok(report.steps.some((s) => s.id === 'system_prompt'));
    assert.ok(report.steps.some((s) => s.id === 'tool_sql_exec'));
  });
});
