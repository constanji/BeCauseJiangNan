const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const {
  KPI_FILENAME,
  resolveEntityId,
  runExcelCellSearch,
} = require('../../utils/excelCellDiscovery');

/**
 * 指标理解 — 固定检索 filename=指标定义信息
 */
class IndicatorUnderstandingTool extends Tool {
  name = 'indicator_understanding';

  description =
    '在知识库「指标定义信息」中检索指标编码、标准名称、口径与业务含义。' +
    '适用于 BM/GM/CO_BOP 编码、指标名称、口径说明等查询。' +
    '不用于机构号/机构名检索（请用 org-context）。';

  schema = z.object({
    query: z
      .string()
      .min(1)
      .describe('指标编码（如 BM10010048）、标准名称（如 存款余额）或口径相关描述'),
    top_k: z
      .number()
      .int()
      .positive()
      .max(20)
      .optional()
      .default(5)
      .describe('返回行数，默认5行'),
    min_score: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.4)
      .describe('向量检索最低相似度阈值，默认0.4'),
    data_source_id: z
      .string()
      .optional()
      .describe('数据源 ID，不提供则自动从当前会话绑定的数据源获取'),
  });

  constructor(fields = {}) {
    super();
    this.userId = fields.userId || 'system';
    this.entityId = fields.entityId || null;
    this.agentDataSourceId = fields.agentDataSourceId || null;
    this.req = fields.req;
    this.conversation = fields.conversation;
  }

  async getEntityId(input = {}) {
    return resolveEntityId(
      {
        entityId: this.entityId,
        agentDataSourceId: this.agentDataSourceId,
        req: this.req,
        conversation: this.conversation,
      },
      input,
    );
  }

  async _call(input) {
    const { query, top_k = 5, min_score = 0.4 } = input || {};

    if (!query || typeof query !== 'string' || !query.trim()) {
      logger.warn(
        `[IndicatorUnderstandingTool] query 参数缺失或为空，input=${JSON.stringify(input)}`,
      );
      return JSON.stringify({
        success: false,
        error:
          'query 参数缺失或为空。请通过 because_jn 的 arguments 传入形如 ' +
          '{"query":"存款余额","top_k":5} 的 JSON 字符串。',
        results: [],
      });
    }

    try {
      const entityId = await this.getEntityId(input);
      const payload = await runExcelCellSearch({
        entityId,
        query: query.trim(),
        topK: top_k,
        minScore: min_score,
        filename: KPI_FILENAME,
        attachAliases: true,
        logPrefix: 'IndicatorUnderstandingTool',
      });
      return JSON.stringify(payload);
    } catch (err) {
      logger.error(`[IndicatorUnderstandingTool] 检索失败: ${err.message}`, err.stack);
      return JSON.stringify({
        success: false,
        error: `指标理解检索失败：${err.message}`,
        results: [],
      });
    }
  }
}

module.exports = IndicatorUnderstandingTool;
