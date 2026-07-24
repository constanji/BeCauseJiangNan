const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const {
  ORG_FILENAME,
  resolveEntityId,
  runExcelCellSearch,
} = require('../../utils/excelCellDiscovery');

/**
 * 机构背景 — 固定检索 filename=机构信息
 */
class OrgContextTool extends Tool {
  name = 'org_context';

  description =
    '在知识库「机构信息」中检索机构号、机构名、层级与下级列表（含 leaf_child 等）。' +
    '适用于机构代码（如 A0001）、机构名称（如 武进）及下属/同级范围查询。' +
    '不用于指标编码/口径检索（请用 indicator-understanding）。';

  schema = z.object({
    query: z
      .string()
      .min(1)
      .describe('机构号（如 A0001）、机构名称（如 武进）或相关描述'),
    top_k: z
      .number()
      .int()
      .positive()
      .max(20)
      .optional()
      .default(5)
      .describe('返回行数，默认5行；机构代码建议先 2 再放宽'),
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
      logger.warn(`[OrgContextTool] query 参数缺失或为空，input=${JSON.stringify(input)}`);
      return JSON.stringify({
        success: false,
        error:
          'query 参数缺失或为空。请通过 because_jn 的 arguments 传入形如 ' +
          '{"query":"武进","top_k":2} 的 JSON 字符串。',
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
        filename: ORG_FILENAME,
        attachAliases: true,
        logPrefix: 'OrgContextTool',
      });
      return JSON.stringify(payload);
    } catch (err) {
      logger.error(`[OrgContextTool] 检索失败: ${err.message}`, err.stack);
      return JSON.stringify({
        success: false,
        error: `机构背景检索失败：${err.message}`,
        results: [],
      });
    }
  }
}

module.exports = OrgContextTool;
