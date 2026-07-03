const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const path = require('path');
const {
  resolveSearchText,
  retrieveLightSchemaBundle,
  DEFAULT_CELL_TOP_K,
} = require('../../utils/lightSchemaRetrieval');

// 延迟加载，避免路径别名问题
let getDataSourceById = null;
let getProjectById = null;

function loadDataSourceModel() {
  if (!getDataSourceById) {
    try {
      getDataSourceById = require('~/models/DataSource').getDataSourceById;
    } catch (e) {
      getDataSourceById = require(
        path.resolve(__dirname, '../../../api/models/DataSource'),
      ).getDataSourceById;
    }
  }
  return getDataSourceById;
}

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

/**
 * Light Schema 按需检索工具
 *
 * 从预生成的 pgvector Light Schema 缓存中检索表结构，完全绕过数据库直连。
 * 支持：
 *   - 语义模式：传入自然语言 query，embed 后做余弦相似度检索
 *   - 精确模式：传入 tables[]，直接按表名查询
 *   - Cell 值对齐：同一 query 并行 searchCells，返回 value_hints，并补拉命中表的 schema
 *
 * 与 database_schema 的分工：
 *   - light_schema（本工具）：首选，0 DB 连接开销
 *   - database_schema：兜底，Light Schema 为空或需要最新实时结构时才用
 */
class LightSchemaTool extends Tool {
  name = 'light_schema';

  description =
    '从预生成的 Light Schema 缓存中按需检索数据库表结构，不连接数据库，速度快。' +
    '支持语义检索（传入自然语言问题自动找最相关的表）、精确检索（传入具体表名）' +
    '以及 Cell 向量值对齐（返回 value_hints 辅助 WHERE 条件，无需降级 database_schema）。' +
    '生成 SQL 前优先调用此工具，只有当此工具返回空结果（未预处理）时才降级到 database_schema。' +
    '返回格式与 database_schema 完全兼容，可直接将 semantic_models 传给 text-to-sql 工具。';

  schema = z.object({
    query: z
      .string()
      .describe(
        '自然语言查询或关键词，用于语义向量检索最相关的表结构，并触发 Cell 值对齐。' +
        '可以是用户的业务问题，也可以是表名/列名/维度值关键词。',
      ),
    tables: z
      .array(z.string())
      .optional()
      .describe(
        '可选：直接指定要查询的表名列表（精确匹配）。' +
        '当你已经知道需要哪些表时使用，速度更快。',
      ),
    top_k: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(8)
      .describe('语义检索最多返回的表数量，默认 8。精确模式（tables 参数）不受此限制。'),
    data_source_id: z
      .string()
      .optional()
      .describe('数据源 ID，不提供则自动从当前会话绑定的数据源获取。'),
  });

  constructor(fields = {}) {
    super();
    this.userId = fields.userId || 'system';
    this.req = fields.req;
    this.conversation = fields.conversation;
  }

  cleanDataSourceId(id) {
    if (!id) return null;
    if (typeof id === 'object') {
      return String(id._id || id.id || id.toString()).trim() || null;
    }
    let s = String(id).trim();
    while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1).trim();
    }
    return s || null;
  }

  async getDataSourceId(input) {
    if (input.data_source_id) {
      return this.cleanDataSourceId(input.data_source_id);
    }

    if (this.conversation && this.conversation.project_id) {
      try {
        const getProjectByIdFn = loadProjectModel();
        const projectId = this.cleanDataSourceId(this.conversation.project_id);
        const project = await getProjectByIdFn(projectId);
        if (project && project.data_source_id) {
          return project.data_source_id.toString();
        }
      } catch (e) {
        logger.warn('[LightSchemaTool] 从 conversation.project_id 获取数据源失败:', e.message);
      }
    }

    if (this.conversation && this.conversation.data_source_id) {
      return this.cleanDataSourceId(this.conversation.data_source_id);
    }

    if (this.req && this.req.body) {
      if (this.req.body.data_source_id) {
        return this.cleanDataSourceId(this.req.body.data_source_id);
      }
      if (this.req.body.project_id) {
        try {
          const getProjectByIdFn = loadProjectModel();
          const projectId = this.cleanDataSourceId(this.req.body.project_id);
          const project = await getProjectByIdFn(projectId);
          if (project && project.data_source_id) {
            return project.data_source_id.toString();
          }
        } catch (e) {
          logger.warn('[LightSchemaTool] 从 req.body.project_id 获取数据源失败:', e.message);
        }
      }
    }

    const agentOptions = this.conversation?.agentOptions || this.conversation?.model_parameters;
    if (agentOptions) {
      const rawId =
        agentOptions.data_source_id ||
        agentOptions.dataSourceId ||
        agentOptions.datasource_id;
      if (rawId) return this.cleanDataSourceId(rawId);
    }

    return null;
  }

  _getServices() {
    const VectorDBService = require(
      path.resolve(__dirname, '../../../api/server/services/RAG/VectorDBService'),
    );
    const EmbeddingService = require(
      path.resolve(__dirname, '../../../api/server/services/RAG/EmbeddingService'),
    );
    return { VectorDBService, EmbeddingService };
  }

  contentToSemanticModel(content) {
    try {
      const schema = typeof content === 'string' ? JSON.parse(content) : content;
      return {
        table_name: schema.tableName,
        table_description: schema.description || '',
        columns: (schema.columns || []).map((c) => ({
          column_name: c.name,
          data_type: c.type,
          is_nullable: c.nullable ? 'YES' : 'NO',
          column_description: c.description || '',
          sample_values: c.sampleValues || [],
        })),
        primary_keys: schema.primaryKeys || [],
      };
    } catch (e) {
      return null;
    }
  }

  async _call(input) {
    const { query, tables, top_k: topK = 8 } = input;
    const startTime = Date.now();

    try {
      const queryText = resolveSearchText({
        input: { query, question: input.question },
        req: this.req,
        conversation: this.conversation,
      });

      logger.info('[LightSchemaTool] _call 开始:', JSON.stringify({
        query: query?.substring(0, 80) || '',
        queryText: queryText?.substring(0, 80) || '',
        tables: tables || [],
        topK,
        hasConversation: !!this.conversation,
        hasReq: !!this.req,
      }));

      const dataSourceId = await this.getDataSourceId(input);
      if (!dataSourceId) {
        return JSON.stringify({
          success: false,
          error: '未找到关联的数据源 ID。请确认当前会话已绑定数据源，或通过 data_source_id 参数指定。',
          suggestion: '可尝试调用 database_schema 工具（会自动读取当前连接的数据源）。',
        });
      }

      const { VectorDBService, EmbeddingService } = this._getServices();
      const vectorDB = new VectorDBService();
      const embeddingService = new EmbeddingService();
      await vectorDB.initialize();

      const tableList = Array.isArray(tables) ? tables.filter(Boolean) : [];
      // 指定了精确表时，语义补充只取 1 条，避免语义结果把精确表挤出上下文窗口
      const semanticTopK = tableList.length > 0 ? 1 : topK;

      const bundle = await retrieveLightSchemaBundle({
        datasourceId: dataSourceId,
        queryText,
        tables: tableList,
        schemaTopK: semanticTopK,
        cellTopK: DEFAULT_CELL_TOP_K,
        vectorDB,
        embeddingService,
      });

      if (bundle.rows.length === 0) {
        logger.info('[LightSchemaTool] 无命中结果，建议降级到 database_schema');
        return JSON.stringify({
          success: false,
          source: 'light_schema',
          error: '未找到匹配的 Light Schema 记录。该数据源可能尚未进行预处理（生成 Light Schema）。',
          suggestion: '请改用 database_schema 工具直接连接数据库获取实时结构，' +
            '或先在管理界面对该数据源执行"生成 Light Schema"操作后再试。',
          dataSource: { id: dataSourceId },
          elapsed_ms: Date.now() - startTime,
        });
      }

      // 精确命中表排最前，语义/cell_boost 补充在后
      const priorityOrder = { exact: 0, semantic: 1, cell_boost: 2 };
      const sortedRows = [...bundle.rows].sort(
        (a, b) => (priorityOrder[a.source] ?? 9) - (priorityOrder[b.source] ?? 9),
      );

      const semanticModels = sortedRows
        .map((r) => this.contentToSemanticModel(r.content))
        .filter(Boolean);

      // 统计指定表中未命中索引的表名
      const missedTables = tableList.filter(
        (t) => !bundle.exactTableNames.some(
          (e) => e === t || e.endsWith(`.${t}`) || t.endsWith(`.${e}`),
        ),
      );

      let instruction =
        'Extract the "semantic_models" array from this response and use it as the ' +
        'semantic_models parameter when calling text-to-sql tool. ' +
        'All schema data comes from the pre-generated Light Schema cache (no DB roundtrip).';

      const response = {
        success: true,
        source: 'light_schema',
        semantic_models: semanticModels,
        tableCount: semanticModels.length,
        retrieval_info: {
          exact_match: bundle.exactTableNames,
          semantic_match: bundle.semanticTableNames,
          cell_table_boost: bundle.cellTableBoost,
          cell_matches: bundle.cellMatches,
          total: semanticModels.length,
          ...(missedTables.length > 0 && {
            not_indexed: missedTables,
            not_indexed_hint: `以下指定表在 Light Schema 索引中未找到（可能表名有误或尚未索引）：${missedTables.join(', ')}。` +
              '建议改用 sql-executor 查 information_schema.columns 获取实时结构。',
          }),
        },
        format: 'semantic',
        instruction,
        dataSource: { id: dataSourceId },
        elapsed_ms: Date.now() - startTime,
      };

      if (bundle.cellMatchStr) {
        response.value_hints = bundle.cellMatchStr;
        response.instruction +=
          ' Additionally, "value_hints" contains column=value matches from cell vectorization ' +
          '— use them to construct accurate WHERE conditions instead of guessing literal values.';
      }

      logger.info(
        `[LightSchemaTool] 完成：精确 ${bundle.exactTableNames.length} 张，` +
        `语义 ${bundle.semanticTableNames.length} 张，` +
        `cell补 ${bundle.cellTableBoost.length} 张，` +
        `cell匹配 ${bundle.cellMatches.length} 条，` +
        `合计 ${semanticModels.length} 张，耗时 ${Date.now() - startTime}ms`,
      );

      return JSON.stringify(response, null, 2);
    } catch (error) {
      logger.error('[LightSchemaTool] 执行失败:', {
        error: error.message,
        stack: error.stack,
      });
      return JSON.stringify({
        success: false,
        source: 'light_schema',
        error: error.message || '未知错误',
        suggestion: '请改用 database_schema 工具作为备选。',
        elapsed_ms: Date.now() - startTime,
      });
    }
  }
}

module.exports = LightSchemaTool;
