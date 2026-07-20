const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BECAUSE_COMMANDS,
  BECAUSE_SUITE_TOOLS,
  BECAUSE_SKILLS_2_TOOL,
} = require('../src/lib/becauseSkills2Tools');
const { BECAUSE_CASES } = require('../src/lib/capabilityFixtures');
const {
  validateBecauseToolCall,
  parseBecauseToolArgs,
  scoreToolChecks,
  detectPseudoToolJson,
} = require('../src/services/ComplianceScorer');

test('because schema includes because_skills_2 and echarts', () => {
  assert.equal(BECAUSE_SUITE_TOOLS.length, 2);
  assert.equal(BECAUSE_SKILLS_2_TOOL.function.name, 'because_skills_2');
  assert.ok(BECAUSE_COMMANDS.includes('light-schema'));
  assert.ok(BECAUSE_COMMANDS.includes('sql-validation'));
  assert.ok(!BECAUSE_COMMANDS.includes('intent-classification'));
});

test('parseBecauseToolArgs extracts command and inner query', () => {
  const parsed = parseBecauseToolArgs({
    function: {
      name: 'because_skills_2',
      arguments: JSON.stringify({
        command: 'light-schema',
        arguments: JSON.stringify({ query: '贷款余额', top_k: 8 }),
      }),
    },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, 'light-schema');
  assert.equal(parsed.innerArgs.query, '贷款余额');
});

test('validateBecauseToolCall passes light-schema with query', () => {
  const v = validateBecauseToolCall(
    {
      function: {
        name: 'because_skills_2',
        arguments: JSON.stringify({
          command: 'light-schema',
          arguments: JSON.stringify({ query: '各机构存款' }),
        }),
      },
    },
    {
      expectedTool: 'because_skills_2',
      expectedCommand: 'light-schema',
      requiredArgumentKeys: ['query'],
    },
  );
  assert.equal(v.ok, true);
});

test('validateBecauseToolCall rejects wrong command', () => {
  const v = validateBecauseToolCall(
    {
      function: {
        name: 'because_skills_2',
        arguments: JSON.stringify({ command: 'sql-executor', arguments: '{}' }),
      },
    },
    { expectedTool: 'because_skills_2', expectedCommand: 'sql-validation' },
  );
  assert.equal(v.ok, false);
});

test('scoreToolChecks passes because light-schema case', () => {
  const result = scoreToolChecks(
    {
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_bc',
                type: 'function',
                function: {
                  name: 'because_skills_2',
                  arguments: JSON.stringify({
                    command: 'light-schema',
                    arguments: JSON.stringify({ query: 'loan balance by org' }),
                  }),
                },
              },
            ],
          },
        },
      ],
    },
    null,
    BECAUSE_CASES.find((c) => c.id === 'bc_light_schema'),
  );
  assert.equal(result.failures.length, 0);
});

test('detectPseudoToolJson finds because command in text', () => {
  const r = detectPseudoToolJson('Here: {"command":"light-schema","arguments":"{}"}');
  assert.equal(r.found, true);
});

test('BECAUSE_CASES cover schema validation and echarts', () => {
  assert.ok(BECAUSE_CASES.length >= 5);
  assert.ok(BECAUSE_CASES.some((c) => c.id === 'bc_echarts'));
  assert.ok(BECAUSE_CASES.every((c) => Array.isArray(c.tools) && c.tools.length >= 1));
});
