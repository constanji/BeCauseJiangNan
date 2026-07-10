const { logger } = require('@because/data-schemas');

/**
 * 向量数据库服务
 * 按照 DAT 系统架构，为每种知识类型创建独立的存储表
 * 直接连接 PostgreSQL + pgvector 数据库存储和检索向量
 */

// Embedding 模型维度配置
// bge-small-zh-v1.5 模型输出 512 维向量
const EMBEDDING_DIMENSION = parseInt(process.env.EMBEDDING_DIMENSION || '512', 10);
/**
 * 检测是否在 Docker 容器内运行
 */
function isRunningInDocker() {
  try {
    const fs = require('fs');
    return fs.existsSync('/.dockerenv') || 
           (fs.existsSync('/proc/self/cgroup') && fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker'));
  } catch (error) {
    return false;
  }
}

class VectorDBService {
  constructor() {
    this.pool = null;
    this.initialized = false;
    
    // 自动检测运行环境并设置默认连接信息
    let defaultHost = 'vectordb';
    let defaultPort = 5432;
    
    // 如果未显式设置环境变量，根据运行环境自动选择
    if (!process.env.VECTOR_DB_HOST && !process.env.DB_HOST) {
      if (!isRunningInDocker()) {
        // 在本地开发环境：使用 localhost 和映射的端口
        defaultHost = 'localhost';
        defaultPort = parseInt(process.env.VECTOR_DB_PORT || process.env.DB_PORT || '5434', 10);
        logger.debug('[VectorDBService] 检测到本地开发环境，使用 localhost:5434 连接向量数据库');
      } else {
        // 在 Docker 容器内：使用容器网络内的主机名
        defaultHost = 'vectordb';
        defaultPort = 5432;
        logger.debug('[VectorDBService] 检测到 Docker 容器环境，使用 vectordb:5432 连接向量数据库');
      }
    }
    
    // 从环境变量或配置获取连接信息
    this.config = {
      host: process.env.VECTOR_DB_HOST || process.env.DB_HOST || defaultHost,
      port: parseInt(process.env.VECTOR_DB_PORT || process.env.DB_PORT || defaultPort.toString(), 10),
      database: process.env.VECTOR_DB_NAME || process.env.POSTGRES_DB || 'mydatabase',
      user: process.env.VECTOR_DB_USER || process.env.POSTGRES_USER || 'myuser',
      password: process.env.VECTOR_DB_PASSWORD || process.env.POSTGRES_PASSWORD || 'mypassword',
      embeddingDimension: EMBEDDING_DIMENSION, // 向量维度
    };
    
    logger.info(`[VectorDBService] 向量数据库连接配置: ${this.config.host}:${this.config.port}/${this.config.database}`);
    logger.info(`[VectorDBService] Embedding 维度: ${this.config.embeddingDimension} (可通过 EMBEDDING_DIMENSION 环境变量配置)`);
  }

  /**
   * 初始化数据库连接
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // 动态加载 pg 库
      let pg;
      try {
        pg = require('pg');
      } catch (error) {
        logger.error('pg (node-postgres) not found. Please install it: npm install pg');
        throw new Error('pg package is required for vector database connection. Install it with: npm install pg');
      }

      // 创建连接池
      const { Pool } = pg;
      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        max: 20, // 最大连接数
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // 测试连接
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();

      // 确保 pgvector 扩展已启用
      await this.ensureExtension();

      // 确保表结构存在
      await this.ensureTables();

      this.initialized = true;
      logger.info('[VectorDBService] Vector database connection initialized successfully');
    } catch (error) {
      logger.error('[VectorDBService] Failed to initialize vector database:', error);
      throw error;
    }
  }

  /**
   * 确保 pgvector 扩展已启用
   */
  async ensureExtension() {
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      logger.debug('[VectorDBService] pgvector extension enabled');
    } catch (error) {
      logger.warn('[VectorDBService] Failed to enable pgvector extension (may already be enabled):', error.message);
    }
  }

  /**
   * 确保表结构存在
   * 按照 DAT 系统架构，为每种知识类型创建独立的表（独立存储空间）
   */
  async ensureTables() {
    try {
      const embeddingDim = this.config.embeddingDimension;
      
      // 按照 DAT 系统架构，创建四种独立的向量存储表
      // 1. 语义模型向量表 (MDL - Model Definition Language)
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS semantic_model_vectors (
          id SERIAL PRIMARY KEY,
          knowledge_entry_id VARCHAR(255) UNIQUE NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          embedding vector(${embeddingDim}),
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 2. QA对向量表 (SQL - Question-SQL Pair)
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS qa_pair_vectors (
          id SERIAL PRIMARY KEY,
          knowledge_entry_id VARCHAR(255) UNIQUE NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          embedding vector(${embeddingDim}),
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 3. 同义词向量表 (SYN - Synonym Pair)
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS synonym_vectors (
          id SERIAL PRIMARY KEY,
          knowledge_entry_id VARCHAR(255) UNIQUE NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          embedding vector(${embeddingDim}),
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 4. 业务知识向量表 (DOC - Document)
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS business_knowledge_vectors (
          id SERIAL PRIMARY KEY,
          knowledge_entry_id VARCHAR(255) UNIQUE NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          embedding vector(${embeddingDim}),
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 为每个表创建用户索引
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_semantic_model_vectors_user_id 
        ON semantic_model_vectors(user_id)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_qa_pair_vectors_user_id 
        ON qa_pair_vectors(user_id)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_synonym_vectors_user_id 
        ON synonym_vectors(user_id)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_business_knowledge_vectors_user_id 
        ON business_knowledge_vectors(user_id)
      `);

      // 为每个表创建向量相似度搜索索引（使用 HNSW）
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_semantic_model_vectors_embedding_hnsw 
        ON semantic_model_vectors 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_qa_pair_vectors_embedding_hnsw 
        ON qa_pair_vectors 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_synonym_vectors_embedding_hnsw 
        ON synonym_vectors 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_business_knowledge_vectors_embedding_hnsw 
        ON business_knowledge_vectors 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);

      // 创建文件向量表（兼容现有文件向量化）
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS file_vectors (
          id SERIAL PRIMARY KEY,
          file_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255),
          entity_id VARCHAR(255),
          chunk_index INTEGER DEFAULT 0,
          content TEXT NOT NULL,
          embedding vector(${embeddingDim}),
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建文件向量索引
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_file_vectors_file_id 
        ON file_vectors(file_id)
      `);

      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_file_vectors_embedding_hnsw 
        ON file_vectors 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);

      // Light Schema 向量表：每个数据源的每张表一条记录（含 DDL 文本 + 结构 JSON）
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS light_schema_vectors (
          id            SERIAL PRIMARY KEY,
          datasource_id VARCHAR(255) NOT NULL,
          table_name    VARCHAR(255) NOT NULL,
          content       TEXT NOT NULL,
          ddl_text      TEXT,
          embedding     vector(${embeddingDim}),
          created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(datasource_id, table_name)
        )
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_light_schema_vectors_ds
          ON light_schema_vectors(datasource_id)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_light_schema_vectors_hnsw
          ON light_schema_vectors USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64)
      `);

      // Cell 向量表：每个文本列的每个枚举值单独一条（用于字面量语义匹配）
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS cell_vectors (
          id            SERIAL PRIMARY KEY,
          datasource_id VARCHAR(255) NOT NULL,
          table_name    VARCHAR(255) NOT NULL,
          column_name   VARCHAR(255) NOT NULL,
          cell_value    TEXT NOT NULL,
          embedding     vector(${embeddingDim}),
          created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_cell_vectors_ds_table
          ON cell_vectors(datasource_id, table_name)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_cell_vectors_hnsw
          ON cell_vectors USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64)
      `);

      logger.debug('[VectorDBService] Database tables and indexes created (DAT architecture: independent tables per type)');
    } catch (error) {
      logger.error('[VectorDBService] Failed to create tables:', error);
      throw error;
    }
  }

  /**
   * 获取表名（根据知识类型）
   * 按照 DAT 系统架构，每种类型对应独立的表
   * @param {string} type - 知识类型
   * @returns {string} 表名
   */
  getTableName(type) {
    const tableMap = {
      semantic_model: 'semantic_model_vectors',
      qa_pair: 'qa_pair_vectors',
      synonym: 'synonym_vectors',
      business_knowledge: 'business_knowledge_vectors',
    };
    return tableMap[type] || null;
  }

  /**
   * 存储知识条目向量
   * 按照 DAT 系统架构，每种类型存储到对应的独立表
   * 存储流程：JSON序列化 → 向量化 → 存储到对应的独立表
   * @param {Object} params
   * @param {string} params.knowledgeEntryId - 知识条目ID
   * @param {string} params.userId - 用户ID
   * @param {string} params.type - 知识类型
   * @param {string} params.content - 内容（JSON序列化）
   * @param {number[]} params.embedding - 向量嵌入
   * @param {Object} params.metadata - 元数据
   * @returns {Promise<boolean>} 是否成功
   */
  async storeKnowledgeVector({ knowledgeEntryId, userId, type, content, embedding, metadata = {} }) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // 验证 embedding 维度
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Embedding must be a non-empty array');
      }

      const actualDimension = embedding.length;
      const expectedDimension = this.config.embeddingDimension;
      
      if (actualDimension !== expectedDimension) {
        const errorMsg = `Embedding dimension mismatch: got ${actualDimension}, expected ${expectedDimension}. ` +
          `Please check your embedding model output dimension and VectorDB table schema. ` +
          `You can configure EMBEDDING_DIMENSION environment variable to match your model.`;
        logger.error(`[VectorDBService] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // 根据类型获取对应的表名
      const tableName = this.getTableName(type);
      if (!tableName) {
        throw new Error(`不支持的知识类型: ${type}`);
      }

      // 将数组转换为 pgvector 格式
      const embeddingStr = `[${embedding.join(',')}]`;

      // 存储到对应的独立表（按照 DAT 架构）
      await this.pool.query(
        `INSERT INTO ${tableName} 
         (knowledge_entry_id, user_id, content, embedding, metadata, updated_at)
         VALUES ($1, $2, $3, $4::vector, $5::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (knowledge_entry_id) 
         DO UPDATE SET 
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding::vector,
           metadata = EXCLUDED.metadata::jsonb,
           updated_at = CURRENT_TIMESTAMP`,
        [knowledgeEntryId, userId, content, embeddingStr, JSON.stringify(metadata)]
      );

      logger.debug(`[VectorDBService] Stored vector for ${type} in table ${tableName}: ${knowledgeEntryId}`);
      return true;
    } catch (error) {
      logger.error('[VectorDBService] Failed to store knowledge vector:', error);
      throw error;
    }
  }

  /**
   * 更新知识向量（实际上使用 storeKnowledgeVector，因为它已经支持 ON CONFLICT DO UPDATE）
   * @param {Object} params
   * @param {string} params.knowledgeEntryId - 知识条目ID
   * @param {string} params.userId - 用户ID
   * @param {string} params.type - 知识类型
   * @param {string} params.content - 内容（JSON序列化）
   * @param {number[]} params.embedding - 向量嵌入
   * @param {Object} params.metadata - 元数据
   * @returns {Promise<boolean>} 是否成功
   */
  async updateKnowledgeVector({ knowledgeEntryId, userId, type, content, embedding, metadata = {} }) {
    // storeKnowledgeVector 已经支持 ON CONFLICT DO UPDATE，所以直接调用它
    return await this.storeKnowledgeVector({
      knowledgeEntryId,
      userId,
      type,
      content,
      embedding,
      metadata,
    });
  }

  /**
   * 从单个表中搜索相似向量
   * 按照 DAT 系统架构，每个类型在独立的表中搜索
 
   * 支持entityId数据源隔离
   * @param {Object} params
   * @param {string} params.tableName - 表名
   * @param {string} params.queryEmbedding - 查询向量
   * @param {string} params.type - 知识类型
   * @param {string} [params.entityId] - 实体ID（数据源隔离，可选）
   * @param {number} params.topK - 返回前K个结果
   * @param {number} params.minScore - 最小相似度分数
   * @returns {Promise<Array>} 搜索结果数组
   */
  async searchInTable({ tableName, queryEmbedding, type, entityId, topK, minScore }) {
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // 构建查询条件：支持entityId数据源隔离
    let whereClause = 'WHERE embedding IS NOT NULL\n        AND 1 - (embedding <=> $1::vector) >= $2';
    const queryParams = [embeddingStr, minScore];

    if (entityId) {
      // 确保entityId是字符串格式（PostgreSQL JSON字段比较需要精确匹配）
      let entityIdStr = typeof entityId === 'string' ? entityId : String(entityId);
      
      // 移除可能的JSON引号（如果entityId被错误地JSON.stringify了）
      // 例如："696e11c6c8717a92aee4e699" -> 696e11c6c8717a92aee4e699
      if (entityIdStr.startsWith('"') && entityIdStr.endsWith('"')) {
        entityIdStr = entityIdStr.slice(1, -1);
        logger.warn(`[VectorDBService] searchInTable - 检测到entityId包含引号，已移除: 原始="${entityId}", 处理后="${entityIdStr}"`);
      }
      
      // 诊断：先检查表中是否有匹配的entity_id记录
      try {
        const countQuery = `SELECT COUNT(*) as count FROM ${tableName} WHERE metadata->>'entity_id' = $1`;
        const countResult = await this.pool.query(countQuery, [entityIdStr]);
        const totalCount = parseInt(countResult.rows[0]?.count || '0', 10);
        logger.info(`[VectorDBService] searchInTable - 诊断查询: 表 ${tableName} 中entity_id="${entityIdStr}"的总记录数: ${totalCount}`);
        
        if (totalCount === 0) {
          // 检查表中实际存储的entity_id格式
          const sampleQuery = `SELECT DISTINCT metadata->>'entity_id' as entity_id FROM ${tableName} LIMIT 3`;
          const sampleResult = await this.pool.query(sampleQuery);
          const sampleEntityIds = sampleResult.rows.map(r => r.entity_id).filter(Boolean);
          if (sampleEntityIds.length > 0) {
            logger.warn(`[VectorDBService] searchInTable - 表中实际存储的entity_id样本: ${JSON.stringify(sampleEntityIds)}`);
            logger.warn(`[VectorDBService] searchInTable - 查询的entity_id: "${entityIdStr}"`);
          } else {
            logger.warn(`[VectorDBService] searchInTable - 表中没有entity_id字段的记录`);
          }
        }
      } catch (diagError) {
        logger.warn(`[VectorDBService] searchInTable - 诊断查询失败:`, diagError.message);
      }
      
      // 使用metadata->>'entity_id'进行文本比较（这是最直接的方式）
      whereClause += '\n        AND metadata->>\'entity_id\' = $3';
      queryParams.push(entityIdStr);
      
      logger.info(`[VectorDBService] searchInTable - 使用entityId过滤: "${entityIdStr}" (原始类型: ${typeof entityId}, 长度: ${entityIdStr.length}, 表: ${tableName})`);
    } else {
      logger.info(`[VectorDBService] searchInTable - 未使用entityId过滤 (表: ${tableName})`);
    }
    
    const limitParamIndex = queryParams.length + 1;
    const query = `
      SELECT
        knowledge_entry_id,
        user_id,
        content,
        metadata,
        1 - (embedding <=> $1::vector) as similarity
      FROM ${tableName}
      ${whereClause}
      ORDER BY embedding <=> $1::vector
      LIMIT $${limitParamIndex}
    `;

    queryParams.push(topK);

    logger.debug(`[VectorDBService] searchInTable - 执行SQL查询 (表: ${tableName}):`, {
      queryPreview: query.substring(0, 200) + '...',
      paramCount: queryParams.length,
      entityId: entityId ? (typeof entityId === 'string' ? entityId : String(entityId)) : null,
    });

    const result = await this.pool.query(query, queryParams);

    logger.info(`[VectorDBService] searchInTable - 查询完成 (表: ${tableName}): 返回 ${result.rows.length} 行 (minScore: ${minScore})`);
    
    // 如果返回0个结果，尝试不设置minScore限制看看有多少记录
    if (result.rows.length === 0 && entityId) {
      try {
        const testQuery = `
          SELECT 
            knowledge_entry_id,
            1 - (embedding <=> $1::vector) as similarity
          FROM ${tableName}
          WHERE embedding IS NOT NULL
            AND metadata->>'entity_id' = $2
          ORDER BY embedding <=> $1::vector
          LIMIT 5
        `;
        const testResult = await this.pool.query(testQuery, [embeddingStr, typeof entityId === 'string' ? entityId : String(entityId)]);
        if (testResult.rows.length > 0) {
          const maxSimilarity = Math.max(...testResult.rows.map(r => parseFloat(r.similarity)));
          logger.warn(`[VectorDBService] searchInTable - 未设置minScore限制时找到 ${testResult.rows.length} 条记录，最高相似度: ${maxSimilarity.toFixed(4)} (minScore要求: ${minScore})`);
        }
      } catch (testError) {
        logger.debug(`[VectorDBService] searchInTable - 测试查询失败:`, testError.message);
      }
    }

    return result.rows.map(row => ({
      knowledgeEntryId: row.knowledge_entry_id,
      userId: row.user_id,
      type: type, // 添加类型信息
      content: row.content,
      metadata: row.metadata,
      score: parseFloat(row.similarity),
      similarity: parseFloat(row.similarity),
    }));
  }

  /**
   * 从file_vectors表中检索文件chunk
   * 支持两种模式：
   * 1. 通过file_id过滤：只检索指定文件的chunk（用于业务知识上传文档）
   * 2. 直接相似度搜索：在所有文件的chunk中搜索（用于混合检索）
   * 
   * @param {Object} params
   * @param {number[]} params.queryEmbedding - 查询向量
   * @param {string} [params.fileId] - 文件ID（可选，如果提供则只检索该文件的chunk）
   * @param {string} [params.userId] - 用户ID（用户隔离，可选）
   * @param {string} [params.entityId] - 实体ID（数据源隔离，可选）
   * @param {number} params.topK - 返回前K个结果
   * @param {number} params.minScore - 最小相似度分数
   * @returns {Promise<Array>} 搜索结果数组
   */
  async searchFileVectors({ queryEmbedding, rawQuery, fileId, userId, entityId, topK = 10, minScore = 0.5 }) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const {
        computeTextMatchScore,
        applyVectorColumnWeight,
        parseMetadataFlag,
      } = require('~/server/services/Files/ExcelColumnSearchUtils');
      const PRIMARY_CELL_FETCH_LIMIT = 5000;

      const formatRow = (row, similarity) => ({
        fileId: row.file_id,
        chunkIndex: row.chunk_index,
        content: row.content,
        metadata: row.metadata || {},
        score: similarity,
        similarity,
      });

      let usePrimaryBoost = false;
      if (entityId) {
        const primaryCheck = await this.pool.query(
          `SELECT 1 FROM file_vectors
           WHERE metadata->>'source' = 'excel_cell'
             AND metadata->>'entity_id' = $1
             AND metadata->>'is_primary_column' = 'true'
           LIMIT 1`,
          [entityId],
        );
        usePrimaryBoost = primaryCheck.rows.length > 0;
      }

      // ── 文本精确匹配（Excel 编码/ID 类查询，主列优先）────────────────────
      let textRows = [];
      if (rawQuery && entityId) {
        const runTextQuery = async (primaryOnly) => {
          const textParams = [entityId, `%${rawQuery}%`, topK * 5];
          let textWhere = `WHERE metadata->>'source' = 'excel_cell' AND metadata->>'entity_id' = $1 AND content ILIKE $2`;
          if (primaryOnly) {
            textWhere += ` AND metadata->>'is_primary_column' = 'true'`;
          }
          if (fileId) {
            textWhere += ` AND file_id = $4`;
            textParams.push(fileId);
          }
          if (userId) {
            textWhere += ` AND user_id = $${textParams.length + 1}`;
            textParams.push(userId.toString());
          }
          return this.pool.query(
            `SELECT file_id, chunk_index, content, metadata FROM file_vectors ${textWhere} LIMIT $3`,
            textParams,
          );
        };

        const mapText = (rows, { forcePrimary } = {}) =>
          rows
            .map((row) => {
              const isPrimary = forcePrimary ?? parseMetadataFlag(row.metadata?.is_primary_column);
              const score = computeTextMatchScore({
                query: rawQuery,
                cellValue: row.content,
                isPrimaryColumn: isPrimary,
                hasPrimaryConfig: usePrimaryBoost,
              });
              if (score == null) return null;
              return formatRow(row, score);
            })
            .filter(Boolean);

        if (usePrimaryBoost) {
          // 主列数据量通常有限（机构/指标主档），全量拉取后在 JS 侧做精确/包含/有序子序列模糊评分，
          // 避免 ILIKE 要求连续子串导致漏掉"溧阳支行"命中"溧阳市支行"这类中间插字场景。
          const primaryParams = [entityId];
          let primaryWhere = `WHERE metadata->>'source' = 'excel_cell' AND metadata->>'entity_id' = $1 AND metadata->>'is_primary_column' = 'true'`;
          if (fileId) {
            primaryWhere += ` AND file_id = $${primaryParams.length + 1}`;
            primaryParams.push(fileId);
          }
          if (userId) {
            primaryWhere += ` AND user_id = $${primaryParams.length + 1}`;
            primaryParams.push(userId.toString());
          }
          primaryParams.push(PRIMARY_CELL_FETCH_LIMIT);
          const primaryResult = await this.pool.query(
            `SELECT file_id, chunk_index, content, metadata FROM file_vectors ${primaryWhere} LIMIT $${primaryParams.length}`,
            primaryParams,
          );
          textRows = mapText(primaryResult.rows, { forcePrimary: true });

          if (textRows.length < topK) {
            const seen = new Set(textRows.map((r) => `${r.fileId}:${r.chunkIndex}`));
            const fallback = mapText((await runTextQuery(false)).rows).filter(
              (r) => !seen.has(`${r.fileId}:${r.chunkIndex}`),
            );
            textRows = [...textRows, ...fallback];
          }
        } else {
          textRows = mapText((await runTextQuery(false)).rows);
        }
        textRows.sort((a, b) => b.score - a.score);
      }
      const textKeys = new Set(textRows.map((r) => `${r.fileId}:${r.chunkIndex}`));

      // ── 向量语义检索 ──────────────────────────────────────────────────────
      const embeddingStr = `[${queryEmbedding.join(',')}]`;
      const runVectorQuery = async (primaryOnly, limit) => {
        let whereClause = 'WHERE embedding IS NOT NULL\n        AND 1 - (embedding <=> $1::vector) >= $2';
        const queryParams = [embeddingStr, minScore];
        let paramIndex = 3;

        if (fileId) {
          whereClause += `\n        AND file_id = $${paramIndex}`;
          queryParams.push(fileId);
          paramIndex++;
        }
        if (userId) {
          whereClause += `\n        AND user_id = $${paramIndex}`;
          queryParams.push(userId.toString());
          paramIndex++;
        }
        if (entityId) {
          whereClause += `\n        AND metadata->>'entity_id' = $${paramIndex}`;
          queryParams.push(entityId);
          paramIndex++;
        }
        if (primaryOnly) {
          whereClause += `\n        AND metadata->>'source' = 'excel_cell'`;
          whereClause += `\n        AND metadata->>'is_primary_column' = 'true'`;
        }

        queryParams.push(limit);
        return this.pool.query(
          `SELECT file_id, chunk_index, content, metadata,
                  1 - (embedding <=> $1::vector) as similarity
           FROM file_vectors ${whereClause}
           ORDER BY embedding <=> $1::vector
           LIMIT $${paramIndex}`,
          queryParams,
        );
      };

      let vectorRows = (await runVectorQuery(usePrimaryBoost, topK * 3)).rows
        .map((row) => {
          const isPrimary = parseMetadataFlag(row.metadata?.is_primary_column);
          const weighted = applyVectorColumnWeight(parseFloat(row.similarity), isPrimary, usePrimaryBoost);
          return formatRow(row, weighted);
        })
        .filter((r) => !textKeys.has(`${r.fileId}:${r.chunkIndex}`));

      if (usePrimaryBoost && vectorRows.length < topK) {
        const seen = new Set(vectorRows.map((r) => `${r.fileId}:${r.chunkIndex}`));
        const fallback = (await runVectorQuery(false, topK * 3)).rows
          .map((row) => {
            const isPrimary = parseMetadataFlag(row.metadata?.is_primary_column);
            const weighted = applyVectorColumnWeight(parseFloat(row.similarity), isPrimary, usePrimaryBoost);
            return formatRow(row, weighted);
          })
          .filter((r) => !textKeys.has(`${r.fileId}:${r.chunkIndex}`) && !seen.has(`${r.fileId}:${r.chunkIndex}`));
        vectorRows = [...vectorRows, ...fallback];
      }

      let merged = [...textRows, ...vectorRows];
      if (usePrimaryBoost) {
        const primaryMerged = merged.filter((r) => parseMetadataFlag(r.metadata?.is_primary_column));
        if (primaryMerged.length > 0) merged = primaryMerged;
      }

      return merged
        .sort(
          (a, b) =>
            (parseMetadataFlag(b.metadata?.is_primary_column) ? 1 : 0) -
              (parseMetadataFlag(a.metadata?.is_primary_column) ? 1 : 0) || b.score - a.score,
        )
        .slice(0, topK);
    } catch (error) {
      logger.error('[VectorDBService] 文件向量检索失败:', error);
      throw error;
    }
  }

  /**
   * 相似度搜索
   * 按照 DAT 系统架构，从对应的独立表中搜索
   * 查找流程：问题向量化 → 在对应的独立表中搜索 → 返回结果
 
   * 支持entityId数据源隔离
   * @param {Object} params
   * @param {number[]} params.queryEmbedding - 查询向量
   * @param {string[]} params.types - 知识类型过滤（如果为空，搜索所有类型）
   * @param {string} [params.entityId] - 实体ID（数据源隔离，可选）
   * @param {number} params.topK - 返回前K个结果（每个类型）
   * @param {number} params.minScore - 最小相似度分数
   * @returns {Promise<Array>} 搜索结果数组
   */
  async searchSimilar({ queryEmbedding, types, entityId, topK = 10, minScore = 0.5 }) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const allTypes = ['semantic_model', 'qa_pair', 'synonym', 'business_knowledge'];
      const searchTypes = types && types.length > 0 ? types : allTypes;
      const isolationInfo = entityId ? `, entityId: ${entityId} (数据源隔离, 类型: ${typeof entityId})` : ' (无数据源隔离)';
      logger.info(`[VectorDBService] 开始向量相似度搜索 (类型数: ${searchTypes.length}, topK: ${topK}, minScore: ${minScore})${isolationInfo}`);

      // 按照 DAT 架构，从每个类型的独立表中搜索
      const searchPromises = searchTypes.map(async (type) => {
        const tableName = this.getTableName(type);
        if (!tableName) {
          logger.warn(`[VectorDBService] 未知的知识类型: ${type}`);
          return [];
        }

        try {
          return await this.searchInTable({
            tableName,
            queryEmbedding,
            type,
            entityId, // 传递entityId进行数据源隔离
            topK, // 每个类型返回 topK 个结果
            minScore,
          });
        } catch (error) {
          logger.warn(`[VectorDBService] 从表 ${tableName} 搜索失败:`, error.message);
          return [];
        }
      });

      // 等待所有搜索完成
      const resultsArrays = await Promise.all(searchPromises);
      const allResults = resultsArrays.flat();

      // 按相似度分数排序，返回前 topK 个结果
      const sortedResults = allResults
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      logger.info(`[VectorDBService] 从 ${searchTypes.length} 个独立表中完成向量相似度搜索，返回 ${sortedResults.length} 个结果 (搜索类型: ${searchTypes.join(', ')})${isolationInfo}`);
      logger.debug(`[VectorDBService] Found ${sortedResults.length} similar vectors from ${searchTypes.length} independent tables (DAT architecture, no user isolation${entityId ? ', entity isolation enabled' : ''})`);
      return sortedResults;
    } catch (error) {
      logger.error('[VectorDBService] Failed to search similar vectors:', error);
      throw error;
    }
  }

  /**
   * 删除知识条目向量
   * 按照 DAT 系统架构，从对应的独立表中删除
   * @param {string} knowledgeEntryId - 知识条目ID
   * @param {string} type - 知识类型（可选，如果不提供则从所有表中删除）
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteKnowledgeVector(knowledgeEntryId, type = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (type) {
        // 从指定类型的表中删除
        const tableName = this.getTableName(type);
        if (!tableName) {
          throw new Error(`不支持的知识类型: ${type}`);
        }

        const result = await this.pool.query(
          `DELETE FROM ${tableName} WHERE knowledge_entry_id = $1`,
          [knowledgeEntryId]
        );

        logger.debug(`[VectorDBService] Deleted vector for ${type} from ${tableName}: ${knowledgeEntryId}`);
        return result.rowCount > 0;
      } else {
        // 从所有表中删除（用于兼容性）
        const allTypes = ['semantic_model', 'qa_pair', 'synonym', 'business_knowledge'];
        let deleted = false;

        for (const t of allTypes) {
          const tableName = this.getTableName(t);
          if (tableName) {
            const result = await this.pool.query(
              `DELETE FROM ${tableName} WHERE knowledge_entry_id = $1`,
              [knowledgeEntryId]
            );
            if (result.rowCount > 0) {
              deleted = true;
              logger.debug(`[VectorDBService] Deleted vector from ${tableName}: ${knowledgeEntryId}`);
            }
          }
        }

        return deleted;
      }
    } catch (error) {
      logger.error('[VectorDBService] Failed to delete knowledge vector:', error);
      throw error;
    }
  }

  // ─────────────────────────────── Light Schema ────────────────────────────────

  /**
   * UPSERT 多条 Light Schema 向量记录
   * @param {string} datasourceId
   * @param {Array<{tableName, content, ddlText, embedding}>} schemas
   */
  async upsertLightSchemas(datasourceId, schemas) {
    if (!this.initialized) await this.initialize();
    for (const { tableName, content, ddlText, embedding } of schemas) {
      const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;
      await this.pool.query(
        `INSERT INTO light_schema_vectors (datasource_id, table_name, content, ddl_text, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (datasource_id, table_name) DO UPDATE SET
           content = EXCLUDED.content,
           ddl_text = EXCLUDED.ddl_text,
           embedding = EXCLUDED.embedding,
           created_at = CURRENT_TIMESTAMP`,
        [datasourceId, tableName, content, ddlText || null, embeddingStr],
      );
    }
    logger.info(`[VectorDBService] Upserted ${schemas.length} light schemas for datasource: ${datasourceId}`);
  }

  /**
   * 删除 Light Schema 向量记录（全量或按表名）
   * @param {string} datasourceId
   * @param {string[]|null} tableNames  为 null 时清空该数据源全部记录
   */
  async deleteLightSchemas(datasourceId, tableNames = null) {
    if (!this.initialized) await this.initialize();
    let result;
    if (tableNames && tableNames.length > 0) {
      result = await this.pool.query(
        `DELETE FROM light_schema_vectors WHERE datasource_id = $1 AND table_name = ANY($2)`,
        [datasourceId, tableNames],
      );
    } else {
      result = await this.pool.query(
        `DELETE FROM light_schema_vectors WHERE datasource_id = $1`,
        [datasourceId],
      );
    }
    return result.rowCount ?? 0;
  }

  /**
   * 按数据源 ID 查询所有 Light Schema（不做向量相似度，直接全量返回）
   * @param {string} datasourceId
   * @returns {Promise<Array<{tableName, content, ddlText, createdAt}>>}
   */
  async getLightSchemas(datasourceId) {
    if (!this.initialized) await this.initialize();
    const result = await this.pool.query(
      `SELECT table_name, content, ddl_text, created_at
       FROM light_schema_vectors WHERE datasource_id = $1 ORDER BY table_name`,
      [datasourceId],
    );
    return result.rows.map((r) => ({
      tableName: r.table_name,
      content: r.content,
      ddlText: r.ddl_text,
      createdAt: r.created_at,
    }));
  }

  /**
   * 按表名精确查询 Light Schema（不做向量相似度）
   * @param {string} datasourceId
   * @param {string[]} tableNames
   * @returns {Promise<Array<{tableName, content, score}>>}
   */
  async getLightSchemasByTableNames(datasourceId, tableNames) {
    if (!this.initialized) await this.initialize();
    if (!tableNames || tableNames.length === 0) return [];
    const result = await this.pool.query(
      `SELECT table_name, content
       FROM light_schema_vectors
       WHERE datasource_id = $1 AND table_name = ANY($2)
       ORDER BY table_name`,
      [datasourceId, tableNames],
    );
    return result.rows.map((r) => ({
      tableName: r.table_name,
      content: r.content,
      score: 1.0,
    }));
  }

  /**
   * 向量相似度搜索 Light Schema
   * @param {string} datasourceId
   * @param {number[]} queryEmbedding
   * @param {number} topK
   * @returns {Promise<Array<{tableName, content, score}>>}
   */
  async searchLightSchema(datasourceId, queryEmbedding, topK = 5) {
    if (!this.initialized) await this.initialize();
    const embeddingStr = `[${queryEmbedding.join(',')}]`;
    const result = await this.pool.query(
      `SELECT table_name, content,
              1 - (embedding <=> $1::vector) AS score
       FROM light_schema_vectors
       WHERE datasource_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [embeddingStr, datasourceId, topK],
    );
    return result.rows.map((r) => ({
      tableName: r.table_name,
      content: r.content,
      score: parseFloat(r.score),
    }));
  }

  // ─────────────────────────────── Cell Vectors ────────────────────────────────

  /**
   * 批量 INSERT cell 向量记录（不去重，调用方在插入前应先 deleteCells）
   * @param {string} datasourceId
   * @param {Array<{tableName, columnName, cellValue, embedding}>} rows
   */
  async insertCells(datasourceId, rows) {
    if (!this.initialized) await this.initialize();
    if (!rows || rows.length === 0) return;
    for (const { tableName, columnName, cellValue, embedding } of rows) {
      const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;
      await this.pool.query(
        `INSERT INTO cell_vectors (datasource_id, table_name, column_name, cell_value, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)`,
        [datasourceId, tableName, columnName, cellValue, embeddingStr],
      );
    }
    logger.info(`[VectorDBService] Inserted ${rows.length} cell vectors for datasource: ${datasourceId}`);
  }

  /**
   * 删除 cell 向量（全量或按表名）
   * @param {string} datasourceId
   * @param {string[]|null} tableNames  为 null 时清空该数据源全部记录
   */
  async deleteCells(datasourceId, tableNames = null) {
    if (!this.initialized) await this.initialize();
    let result;
    if (tableNames && tableNames.length > 0) {
      result = await this.pool.query(
        `DELETE FROM cell_vectors WHERE datasource_id = $1 AND table_name = ANY($2)`,
        [datasourceId, tableNames],
      );
    } else {
      result = await this.pool.query(
        `DELETE FROM cell_vectors WHERE datasource_id = $1`,
        [datasourceId],
      );
    }
    return result.rowCount ?? 0;
  }

  /**
   * 按表聚合 Cell 向量统计（不受明细 LIMIT 影响）
   * @param {string} datasourceId
   * @returns {Promise<{ totalValues: number, totalTables: number, totalColumns: number, tables: Array<{ tableName: string, valueCount: number, columnCount: number }> }>}
   */
  async getCellSummary(datasourceId) {
    if (!this.initialized) await this.initialize();

    const totalsResult = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total_values,
         COUNT(DISTINCT table_name)::int AS total_tables,
         COUNT(DISTINCT (table_name, column_name))::int AS total_columns
       FROM cell_vectors
       WHERE datasource_id = $1`,
      [datasourceId],
    );

    const tablesResult = await this.pool.query(
      `SELECT
         table_name,
         COUNT(*)::int AS value_count,
         COUNT(DISTINCT column_name)::int AS column_count
       FROM cell_vectors
       WHERE datasource_id = $1
       GROUP BY table_name
       ORDER BY table_name`,
      [datasourceId],
    );

    const totals = totalsResult.rows[0] || {};
    return {
      totalValues: totals.total_values || 0,
      totalTables: totals.total_tables || 0,
      totalColumns: totals.total_columns || 0,
      tables: tablesResult.rows.map((r) => ({
        tableName: r.table_name,
        valueCount: r.value_count,
        columnCount: r.column_count,
      })),
    };
  }

  /**
   * 查询指定数据源下的 cell 向量记录
   * @param {string} datasourceId
   * @param {{ tableName?: string, columnName?: string, limit?: number }} [options]
   * @returns {Promise<Array<{id:number, tableName:string, columnName:string, cellValue:string, createdAt:string}>>}
   */
  async getCells(datasourceId, options = {}) {
    if (!this.initialized) await this.initialize();
    const { tableName, columnName, limit = 1000 } = options;

    const where = ['datasource_id = $1'];
    const params = [datasourceId];

    if (tableName) {
      where.push(`table_name = $${params.length + 1}`);
      params.push(tableName);
    }
    if (columnName) {
      where.push(`column_name = $${params.length + 1}`);
      params.push(columnName);
    }

    params.push(Math.max(1, Math.min(Number(limit) || 1000, 5000)));

    const result = await this.pool.query(
      `SELECT id, table_name, column_name, cell_value, created_at
       FROM cell_vectors
       WHERE ${where.join(' AND ')}
       ORDER BY table_name, column_name, cell_value
       LIMIT $${params.length}`,
      params,
    );

    return result.rows.map((r) => ({
      id: r.id,
      tableName: r.table_name,
      columnName: r.column_name,
      cellValue: r.cell_value,
      createdAt: r.created_at,
    }));
  }

  /**
   * 新增一条 cell 向量记录
   * @param {string} datasourceId
   * @param {{ tableName:string, columnName:string, cellValue:string, embedding:number[]|null }} row
   * @returns {Promise<{id:number, tableName:string, columnName:string, cellValue:string, createdAt:string}>}
   */
  async createCell(datasourceId, row) {
    if (!this.initialized) await this.initialize();
    const { tableName, columnName, cellValue, embedding } = row;
    const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;
    const result = await this.pool.query(
      `INSERT INTO cell_vectors (datasource_id, table_name, column_name, cell_value, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       RETURNING id, table_name, column_name, cell_value, created_at`,
      [datasourceId, tableName, columnName, cellValue, embeddingStr],
    );
    const created = result.rows[0];
    return {
      id: created.id,
      tableName: created.table_name,
      columnName: created.column_name,
      cellValue: created.cell_value,
      createdAt: created.created_at,
    };
  }

  /**
   * 更新一条 cell 向量记录
   * @param {string} datasourceId
   * @param {number|string} cellId
   * @param {{ tableName:string, columnName:string, cellValue:string, embedding:number[]|null }} row
   * @returns {Promise<{id:number, tableName:string, columnName:string, cellValue:string, createdAt:string}|null>}
   */
  async updateCell(datasourceId, cellId, row) {
    if (!this.initialized) await this.initialize();
    const { tableName, columnName, cellValue, embedding } = row;
    const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;
    const result = await this.pool.query(
      `UPDATE cell_vectors
       SET table_name = $3,
           column_name = $4,
           cell_value = $5,
           embedding = $6::vector
       WHERE datasource_id = $1 AND id = $2
       RETURNING id, table_name, column_name, cell_value, created_at`,
      [datasourceId, Number(cellId), tableName, columnName, cellValue, embeddingStr],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const updated = result.rows[0];
    return {
      id: updated.id,
      tableName: updated.table_name,
      columnName: updated.column_name,
      cellValue: updated.cell_value,
      createdAt: updated.created_at,
    };
  }

  /**
   * 删除单条 cell 向量记录
   * @param {string} datasourceId
   * @param {number|string} cellId
   * @returns {Promise<boolean>}
   */
  async deleteCellById(datasourceId, cellId) {
    if (!this.initialized) await this.initialize();
    const result = await this.pool.query(
      `DELETE FROM cell_vectors WHERE datasource_id = $1 AND id = $2`,
      [datasourceId, Number(cellId)],
    );
    return result.rowCount > 0;
  }

  /**
   * 向量相似度搜索 cell 值（用于字面量语义匹配）
   * @param {string} datasourceId
   * @param {number[]} queryEmbedding
   * @param {number} topK
   * @param {number} minScore
   * @returns {Promise<Array<{tableName, columnName, cellValue, score}>>}
   */
  async searchCells(datasourceId, queryEmbedding, topK = 10, minScore = 0.5) {
    if (!this.initialized) await this.initialize();
    const embeddingStr = `[${queryEmbedding.join(',')}]`;
    const result = await this.pool.query(
      `SELECT table_name, column_name, cell_value,
              1 - (embedding <=> $1::vector) AS score
       FROM cell_vectors
       WHERE datasource_id = $2
         AND embedding IS NOT NULL
         AND 1 - (embedding <=> $1::vector) >= $3
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      [embeddingStr, datasourceId, minScore, topK],
    );
    return result.rows.map((r) => ({
      tableName: r.table_name,
      columnName: r.column_name,
      cellValue: r.cell_value,
      score: parseFloat(r.score),
    }));
  }

  /**
   * 获取连接池（用于高级操作）
   * @returns {Object} pg Pool 实例
   */
  getPool() {
    if (!this.initialized) {
      throw new Error('VectorDBService not initialized');
    }
    return this.pool;
  }
}

module.exports = VectorDBService;
