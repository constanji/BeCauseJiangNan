const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const path = require('path');

let ExcelCellVectorizationService = null;
function loadService() {
  if (!ExcelCellVectorizationService) {
    try {
      ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
    } catch (e) {
      ExcelCellVectorizationService = require(
        path.resolve(__dirname, '../../../api/server/services/Files/ExcelCellVectorizationService'),
      );
    }
  }
  return ExcelCellVectorizationService;
}

let getProjectById = null;
function loadProjectModel() {
  if (!getProjectById) {
    try {
      getProjectById = require('~/models/Project').getProjectById;
    } catch (e) {
      getProjectById = require(
        path.resolve(__dirname, '../../../api/models/Project'),
      ).getProjectById;
    }
  }
  return getProjectById;
}

function cleanId(id) {
  if (!id) return null;
  if (typeof id === 'object') {
    const raw = id._id || id.id || (typeof id.toString === 'function' ? id.toString() : null);
    if (raw && String(raw) !== '[object Object]') {
      return cleanId(raw);
    }
  }
  let s = String(id).replace(/^ObjectId\("(.+)"\)$/, '$1').trim();
  while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s || null;
}

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

  /**
   * 从 conversation / req 中提取 entityId（数据源 ID）
   *
   * 优先级与 RAGRetrievalTool / 知识库 UI 一致：会话当前选中的 data_source_id
   * 优先于 project 默认绑定，避免「项目绑 A 源、Excel 上传到 B 源」时检索为空。
   */
  async getEntityId(input = {}) {
    if (this.entityId) return cleanId(this.entityId);
    if (input.data_source_id) return cleanId(input.data_source_id);
    if (input.entity_id) return cleanId(input.entity_id);

    const conv = this.conversation;

    // 会话级数据源（含 ToolService 从 req.body 注入的值）优先于 project 默认
    if (conv?.data_source_id) return cleanId(conv.data_source_id);

    const body = this.req?.body;
    if (body?.data_source_id) return cleanId(body.data_source_id);
    if (body?.endpointOption?.data_source_id) return cleanId(body.endpointOption.data_source_id);

    const agentOptions = conv?.agentOptions || conv?.model_parameters || {};
    const fromAgentOpts = cleanId(
      agentOptions.data_source_id ||
        agentOptions.dataSourceId ||
        agentOptions.datasource_id,
    );
    if (fromAgentOpts) return fromAgentOpts;

    if (this.agentDataSourceId) return cleanId(this.agentDataSourceId);

    if (conv?.project_id) {
      try {
        const getProjectByIdFn = loadProjectModel();
        const project = await getProjectByIdFn(cleanId(conv.project_id));
        if (project?.data_source_id) {
          return cleanId(project.data_source_id);
        }
      } catch (e) {
        logger.warn('[KnowledgeDiscoveryTool] 从 project_id 获取数据源失败:', e.message);
      }
    }

    if (body?.project_id || body?.endpointOption?.project_id) {
      try {
        const getProjectByIdFn = loadProjectModel();
        const projectId = cleanId(body.project_id || body.endpointOption?.project_id);
        const project = await getProjectByIdFn(projectId);
        if (project?.data_source_id) return cleanId(project.data_source_id);
      } catch (e) {
        logger.warn('[KnowledgeDiscoveryTool] 从 req.body.project_id 获取数据源失败:', e.message);
      }
    }

    // entityId 常为 Agent ID，不能当作数据源 ID
    return null;
  }

  async _call(input) {
    const { query, top_k = 5, min_score = 0.4 } = input;
    const entityId = await this.getEntityId(input);

    logger.info(`[KnowledgeDiscoveryTool] query="${query}", entityId=${entityId}, topK=${top_k}`);

    if (!entityId) {
      return JSON.stringify({
        success: false,
        error: '未找到关联的数据源 ID（entityId），无法检索结构化知识。请确认当前会话已绑定数据源。',
        results: [],
      });
    }

    try {
      const ServiceClass = loadService();
      const svc = new ServiceClass();

      const results = await svc.search({
        entityId,
        query,
        topK: top_k,
        minScore: min_score,
      });

      if (!results || results.length === 0) {
        return JSON.stringify({
          success: true,
          query,
          entityId,
          results: [],
          summary: `未在数据源 ${entityId} 的结构化知识文件中找到与「${query}」相关的数据行。`,
        });
      }

      const formatted = results.map((r, i) => ({
        rank: i + 1,
        score: Math.round(r.score * 100) / 100,
        matched_column: r.columnName,
        matched_value: r.cellValue,
        is_primary_column: r.isPrimaryColumn || false,
        full_row: r.fullRow,
        filename: r.filename,
        sheet: r.sheetName,
        row_index: r.rowIndex,
      }));

      const primaryHits = formatted.filter((r) => r.is_primary_column);
      const summary =
        primaryHits.length > 0
          ? `在主列中精确命中 ${primaryHits.length} 条，共返回 ${formatted.length} 条相关数据行。`
          : `共返回 ${formatted.length} 条相关数据行（语义匹配）。`;

      logger.info(`[KnowledgeDiscoveryTool] 返回 ${formatted.length} 条结果，主列命中 ${primaryHits.length} 条`);

      return JSON.stringify({
        success: true,
        query,
        entityId,
        total: formatted.length,
        summary,
        results: formatted,
      });
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
