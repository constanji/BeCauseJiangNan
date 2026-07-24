const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { logger } = require('@because/data-schemas');
const path = require('path');

let resolveAgentDataSourceIdFn = null;
function loadAgentDataSourceResolver() {
  if (!resolveAgentDataSourceIdFn) {
    try {
      resolveAgentDataSourceIdFn = require('~/server/services/AgentDataSourceResolver')
        .resolveAgentDataSourceId;
    } catch (e) {
      resolveAgentDataSourceIdFn = require(
        path.resolve(__dirname, '../../../api/server/services/AgentDataSourceResolver'),
      ).resolveAgentDataSourceId;
    }
  }
  return resolveAgentDataSourceIdFn;
}

// 延迟加载RAGService，避免路径别名问题
let RAGService = null;
function loadRAGService() {
  if (!RAGService) {
    try {
      // 尝试使用路径别名（在api目录上下文中有效）
      RAGService = require('~/server/services/RAG').RAGService;
    } catch (e) {
      // 如果路径别名无效，使用相对路径
      RAGService = require(path.resolve(__dirname, '../../../api/server/services/RAG')).RAGService;
    }
  }
  return RAGService;
}

/**
 * RAG Retrieval Tool - RAG知识检索工具
 *
 * 从知识库中检索语义模型、QA对、同义词、业务知识等多源知识
 */
class RAGRetrievalTool extends Tool {
  name = 'rag_retrieval';

  description =
    '从知识库中检索与查询相关的多源知识：语义模型、QA对、同义词、业务知识。' +
    '支持向量检索和重排序，返回结构化的检索结果和相似度分数。';

  schema = z.object({
    query: z
      .string()
      .min(1)
      .describe('查询文本'),
    types: z
      .array(z.enum(['semantic_model', 'qa_pair', 'synonym', 'business_knowledge']))
      .optional()
      .describe('要检索的知识类型，默认全部类型'),
    top_k: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .default(10)
      .describe('返回数量，默认10'),
    use_reranking: z
      .boolean()
      .optional()
      .default(true)
      .describe('是否使用重排序，默认启用'),
    enhanced_reranking: z
      .boolean()
      .optional()
      .default(false)
      .describe('是否使用增强重排序，默认关闭'),
    entity_id: z
      .string()
      .optional()
      .describe('实体ID过滤（数据源ID）'),
    file_ids: z
      .array(z.string())
      .optional()
      .describe('文件ID数组过滤'),
  });

  constructor(fields = {}) {
    super();
    this.userId = fields.userId || 'system';
    this.req = fields.req;
    this.conversation = fields.conversation; // 保存conversation信息
    this.agentDataSourceId = fields.agentDataSourceId || null;
    this.ragService = null; // 延迟初始化
  }

  /**
   * 获取entityId（从conversation或input）
   */
  async getEntityId(input = {}) {
    const cleanId = (id) => {
      if (!id) return null;
      if (typeof id === 'object') {
        const raw = id._id || id.id || (typeof id.toString === 'function' ? id.toString() : null);
        if (raw && String(raw) !== '[object Object]') return cleanId(raw);
      }
      let s = String(id).replace(/^ObjectId\("(.+)"\)$/, '$1').trim();
      while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
      }
      return s || null;
    };

    if (input.entity_id) return cleanId(input.entity_id);
    if (input.data_source_id) return cleanId(input.data_source_id);

    const conv = this.conversation;
    if (conv?.data_source_id) return cleanId(conv.data_source_id);

    const body = this.req?.body;
    if (body?.data_source_id) return cleanId(body.data_source_id);
    if (body?.endpointOption?.data_source_id) return cleanId(body.endpointOption.data_source_id);

    const agentOptions = conv?.agentOptions || conv?.model_parameters || {};
    const fromAgentOpts = cleanId(
      agentOptions.data_source_id || agentOptions.dataSourceId || agentOptions.datasource_id,
    );
    if (fromAgentOpts) return fromAgentOpts;

    if (this.agentDataSourceId) return cleanId(this.agentDataSourceId);

    if (conv?.project_id) {
      try {
        let getProjectByIdFn = null;
        try {
          getProjectByIdFn = require('~/models/Project').getProjectById;
        } catch (e) {
          getProjectByIdFn = require(path.resolve(__dirname, '../../../api/models/Project')).getProjectById;
        }
        const project = await getProjectByIdFn(cleanId(conv.project_id));
        if (project?.data_source_id) return cleanId(project.data_source_id);
      } catch (error) {
        logger.warn('[RAGRetrievalTool] 获取项目数据源失败:', error.message);
      }
    }

    if (body?.project_id || body?.endpointOption?.project_id) {
      try {
        let getProjectByIdFn = null;
        try {
          getProjectByIdFn = require('~/models/Project').getProjectById;
        } catch (e) {
          getProjectByIdFn = require(path.resolve(__dirname, '../../../api/models/Project')).getProjectById;
        }
        const projectId = cleanId(body.project_id || body.endpointOption?.project_id);
        const project = await getProjectByIdFn(projectId);
        if (project?.data_source_id) return cleanId(project.data_source_id);
      } catch (error) {
        logger.warn('[RAGRetrievalTool] 从 req.body.project_id 获取数据源失败:', error.message);
      }
    }

    const agentId = cleanId(body?.agent_id || body?.endpointOption?.agent_id);
    if (agentId) {
      try {
        const resolveFn = loadAgentDataSourceResolver();
        const resolved = await resolveFn(agentId);
        if (resolved) return cleanId(resolved);
      } catch (error) {
        logger.warn('[RAGRetrievalTool] agent 绑定数据源解析失败:', error.message);
      }
    }

    logger.warn('[RAGRetrievalTool] 未找到entityId，将检索所有知识库（不进行数据源隔离）');
    return null;
  }

  /**
   * 获取RAGService实例（延迟加载）
   */
  getRAGService() {
    if (!this.ragService) {
      const RAGServiceClass = loadRAGService();
      this.ragService = new RAGServiceClass();
    }
    return this.ragService;
  }

  /**
   * 调用RAG服务检索知识（直接调用RAGService，不通过HTTP）
   */
  async retrieveKnowledge(query, userId, options = {}) {
    try {
      const {
        types,
        topK = 10,
        useReranking = true,
        enhancedReranking = false,
        entityId,
        fileIds,
      } = options;

      logger.info('[RAGRetrievalTool] 调用RAGService.query:', {
        query: (query || '').substring(0, 30),
        userId,
        types: types || ['semantic_model', 'qa_pair', 'synonym', 'business_knowledge'],
        topK,
        useReranking,
        enhancedReranking,
        entityId,
        fileIds,
      });

      const ragService = this.getRAGService();
      logger.info('[RAGRetrievalTool] RAGService实例已创建');

      // 当有 entityId 时，传入 fileIds: null 触发 hybridRetrieve 中的跨文件检索，
      // 使 Excel 向量化的单元格数据（file_vectors, source='excel_cell'）也被纳入检索范围。
      const resolvedFileIds = fileIds || (entityId ? null : undefined);

      const result = await ragService.query({
        query,
        userId,
        options: {
          types: types || ['semantic_model', 'qa_pair', 'synonym', 'business_knowledge'],
          topK,
          useReranking,
          enhancedReranking,
          entityId,
          fileIds: resolvedFileIds,
        },
      });

      logger.info('[RAGRetrievalTool] RAGService.query返回结果:', {
        total: result.total,
        hasResults: result.results && result.results.length > 0,
        metadata: result.metadata,
      });

      return result;
    } catch (error) {
      logger.error('[RAGRetrievalTool] RAG检索失败:', error);
      logger.error('[RAGRetrievalTool] 错误详情:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
      throw new Error(error.message || 'RAG检索失败');
    }
  }

  /**
   * 检测是否处于离线模式（没有可用的 LLM API key）
   * @returns {boolean} 如果处于离线模式返回 true
   */
  isOfflineMode() {
    // 检查常见的 LLM API keys
    const hasOpenAIKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '');
    const hasAnthropicKey = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim() !== '');
    const hasAzureKey = !!(process.env.AZURE_API_KEY && process.env.AZURE_API_KEY.trim() !== '');
    const hasGoogleKey = !!(process.env.GOOGLE_KEY && process.env.GOOGLE_KEY.trim() !== '');

    // 检查是否有显式的离线模式配置
    const forceOffline = process.env.FORCE_OFFLINE_MODE === 'true' ||
                         process.env.RAG_OFFLINE_MODE === 'true';

    // 如果显式配置了离线模式，直接返回 true
    if (forceOffline) {
      logger.info('[RAGRetrievalTool] 检测到显式离线模式配置');
      return true;
    }

    // 如果没有任何 LLM API key，认为处于离线模式
    const isOffline = !hasOpenAIKey && !hasAnthropicKey && !hasAzureKey && !hasGoogleKey;

    if (isOffline) {
      logger.info('[RAGRetrievalTool] 检测到离线模式：未配置任何 LLM API key');
    }

    return isOffline;
  }

  /**
   * 按类型组织检索结果
   */
  organizeResultsByType(results) {
    const organized = {
      semantic_models: [],
      qa_pairs: [],
      synonyms: [],
      business_knowledge: [],
    };

    if (!results || !Array.isArray(results)) {
      return organized;
    }

    results.forEach((result) => {
      switch (result.type) {
        case 'semantic_model':
          organized.semantic_models.push(result);
          break;
        case 'qa_pair':
          organized.qa_pairs.push(result);
          break;
        case 'synonym':
          organized.synonyms.push(result);
          break;
        case 'business_knowledge':
          organized.business_knowledge.push(result);
          break;
      }
    });

    return organized;
  }

  /**
   * @override
   */
  async _call(input) {
    const {
      query,
      types,
      top_k = 10,
      use_reranking = true,
      enhanced_reranking = false,
      entity_id,
      file_ids,
    } = input || {};

    if (!query || typeof query !== 'string') {
      logger.warn('[RAGRetrievalTool] query 参数缺失或无效:', { query });
      return JSON.stringify({
        query: query || '',
        results: [],
        total: 0,
        error: 'query 参数缺失',
        metadata: { retrieval_count: 0, reranked: false, enhanced_reranking: false },
      }, null, 2);
    }

    try {
      logger.info('[RAGRetrievalTool] 开始RAG检索:', {
        query: query.substring(0, 50),
        types,
        topK: top_k,
        inputEntityId: entity_id,
        toolUserId: this.userId,
        conversation: this.conversation ? {
          data_source_id: this.conversation.data_source_id,
          project_id: this.conversation.project_id,
          conversationId: this.conversation.conversationId
        } : null
      });

      const userId = this.userId || 'system';
      logger.info('[RAGRetrievalTool] 使用userId:', userId);

      // 检查userId是否有效
      if (!userId || userId === 'system') {
        logger.warn('[RAGRetrievalTool] userId无效，可能导致权限问题');
      }

      // 自动获取entityId（如果未提供）
      const finalEntityId = entity_id || await this.getEntityId(input);
      logger.info('[RAGRetrievalTool] 最终entityId:', finalEntityId, '类型:', typeof finalEntityId, 'input.entity_id:', entity_id);

      // 确保entityId格式一致：如果是ObjectId，转换为字符串
      let normalizedEntityId = finalEntityId;
      if (finalEntityId && typeof finalEntityId === 'object' && finalEntityId.toString) {
        normalizedEntityId = finalEntityId.toString();
        logger.info('[RAGRetrievalTool] entityId已标准化为字符串:', normalizedEntityId);
      } else if (typeof finalEntityId === 'string') {
        normalizedEntityId = finalEntityId;
        logger.info('[RAGRetrievalTool] entityId已是字符串格式:', normalizedEntityId);
      } else if (finalEntityId) {
        normalizedEntityId = String(finalEntityId);
        logger.info('[RAGRetrievalTool] entityId转换为字符串:', normalizedEntityId);
      } else {
        logger.info('[RAGRetrievalTool] entityId为空，不进行数据源隔离');
      }

      // 移除可能的JSON引号（如果entityId被错误地JSON.stringify了）
      if (normalizedEntityId && typeof normalizedEntityId === 'string') {
        if (normalizedEntityId.startsWith('"') && normalizedEntityId.endsWith('"')) {
          const original = normalizedEntityId;
          normalizedEntityId = normalizedEntityId.slice(1, -1);
          logger.warn(`[RAGRetrievalTool] 检测到entityId包含引号，已移除: 原始="${original}", 处理后="${normalizedEntityId}"`);
        }
      }

      const ragResults = await this.retrieveKnowledge(query, userId, {
        types,
        topK: top_k,
        useReranking: use_reranking,
        enhancedReranking: enhanced_reranking,
        entityId: normalizedEntityId,
        fileIds: file_ids,
      });

      // 检查检索结果是否为空
      const hasResults = ragResults.results && ragResults.results.length > 0;
      const isOffline = this.isOfflineMode();

      // 关键修复：如果检索结果为 0 且处于离线模式，返回明确的错误消息
      // 避免 Agent 继续调用 LLM（会被拦截导致卡住）
      if (!hasResults && isOffline) {
        const errorMessage = {
          query: ragResults.query,
          results: [],
          total: 0,
          error: 'RAG检索未找到相关知识，且系统处于离线模式（无可用LLM），无法生成回答。',
          error_type: 'OFFLINE_MODE_NO_RESULTS',
          suggestions: [
            '请检查entityId是否正确（当前entityId: ' + (normalizedEntityId || '未指定') + '）',
            '确认知识库中是否有对应entityId的数据',
            '或者配置LLM API key以启用在线模式',
          ],
          metadata: {
            retrieval_count: 0,
            reranked: false,
            enhanced_reranking: false,
            entity_id: normalizedEntityId || null,
            offline_mode: true,
          },
        };

        logger.warn('[RAGRetrievalTool] 检索结果为0且处于离线模式，返回错误消息避免Agent卡住:', {
          entityId: normalizedEntityId,
          offlineMode: true,
        });

        return JSON.stringify(errorMessage, null, 2);
      }

      // 按类型组织结果（可选，便于使用）
      const organizedResults = this.organizeResultsByType(ragResults.results);

      const result = {
        query: ragResults.query,
        results: ragResults.results,
        total: ragResults.total,
        metadata: ragResults.metadata,
        // 额外提供按类型组织的结果
        by_type: organizedResults,
      };

      logger.info('[RAGRetrievalTool] 检索完成:', {
        total: ragResults.total,
        types_found: Object.keys(organizedResults).filter(
          key => organizedResults[key].length > 0
        ),
      });

      return JSON.stringify(result, null, 2);
    } catch (error) {
      logger.error('[RAGRetrievalTool] 检索失败:', error);
      return JSON.stringify(
        {
          query,
          results: [],
          total: 0,
          error: error.message,
          metadata: {
            retrieval_count: 0,
            reranked: false,
            enhanced_reranking: false,
          },
        },
        null,
        2,
      );
    }
  }
}

module.exports = RAGRetrievalTool;
