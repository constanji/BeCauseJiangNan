const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../../../../..');
const BeCauseSkills3 = require(path.join(projectRoot, 'Because-3.0'));

/**
 * BeCause问数工具 3.0 - 瘦身版统一入口
 *
 * 相比 2.0：
 * - 移除 sql-validation / intent-classification / chart-generation
 * - fluctuation-attribution 默认返回 LLM 消费版摘要
 */
class BeCauseSkillsTool3 extends Tool {
  name = 'because_skills_3';

  description =
    'BeCause问数工具3.0 - 智能问数瘦身版，默认精简归因输出。' +
    'Commands: knowledge-discovery (结构化知识行检索，优先用于查询指标编码/定义/口径；可选 filename 限定单个 Excel), ' +
    'light-schema (从预生成缓存按需检索表结构，生成SQL前首选，0 DB开销), ' +
    'rag-retrieval (RAG知识检索，内置重排序), ' +
    'database-schema (数据库Schema实时获取，light-schema无结果时才用), ' +
    'result-analysis (结果分析，支持Adtributor归因+异常检测+趋势分析), ' +
    'sql-executor (SQL执行，执行器侧只读约束仍在), ' +
    'fluctuation-attribution (波动归因，默认读 overview/top_contributors/conclusion 等瘦身字段)。' +
    '注意：无 sql-validation 子命令；图表可视化不在本工具内，需要画图时请调用独立的 echarts_generator_app 工具。';

  schema = z.object({
    command: z.enum([
      'knowledge-discovery',
      'light-schema',
      'rag-retrieval',
      'database-schema',
      'result-analysis',
      'sql-executor',
      'fluctuation-attribution',
    ]),
    arguments: z
      .string()
      .optional()
      .describe('命令参数，JSON字符串格式，包含各命令所需的参数'),
  });

  constructor(fields = {}) {
    super();
    this.userId = fields.userId || 'system';
    this.req = fields.req;
    this.projectRoot = fields.projectRoot || process.cwd();
    this.conversation = fields.conversation;
    this.dataSourceId = fields.dataSourceId || null;

    const allowed = fields.req?.body?._benchmarkAllowedCommands;
    if (Array.isArray(allowed) && allowed.length > 0) {
      this.schema = z.object({
        command: z.enum(allowed),
        arguments: z.string().optional().describe('命令参数，JSON字符串格式，包含各命令所需的参数'),
      });
    }

    this.tools = {
      'knowledge-discovery': new BeCauseSkills3.KnowledgeDiscoveryTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
        agentDataSourceId: this.dataSourceId,
      }),
      'light-schema': new BeCauseSkills3.LightSchemaTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
      }),
      'rag-retrieval': new BeCauseSkills3.RAGRetrievalTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
        agentDataSourceId: this.dataSourceId,
      }),
      'database-schema': new BeCauseSkills3.DatabaseSchemaTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
      }),
      'result-analysis': new BeCauseSkills3.ResultAnalysisTool({
        userId: this.userId,
        req: this.req,
      }),
      'sql-executor': new BeCauseSkills3.SqlExecutorTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
      }),
      'fluctuation-attribution': new BeCauseSkills3.FluctuationAttributionTool({
        userId: this.userId,
        req: this.req,
      }),
    };
  }

  parseArguments(argsString) {
    logger.info('[BeCauseSkillsTool3] parseArguments called with:', {
      argsStringLength: argsString?.length || 0,
      argsStringPreview: argsString?.substring(0, 200) + (argsString?.length > 200 ? '...' : ''),
    });

    if (!argsString || !argsString.trim()) {
      return { args: {}, error: null };
    }

    let text = argsString.trim();
    let lastError = null;

    const sanitizeFullwidthPunctuation = (str) =>
      str.replace(/，/g, ',').replace(/：/g, ':').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

    for (let attempt = 0; attempt < 2; attempt++) {
      let value;
      try {
        value = JSON.parse(text);
      } catch (e) {
        const sanitized = sanitizeFullwidthPunctuation(text);
        if (sanitized === text) {
          lastError = e;
          break;
        }
        try {
          value = JSON.parse(sanitized);
          logger.warn('[BeCauseSkillsTool3] arguments 含全角标点，已自动纠正后解析成功');
        } catch (e2) {
          lastError = e2;
          break;
        }
      }

      if (typeof value === 'string') {
        text = value.trim();
        lastError = null;
        continue;
      }

      if (value && typeof value === 'object') {
        logger.info('[BeCauseSkillsTool3] Successfully parsed arguments:', {
          unwrapCount: attempt,
          keys: Object.keys(value),
        });
        return { args: value, error: null };
      }

      lastError = new Error(`arguments 解析结果既不是对象也不是字符串（实际为 ${typeof value}）`);
      break;
    }

    const preview = argsString.length > 300 ? `${argsString.slice(0, 300)}...` : argsString;
    logger.error('[BeCauseSkillsTool3] Failed to parse arguments:', {
      error: lastError?.message,
      argsStringPreview: preview,
    });
    return {
      args: {},
      error:
        `arguments 不是合法的 JSON 对象字符串（${lastError?.message || '解析失败'}）。` +
        '请直接传入形如 {"key":"value"} 的 JSON 字符串，不要多层转义或用引号把整段 JSON 再包一层。',
    };
  }

  async _call(input) {
    const startTime = Date.now();
    try {
      const { command, arguments: argsString } = input || {};

      if (!command) {
        logger.warn('[BeCauseSkillsTool3] command 参数缺失');
        return JSON.stringify({ success: false, error: 'command 参数缺失' });
      }

      logger.info('[BeCauseSkillsTool3] ========== 开始调用 ==========');
      logger.info(`[BeCauseSkillsTool3] Command: ${command}, UserId: ${this.userId}`);

      const tool = this.tools[command];
      if (!tool) {
        return JSON.stringify({ success: false, error: `未知命令: ${command}` });
      }

      const { args, error: parseError } = this.parseArguments(argsString);
      if (parseError) {
        logger.warn(`[BeCauseSkillsTool3] arguments 解析失败: ${parseError}`);
        return JSON.stringify({ success: false, error: parseError });
      }

      if (command === 'fluctuation-attribution') {
        args._sqlExecutor = this.tools['sql-executor'];
      }

      const result = await tool._call(args);

      const duration = Date.now() - startTime;
      logger.info(`[BeCauseSkillsTool3] 执行完成，耗时: ${duration}ms`);
      logger.info('[BeCauseSkillsTool3] ========== 调用完成 ==========');

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[BeCauseSkillsTool3] 执行错误 (耗时: ${duration}ms):`, err);
      return JSON.stringify({
        success: false,
        error: err.message || 'BeCause问数工具3.0执行失败',
      });
    }
  }
}

module.exports = BeCauseSkillsTool3;
