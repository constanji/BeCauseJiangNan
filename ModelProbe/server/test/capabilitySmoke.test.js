const test = require('node:test');
const assert = require('node:assert/strict');
const { FORMAT_CASES, TOOL_CASES, BECAUSE_CASES, MOCK_TOOLS } = require('../src/lib/capabilityFixtures');
const { BECAUSE_SUITE_TOOLS } = require('../src/lib/becauseSkills2Tools');
const { buildChatBody, toolsPreservedInBody } = require('../src/services/ToolProtocolProbe');

test('capability fixtures define format and tool cases', () => {
  assert.ok(FORMAT_CASES.length >= 5);
  assert.ok(TOOL_CASES.length >= 3);
  assert.ok(BECAUSE_CASES.length >= 5);
  assert.equal(MOCK_TOOLS.length, 2);
});

test('assembled buildChatBody preserves because tools', () => {
  const endpoint = {
    type: 'openai',
    azure: null,
    dropParams: [],
    addParams: {},
    useResponsesApi: false,
  };
  const { body } = buildChatBody({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: '查表结构' }],
    endpoint,
    layer: 'assembled',
    extra: { tools: BECAUSE_SUITE_TOOLS, tool_choice: 'auto' },
  });
  assert.equal(toolsPreservedInBody(body), true);
  assert.ok(body.tools.some((t) => t.function?.name === 'because_skills_2'));
});

test('assembled buildChatBody preserves tools', () => {
  const endpoint = {
    type: 'openai',
    azure: null,
    dropParams: [],
    addParams: {},
    useResponsesApi: false,
  };
  const { body } = buildChatBody({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    endpoint,
    layer: 'assembled',
    extra: { tools: MOCK_TOOLS, tool_choice: 'auto' },
  });
  assert.equal(toolsPreservedInBody(body), true);
  assert.ok(Array.isArray(body.tools));
});

test('direct buildChatBody includes tools', () => {
  const endpoint = { type: 'openai' };
  const { body } = buildChatBody({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'weather?' }],
    endpoint,
    layer: 'direct',
    extra: { tools: MOCK_TOOLS, tool_choice: 'auto' },
  });
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.tools.length, 2);
});
