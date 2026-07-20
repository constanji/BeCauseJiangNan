const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseThinkingContent,
  hasUnclosedThink,
  hasThinkTagsOutsideCodeFence,
  detectPseudoToolJson,
  validateToolCall,
  scoreFormatChecks,
  scoreToolChecks,
} = require('../src/services/ComplianceScorer');

test('parseThinkingContent splits paired tags', () => {
  const { text, thinking } = parseThinkingContent(
    'Hello <think>step1</think> world',
  );
  assert.equal(text, 'Hello  world');
  assert.equal(thinking, 'step1');
});

test('unclosed think tag is detected', () => {
  assert.equal(hasUnclosedThink('Answer <think>oops'), true);
  assert.equal(hasUnclosedThink('<think>a</think> ok'), false);
});

test('think tags inside code fence are ignored for leak detection', () => {
  const raw = '```\n<think>demo</think>\n```\nSample shown above.';
  assert.equal(hasThinkTagsOutsideCodeFence(raw), false);
});

test('detectPseudoToolJson finds pasted function json', () => {
  const r = detectPseudoToolJson(
    'Here: {"name":"get_weather","arguments":"{\\"city\\":\\"Shanghai\\"}"}',
  );
  assert.equal(r.found, true);
});

test('validateToolCall requires city', () => {
  const ok = validateToolCall(
    { function: { name: 'get_weather', arguments: '{"city":"Shanghai"}' } },
    { expectedTool: 'get_weather', requiredArgs: ['city'] },
  );
  assert.equal(ok.ok, true);
  const bad = validateToolCall(
    { function: { name: 'get_weather', arguments: '{}' } },
    { expectedTool: 'get_weather', requiredArgs: ['city'] },
  );
  assert.equal(bad.ok, false);
});

test('scoreFormatChecks flags think leak', () => {
  const result = scoreFormatChecks(
    { choices: [{ message: { content: 'bad <think>leak' } }] },
    { checks: ['think_leak', 'think_unclosed'] },
  );
  assert.equal(result.checks.find((c) => c.id === 'think_leak').pass, false);
  assert.equal(result.checks.find((c) => c.id === 'think_unclosed').pass, false);
});

test('scoreToolChecks passes valid tool call', () => {
  const result = scoreToolChecks(
    {
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Shanghai"}' },
              },
            ],
          },
        },
      ],
    },
    null,
    {
      expectedTool: 'get_weather',
      requiredArgs: ['city'],
      checks: ['tool_emits_native', 'tool_args_json', 'tool_name_match', 'tool_no_text_json'],
    },
  );
  assert.ok(result.score >= 0.75);
  assert.equal(result.failures.length, 0);
});
