const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const { logger } = require('@because/data-schemas');
const { decryptV2 } = require('@because/api');
const path = require('path');
const { gaussdbJdbcQuery } = require(path.join(__dirname, '../../utils/gaussdbJdbcBridge'));
const {
  CATEGORY,
  stringifySqlExecutorError,
  formatSqlExecutorError,
} = require(path.join(__dirname, '../../../api/server/utils/formatSqlExecutorError'));
// 延迟加载模型函数，避免路径别名问题
let getDataSourceById = null;
let getProjectById = null;

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
 * SQL 结果行数上限。
 * 可通过环境变量 SQL_EXECUTOR_MAX_ROWS 调整，不设则默认 50。
 * 若需临时查看更多行，可在 Because.yaml / docker-compose 中设置该变量（如 200）。
 */
const SQL_EXECUTOR_MAX_ROWS = (() => {
  const v = parseInt(process.env.SQL_EXECUTOR_MAX_ROWS, 10);
  return Number.isFinite(v) && v > 0 ? v : 50;
})();

/** 指标问数向的解读指引（成功响应顶层 guidance） */
const SQL_RESULT_GUIDANCE = [
  '1. 用自然语言概括查数结论（指标 / 机构 / 时间），数值只能来自 rows。',
  '2. 多行用表格；突出 index_number、org_code/brchna、index_value、data_dt 等关键字段含义。',
  '3. 金额按问数单位规则展示；比率保持原值并标 %；禁止混用单位。',
  '4. 空结果或 truncated 时说明原因，并依 truncation_hint 建议下一步。',
  '5. 禁止臆造未返回的行/字段；勿向用户粘贴完整 SQL。',
];

const SQL_RESULT_NOTE =
  '基于 rows 解释，禁止臆造。可对比数据按会话 prompt §9 调用 echarts_generator_app，数值须与 rows 一致。';

/**
 * SQL Executor Tool - SQL执行工具（重构版）
 * 
 * 支持动态数据源切换，直接从Agent配置中获取数据源信息
 * 不再依赖独立的sql-api服务
 */
class SqlExecutorTool extends Tool {
  name = 'sql_executor';

  description =
    '执行只读的SQL SELECT查询和WITH子句（CTE），并返回查询结果（rows）。' +
    '工具会根据Agent配置的数据源自动连接对应的数据库。' +
    '支持MySQL、PostgreSQL和GaussDB数据库。' +
    '支持WITH子句（CTE）、复杂子查询、JOIN等高级SQL特性。';

  schema = z.object({
    sql: z
      .string()
      .min(1)
      .describe(
        '要执行的SQL SELECT查询语句或WITH子句（CTE）。必须是只读查询，禁止包含INSERT/UPDATE/DELETE/DDL等写操作。支持WITH子句、复杂子查询、JOIN等高级SQL特性。',
      ),
    max_rows: z
      .number()
      .int()
      .positive()
      .max(1000)
      .optional()
      .describe(
        `可选：限制返回的最大行数。默认上限由服务端 SQL_EXECUTOR_MAX_ROWS 环境变量控制（当前为 ${SQL_EXECUTOR_MAX_ROWS} 行）。` +
        '如需查看更多行，请在调用时显式传入 max_rows（如 200）；但服务端会在环境变量范围内取较小值以保护性能。',
      ),
    data_source_id: z
      .string()
      .optional()
      .describe('可选：数据源ID，如果不提供则从Agent配置中获取'),
  });

  constructor(fields = {}) {
    super();
    this.req = fields.req; // 请求对象（用于获取用户信息）
    this.conversation = fields.conversation; // Conversation对象，包含project_id
  }

  /**
   * 获取数据源连接池
   */
  async getConnectionPool(dataSourceId) {
    // 清理数据源ID，确保格式正确
    const cleanedId = this.cleanDataSourceId(dataSourceId);
    
    if (!cleanedId) {
      throw new Error(`无效的数据源ID: ${dataSourceId}`);
    }

    logger.info('[SqlExecutorTool] 获取连接池，数据源ID:', { 
      original: dataSourceId, 
      cleaned: cleanedId 
    });

    // 如果已有连接池，直接返回
    if (connectionPools.has(cleanedId)) {
      return connectionPools.get(cleanedId);
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
      logger.error('[SqlExecutorTool] 密码解密失败:', error);
      // 检查是否是旧格式的加密
      const parts = dataSource.password.split(':');
      if (parts.length === 3) {
        throw new Error(
          '无法解密旧格式的密码。请编辑该数据源，重新输入密码并保存配置。',
        );
      }
      throw new Error(`密码解密失败: ${error.message}`);
    }

    // 根据数据库类型创建连接池
    // gaussdb 使用 Java JDBC 桥，不建真正的连接池，存储解密后的密码供每次查询使用
    if (dataSource.type === 'gaussdb') {
      connectionPools.set(cleanedId, {
        pool: { type: 'gaussdb-jdbc', password },
        dataSource,
      });
      logger.info('[SqlExecutorTool] GaussDB JDBC 适配器已就绪:', {
        dataSourceId: cleanedId,
        host: dataSource.host,
        database: dataSource.database,
      });
      return { pool: { type: 'gaussdb-jdbc', password }, dataSource };
    }

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
    });

    logger.info('[SqlExecutorTool] 创建连接池成功:', {
      dataSourceId: cleanedId,
      type: dataSource.type,
      database: dataSource.database,
    });

    return { pool, dataSource };
  }

  /**
   * 执行SQL查询
   */
  async executeQuery(sql, pool, dataSource) {
    if (dataSource.type === 'mysql') {
      const [rows] = await pool.execute(sql);
      return rows;
    } else if (dataSource.type === 'postgresql') {
      const result = await pool.query(sql);
      return result.rows;
    } else if (dataSource.type === 'gaussdb') {
      // 通过 Java JDBC 桥执行，pool 对象存有解密后的密码
      return await gaussdbJdbcQuery(sql, [], dataSource, pool.password);
    } else {
      throw new Error(`不支持的数据库类型: ${dataSource.type}`);
    }
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
   * 获取数据源ID（从输入参数、conversation.project_id或req.body）
   */
  async getDataSourceId(input) {
    // 1. 优先使用输入参数中的data_source_id
    if (input.data_source_id) {
      return this.cleanDataSourceId(input.data_source_id);
    }

    // 2. 从conversation.project_id获取项目，然后从项目获取data_source_id
    if (this.conversation && this.conversation.project_id) {
      try {
        const getProjectByIdFn = loadProjectModel();
        const projectId = this.cleanDataSourceId(this.conversation.project_id);
        const project = await getProjectByIdFn(projectId);
        if (project && project.data_source_id) {
          return project.data_source_id.toString();
        }
      } catch (error) {
        logger.warn('[SqlExecutorTool] 获取项目数据源失败:', error.message);
      }
    }

    // 3. 从conversation.data_source_id获取（如果前端直接传递了数据源ID）
    if (this.conversation && this.conversation.data_source_id) {
      return this.cleanDataSourceId(this.conversation.data_source_id);
    }

    // 4. 从req.body中获取（如果前端通过请求传递）
    if (this.req && this.req.body) {
      if (this.req.body.data_source_id) {
        return this.cleanDataSourceId(this.req.body.data_source_id);
      }
      // 如果req.body中有project_id，也尝试获取
      if (this.req.body.project_id) {
        try {
          const getProjectByIdFn = loadProjectModel();
          const projectId = this.cleanDataSourceId(this.req.body.project_id);
          const project = await getProjectByIdFn(projectId);
          if (project && project.data_source_id) {
            return project.data_source_id.toString();
          }
        } catch (error) {
          logger.warn('[SqlExecutorTool] 从req.body获取项目数据源失败:', error.message);
        }
      }
    }

    // 5. 如果都没有，返回null
    return null;
  }

  /**
   * @override
   */
  async _call(input) {
    const { sql, max_rows } = input;
    const trimmedSql = sql.trim();

    // 基础校验：支持SELECT和WITH子句（CTE）
    const upper = trimmedSql.toUpperCase().trim();
    const isWithClause = upper.startsWith('WITH');
    const isSelectQuery = upper.startsWith('SELECT');
    
    if (!isWithClause && !isSelectQuery) {
      return stringifySqlExecutorError({
        error: '只允许执行SELECT查询或WITH子句（CTE），请不要包含INSERT/UPDATE/DELETE/DDL等写操作。',
        code: 'NOT_READONLY',
        category: CATEGORY.SQL_POLICY,
        hint: '请改写为 SELECT 或 WITH ... AS (SELECT ...) 只读查询',
        sql: trimmedSql,
      });
    }

    // 如果是以WITH开头，验证其结构：WITH ... AS (SELECT ...)
    if (isWithClause) {
      // 检查WITH子句是否包含SELECT（这是只读查询的标志）
      if (!upper.includes('SELECT')) {
        return stringifySqlExecutorError({
          error: 'WITH子句必须包含SELECT查询，不允许包含写操作。',
          code: 'WITH_MISSING_SELECT',
          category: CATEGORY.SQL_POLICY,
          hint: '每个 CTE 体应为 SELECT；禁止在 WITH 中写 INSERT/UPDATE/DELETE',
          sql: trimmedSql,
        });
      }

      // 确保WITH子句中没有写操作
      // 提取所有WITH子句的内容进行检查
      const withMatches = trimmedSql.matchAll(/\bWITH\s+(\w+)\s+AS\s*\(([\s\S]*?)\)/gi);
      for (const match of withMatches) {
        const cteBody = match[2];

        // 检查CTE体中是否有写操作
        const writeOps = [
          /\bINSERT\s+INTO\b/i,
          /\bUPDATE\s+\w+\s+SET\b/i,
          /\bDELETE\s+FROM\b/i,
          /\bDROP\s+(TABLE|DATABASE)\b/i,
          /\bCREATE\s+(TABLE|DATABASE)\b/i,
        ];

        for (const pattern of writeOps) {
          if (pattern.test(cteBody)) {
            return stringifySqlExecutorError({
              error: `WITH子句 "${match[1]}" 中包含写操作，不允许执行。`,
              code: 'WITH_WRITE_FORBIDDEN',
              category: CATEGORY.SQL_POLICY,
              hint: 'CTE 仅允许只读 SELECT；请移除写操作后重试',
              sql: trimmedSql,
            });
          }
        }
      }
    }

    // 额外安全检查：使用精确的正则表达式匹配SQL语句，避免误判
    // 避免误判字段名、表名或注释中包含这些关键词
    const dangerousPatterns = [
      /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW|PROCEDURE|FUNCTION|TRIGGER)\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bUPDATE\s+\w+\s+SET\b/i,
      /\bINSERT\s+INTO\b/i,
      /\bALTER\s+TABLE\b/i,
      /\bTRUNCATE\s+TABLE\b/i,
      /\bCREATE\s+(TABLE|DATABASE|INDEX|VIEW|PROCEDURE|FUNCTION|TRIGGER)\b/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /\bEXEC\s+/i,
      /\bEXECUTE\s+/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmedSql)) {
        const match = trimmedSql.match(pattern);
        return stringifySqlExecutorError({
          error: `检测到危险操作 "${match[0].trim()}"，出于安全考虑拒绝执行该查询。`,
          code: 'DANGEROUS_SQL',
          category: CATEGORY.SQL_POLICY,
          hint: '本工具仅允许只读查询；请删除 DDL/DML 后重试',
          sql: trimmedSql,
        });
      }
    }

    let activeDataSource = null;
    try {
      // 获取数据源ID
      const dataSourceId = await this.getDataSourceId(input);

      if (!dataSourceId) {
        return stringifySqlExecutorError({
          error:
            '未配置数据源。请先在左侧业务列表中选择数据源，或在调用工具时提供data_source_id参数。',
          code: 'DATASOURCE_NOT_CONFIGURED',
          category: CATEGORY.DATASOURCE_CONFIG,
          hint: '在 Agent/会话中绑定数据源，或调用时传入 data_source_id',
          sql: trimmedSql,
        });
      }

      // 获取连接池和数据源信息
      const { pool, dataSource } = await this.getConnectionPool(dataSourceId);
      activeDataSource = dataSource;

      // 执行查询
      let rows = await this.executeQuery(trimmedSql, pool, dataSource);

      // 限制返回行数：取「模型传入值」与「服务端上限」中的较小值
      const effectiveMax =
        typeof max_rows === 'number' && max_rows > 0
          ? Math.min(max_rows, SQL_EXECUTOR_MAX_ROWS)
          : SQL_EXECUTOR_MAX_ROWS;
      const totalRows = rows.length;
      let truncated = false;
      if (rows.length > effectiveMax) {
        rows = rows.slice(0, effectiveMax);
        truncated = true;
      }

      // 构建精简成功响应（以 rows 为主，无 attribution / dataSource）
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      const result = {
        success: true,
        sql: trimmedSql,
        rowCount: rows.length,
        ...(truncated
          ? {
              truncated: true,
              totalRowsInDB: totalRows,
              warning: 'ROW_LIMIT',
              warning_code: 'ROW_LIMIT',
              truncation_hint:
                `结果已截断：数据库共返回 ${totalRows} 行，当前仅展示前 ${effectiveMax} 行。` +
                `如需更多行，请在调用时传入 max_rows（最大 1000），` +
                `或由管理员在服务端设置环境变量 SQL_EXECUTOR_MAX_ROWS。`,
            }
          : {}),
        rows,
        columns,
        guidance: SQL_RESULT_GUIDANCE,
        note: SQL_RESULT_NOTE,
      };

      logger.info('[SqlExecutorTool] SQL执行成功:', {
        dataSourceId,
        rowCount: rows.length,
        database: dataSource.database,
      });

      return JSON.stringify(result, null, 2);
    } catch (error) {
      logger.error('[SqlExecutorTool] SQL执行失败:', {
        sql: trimmedSql.substring(0, 100),
        error: error.message,
        stack: error.stack,
      });

      return JSON.stringify(
        formatSqlExecutorError(error, { sql: trimmedSql, dataSource: activeDataSource }),
        null,
        2,
      );
    }
  }
}

module.exports = SqlExecutorTool;

