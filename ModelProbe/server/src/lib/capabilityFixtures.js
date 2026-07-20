/** 输出规范与工具协议探测用例（合成 prompt + mock tools） */

const { BECAUSE_SUITE_TOOLS } = require('./becauseSkills2Tools');

const MOCK_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_account',
      description: 'Look up a bank account by id',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Account id' },
        },
        required: ['id'],
      },
    },
  },
];

const FORMAT_CASES = [
  {
    id: 'think_native',
    label: '推理与答案分离',
    prompt:
      'Think step by step internally, then reply to the user with ONLY the final answer (one short sentence). Do not expose your reasoning in the visible answer.',
    checks: ['think_native', 'think_leak', 'final_answer_only'],
  },
  {
    id: 'think_leak',
    label: 'Think 不得泄漏到正文',
    prompt:
      'You must not put any reasoning tags or chain-of-thought in the user-visible text. Reply with exactly: OK',
    checks: ['think_leak', 'final_answer_only'],
  },
  {
    id: 'think_unclosed',
    label: '未闭合 think 标签检测',
    prompt:
      'If you use <think> tags, they MUST be closed. Reply with a one-word answer: done',
    checks: ['think_unclosed', 'think_leak'],
  },
  {
    id: 'think_in_codefence',
    label: '代码块内标签不计泄漏',
    prompt:
      'Show ONE markdown fenced code block (```) containing the literal text <think>example</think> as sample documentation. After the code block, write one line: Sample shown above.',
    checks: ['think_in_codefence', 'think_leak'],
  },
  {
    id: 'final_answer_only',
    label: '仅输出最终答案',
    prompt: 'What is 2+2? Reply with the number only, no explanation.',
    checks: ['final_answer_only', 'think_leak'],
  },
];

const TOOL_CASES = [
  {
    id: 'tool_weather',
    label: '应调用 get_weather',
    messages: [
      {
        role: 'user',
        content: 'What is the weather in Shanghai right now? Use the available tool; do not guess.',
      },
    ],
    expectedTool: 'get_weather',
    requiredArgs: ['city'],
    checks: ['tool_emits_native', 'tool_args_json', 'tool_no_text_json', 'tool_name_match'],
  },
  {
    id: 'tool_account',
    label: '应调用 lookup_account',
    messages: [
      {
        role: 'user',
        content: 'Look up account id ACC-8842 using the tool. Do not paste JSON in chat.',
      },
    ],
    expectedTool: 'lookup_account',
    requiredArgs: ['id'],
    checks: ['tool_emits_native', 'tool_args_json', 'tool_no_text_json', 'tool_name_match'],
  },
  {
    id: 'tool_roundtrip',
    label: '工具结果往返',
    messages: [
      {
        role: 'user',
        content: 'Use get_weather for Beijing, then summarize the result in one sentence.',
      },
    ],
    expectedTool: 'get_weather',
    requiredArgs: ['city'],
    roundtrip: true,
    mockToolResult: { temperature_c: 18, condition: 'cloudy', city: 'Beijing' },
    checks: [
      'tool_emits_native',
      'tool_args_json',
      'tool_name_match',
      'tool_roundtrip',
      'tool_no_text_json',
    ],
  },
];

const BECAUSE_CASES = [
  {
    id: 'bc_light_schema',
    label: '问数：应选 light-schema',
    tools: BECAUSE_SUITE_TOOLS,
    messages: [
      {
        role: 'user',
        content:
          '用户问题：查询各机构贷款余额汇总，需要先获取相关表结构再写 SQL。请使用 because_skills_2 工具，command 选 light-schema，arguments 里带上 query。不要在正文粘贴 JSON。',
      },
    ],
    expectedTool: 'because_skills_2',
    expectedCommand: 'light-schema',
    requiredArgumentKeys: ['query'],
    checks: [
      'tool_emits_native',
      'tool_args_json',
      'tool_name_match',
      'because_command_match',
      'tool_no_text_json',
    ],
  },
  {
    id: 'bc_sql_validation',
    label: '问数：应选 sql-validation',
    tools: BECAUSE_SUITE_TOOLS,
    messages: [
      {
        role: 'user',
        content:
          '已有 SQL：SELECT org_name, SUM(loan_balance) FROM loan_fact GROUP BY org_name。请先校验再执行。使用 because_skills_2，command 必须是 sql-validation。勿在对话里粘贴 function call JSON。',
      },
    ],
    expectedTool: 'because_skills_2',
    expectedCommand: 'sql-validation',
    checks: [
      'tool_emits_native',
      'tool_args_json',
      'tool_name_match',
      'because_command_match',
      'tool_no_text_json',
    ],
  },
  {
    id: 'bc_no_text_json',
    label: '问数：禁止正文伪 JSON',
    tools: BECAUSE_SUITE_TOOLS,
    messages: [
      {
        role: 'user',
        content:
          '帮我查表结构。必须用原生 function calling 调用 because_skills_2，禁止在回复正文里写 {"command":"light-schema"} 这类 JSON。',
      },
    ],
    expectedTool: 'because_skills_2',
    expectedCommand: 'light-schema',
    checks: ['tool_emits_native', 'because_command_match', 'tool_no_text_json'],
  },
  {
    id: 'bc_roundtrip',
    label: '问数：schema mock 往返',
    tools: BECAUSE_SUITE_TOOLS,
    messages: [
      {
        role: 'user',
        content:
          '查询客户存款余额按机构汇总，先 light-schema 拿表结构，再根据返回结果用一句话说明下一步会做什么。使用工具，不要猜表名。',
      },
    ],
    expectedTool: 'because_skills_2',
    expectedCommand: 'light-schema',
    requiredArgumentKeys: ['query'],
    roundtrip: true,
    mockToolResult: {
      success: true,
      semantic_models: [
        {
          table_name: 'deposit_fact',
          columns: [
            { column_name: 'org_name', data_type: 'varchar' },
            { column_name: 'deposit_balance', data_type: 'decimal' },
          ],
        },
      ],
      value_hints: [],
    },
    checks: [
      'tool_emits_native',
      'because_command_match',
      'tool_roundtrip',
      'tool_no_text_json',
    ],
  },
  {
    id: 'bc_echarts',
    label: '问数：图表用 echarts_generator_app',
    tools: BECAUSE_SUITE_TOOLS,
    messages: [
      {
        role: 'user',
        content:
          '已有两机构贷款余额对比数据，需要生成柱状图。请调用 echarts_generator_app（不是 because_skills_2 子命令），传入 charts 数组。',
      },
    ],
    expectedTool: 'echarts_generator_app',
    checks: ['tool_emits_native', 'tool_name_match', 'tool_no_text_json'],
  },
];

module.exports = {
  MOCK_TOOLS,
  FORMAT_CASES,
  TOOL_CASES,
  BECAUSE_CASES,
};
