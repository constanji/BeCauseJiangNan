const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const {
  resolveEntityId,
  runExcelCellSearch,
} = require('../../utils/excelCellDiscovery');

/**
 * Knowledge Discovery Tool — 结构化知识行检索
 *
 * 针对上传的 Excel 等表格知识（指标库、数据字典、业务映射表等）进行混合检索：
 * 1. 文本精确包含匹配（指标编码、名称等）
 * 2. 语义向量检索（自然语言描述）
 * 3. 按行去重，主列命中优先，返回完整行内容
 */
class KnowledgeDiscoveryTool extends Tool {
  name = 'knowledge_discovery';

  description =
    '在已上传的结构化知识文件（Excel 指标库、数据字典、业务映射表等）中检索数据行。' +
    '支持指标编码（如 BM10012529）、指标名称、业务术语等查询。' +
    '可通过 filename 限定只在某个 Excel 内检索（如 org_master.xlsx）；不传则在当前数据源全部 Excel 中搜索。' +
    '返回命中的完整行内容，包括所有字段。' +
    '当用户查询指标定义、指标口径、计算公式、业务含义时，优先调用此工具。';

  schema = z.object({
    query: z
      .string()
      .min(1)
      .describe('查询内容，可以是指标编码（如 BM10012529）、指标名称（如 对公存款余额）、或自然语言描述'),
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
    filename: z
      .string()
      .optional()
      .describe(
        '可选。指定 Excel 文件名后仅在该文件内检索（大小写不敏感，如 org_master.xlsx；也可传无扩展名 org_master）。不传则在当前数据源全部 Excel 中搜索',
      ),
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
    const { query, top_k = 5, min_score = 0.4, filename } = input || {};

    // because_skills_* 直接调用 _call，不会走 Tool.invoke() 的 Zod schema 校验，
    // 这里补一道前置校验：query 缺失/为空时给出明确的、面向模型的错误提示。
    if (!query || typeof query !== 'string' || !query.trim()) {
      logger.warn(
        `[KnowledgeDiscoveryTool] query 参数缺失或为空，input=${JSON.stringify(input)}`,
      );
      return JSON.stringify({
        success: false,
        error:
          'query 参数缺失或为空。请通过 because_skills_3 的 arguments 传入形如 ' +
          '{"query":"对公存款余额","top_k":5} 的 JSON 字符串；查机构时可加 "filename":"org_master.xlsx"。不要多层转义或漏传 query 字段。',
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
        filename,
        attachAliases: false,
        logPrefix: 'KnowledgeDiscoveryTool',
      });
      return JSON.stringify(payload);
    } catch (err) {
      logger.error(`[KnowledgeDiscoveryTool] 检索失败: ${err.message}`, err.stack);
      return JSON.stringify({
        success: false,
        error: `知识检索失败：${err.message}`,
        results: [],
      });
    }
  }
}

module.exports = KnowledgeDiscoveryTool;
