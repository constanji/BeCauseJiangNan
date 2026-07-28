const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const { logger } = require('@because/data-schemas');
const { decryptV2 } = require('@because/api');
const path = require('path');
const { gaussdbJdbcQuery, killProcess: killGaussdbProcess } = require(
  path.join(__dirname, '../../utils/gaussdbJdbcBridge'),
);
const {
  retrieveLightSchemaBundle,
  DEFAULT_CELL_TOP_K,
} = require(path.join(__dirname, '../../utils/lightSchemaRetrieval'));

// 延迟加载模型函数，避免路径别名问题
let getDataSourceById = null;
let getProjectById = null;
let getDataSourceRevisionFn = null;

/**
 * 数据源更新/删除后会 bump 版本号；缓存命中时对比版本号，
 * 不一致就说明配置已变更，需要淘汰旧连接后重建。
 */
function loadCacheRegistry() {
  if (!getDataSourceRevisionFn) {
    try {
      getDataSourceRevisionFn = require('~/server/services/DataSourceCacheRegistry').getDataSourceRevision;
    } catch (e) {
      getDataSourceRevisionFn = require(
        path.resolve(__dirname, '../../../api/server/services/DataSourceCacheRegistry'),
      ).getDataSourceRevision;
    }
  }
  return getDataSourceRevisionFn;
}

function loadDataSourceModel() {
  if (!getDataSourceById) {
    try {
      getDataSourceById = require('~/models/DataSource').getDataSourceById;
    } catch (e) {
      getDataSourceById = require(path.resolve(__dirname, '../../../api/models/DataSource')).getDataSourceById;
    }
  }
  return getDataSourceById;
}

function loadProjectModel() {
  if (!getProjectById) {
    try {
      getProjectById = require('~/models/Project').getProjectById;
    } catch (e) {
      getProjectById = require(path.resolve(__dirname, '../../../api/models/Project')).getProjectById;
    }
  }
  return getProjectById;
}

// 连接池缓存（按数据源ID缓存）
const connectionPools = new Map();

/**
 * 淘汰一个已过期（数据源配置已变更）的缓存连接。
 * GaussDB 走 JDBC 常驻子进程，需要显式杀掉；MySQL/PostgreSQL 的 pool 调用 end() 优雅关闭。
 * 任何一步失败都只记录日志、不阻断重建流程。
 */
async function evictConnectionPool(cleanedId, cached) {
  connectionPools.delete(cleanedId);
  try {
    if (cached?.dataSource?.type === 'gaussdb') {
      killGaussdbProcess(cleanedId);
    } else if (cached?.pool && typeof cached.pool.end === 'function') {
      await cached.pool.end();
    }
  } catch (err) {
    logger.warn('[DatabaseSchemaTool] 关闭旧连接池失败（忽略，继续按最新配置重建）:', err.message);
  }
}

/**
 * Database Schema Tool - 获取数据库表结构信息（重构版）
 *
 * 直接连接数据库获取表结构信息，不再依赖独立的sql-api服务
 * 支持动态数据源切换，从前端业务列表选择的数据源获取Schema
 */
class DatabaseSchemaTool extends Tool {
  name = 'database_schema';

  description =
    '获取数据库的实际表结构信息（语义模型）。这是获取数据库Schema的主要工具，用于SQL生成和意图判断。' +
    '工具会根据前端业务列表中选择的数据源自动连接对应的数据库。' +
    '可以获取所有表的Schema，或指定单个表的详细结构。返回的信息包括表名、列名、数据类型、是否可空、主键、索引等。' +
    '使用 format="semantic" 获取语义模型格式，直接用于 text-to-sql 工具的 semantic_models 参数。' +
    '这是生成SQL查询前必须调用的工具，也可用于意图分类时判断查询是否与数据库相关。' +
    '支持MySQL、PostgreSQL和GaussDB数据库。';

  schema = z.object({
    table: z
      .string()
      .optional()
      .describe('可选：指定表名，只获取该表的结构。如果不提供，则获取所有表的结构'),
    format: z
      .enum(['detailed', 'semantic'])
      .optional()
      .default('semantic')
      .describe('输出格式：detailed（详细结构）或 semantic（语义模型格式，用于SQL生成），默认 semantic'),
    data_source_id: z
      .string()
      .optional()
      .describe('数据源ID，如果不提供则从前端业务列表选择的数据源中获取'),
  });

  constructor(fields = {}) {
    super();
    this.userId = fields.userId || 'system';
    this.req = fields.req;
    this.conversation = fields.conversation; // Conversation对象，包含project_id和data_source_id
  }

  /**
   * 获取数据源连接池（复用连接池以提高性能）
   */
  async getConnectionPool(dataSourceId) {
    // 清理数据源ID，确保格式正确
    const cleanedId = this.cleanDataSourceId(dataSourceId);

    if (!cleanedId) {
      throw new Error(`无效的数据源ID: ${dataSourceId}`);
    }

    logger.info('[DatabaseSchemaTool] 获取连接池，数据源ID:', JSON.stringify({
      original: String(dataSourceId || 'null'),
      cleaned: String(cleanedId || 'null')
    }));

    // 数据源当前版本号：更新/删除数据源时会 bump，用来判断缓存是否已过期
    const currentRevision = loadCacheRegistry()(cleanedId);

    // 如果已有连接池且数据源配置未变更，直接返回
    if (connectionPools.has(cleanedId)) {
      const cached = connectionPools.get(cleanedId);
      if ((cached.revision || 0) === currentRevision) {
        return { pool: cached.pool, dataSource: cached.dataSource };
      }
      logger.info('[DatabaseSchemaTool] 数据源配置已变更，淘汰旧连接池并重建:', cleanedId);
      await evictConnectionPool(cleanedId, cached);
    }

    // 获取数据源信息
    const getDataSourceByIdFn = loadDataSourceModel();
    const dataSource = await getDataSourceByIdFn(cleanedId);
    if (!dataSource) {
      throw new Error(`数据源不存在: ${dataSourceId}`);
    }

    // 检查数据源状态
    if (dataSource.status !== 'active') {
      throw new Error(`数据源未激活: ${dataSource.name}`);
    }

    // 解密密码
    let password;
    try {
      password = await decryptV2(dataSource.password);
    } catch (error) {
      logger.error('[DatabaseSchemaTool] 密码解密失败:', error);
      // 检查是否是旧格式的加密
      const parts = dataSource.password.split(':');
      if (parts.length === 3) {
        throw new Error(
          '无法解密旧格式的密码。请编辑该数据源，重新输入密码并保存配置。',
        );
      }
      throw new Error(`密码解密失败: ${error.message}`);
    }

    // gaussdb 使用 Java JDBC 桥，不建真正的连接池，存储解密后的密码供每次查询使用
    if (dataSource.type === 'gaussdb') {
      connectionPools.set(cleanedId, {
        pool: { type: 'gaussdb-jdbc', password },
        dataSource,
        revision: currentRevision,
      });
      logger.info('[DatabaseSchemaTool] GaussDB JDBC 适配器已就绪:', JSON.stringify({
        dataSourceId: cleanedId,
        host: dataSource.host,
        database: dataSource.database,
      }));
      return { pool: { type: 'gaussdb-jdbc', password }, dataSource };
    }

    // 根据数据库类型创建连接池
    let pool;
    if (dataSource.type === 'mysql') {
      const poolConfig = {
        host: dataSource.host,
        port: dataSource.port,
        user: dataSource.username,
        password,
        database: dataSource.database,
        waitForConnections: true,
        connectionLimit: dataSource.connectionPool?.max || 10,
        queueLimit: 0,
        connectTimeout: dataSource.connectionPool?.connectionTimeoutMillis || 10000,
      };

      // MySQL SSL配置
      if (dataSource.ssl && dataSource.ssl.enabled) {
        poolConfig.ssl = {};
        if (dataSource.ssl.ca) {
          poolConfig.ssl.ca = dataSource.ssl.ca;
        }
        if (dataSource.ssl.cert) {
          poolConfig.ssl.cert = dataSource.ssl.cert;
        }
        if (dataSource.ssl.key) {
          poolConfig.ssl.key = dataSource.ssl.key;
        }
        if (dataSource.ssl.rejectUnauthorized !== undefined) {
          poolConfig.ssl.rejectUnauthorized = dataSource.ssl.rejectUnauthorized;
        }
      }

      pool = mysql.createPool(poolConfig);
    } else if (dataSource.type === 'postgresql') {
      const poolConfig = {
        host: dataSource.host,
        port: dataSource.port,
        user: dataSource.username,
        password,
        database: dataSource.database,
        max: dataSource.connectionPool?.max || 10,
        min: dataSource.connectionPool?.min || 0,
        idleTimeoutMillis: dataSource.connectionPool?.idleTimeoutMillis || 30000,
        connectionTimeoutMillis: dataSource.connectionPool?.connectionTimeoutMillis || 10000,
      };

      // PostgreSQL SSL配置
      if (dataSource.ssl && dataSource.ssl.enabled) {
        poolConfig.ssl = {};
        if (dataSource.ssl.rejectUnauthorized !== undefined) {
          poolConfig.ssl.rejectUnauthorized = dataSource.ssl.rejectUnauthorized;
        }
        if (dataSource.ssl.ca) {
          poolConfig.ssl.ca = dataSource.ssl.ca;
        }
        if (dataSource.ssl.cert) {
          poolConfig.ssl.cert = dataSource.ssl.cert;
        }
        if (dataSource.ssl.key) {
          poolConfig.ssl.key = dataSource.ssl.key;
        }
      }

      pool = new Pool(poolConfig);
    } else {
      throw new Error(`不支持的数据库类型: ${dataSource.type}`);
    }

    // 缓存连接池（使用清理后的ID）
    connectionPools.set(cleanedId, {
      pool,
      dataSource,
      revision: currentRevision,
    });

    logger.info('[DatabaseSchemaTool] 创建连接池成功:', JSON.stringify({
      dataSourceId: cleanedId,
      type: dataSource.type,
      database: dataSource.database,
    }));

    return { pool, dataSource };
  }

  /**
   * 获取MySQL数据库Schema
   */
  async getMySQLSchema(pool, table = null, database = null) {
    // 如果database未提供，尝试执行查询获取当前数据库
    if (!database) {
      try {
        const [result] = await pool.execute('SELECT DATABASE() as db');
        database = result[0]?.db;
        if (!database) {
          throw new Error('无法获取数据库名：DATABASE() 返回 null');
        }
        logger.info('[DatabaseSchemaTool] 通过查询获取数据库名:', JSON.stringify({ database }));
      } catch (error) {
        logger.error('[DatabaseSchemaTool] 无法获取数据库名:', JSON.stringify({
          error: error.message,
          stack: error.stack,
        }));
        throw new Error(`无法获取数据库名: ${error.message}`);
      }
    }

    logger.info('[DatabaseSchemaTool] 使用MySQL数据库名:', JSON.stringify({ database }));

    if (table) {
      // 获取单个表的结构
      const [columns] = await pool.execute(
        `SELECT
          COLUMN_NAME as column_name,
          DATA_TYPE as data_type,
          IS_NULLABLE as is_nullable,
          COLUMN_KEY as column_key,
          COLUMN_DEFAULT as column_default,
          COLUMN_COMMENT as column_comment
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
        [database, table]
      );

      const [indexes] = await pool.execute(
        `SELECT
          INDEX_NAME as index_name,
          COLUMN_NAME as column_name,
          NON_UNIQUE as non_unique,
          SEQ_IN_INDEX as seq_in_index
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [database, table]
      );

      return {
        database,
        table,
        columns: columns.map(col => ({
          ...col,
          is_nullable: col.is_nullable === 'YES',
        })),
        indexes: this.formatMySQLIndexes(indexes),
      };
    } else {
      // 获取所有表的结构
      const [tables] = await pool.execute(
        `SELECT TABLE_NAME as table_name
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
        [database]
      );

      const schema = {};
      for (const { table_name } of tables) {
        const tableSchema = await this.getMySQLSchema(pool, table_name, database);
        schema[table_name] = {
          columns: tableSchema.columns,
          indexes: tableSchema.indexes,
        };
      }

      return {
        database,
        schema,
      };
    }
  }

  /**
   * 获取PostgreSQL数据库Schema
   */
  async getPostgreSQLSchema(pool, table = null, database = null) {
    // 如果database未提供，尝试从pool配置中获取或执行查询
    if (!database) {
      // PostgreSQL连接池的配置在pool.options中
      database = pool.options?.database;
      if (!database) {
        // 如果还是获取不到，尝试执行查询获取当前数据库
        try {
          const result = await pool.query('SELECT current_database() as db');
          database = result.rows[0]?.db;
          if (!database) {
            throw new Error('无法获取数据库名：current_database() 返回 null');
          }
          logger.info('[DatabaseSchemaTool] 通过查询获取PostgreSQL数据库名:', database);
        } catch (error) {
          logger.error('[DatabaseSchemaTool] 无法获取PostgreSQL数据库名:', JSON.stringify({
            error: error.message,
            stack: error.stack,
          }));
          throw new Error(`无法获取数据库名: ${error.message}`);
        }
      }
    }

    logger.info('[DatabaseSchemaTool] 使用PostgreSQL数据库名:', JSON.stringify({ database }));

    if (table) {
      // 获取单个表的结构
      const columnsResult = await pool.query(
        `SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          CASE
            WHEN pk.column_name IS NOT NULL THEN 'PRI'
            WHEN uq.column_name IS NOT NULL THEN 'UNI'
            ELSE ''
          END as column_key,
          col_description(c.oid, a.attnum) as column_comment
        FROM information_schema.columns c
        LEFT JOIN pg_class t ON t.relname = c.table_name
        LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
        LEFT JOIN (
          SELECT ku.table_name, ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
        LEFT JOIN (
          SELECT ku.table_name, ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
          WHERE tc.constraint_type = 'UNIQUE'
        ) uq ON uq.table_name = c.table_name AND uq.column_name = c.column_name
        WHERE c.table_schema = 'public' AND c.table_name = $1
        ORDER BY c.ordinal_position`,
        [table]
      );

      const indexesResult = await pool.query(
        `SELECT
          i.relname as index_name,
          a.attname as column_name,
          NOT ix.indisunique as non_unique,
          array_position(ix.indkey, a.attnum) as seq_in_index
        FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        WHERE t.relname = $1 AND t.relkind = 'r'
        ORDER BY i.relname, seq_in_index`,
        [table]
      );

      return {
        database,
        table,
        columns: columnsResult.rows.map(col => ({
          ...col,
          is_nullable: col.is_nullable === 'YES',
        })),
        indexes: this.formatPostgreSQLIndexes(indexesResult.rows),
      };
    } else {
      // 获取所有表的结构
      const tablesResult = await pool.query(
        `SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`
      );

      const schema = {};
      for (const { table_name } of tablesResult.rows) {
        const tableSchema = await this.getPostgreSQLSchema(pool, table_name);
        schema[table_name] = {
          columns: tableSchema.columns,
          indexes: tableSchema.indexes,
        };
      }

      return {
        database,
        schema,
      };
    }
  }

  /**
   * 获取 GaussDB 数据库 Schema（通过 Java JDBC 桥执行 information_schema 查询）
   */
  async getGaussDBSchema(password, table = null, dataSource) {
    const database = dataSource.database;
    const dsConfig = {
      host: dataSource.host,
      port: dataSource.port,
      database: dataSource.database,
      username: dataSource.username,
      ssl: dataSource.ssl,
    };

    logger.info('[DatabaseSchemaTool] 使用GaussDB JDBC桥获取Schema:', JSON.stringify({ database, table: table || 'all' }));

    if (table) {
      // 注意：GaussDB JDBC 桥（GaussJdbcQuery.java）用标准 JDBC PreparedStatement，
      // 只识别字面量 `?` 作为绑定位，不能用 PostgreSQL 扩展协议风格的 `$1`。
      const columns = await gaussdbJdbcQuery(
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position`,
        [table],
        dsConfig,
        password,
      );

      const pkRows = await gaussdbJdbcQuery(
        `SELECT a.attname as column_name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = ?::regclass AND i.indisprimary`,
        [`public.${table}`],
        dsConfig,
        password,
      );
      const primaryKeys = new Set(pkRows.map((r) => r.column_name));

      return {
        database,
        table,
        columns: columns.map((col) => ({
          column_name: col.column_name,
          data_type: col.data_type,
          is_nullable: col.is_nullable === 'YES',
          column_key: primaryKeys.has(col.column_name) ? 'PRI' : '',
          column_comment: '',
          column_default: col.column_default,
        })),
        indexes: [],
      };
    } else {
      const tables = await gaussdbJdbcQuery(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
        [],
        dsConfig,
        password,
      );

      const schema = {};
      for (const { table_name } of tables) {
        const tableSchema = await this.getGaussDBSchema(password, table_name, dataSource);
        schema[table_name] = {
          columns: tableSchema.columns,
          indexes: tableSchema.indexes,
        };
      }

      return { database, schema };
    }
  }

  /**
   * 格式化MySQL索引
   */
  formatMySQLIndexes(indexes) {
    const indexMap = {};
    for (const idx of indexes) {
      if (!indexMap[idx.index_name]) {
        indexMap[idx.index_name] = {
          name: idx.index_name,
          unique: idx.non_unique === 0,
          columns: [],
        };
      }
      indexMap[idx.index_name].columns.push(idx.column_name);
    }
    return Object.values(indexMap);
  }

  /**
   * 格式化PostgreSQL索引
   */
  formatPostgreSQLIndexes(indexes) {
    const indexMap = {};
    for (const idx of indexes) {
      if (!indexMap[idx.index_name]) {
        indexMap[idx.index_name] = {
          name: idx.index_name,
          unique: !idx.non_unique,
          columns: [],
        };
      }
      indexMap[idx.index_name].columns.push(idx.column_name);
    }
    return Object.values(indexMap);
  }

  /**
   * 清理数据源ID字符串，移除多余的引号和空白字符
   */
  cleanDataSourceId(id) {
    if (!id) {
      return null;
    }

    // 如果是对象，尝试提取_id或id字段
    if (typeof id === 'object') {
      id = id._id || id.id || id.toString();
    }

    // 转换为字符串
    const str = String(id).trim();

    // 移除字符串两端的引号（单引号和双引号，可能有多层）
    let cleaned = str.replace(/^["']+|["']+$/g, '');

    // 如果还有引号，继续清理（处理双重引号的情况）
    while (cleaned !== cleaned.replace(/^["']+|["']+$/g, '')) {
      cleaned = cleaned.replace(/^["']+|["']+$/g, '');
    }

    return cleaned || null;
  }

  /**
   * 从 pgvector 读取预处理好的 Light Schema 列表（缓存优先逻辑）
   * @param {string} datasourceId
   * @returns {Promise<Array|null>}  有记录时返回数组，否则返回 null
   */
  async getLightSchemaFromCache(datasourceId) {
    let VectorDBService;
    try {
      VectorDBService = require(path.resolve(__dirname, '../../../api/server/services/RAG/VectorDBService'));
    } catch (_) {
      return null;
    }
    const vectorDB = new VectorDBService();
    await vectorDB.initialize();
    const schemas = await vectorDB.getLightSchemas(datasourceId);
    return schemas && schemas.length > 0 ? schemas : null;
  }

  /**
   * 当有用户问题时，用一次 embedding 同时做：
   *   1. Light Schema 语义检索（只返回最相关的 top-K 张表，避免全量返回）
   *   2. Cell 向量检索（字面量值匹配，辅助 WHERE 条件生成）
   *
   * 这样 500~1000 张表的大型数据库也只会把最相关的表塞进 LLM 上下文。
   *
   * @param {string} datasourceId
   * @param {string} question       用户原始问题
   * @param {number} tableTopK      返回最相关的表数量，默认 15
   * @param {number} cellTopK       Cell 匹配条数，默认 10
   * @returns {Promise<{schemas: Array|null, cellMatchStr: string}>}
   */
  async fetchSchemasByQuestion(datasourceId, question, tableTopK = 15, cellTopK = DEFAULT_CELL_TOP_K) {
    try {
      const VectorDBService = require(path.resolve(__dirname, '../../../api/server/services/RAG/VectorDBService'));
      const EmbeddingService = require(path.resolve(__dirname, '../../../api/server/services/RAG/EmbeddingService'));
      const vectorDB = new VectorDBService();
      const embeddingService = new EmbeddingService();
      await vectorDB.initialize();

      const bundle = await retrieveLightSchemaBundle({
        datasourceId,
        queryText: question,
        tables: [],
        schemaTopK: tableTopK,
        cellTopK,
        vectorDB,
        embeddingService,
      });

      if (bundle.rows.length === 0 && question) {
        const allSchemas = await vectorDB.getLightSchemas(datasourceId);
        return {
          schemas: allSchemas?.length ? allSchemas : null,
          cellMatchStr: '',
          cellMatches: [],
          cellTableBoost: [],
        };
      }

      return {
        schemas: bundle.rows.length ? bundle.rows : null,
        cellMatchStr: bundle.cellMatchStr,
        cellMatches: bundle.cellMatches,
        cellTableBoost: bundle.cellTableBoost,
      };
    } catch (err) {
      logger.warn('[DatabaseSchemaTool] 语义检索失败，降级为全量:', err?.message || String(err));
      try {
        const VectorDBService = require(path.resolve(__dirname, '../../../api/server/services/RAG/VectorDBService'));
        const vectorDB = new VectorDBService();
        await vectorDB.initialize();
        const allSchemas = await vectorDB.getLightSchemas(datasourceId);
        return {
          schemas: allSchemas?.length ? allSchemas : null,
          cellMatchStr: '',
          cellMatches: [],
          cellTableBoost: [],
        };
      } catch (_) {
        return {
          schemas: null,
          cellMatchStr: '',
          cellMatches: [],
          cellTableBoost: [],
        };
      }
    }
  }

  /**
   * 用问题文本做 Cell 向量检索，返回字面量匹配提示字符串。
   * @param {string} datasourceId
   * @param {string} question  用户原始问题
   * @returns {Promise<string>}  空字符串表示无命中或检索失败
   */
  async searchCellMatches(datasourceId, question) {
    try {
      const result = await this.fetchSchemasByQuestion(datasourceId, question, 0, DEFAULT_CELL_TOP_K);
      return result.cellMatchStr || '';
    } catch (err) {
      logger.warn('[DatabaseSchemaTool] Cell 向量检索失败（不影响主流程）:', err?.message || String(err));
      return '';
    }
  }

  /**
   * 获取数据源ID（从输入参数、conversation.project_id或req.body）
   */
  async getDataSourceId(input) {
    logger.info('[DatabaseSchemaTool] getDataSourceId 开始:', JSON.stringify({
      inputHasDataSourceId: !!input.data_source_id,
      conversationExists: !!this.conversation,
      conversationProjectId: this.conversation?.project_id || 'null',
      conversationDataSourceId: this.conversation?.data_source_id || 'null',
      reqExists: !!this.req,
      reqBodyDataSourceId: this.req?.body?.data_source_id || 'null',
      reqBodyProjectId: this.req?.body?.project_id || 'null',
    }));

    // 1. 优先使用输入参数中的data_source_id
    if (input.data_source_id) {
      const cleaned = this.cleanDataSourceId(input.data_source_id);
      logger.info('[DatabaseSchemaTool] 从input获取数据源ID:', JSON.stringify({ original: input.data_source_id, cleaned }));
      return cleaned;
    }

    // 2. 从conversation.project_id获取项目，然后从项目获取data_source_id
    if (this.conversation && this.conversation.project_id) {
      try {
        const getProjectByIdFn = loadProjectModel();
        const projectId = this.cleanDataSourceId(this.conversation.project_id);
        logger.info('[DatabaseSchemaTool] 尝试从项目获取数据源ID:', JSON.stringify({ projectId }));
        const project = await getProjectByIdFn(projectId);
        if (project && project.data_source_id) {
          const dataSourceId = project.data_source_id.toString();
          logger.info('[DatabaseSchemaTool] 从项目获取到数据源ID:', JSON.stringify({ dataSourceId }));
          return dataSourceId;
        } else {
          logger.warn('[DatabaseSchemaTool] 项目没有关联数据源:', JSON.stringify({ projectId, hasDataSourceId: !!project?.data_source_id }));
        }
      } catch (error) {
        logger.warn('[DatabaseSchemaTool] 获取项目数据源失败:', JSON.stringify({ error: error.message, stack: error.stack }));
      }
    }

    // 3. 从conversation.data_source_id获取（如果前端直接传递了数据源ID）
    if (this.conversation && this.conversation.data_source_id) {
      const cleaned = this.cleanDataSourceId(this.conversation.data_source_id);
      logger.info('[DatabaseSchemaTool] 从conversation.data_source_id获取:', JSON.stringify({ original: this.conversation.data_source_id, cleaned }));
      return cleaned;
    }

    // 4. 从req.body中获取（如果前端通过请求传递）
    if (this.req && this.req.body) {
      if (this.req.body.data_source_id) {
        const cleaned = this.cleanDataSourceId(this.req.body.data_source_id);
        logger.info('[DatabaseSchemaTool] 从req.body.data_source_id获取:', JSON.stringify({ original: this.req.body.data_source_id, cleaned }));
        return cleaned;
      }
      // 如果req.body中有project_id，也尝试获取
      if (this.req.body.project_id) {
        try {
          const getProjectByIdFn = loadProjectModel();
          const projectId = this.cleanDataSourceId(this.req.body.project_id);
          logger.info('[DatabaseSchemaTool] 尝试从req.body项目获取数据源ID:', JSON.stringify({ projectId }));
          const project = await getProjectByIdFn(projectId);
          if (project && project.data_source_id) {
            const dataSourceId = project.data_source_id.toString();
            logger.info('[DatabaseSchemaTool] 从req.body项目获取到数据源ID:', JSON.stringify({ dataSourceId }));
            return dataSourceId;
          }
        } catch (error) {
          logger.warn('[DatabaseSchemaTool] 从req.body获取项目数据源失败:', JSON.stringify({ error: error.message, stack: error.stack }));
        }
      }
    }

    // 5. 如果都没有，返回null
    logger.warn('[DatabaseSchemaTool] 未找到数据源ID，返回null');
    return null;
  }

  /**
   * 转换为语义模型格式
   */
  convertToSemanticModel(schemaData) {
    if (!schemaData.schema && !schemaData.columns) {
      return [];
    }

    // 单个表的情况
    if (schemaData.columns) {
      return [
        {
          name: schemaData.table,
          description: `数据库表: ${schemaData.table}`,
          model: schemaData.table,
          columns: schemaData.columns.map((col) => ({
            name: col.column_name,
            type: col.data_type,
            nullable: col.is_nullable === 'YES' || col.is_nullable === true,
            key: col.column_key,
            comment: col.column_comment || '',
            default: col.column_default,
          })),
          indexes: schemaData.indexes || [],
        },
      ];
    }

    // 多个表的情况
    const semanticModels = [];
    for (const [tableName, tableInfo] of Object.entries(schemaData.schema)) {
      semanticModels.push({
        name: tableName,
        description: `数据库表: ${tableName}`,
        model: tableName,
        columns: tableInfo.columns.map((col) => ({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === 'YES' || col.is_nullable === true,
          key: col.column_key,
          comment: col.column_comment || '',
          default: col.column_default,
        })),
        indexes: tableInfo.indexes || [],
      });
    }

    return semanticModels;
  }

  /**
   * 格式化输出为可读文本
   */
  formatAsText(schemaData) {
    if (!schemaData.schema && !schemaData.columns) {
      return '未找到表结构信息';
    }

    let output = `数据库: ${schemaData.database}\n\n`;

    // 单个表的情况
    if (schemaData.columns) {
      output += `表名: ${schemaData.table}\n`;
      output += '列信息:\n';
      schemaData.columns.forEach((col) => {
        output += `  - ${col.column_name} (${col.data_type})`;
        if (col.column_key === 'PRI') output += ' [主键]';
        if (col.column_key === 'UNI') output += ' [唯一]';
        if (col.is_nullable === 'NO' || col.is_nullable === false) output += ' [非空]';
        if (col.column_comment) output += ` - ${col.column_comment}`;
        output += '\n';
      });
      return output;
    }

    // 多个表的情况
    for (const [tableName, tableInfo] of Object.entries(schemaData.schema)) {
      output += `表名: ${tableName}\n`;
      output += '列信息:\n';
      tableInfo.columns.forEach((col) => {
        output += `  - ${col.column_name} (${col.data_type})`;
        if (col.column_key === 'PRI') output += ' [主键]';
        if (col.column_key === 'UNI') output += ' [唯一]';
        if (col.is_nullable === 'NO' || col.is_nullable === false) output += ' [非空]';
        if (col.column_comment) output += ` - ${col.column_comment}`;
        output += '\n';
      });
      output += '\n';
    }

    return output;
  }

  /**
   * 检查查询是否与数据库表/列相关（用于意图分类）
   */
  checkQueryRelevance(query, schemaData) {
    const queryLower = query.toLowerCase();
    const tableNames = [];

    // 提取所有表名
    if (schemaData.schema) {
      tableNames.push(...Object.keys(schemaData.schema));
    } else if (schemaData.table) {
      tableNames.push(schemaData.table);
    }

    // 提取所有列名
    const columnNames = [];
    if (schemaData.schema) {
      for (const tableInfo of Object.values(schemaData.schema)) {
        if (tableInfo.columns) {
          columnNames.push(...tableInfo.columns.map(col => col.column_name.toLowerCase()));
        }
      }
    } else if (schemaData.columns) {
      columnNames.push(...schemaData.columns.map(col => col.column_name.toLowerCase()));
    }

    // 检查查询中是否包含表名或列名
    const matchedTables = tableNames.filter(tableName =>
      queryLower.includes(tableName.toLowerCase())
    );
    const matchedColumns = columnNames.filter(columnName =>
      queryLower.includes(columnName)
    );

    return {
      relevant: matchedTables.length > 0 || matchedColumns.length > 0,
      matched_tables: matchedTables,
      matched_columns: matchedColumns.slice(0, 5), // 只返回前5个匹配的列
    };
  }

  /**
   * @override
   */
  async _call(input) {
    const { table, format = 'semantic' } = input;
    let dataSourceId = null; // 在外部作用域声明，确保catch块可以访问

    try {
      logger.info('[DatabaseSchemaTool] _call 开始:', JSON.stringify({
        input: JSON.stringify(input),
        table: table || 'all',
        format,
        hasConversation: !!this.conversation,
        hasReq: !!this.req,
      }));

      // 获取数据源ID
      logger.info('[DatabaseSchemaTool] 准备调用 getDataSourceId');
      dataSourceId = await this.getDataSourceId(input);
      logger.info('[DatabaseSchemaTool] getDataSourceId 返回:', JSON.stringify({ dataSourceId: dataSourceId || 'null' }));

      logger.info('[DatabaseSchemaTool] 获取到的数据源ID:', JSON.stringify({
        dataSourceId: dataSourceId || 'null',
        conversation: this.conversation ? {
          project_id: this.conversation.project_id || 'null',
          data_source_id: this.conversation.data_source_id || 'null',
        } : 'conversation is null',
        reqBody: this.req?.body ? {
          project_id: this.req.body.project_id || 'null',
          data_source_id: this.req.body.data_source_id || 'null',
        } : 'req.body is null',
      }));

      if (!dataSourceId) {
        const errorMsg = '未配置数据源。请先在左侧业务列表中选择数据源，或在调用工具时提供data_source_id参数。';
        logger.warn('[DatabaseSchemaTool]', errorMsg);
        return JSON.stringify({
          success: false,
          error: errorMsg,
          table: table || 'all',
        });
      }

      // ── Light Schema 缓存优先 + 语义表过滤 + Cell 向量字面量匹配 ──────────
      // 若已预处理过该数据源（pgvector 中有 light_schema_vectors 记录），
      // 直接读取缓存并转换为 semantic_models 返回，避免实时连接远端数据库。
      //
      // 有用户问题时：用一次 embedding 同时做语义表过滤（只返回最相关的表）
      //   + Cell 向量检索（辅助 WHERE 条件），适配 500~1000 张表的大型数据库。
      // 无用户问题时：全量返回（仅适合小型数据库场景）。
      try {
        // 取出用户问题
        const userQuestion = this.req?.body?.text
          || this.req?.body?.message
          || this.req?.body?.content
          || input.question
          || '';

        let cachedSchemas, cellMatchStr;
        if (userQuestion) {
          // 有问题：语义检索相关表 + cell 匹配（复用同一个 embedding，一次向量化）
          const result = await this.fetchSchemasByQuestion(dataSourceId, userQuestion);
          cachedSchemas = result.schemas;
          cellMatchStr = result.cellMatchStr;
        } else {
          // 无问题（如直接 format 查询）：全量返回 + 无 cell 匹配
          [cachedSchemas, cellMatchStr] = await Promise.all([
            this.getLightSchemaFromCache(dataSourceId),
            Promise.resolve(''),
          ]);
        }

        if (cachedSchemas && cachedSchemas.length > 0) {
          logger.info(
            `[DatabaseSchemaTool] Light Schema 缓存命中，共 ${cachedSchemas.length} 张表` +
            (cellMatchStr ? `，Cell 匹配：${cellMatchStr}` : '，无 Cell 匹配'),
          );
          const semanticModels = cachedSchemas.map((s) => {
            let schema;
            try { schema = JSON.parse(s.content); } catch (_) { return null; }
            if (!schema) return null;
            return {
              table_name: schema.tableName,
              table_description: '',
              columns: (schema.columns || []).map((c) => ({
                column_name: c.name,
                data_type: c.type,
                is_nullable: c.nullable ? 'YES' : 'NO',
                column_description: c.description || '',
                sample_values: (c.sampleValues || []).slice(0, 2),
              })),
              primary_keys: schema.primaryKeys || [],
            };
          }).filter(Boolean);

          const result = {
            success: true,
            source: 'light_schema_cache',
            semantic_models: semanticModels,
            format: 'semantic',
            instruction: 'Extract the "semantic_models" array from this response and use it as the semantic_models parameter when calling text-to-sql tool.',
            dataSource: { id: dataSourceId },
          };

          // 注入字面量匹配（给 LLM 明确的 WHERE 值提示）
          if (cellMatchStr) {
            result.value_hints = cellMatchStr;
            result.instruction +=
              ' Additionally, "value_hints" contains possible column=value matches found in the database ' +
              '— use them to construct accurate WHERE conditions instead of guessing literal values.';
          }

          return JSON.stringify(result, null, 2);
        }
      } catch (cacheErr) {
        logger.warn('[DatabaseSchemaTool] Light Schema 缓存读取失败，降级为实时查询:', cacheErr.message);
      }
      // ─────────────────────────────────────────────────────────────────

      // 获取连接池和数据源信息
      const { pool, dataSource } = await this.getConnectionPool(dataSourceId);

      // 根据数据库类型获取Schema
      let schemaData;
      try {
        logger.info('[DatabaseSchemaTool] 开始获取Schema:', JSON.stringify({
          databaseType: dataSource.type,
          database: dataSource.database,
          table: table || 'all',
        }));
        if (dataSource.type === 'mysql') {
          schemaData = await this.getMySQLSchema(pool, table, dataSource.database);
        } else if (dataSource.type === 'postgresql') {
          schemaData = await this.getPostgreSQLSchema(pool, table, dataSource.database);
        } else if (dataSource.type === 'gaussdb') {
          schemaData = await this.getGaussDBSchema(pool.password, table, dataSource);
        } else {
          throw new Error(`不支持的数据库类型: ${dataSource.type}`);
        }
      } catch (schemaError) {
        logger.error('[DatabaseSchemaTool] 获取Schema时出错:', JSON.stringify({
          error: schemaError.message,
          stack: schemaError.stack,
          databaseType: dataSource.type,
          database: dataSource.database,
          table: table || 'all',
          dataSourceId: dataSourceId || 'null',
        }));
        throw schemaError;
      }

      // 根据格式返回
      if (format === 'semantic') {
        const semanticModels = this.convertToSemanticModel(schemaData);
        // 返回清晰的格式，方便主代理提取 semantic_models
        return JSON.stringify(
          {
            success: true,
            database: schemaData.database,
            semantic_models: semanticModels,
            format: 'semantic',
            instruction: 'Extract the "semantic_models" array from this response and use it as the semantic_models parameter when calling text-to-sql tool.',
            dataSource: {
              id: dataSource._id.toString(),
              name: dataSource.name,
              type: dataSource.type,
              database: dataSource.database,
            },
          },
          null,
          2,
        );
      } else {
        // detailed 格式
        return JSON.stringify(
          {
            success: true,
            database: schemaData.database,
            schema: schemaData.schema || { [schemaData.table]: { columns: schemaData.columns, indexes: schemaData.indexes } },
            text_format: this.formatAsText(schemaData),
            format: 'detailed',
            dataSource: {
              id: dataSource._id.toString(),
              name: dataSource.name,
              type: dataSource.type,
              database: dataSource.database,
            },
          },
          null,
          2,
        );
      }
    } catch (error) {
      const errorInfo = {
        table: table || 'all',
        error: error.message || '未知错误',
        stack: error.stack || '无堆栈信息',
        dataSourceId: dataSourceId || 'null',
        conversationExists: !!this.conversation,
        reqExists: !!this.req,
        input: JSON.stringify(input),
      };

      logger.error('[DatabaseSchemaTool] 获取Schema失败:', JSON.stringify(errorInfo, null, 2));

      return JSON.stringify({
        success: false,
        error: error.message || '获取Schema失败',
        table: table || 'all',
        details: process.env.NODE_ENV === 'development' ? errorInfo : undefined,
      });
    }
  }
}

module.exports = DatabaseSchemaTool;
