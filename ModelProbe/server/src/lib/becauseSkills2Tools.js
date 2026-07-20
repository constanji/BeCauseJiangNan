/**
 * Because-2.0 问数工具 OpenAI tools schema（自包含，对齐主站 BeCauseSkills2.js）。
 * 源文件：api/app/clients/tools/structured/BeCauseSkills2.js
 * 不 require Because-2.0 运行时。
 */

const BECAUSE_COMMANDS = [
  'knowledge-discovery',
  'light-schema',
  'rag-retrieval',
  'database-schema',
  'sql-validation',
  'result-analysis',
  'sql-executor',
  'fluctuation-attribution',
];

const BECAUSE_SKILLS_2_TOOL = {
  type: 'function',
  function: {
    name: 'because_skills_2',
    description:
      'BeCause问数工具2.0 - 智能问数（自然语言转SQL）的完整能力集。' +
      'Commands: knowledge-discovery, light-schema, rag-retrieval, database-schema, ' +
      'sql-validation, result-analysis, sql-executor, fluctuation-attribution。' +
      '通过 function calling 调用，勿在对话里粘贴 JSON。' +
      '图表可视化不在本工具内，需要画图时请调用独立的 echarts_generator_app。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: BECAUSE_COMMANDS,
          description: '要执行的子命令',
        },
        arguments: {
          type: 'string',
          description: '命令参数，JSON 字符串格式，包含各 command 所需字段',
        },
      },
      required: ['command'],
    },
  },
};

/** 源文件：api/app/clients/tools/structured/EChartsGeneratorAPP.js */
const ECHARTS_GENERATOR_TOOL = {
  type: 'function',
  function: {
    name: 'echarts_generator_app',
    description:
      'ECharts 图表生成工具。传入 charts 数组（每项含 id、title、echartsOption）。' +
      '不是 because_skills_2 的子命令；需要可视化时单独调用本工具。',
    parameters: {
      type: 'object',
      properties: {
        charts: {
          description: '图表配置数组 [{ id, title, echartsOption }, ...]',
        },
      },
      required: ['charts'],
    },
  },
};

/** 问数套件默认注入：because_skills_2 + 独立图表工具 */
const BECAUSE_SUITE_TOOLS = [BECAUSE_SKILLS_2_TOOL, ECHARTS_GENERATOR_TOOL];

module.exports = {
  BECAUSE_COMMANDS,
  BECAUSE_SKILLS_2_TOOL,
  ECHARTS_GENERATOR_TOOL,
  BECAUSE_SUITE_TOOLS,
};
