const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const path = require('path');

// 导入 Because-2.0 重构后的工具集
const projectRoot = path.resolve(__dirname, '../../../../..');
const BeCauseSkills2 = require(path.join(projectRoot, 'Because-2.0'));

/**
 * BeCause问数工具 2.0 - 统一的智能问数工具入口
 * 
 * 相比 1.0 版本新增：
 * - fluctuation-attribution: 波动归因（Adtributor算法，维度归因+指标归因+时间对比+下钻）
 * - sql-validation 增强: 7类关键字分类 + 双盲SQL对比 + 文本-知识-SQL对齐检查
 * - result-analysis 增强: Adtributor归因 + 异常检测 + 趋势分析 + 指标关联
 * 
 * 新增核心算法：
 * - JS散度 / KL散度
 * - 解释力（Explanatory Power）、惊喜度（Surprise）、简洁性（Parsimony）
 * - ElasticNet回归 + 特征重要性（SHAP近似）
 * - 多维度下钻（最多10条路径）
 * - 同比/环比/自定义时间对比
 */
class BeCauseSkillsTool2 extends Tool {
  name = 'because_skills_2';

  description =
    'BeCause问数工具2.0 - 智能问数（自然语言转SQL）的完整能力集，新增波动归因能力。' +
    'Commands: knowledge-discovery (结构化知识行检索，优先用于查询指标编码/定义/口径；可选 filename 限定单个 Excel), ' +
    'light-schema (从预生成缓存按需检索表结构，生成SQL前首选，0 DB开销), ' +
    'rag-retrieval (RAG知识检索，内置重排序), ' +
    'database-schema (数据库Schema实时获取，light-schema无结果时才用), ' +
    'sql-validation (SQL校验，支持7类关键字分类+双盲对比), ' +
    'result-analysis (结果分析，支持Adtributor归因+异常检测+趋势分析), ' +
    'sql-executor (SQL执行), ' +
    'fluctuation-attribution (波动归因，维度归因+指标归因+时间对比+下钻)。' +
    '注意：图表可视化不在本工具内，需要画图时请调用独立的 echarts_generator_app 工具。';

  schema = z.object({
    command: z.enum([
      'knowledge-discovery',
      'light-schema',
      'rag-retrieval',
      'database-schema',
      'sql-validation',
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

    // 基准测试模式：仅暴露允许的子命令
    const allowed = fields.req?.body?._benchmarkAllowedCommands;
    if (Array.isArray(allowed) && allowed.length > 0) {
      this.schema = z.object({
        command: z.enum(allowed),
        arguments: z.string().optional().describe('命令参数，JSON字符串格式，包含各命令所需的参数'),
      });
    }

    // 初始化各个子工具实例（intent-classification 暂时关闭）
    this.tools = {
      'knowledge-discovery': new BeCauseSkills2.KnowledgeDiscoveryTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
        agentDataSourceId: this.dataSourceId,
      }),
      'light-schema': new BeCauseSkills2.LightSchemaTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
      }),
      'rag-retrieval': new BeCauseSkills2.RAGRetrievalTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
        agentDataSourceId: this.dataSourceId,
      }),
      'database-schema': new BeCauseSkills2.DatabaseSchemaTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
      }),
      'sql-validation': new BeCauseSkills2.SQLValidationTool({
        userId: this.userId,
        req: this.req,
      }),
      'result-analysis': new BeCauseSkills2.ResultAnalysisTool({
        userId: this.userId,
        req: this.req,
      }),
      'sql-executor': new BeCauseSkills2.SqlExecutorTool({
        userId: this.userId,
        req: this.req,
        conversation: this.conversation,
      }),
      'fluctuation-attribution': new BeCauseSkills2.FluctuationAttributionTool({
        userId: this.userId,
        req: this.req,
      }),
    };
  }

  /**
   * 解析 arguments 字符串为参数对象。
   *
   * 部分（尤其是低质量）模型会把 arguments 多包一层引号/转义（例如把已经是
   * JSON 字符串的内容再 JSON.stringify 一次），导致一次 JSON.parse 后拿到的
   * 还是字符串而不是对象。这里最多解包两层，并在最终仍无法得到对象时，
   * 明确返回可读的错误信息，而不是静默退化成 {}（那样会导致后续报错
   * 变成难以定位的"某个必填字段缺失"）。
   *
   * @returns {{ args: Record<string, unknown>, error: string | null }}
   */
  parseArguments(argsString) {
    logger.info('[BeCauseSkillsTool2] parseArguments called with:', {
      argsStringLength: argsString?.length || 0,
      argsStringPreview: argsString?.substring(0, 200) + (argsString?.length > 200 ? '...' : ''),
    });

    if (!argsString || !argsString.trim()) {
      return { args: {}, error: null };
    }

    let text = argsString.trim();
    let lastError = null;

    // 部分中文场景下的低质量模型会把 JSON 里的结构性符号写成全角标点
    // （，：""''），导致原本合法的 JSON 直接解析失败。只在严格解析失败时
    // 才尝试纠正重试，避免误伤合法内容。
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
          logger.warn('[BeCauseSkillsTool2] arguments 含全角标点，已自动纠正后解析成功');
        } catch (e2) {
          lastError = e2;
          break;
        }
      }

      if (typeof value === 'string') {
        // 外层多包了一层引号/转义，继续尝试解析内层
        text = value.trim();
        lastError = null;
        continue;
      }

      if (value && typeof value === 'object') {
        logger.info('[BeCauseSkillsTool2] Successfully parsed arguments:', {
          unwrapCount: attempt,
          keys: Object.keys(value),
        });
        return { args: value, error: null };
      }

      lastError = new Error(`arguments 解析结果既不是对象也不是字符串（实际为 ${typeof value}）`);
      break;
    }

    const preview = argsString.length > 300 ? `${argsString.slice(0, 300)}...` : argsString;
    logger.error('[BeCauseSkillsTool2] Failed to parse arguments:', {
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
        logger.warn('[BeCauseSkillsTool2] command 参数缺失');
        return JSON.stringify({ success: false, error: 'command 参数缺失' }, null, 2);
      }

      logger.info('[BeCauseSkillsTool2] ========== 开始调用 ==========');
      logger.info(`[BeCauseSkillsTool2] Command: ${command}, UserId: ${this.userId}`);

      const tool = this.tools[command];
      if (!tool) {
        return JSON.stringify(
          { success: false, error: `未知命令: ${command}` },
          null, 2,
        );
      }

      const { args, error: parseError } = this.parseArguments(argsString);
      if (parseError) {
        logger.warn(`[BeCauseSkillsTool2] arguments 解析失败: ${parseError}`);
        return JSON.stringify({ success: false, error: parseError }, null, 2);
      }

      // fluctuation-attribution：自动执行SQL获取基期/现期数据
      if (command === 'fluctuation-attribution') {
        args._sqlExecutor = this.tools['sql-executor'];
      }

      const result = await tool._call(args);

      const duration = Date.now() - startTime;
      logger.info(`[BeCauseSkillsTool2] 执行完成，耗时: ${duration}ms`);
      logger.info('[BeCauseSkillsTool2] ========== 调用完成 ==========');

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[BeCauseSkillsTool2] 执行错误 (耗时: ${duration}ms):`, err);
      const msg = err?.message || '';
      if (/cannot read propert(y|ies) of undefined.*(reading ['"]trim['"])/i.test(msg)) {
        return JSON.stringify(
          {
            success: false,
            error:
              '缺少 SQL 语句：请在 arguments 中传入 sql（推荐），也兼容 query / statement。示例：{"sql":"SELECT * FROM dim_region"}。',
            code: 'MISSING_SQL',
            hint: '参数名须为 sql 或 query，值为完整只读 SELECT/WITH 语句',
          },
          null,
          2,
        );
      }
      return JSON.stringify(
        { success: false, error: msg || 'BeCause问数工具2.0执行失败' },
        null, 2,
      );
    }
  }
}

module.exports = BeCauseSkillsTool2;
