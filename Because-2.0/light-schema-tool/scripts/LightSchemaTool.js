const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const path = require('path');

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
 * 支持两种模式：
 *   - 语义模式：传入自然语言 query，embed 后做余弦相似度检索
 *   - 精确模式：传入 tables[]，直接按表名查询
 * 两种模式可同时使用，结果合并去重。
 *
 * 与 database_schema 的分工：
 *   - light_schema（本工具）：首选，0 DB 连接开销，依赖预先生成的 Light Schema
 *   - database_schema：兜底，Light Schema 为空或需要最新实时结构时才用
 */
class LightSchemaTool extends Tool {
  name = 'light_schema';

  description =
    '从预生成的 Light Schema 缓存中按需检索数据库表结构，不连接数据库，速度快。' +
    '支持语义检索（传入自然语言问题自动找最相关的表）和精确检索（传入具体表名直接返回）。' +
    '生成 SQL 前优先调用此工具获取表结构，只有当此工具返回空结果（未预处理）时才降级到 database_schema。' +
    '返回格式与 database_schema 完全兼容，可直接将 semantic_models 传给 text-to-sql 工具。';

  schema = z.object({
    query: z
      .string()
      .describe(
        '自然语言查询或关键词，用于语义向量检索最相关的表结构。' +
        '可以是用户的业务问题，也可以是表名/列名关键词。',
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

  // ── 工具方法 ───────────────────────────────────────────────────────────────

  /**
   * 清理数据源 ID，去除多余引号/格式
   */
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

  /**
   * 获取数据源 ID（五级查找链，与 DatabaseSchemaTool 完全一致）
   */
  async getDataSourceId(input) {
    // 1. input 参数直接指定
    if (input.data_source_id) {
      return this.cleanDataSourceId(input.data_source_id);
    }

    // 2. conversation.project_id → Project → data_source_id
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

    // 3. conversation.data_source_id
    if (this.conversation && this.conversation.data_source_id) {
      return this.cleanDataSourceId(this.conversation.data_source_id);
    }

    // 4. req.body.data_source_id / req.body.project_id
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

    // 5. agentOptions / model_parameters（兜底）
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

  /**
   * 获取 VectorDBService 和 EmbeddingService 单例
   */
  _getServices() {
    const VectorDBService = require(
      path.resolve(__dirname, '../../../api/server/services/RAG/VectorDBService'),
    );
    const EmbeddingService = require(
      path.resolve(__dirname, '../../../api/server/services/RAG/EmbeddingService'),
    );
    return { VectorDBService, EmbeddingService };
  }

  /**
   * 精确按表名查询 Light Schema（绕过 embedding，直接 SQL 查）
   * @param {object} vectorDB  已初始化的 VectorDBService 实例
   * @param {string} datasourceId
   * @param {string[]} tableNames
   * @returns {Promise<Array<{tableName, content, score}>>}
   */
  async fetchByTableNames(vectorDB, datasourceId, tableNames) {
    if (!tableNames || tableNames.length === 0) return [];
    try {
      const result = await vectorDB.pool.query(
        `SELECT table_name, content
         FROM light_schema_vectors
         WHERE datasource_id = $1 AND table_name = ANY($2)
         ORDER BY table_name`,
        [datasourceId, tableNames],
      );
      return result.rows.map((r) => ({
        tableName: r.table_name,
        content: r.content,
        score: 1.0, // 精确匹配，得分最高
      }));
    } catch (e) {
      logger.warn('[LightSchemaTool] 按表名精确查询失败:', e.message);
      return [];
    }
  }

  /**
   * 将 Light Schema content JSON 转换为统一的 semantic_model 对象
   */
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

  // ── 主执行逻辑 ─────────────────────────────────────────────────────────────

  async _call(input) {
    const { query, tables, top_k: topK = 8 } = input;
    const startTime = Date.now();

    try {
      logger.info('[LightSchemaTool] _call 开始:', JSON.stringify({
        query: query?.substring(0, 80) || '',
        tables: tables || [],
        topK,
        hasConversation: !!this.conversation,
        hasReq: !!this.req,
      }));

      // ── 1. 解析数据源 ID ──────────────────────────────────────────────────
      const dataSourceId = await this.getDataSourceId(input);
      if (!dataSourceId) {
        return JSON.stringify({
          success: false,
          error: '未找到关联的数据源 ID。请确认当前会话已绑定数据源，或通过 data_source_id 参数指定。',
          suggestion: '可尝试调用 database_schema 工具（会自动读取当前连接的数据源）。',
        });
      }

      // ── 2. 初始化服务 ─────────────────────────────────────────────────────
      const { VectorDBService, EmbeddingService } = this._getServices();
      const vectorDB = new VectorDBService();
      await vectorDB.initialize();

      // ── 3. 双模式检索 ─────────────────────────────────────────────────────
      const exactResults = [];   // 精确模式结果
      const semanticResults = []; // 语义模式结果

      // 3a. 精确模式（tables 不为空）
      if (tables && tables.length > 0) {
        const rows = await this.fetchByTableNames(vectorDB, dataSourceId, tables);
        exactResults.push(...rows);
        logger.info(`[LightSchemaTool] 精确查询命中 ${rows.length}/${tables.length} 张表`);
      }

      // 3b. 语义模式（embed query → cosine search）
      if (query) {
        const embedding = new EmbeddingService();
        const queryEmbedding = await embedding.embedText(query);
        if (queryEmbedding) {
          const rows = await vectorDB.searchLightSchema(dataSourceId, queryEmbedding, topK);
          semanticResults.push(...rows);
          logger.info(`[LightSchemaTool] 语义检索命中 ${rows.length} 张表（top ${topK}）`);
        } else {
          logger.warn('[LightSchemaTool] embedding 生成失败，跳过语义检索');
        }
      }

      // ── 4. 合并去重（精确结果优先） ───────────────────────────────────────
      // key = tableName，精确结果先放入，语义结果不覆盖
      const mergedMap = new Map();
      for (const r of exactResults) {
        mergedMap.set(r.tableName, r);
      }
      for (const r of semanticResults) {
        if (!mergedMap.has(r.tableName)) {
          mergedMap.set(r.tableName, r);
        }
      }

      const merged = [...mergedMap.values()];

      // ── 5. 处理"无结果"情况 ──────────────────────────────────────────────
      if (merged.length === 0) {
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

      // ── 6. 转换为 semantic_models ─────────────────────────────────────────
      const semanticModels = merged
        .map((r) => this.contentToSemanticModel(r.content))
        .filter(Boolean);

      // 按精确/语义分类注释（方便 LLM 理解置信度）
      const exactNames = new Set(exactResults.map((r) => r.tableName));
      const semanticNames = new Set(semanticResults.map((r) => r.tableName));

      logger.info(
        `[LightSchemaTool] 完成：精确 ${exactResults.length} 张，` +
        `语义 ${semanticResults.filter((r) => !exactNames.has(r.tableName)).length} 张，` +
        `合计 ${semanticModels.length} 张，耗时 ${Date.now() - startTime}ms`,
      );

      return JSON.stringify(
        {
          success: true,
          source: 'light_schema',
          semantic_models: semanticModels,
          tableCount: semanticModels.length,
          retrieval_info: {
            exact_match: [...exactNames],
            semantic_match: [...semanticNames].filter((n) => !exactNames.has(n)),
            total: semanticModels.length,
          },
          format: 'semantic',
          instruction:
            'Extract the "semantic_models" array from this response and use it as the ' +
            'semantic_models parameter when calling text-to-sql tool. ' +
            'All schema data comes from the pre-generated Light Schema cache (no DB roundtrip).',
          dataSource: { id: dataSourceId },
          elapsed_ms: Date.now() - startTime,
        },
        null,
        2,
      );
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
