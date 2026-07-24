const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../../../../..');
const BeCauseJN = require(path.join(projectRoot, 'Because-jn'));

/**
 * BeCause江南 — 加载独立技能包 Because-jn
 *
 * 优先 indicator-understanding / org-context；无结构化命中再用 rag-retrieval。
 * 不挂 knowledge-discovery，避免与两个专用工具抢路由。
 */
class BeCauseSkillsJN extends Tool {
  name = 'because_jn';

  description =
    'BeCause江南问数工具。优先使用 indicator-understanding（指标编码/标准名称/口径，固定检索「指标定义信息」）' +
    '与 org-context（机构号/机构名/下级，固定检索「机构信息」）；' +
    '术语、规则、非表格知识用 rag-retrieval 兜底。' +
    '其余问数命令：light-schema、database-schema、sql-executor、result-analysis、fluctuation-attribution。' +
    '注意：无 knowledge-discovery / sql-validation；图表请用独立 echarts_generator_app。';

  schema = z.object({
    command: z.enum([
      'indicator-understanding',
      'org-context',
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
      'indicator-understanding': new BeCauseJN.IndicatorUnderstandingTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
        agentDataSourceId: this.dataSourceId,
      }),
      'org-context': new BeCauseJN.OrgContextTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
        agentDataSourceId: this.dataSourceId,
      }),
      'light-schema': new BeCauseJN.LightSchemaTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
      }),
      'rag-retrieval': new BeCauseJN.RAGRetrievalTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
        agentDataSourceId: this.dataSourceId,
      }),
      'database-schema': new BeCauseJN.DatabaseSchemaTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
      }),
      'result-analysis': new BeCauseJN.ResultAnalysisTool({
        userId: this.userId,
        req: this.req,
      }),
      'sql-executor': new BeCauseJN.SqlExecutorTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
      }),
      'fluctuation-attribution': new BeCauseJN.FluctuationAttributionTool({
        userId: this.userId,
        req: this.req,
      }),
    };
  }

  parseArguments(argsString) {
    logger.info('[BeCauseSkillsJN] parseArguments called with:', {
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
          logger.warn('[BeCauseSkillsJN] arguments 含全角标点，已自动纠正后解析成功');
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
        logger.info('[BeCauseSkillsJN] Successfully parsed arguments:', {
          unwrapCount: attempt,
          keys: Object.keys(value),
        });
        return { args: value, error: null };
      }

      lastError = new Error(`arguments 解析结果既不是对象也不是字符串（实际为 ${typeof value}）`);
      break;
    }

    const preview = argsString.length > 300 ? `${argsString.slice(0, 300)}...` : argsString;
    logger.error('[BeCauseSkillsJN] Failed to parse arguments:', {
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
        logger.warn('[BeCauseSkillsJN] command 参数缺失');
        return JSON.stringify({ success: false, error: 'command 参数缺失' });
      }

      logger.info('[BeCauseSkillsJN] ========== 开始调用 ==========');
      logger.info(`[BeCauseSkillsJN] Command: ${command}, UserId: ${this.userId}`);

      const tool = this.tools[command];
      if (!tool) {
        return JSON.stringify({ success: false, error: `未知命令: ${command}` });
      }

      const { args, error: parseError } = this.parseArguments(argsString);
      if (parseError) {
        logger.warn(`[BeCauseSkillsJN] arguments 解析失败: ${parseError}`);
        return JSON.stringify({ success: false, error: parseError });
      }

      if (command === 'fluctuation-attribution') {
        args._sqlExecutor = this.tools['sql-executor'];
      }

      const result = await tool._call(args);

      const duration = Date.now() - startTime;
      logger.info(`[BeCauseSkillsJN] 执行完成，耗时: ${duration}ms`);
      logger.info('[BeCauseSkillsJN] ========== 调用完成 ==========');

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[BeCauseSkillsJN] 执行错误 (耗时: ${duration}ms):`, err);
      return JSON.stringify({
        success: false,
        error: err.message || 'BeCause江南工具执行失败',
      });
    }
  }
}

module.exports = BeCauseSkillsJN;
