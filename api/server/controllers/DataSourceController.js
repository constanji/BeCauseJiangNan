const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');
const { logger } = require('@because/data-schemas');
const { SystemRoles } = require('@because/data-provider');
const { encryptV2, decryptV2 } = require('@because/api');
const {
  createDataSource,
  getDataSources,
  getDataSourceById,
  updateDataSource,
  deleteDataSource,
} = require('~/models/DataSource');
const {
  formatConnectionTestError,
  buildConnectionTestApiPayload,
} = require('~/server/utils/formatConnectionTestError');

// GaussDB Java JDBC 桥（企业定制安全协议，无法用标准 pg 包连接）
// 必须相对项目根 /app/Because-2.0，勿用 __dirname 相对路径（Knowledge 等更深目录会落到 /app/api/Because-2.0）
const { gaussdbJdbcQuery, gaussdbTestConnection } = require(
  path.join(require('~/config/paths').root, 'Because-2.0/utils/gaussdbJdbcBridge'),
);

// 使用项目统一的加密/解密函数（基于 CREDS_KEY 环境变量）
// 为了兼容旧数据，先尝试新方法，如果失败再尝试旧方法

/**
 * 加密密码（使用项目的 encryptV2）
 * @param {string} text - 要加密的文本
 * @returns {Promise<string>} 加密后的文本
 */
async function encryptPassword(text) {
  try {
    return await encryptV2(text);
  } catch (error) {
    logger.error('[encryptPassword] Error:', error);
    throw new Error('密码加密失败');
  }
}

/**
 * 解密密码（兼容新旧两种格式）
 * @param {string} encryptedText - 加密的文本
 * @returns {Promise<string>} 解密后的文本
 */
/**
 * 自定义错误类，用于标识密码解密失败的类型
 */
class PasswordDecryptionError extends Error {
  constructor(message, code = 'DECRYPTION_FAILED') {
    super(message);
    this.name = 'PasswordDecryptionError';
    this.code = code;
  }
}

async function decryptPassword(encryptedText) {
  // 首先尝试使用新方法（encryptV2格式）
  try {
    return await decryptV2(encryptedText);
  } catch (error) {
    // 如果不是新格式，尝试旧格式（AES-256-GCM格式：iv:authTag:encrypted）
    // 旧格式会有3个部分，新格式通常有2个部分（iv:encrypted）
    const parts = encryptedText.split(':');
    if (parts.length === 3) {
      // 可能是旧格式，但由于密钥已丢失，无法解密
      logger.warn('[decryptPassword] 检测到旧格式的加密数据，但无法解密。请重新输入密码。');
      throw new PasswordDecryptionError(
        '无法解密旧格式的密码。请编辑该数据源，重新输入密码并保存配置。',
        'LEGACY_ENCRYPTION_FORMAT'
      );
    }
    // 如果格式不匹配，抛出原始错误
    logger.error('[decryptPassword] Error:', error);
    throw new PasswordDecryptionError('密码解密失败：' + error.message, 'DECRYPTION_FAILED');
  }
}

/**
 * 测试数据库连接
 * @param {Object} config - 数据库配置
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function testDatabaseConnection(config) {
  const { type, host, port, database, username, password, ssl } = config;

  try {
    const TableExtractService = require('~/server/services/Knowledge/TableExtractService');
    if (TableExtractService.isKnowledgeExtractMockDataSource({ host, database })) {
      return {
        success: true,
        message: 'Mock 数据源：无需真实数据库连接',
      };
    }

    if (type === 'mysql') {
      // 动态加载 mysql2
      let mysql;
      try {
        mysql = require('mysql2/promise');
      } catch (error) {
        logger.error('[testDatabaseConnection] mysql2 not found:', error);
        return {
          success: false,
          error: 'mysql2 包未安装，请运行: npm install mysql2',
        };
      }

      const connectionConfig = {
        host,
        port,
        user: username,
        password,
        database,
        connectTimeout: 10000,
      };

      // MySQL SSL配置
      if (ssl && ssl.enabled) {
        connectionConfig.ssl = {};
        if (ssl.ca) {
          connectionConfig.ssl.ca = ssl.ca;
        }
        if (ssl.cert) {
          connectionConfig.ssl.cert = ssl.cert;
        }
        if (ssl.key) {
          connectionConfig.ssl.key = ssl.key;
        }
        if (ssl.rejectUnauthorized !== undefined) {
          connectionConfig.ssl.rejectUnauthorized = ssl.rejectUnauthorized;
        }
      }

      const connection = await mysql.createConnection(connectionConfig);

      await connection.ping();
      await connection.end();

      return { success: true };
    } else if (type === 'postgresql') {
      // 动态加载 pg
      let pg;
      try {
        pg = require('pg');
      } catch (error) {
        logger.error('[testDatabaseConnection] pg not found:', error);
        return {
          success: false,
          error: 'pg 包未安装，请运行: npm install pg',
        };
      }

      const { Client } = pg;
      const clientConfig = {
        host,
        port,
        database,
        user: username,
        password,
        connectionTimeoutMillis: 10000,
      };

      // PostgreSQL SSL配置
      if (ssl && ssl.enabled) {
        clientConfig.ssl = {};
        if (ssl.rejectUnauthorized !== undefined) {
          clientConfig.ssl.rejectUnauthorized = ssl.rejectUnauthorized;
        }
        if (ssl.ca) {
          clientConfig.ssl.ca = ssl.ca;
        }
        if (ssl.cert) {
          clientConfig.ssl.cert = ssl.cert;
        }
        if (ssl.key) {
          clientConfig.ssl.key = ssl.key;
        }
      }

      const client = new Client(clientConfig);

      await client.connect();
      await client.query('SELECT NOW()');
      await client.end();

      return { success: true };
    } else if (type === 'gaussdb') {
      // GaussDB 使用 Java JDBC 桥（企业定制安全协议）
      await gaussdbTestConnection({ host, port, database, username, ssl }, password);
      return { success: true };
    } else {
      return {
        success: false,
        error: `不支持的数据库类型: ${type}`,
      };
    }
  } catch (error) {
    logger.error('[testDatabaseConnection] Connection test failed:', error);
    const formatted = formatConnectionTestError(error, config);
    return {
      success: false,
      error: formatted.error,
      code: formatted.code,
      hint: formatted.hint,
      raw: formatted.raw,
    };
  }
}

/**
 * 获取数据库结构
 * @param {Object} config - 数据库配置
 * @returns {Promise<{success: boolean, schema?: Object, error?: string}>}
 */
async function getDatabaseSchema(config) {
  const {
    type,
    host,
    port,
    database,
    username,
    password,
    ssl,
    schemaName = 'public',
    tableNames = null,
  } = config;
  const selectedTableNames = Array.isArray(tableNames) && tableNames.length > 0
    ? tableNames.map((t) => String(t)).filter(Boolean)
    : null;

  try {
    if (type === 'mysql') {
      let mysql;
      try {
        mysql = require('mysql2/promise');
      } catch (error) {
        return {
          success: false,
          error: 'mysql2 包未安装，请运行: npm install mysql2',
        };
      }

      const connectionConfig = {
        host,
        port,
        user: username,
        password,
        database,
        connectTimeout: 10000,
      };

      // MySQL SSL配置
      if (ssl && ssl.enabled) {
        connectionConfig.ssl = {};
        if (ssl.ca) {
          connectionConfig.ssl.ca = ssl.ca;
        }
        if (ssl.cert) {
          connectionConfig.ssl.cert = ssl.cert;
        }
        if (ssl.key) {
          connectionConfig.ssl.key = ssl.key;
        }
        if (ssl.rejectUnauthorized !== undefined) {
          connectionConfig.ssl.rejectUnauthorized = ssl.rejectUnauthorized;
        }
      }

      const connection = await mysql.createConnection(connectionConfig);

      try {
        // 获取表列表；如果传入 tableNames，只查选中的表
        const tableParams = [database];
        let tableFilter = '';
        if (selectedTableNames) {
          tableFilter = ` AND TABLE_NAME IN (${selectedTableNames.map(() => '?').join(',')})`;
          tableParams.push(...selectedTableNames);
        }
        const [tables] = await connection.query(`
          SELECT TABLE_NAME as table_name
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ?
          AND TABLE_TYPE = 'BASE TABLE'
          ${tableFilter}
          ORDER BY TABLE_NAME
        `, tableParams);

        const schema = {};

        // 获取每个表的结构
        for (const table of tables) {
          const tableName = table.table_name;
          
          // 获取列信息
          const [columns] = await connection.query(`
            SELECT 
              COLUMN_NAME as column_name,
              DATA_TYPE as data_type,
              IS_NULLABLE as is_nullable,
              COLUMN_KEY as column_key,
              COLUMN_COMMENT as column_comment,
              COLUMN_DEFAULT as column_default
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
          `, [database, tableName]);

          // 获取索引信息
          const [indexes] = await connection.query(`
            SELECT 
              INDEX_NAME as index_name,
              COLUMN_NAME as column_name,
              NON_UNIQUE as non_unique
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY INDEX_NAME, SEQ_IN_INDEX
          `, [database, tableName]);

          schema[tableName] = {
            columns: columns.map(col => ({
              column_name: col.column_name,
              data_type: col.data_type,
              is_nullable: col.is_nullable,
              column_key: col.column_key,
              column_comment: col.column_comment || '',
              column_default: col.column_default,
            })),
            indexes: indexes.map(idx => ({
              index_name: idx.index_name,
              column_name: idx.column_name,
              non_unique: idx.non_unique,
            })),
          };
        }

        await connection.end();

        return {
          success: true,
          database,
          schema,
        };
      } catch (error) {
        await connection.end();
        throw error;
      }
    } else if (type === 'postgresql') {
      let pg;
      try {
        pg = require('pg');
      } catch (error) {
        return {
          success: false,
          error: 'pg 包未安装，请运行: npm install pg',
        };
      }

      const { Client } = pg;
      const clientConfig = {
        host,
        port,
        database,
        user: username,
        password,
        connectionTimeoutMillis: 10000,
      };

      // PostgreSQL SSL配置
      if (ssl && ssl.enabled) {
        clientConfig.ssl = {};
        if (ssl.rejectUnauthorized !== undefined) {
          clientConfig.ssl.rejectUnauthorized = ssl.rejectUnauthorized;
        }
        if (ssl.ca) {
          clientConfig.ssl.ca = ssl.ca;
        }
        if (ssl.cert) {
          clientConfig.ssl.cert = ssl.cert;
        }
        if (ssl.key) {
          clientConfig.ssl.key = ssl.key;
        }
      }

      const client = new Client(clientConfig);

      await client.connect();

      try {
        // 获取表列表；如果传入 tableNames，只查选中的表
        const tableParams = [schemaName];
        let tableFilter = '';
        if (selectedTableNames) {
          tableFilter = ` AND table_name = ANY($2::text[])`;
          tableParams.push(selectedTableNames);
        }
        const tablesResult = await client.query(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = $1
          AND table_type = 'BASE TABLE'
          ${tableFilter}
          ORDER BY table_name
        `, tableParams);

        const schema = {};

        // 获取每个表的结构
        for (const row of tablesResult.rows) {
          const tableName = row.table_name;

          // 获取列信息
          const columnsResult = await client.query(`
            SELECT 
              column_name,
              data_type,
              is_nullable,
              column_default
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
          `, [schemaName, tableName]);

          // 获取主键信息
          const pkResult = await client.query(`
            SELECT a.attname as column_name
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass
            AND i.indisprimary
          `, [`${schemaName}.${tableName}`]);

          const primaryKeys = new Set(pkResult.rows.map(r => r.column_name));

          // 获取索引信息
          const indexesResult = await client.query(`
            SELECT
              i.relname as index_name,
              a.attname as column_name,
              ix.indisunique as is_unique
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE t.relkind = 'r'
            AND t.relname = $1
            ORDER BY i.relname, a.attnum
          `, [tableName]);

          schema[tableName] = {
            columns: columnsResult.rows.map(col => ({
              column_name: col.column_name,
              data_type: col.data_type,
              is_nullable: col.is_nullable === 'YES',
              column_key: primaryKeys.has(col.column_name) ? 'PRI' : '',
              column_comment: '',
              column_default: col.column_default,
            })),
            indexes: indexesResult.rows.map(idx => ({
              index_name: idx.index_name,
              column_name: idx.column_name,
              non_unique: idx.is_unique ? 0 : 1,
            })),
          };
        }

        await client.end();

        return {
          success: true,
          database,
          schema,
        };
      } catch (error) {
        await client.end();
        throw error;
      }
    } else if (type === 'gaussdb') {
      // GaussDB 使用 Java JDBC 桥查询。
      // 支持按 schema / selected tables 分层加载，避免一次性扫描全库全列。
      const dataSourceConfig = { host, port, database, username, ssl };
      const tablePlaceholders = selectedTableNames
        ? selectedTableNames.map(() => '?').join(',')
        : '';
      const tableFilter = selectedTableNames
        ? `AND c.relname IN (${tablePlaceholders})`
        : '';
      const queryParams = selectedTableNames
        ? [schemaName, ...selectedTableNames]
        : [schemaName];

      // 1. 获取表列表：直接查 pg_class，避免 pg_catalog.pg_tables 视图额外开销
      const tables = await gaussdbJdbcQuery(
        `SELECT c.oid AS table_oid, c.relname AS table_name
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = ?
           AND c.relkind IN ('r', 'p')
           ${tableFilter}
         ORDER BY c.relname`,
        queryParams,
        dataSourceConfig,
        password,
      );

      if (!tables || tables.length === 0) {
        return { success: true, database, schema: {} };
      }

      // 2. 一次性获取所有表的列信息。
      // 避免 information_schema、format_type、pg_get_expr 这类在 GaussDB 上可能很慢的视图/函数。
      const allColumns = await gaussdbJdbcQuery(
        `SELECT
           c.relname                                        AS table_name,
           a.attname                                       AS column_name,
           t.typname                                       AS data_type,
           CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
           NULL::text                                      AS column_default
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
         JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
         WHERE n.nspname = ?
           AND c.relkind IN ('r', 'p')
           AND a.attnum > 0
           AND NOT a.attisdropped
           ${tableFilter}
         ORDER BY c.relname, a.attnum`,
        queryParams,
        dataSourceConfig,
        password,
      );

      // 3. 一次性获取所有表的主键
      const allPkRows = await gaussdbJdbcQuery(
        `SELECT c.relname AS table_name, a.attname AS column_name
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE i.indisprimary
           AND n.nspname = ?
           AND c.relkind IN ('r', 'p')
           ${tableFilter}`,
        queryParams,
        dataSourceConfig,
        password,
      );

      // 按表名分组列信息
      const columnsByTable = {};
      for (const col of allColumns) {
        if (!columnsByTable[col.table_name]) columnsByTable[col.table_name] = [];
        columnsByTable[col.table_name].push(col);
      }

      // 按表名分组主键
      const pkByTable = {};
      for (const pk of allPkRows) {
        if (!pkByTable[pk.table_name]) pkByTable[pk.table_name] = new Set();
        pkByTable[pk.table_name].add(pk.column_name);
      }

      // 组装 schema
      const schema = {};
      for (const row of tables) {
        const tableName = row.table_name;
        const cols = columnsByTable[tableName] || [];
        const pks = pkByTable[tableName] || new Set();
        schema[tableName] = {
          columns: cols.map((col) => ({
            column_name: col.column_name,
            data_type: col.data_type,
            is_nullable: col.is_nullable === 'YES',
            column_key: pks.has(col.column_name) ? 'PRI' : '',
            column_comment: '',
            column_default: col.column_default,
          })),
          indexes: [],
        };
      }

      return { success: true, database, schema };
    } else {
      return {
        success: false,
        error: `不支持的数据库类型: ${type}`,
      };
    }
  } catch (error) {
    logger.error('[getDatabaseSchema] Error:', error);
    logger.error('[getDatabaseSchema] Error stack:', error.stack);
    logger.error('[getDatabaseSchema] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
    });
    return {
      success: false,
      error: error.message || '获取数据库结构失败',
    };
  }
}

async function listDatabaseSchemas(config) {
  const { type, host, port, database, username, password, ssl } = config;
  if (type === 'mysql') {
    return {
      success: true,
      database,
      schemas: [{ schemaName: database, tableCount: null }],
    };
  }

  if (type === 'postgresql') {
    const { Client } = require('pg');
    const client = new Client({
      host,
      port,
      database,
      user: username,
      password,
      connectionTimeoutMillis: 10000,
      ssl: ssl?.enabled ? { rejectUnauthorized: ssl.rejectUnauthorized !== false } : undefined,
    });
    await client.connect();
    try {
      const { rows } = await client.query(`
        SELECT n.nspname AS schema_name, COUNT(c.oid)::int AS table_count
        FROM pg_catalog.pg_namespace n
        LEFT JOIN pg_catalog.pg_class c
          ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p')
        WHERE n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
        GROUP BY n.nspname
        ORDER BY CASE WHEN n.nspname = 'public' THEN 0 ELSE 1 END, n.nspname
      `);
      return {
        success: true,
        database,
        schemas: rows.map((r) => ({ schemaName: r.schema_name, tableCount: r.table_count })),
      };
    } finally {
      await client.end();
    }
  }

  if (type === 'gaussdb') {
    const rows = await gaussdbJdbcQuery(
      `SELECT n.nspname AS schema_name, COUNT(c.oid) AS table_count
       FROM pg_catalog.pg_namespace n
       LEFT JOIN pg_catalog.pg_class c
         ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p')
       WHERE n.nspname NOT LIKE 'pg_%'
         AND n.nspname <> 'information_schema'
       GROUP BY n.nspname
       ORDER BY CASE WHEN n.nspname = 'public' THEN 0 ELSE 1 END, n.nspname`,
      [],
      { host, port, database, username, ssl },
      password,
    );
    return {
      success: true,
      database,
      schemas: rows.map((r) => ({
        schemaName: r.schema_name,
        tableCount: Number(r.table_count || 0),
      })),
    };
  }

  return { success: false, error: `不支持的数据库类型: ${type}` };
}

async function listDatabaseTables(config) {
  const { type, host, port, database, username, password, ssl, schemaName = 'public' } = config;

  if (type === 'mysql') {
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection({
      host,
      port,
      user: username,
      password,
      database,
      connectTimeout: 10000,
    });
    try {
      const [rows] = await connection.query(
        `SELECT TABLE_NAME AS table_name
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_NAME`,
        [database],
      );
      return { success: true, database, schemaName: database, tables: rows.map((r) => r.table_name) };
    } finally {
      await connection.end();
    }
  }

  if (type === 'postgresql') {
    const { Client } = require('pg');
    const client = new Client({
      host,
      port,
      database,
      user: username,
      password,
      connectionTimeoutMillis: 10000,
      ssl: ssl?.enabled ? { rejectUnauthorized: ssl.rejectUnauthorized !== false } : undefined,
    });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT c.relname AS table_name
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1
           AND c.relkind IN ('r', 'p')
         ORDER BY c.relname`,
        [schemaName],
      );
      return { success: true, database, schemaName, tables: rows.map((r) => r.table_name) };
    } finally {
      await client.end();
    }
  }

  if (type === 'gaussdb') {
    const rows = await gaussdbJdbcQuery(
      `SELECT c.relname AS table_name
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ?
         AND c.relkind IN ('r', 'p')
       ORDER BY c.relname`,
      [schemaName],
      { host, port, database, username, ssl },
      password,
    );
    return { success: true, database, schemaName, tables: rows.map((r) => r.table_name) };
  }

  return { success: false, error: `不支持的数据库类型: ${type}` };
}

/**
 * 获取所有数据源
 * @route GET /api/config/data-sources
 * 返回所有数据源
 */
async function getDataSourcesHandler(req, res) {
  try {
    const { SystemRoles } = require('@because/data-provider');
    const isAdmin = req.user?.role === SystemRoles.ADMIN;
    
    let dataSources = await getDataSources({});

    // 如果不是管理员，只返回公开的数据源
    if (!isAdmin) {
      dataSources = dataSources.filter(ds => {
        const isPublic = ds.isPublic !== undefined ? Boolean(ds.isPublic) : false;
        return isPublic === true;
      });
    }

    // 移除密码字段，确保 isPublic 字段存在（兼容旧数据）
    const sanitizedDataSources = dataSources.map(({ password, ...rest }) => ({
      ...rest,
      isPublic: rest.isPublic !== undefined ? Boolean(rest.isPublic) : false,
    }));

    return res.status(200).json({
      success: true,
      data: sanitizedDataSources,
    });
  } catch (error) {
    logger.error('[getDataSourcesHandler] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || '获取数据源列表失败',
    });
  }
}

/**
 * 获取单个数据源
 * @route GET /api/config/data-sources/:id
 */
async function getDataSourceHandler(req, res) {
  try {
    const { id } = req.params;
    const { id: userId } = req.user;

    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({
        success: false,
        error: '数据源不存在',
      });
    }

    // 检查权限：只有创建者或管理员可以访问
    if (dataSource.createdBy.toString() !== userId && req.user.role !== SystemRoles.ADMIN) {
      return res.status(403).json({
        success: false,
        error: '无权访问此数据源',
      });
    }

    // 移除密码字段，确保 isPublic 字段存在（兼容旧数据）
    const { password, ...rest } = dataSource;
    const sanitizedDataSource = {
      ...rest,
      isPublic: rest.isPublic !== undefined ? Boolean(rest.isPublic) : false,
    };

    return res.status(200).json({
      success: true,
      data: sanitizedDataSource,
    });
  } catch (error) {
    logger.error('[getDataSourceHandler] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || '获取数据源失败',
    });
  }
}

/**
 * 创建数据源
 * @route POST /api/config/data-sources
 */
async function createDataSourceHandler(req, res) {
  try {
    const { id: userId } = req.user;
    const {
      name,
      type,
      host,
      port,
      database,
      username,
      password,
      connectionPool,
      ssl,
      status = 'active',
      isPublic = false,
    } = req.body;

    // 验证必填字段
    if (!name || !type || !host || !port || !database || !username || !password) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段',
      });
    }

    // 验证类型
    if (!['mysql', 'postgresql', 'gaussdb'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: '不支持的数据库类型，仅支持 mysql、postgresql 和 gaussdb',
      });
    }

    // 加密密码
    const encryptedPassword = await encryptPassword(password);

    // 创建数据源 - 确保userId是ObjectId类型
    // 如果connectionPool存在，确保所有字段都有值
    const poolConfig = connectionPool
      ? {
          min: connectionPool.min ?? 0,
          max: connectionPool.max ?? 10,
          idleTimeoutMillis: connectionPool.idleTimeoutMillis ?? 30000,
          connectionTimeoutMillis: connectionPool.connectionTimeoutMillis ?? 10000,
        }
      : {
          min: 0,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        };

    // SSL配置
    const sslConfig = ssl
      ? {
          enabled: ssl.enabled ?? false,
          rejectUnauthorized: ssl.rejectUnauthorized ?? true,
          ca: ssl.ca || null,
          cert: ssl.cert || null,
          key: ssl.key || null,
        }
      : {
          enabled: false,
          rejectUnauthorized: true,
          ca: null,
          cert: null,
          key: null,
        };

    const dataSource = await createDataSource({
      name,
      type,
      host,
      port: parseInt(port),
      database,
      username,
      password: encryptedPassword,
      connectionPool: poolConfig,
      ssl: sslConfig,
      status,
      isPublic,
      createdBy: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId,
    });

    // 移除密码字段 - dataSource已经是普通对象
    const { password: _, ...sanitizedDataSource } = dataSource;

    return res.status(201).json({
      success: true,
      data: sanitizedDataSource,
      message: '数据源创建成功',
    });
  } catch (error) {
    logger.error('[createDataSourceHandler] Error:', error);
    logger.error('[createDataSourceHandler] Error stack:', error.stack);
    logger.error('[createDataSourceHandler] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
      keyPattern: error.keyPattern,
      keyValue: error.keyValue,
    });

    // 处理唯一索引冲突错误 (E11000)
    if (error.code === 11000 || error.name === 'MongoServerError') {
      const duplicateKey = error.keyPattern ? Object.keys(error.keyPattern)[0] : 'name';
      const duplicateValue = error.keyValue ? Object.values(error.keyValue)[0] : 'unknown';
      return res.status(409).json({
        success: false,
        error: `数据源名称 "${duplicateValue}" 已存在，请使用不同的名称`,
      });
    }

    // 处理验证错误
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors || {}).map((err) => err.message).join(', ');
      return res.status(400).json({
        success: false,
        error: `数据验证失败: ${validationErrors}`,
      });
    }

    // 处理类型转换错误
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: `数据类型错误: ${error.message}`,
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message || '创建数据源失败',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

/**
 * 更新数据源
 * @route PUT /api/config/data-sources/:id
 */
async function updateDataSourceHandler(req, res) {
  try {
    const { id } = req.params;
    const { id: userId } = req.user;
    const updateData = req.body;

    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({
        success: false,
        error: '数据源不存在',
      });
    }

    // 检查权限
    if (dataSource.createdBy.toString() !== userId && req.user.role !== SystemRoles.ADMIN) {
      return res.status(403).json({
        success: false,
        error: '无权修改此数据源',
      });
    }

    // 如果提供了密码，需要加密
    if (updateData.password) {
      updateData.password = await encryptPassword(updateData.password);
    }

    // 如果提供了connectionPool，确保所有字段都有值
    if (updateData.connectionPool) {
      updateData.connectionPool = {
        min: updateData.connectionPool.min ?? 0,
        max: updateData.connectionPool.max ?? 10,
        idleTimeoutMillis: updateData.connectionPool.idleTimeoutMillis ?? 30000,
        connectionTimeoutMillis: updateData.connectionPool.connectionTimeoutMillis ?? 10000,
      };
    }

    // 如果提供了SSL配置，确保所有字段都有值
    if (updateData.ssl !== undefined) {
      if (updateData.ssl === null) {
        // 如果显式设置为null，则删除SSL配置
        updateData.ssl = {
          enabled: false,
          rejectUnauthorized: true,
          ca: null,
          cert: null,
          key: null,
        };
      } else {
        updateData.ssl = {
          enabled: updateData.ssl.enabled ?? false,
          rejectUnauthorized: updateData.ssl.rejectUnauthorized ?? true,
          ca: updateData.ssl.ca || null,
          cert: updateData.ssl.cert || null,
          key: updateData.ssl.key || null,
        };
      }
    }

    // 不允许修改name和createdBy
    delete updateData.name;
    delete updateData.createdBy;

    // 确保 isPublic 字段被正确设置
    if (updateData.isPublic !== undefined) {
      updateData.isPublic = Boolean(updateData.isPublic);
    }

    const updatedDataSource = await updateDataSource(id, updateData);
    if (!updatedDataSource) {
      return res.status(404).json({
        success: false,
        error: '数据源不存在',
      });
    }

    // 移除密码字段，确保 isPublic 字段存在（兼容旧数据）
    const { password: _, ...rest } = updatedDataSource;
    const sanitizedDataSource = {
      ...rest,
      isPublic: rest.isPublic !== undefined ? Boolean(rest.isPublic) : false,
    };

    return res.status(200).json({
      success: true,
      data: sanitizedDataSource,
      message: '数据源更新成功',
    });
  } catch (error) {
    logger.error('[updateDataSourceHandler] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || '更新数据源失败',
    });
  }
}

/**
 * 删除数据源
 * @route DELETE /api/config/data-sources/:id
 */
async function deleteDataSourceHandler(req, res) {
  try {
    const { id } = req.params;
    const { id: userId } = req.user;

    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({
        success: false,
        error: '数据源不存在',
      });
    }

    // 检查权限
    if (dataSource.createdBy.toString() !== userId && req.user.role !== SystemRoles.ADMIN) {
      return res.status(403).json({
        success: false,
        error: '无权删除此数据源',
      });
    }

    const deleted = await deleteDataSource(id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: '数据源不存在',
      });
    }

    return res.status(200).json({
      success: true,
      message: '数据源删除成功',
    });
  } catch (error) {
    logger.error('[deleteDataSourceHandler] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || '删除数据源失败',
    });
  }
}

/**
 * 测试数据源连接
 * @route POST /api/config/data-sources/:id/test
 */
async function testDataSourceConnectionHandler(req, res) {
  try {
    const { id } = req.params;
    const { id: userId } = req.user;

    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({
        success: false,
        error: '数据源不存在',
      });
    }

    // 检查权限
    if (dataSource.createdBy.toString() !== userId && req.user.role !== SystemRoles.ADMIN) {
      return res.status(403).json({
        success: false,
        error: '无权测试此数据源',
      });
    }

    // 解密密码
    let password;
    try {
      password = await decryptPassword(dataSource.password);
    } catch (decryptError) {
      // 处理密码解密错误
      if (decryptError.code === 'LEGACY_ENCRYPTION_FORMAT') {
        return res.status(400).json({
          success: false,
          status: 'error',
          error: decryptError.message,
          code: 'LEGACY_ENCRYPTION_FORMAT',
          message: decryptError.message,
        });
      }
      logger.error('[testDataSourceConnectionHandler] 密码解密失败', { error: decryptError.message });
      return res.status(500).json({
        success: false,
        status: 'error',
        error: decryptError.message || '密码解密失败',
        code: 'DECRYPTION_FAILED',
      });
    }

    // 测试连接
    const result = await testDatabaseConnection({
      type: dataSource.type,
      host: dataSource.host,
      port: dataSource.port,
      database: dataSource.database,
      username: dataSource.username,
      password,
      ssl: dataSource.ssl,
    });

    // 更新连接状态
    if (result.success) {
      await updateDataSource(id, {
        connectionStatus: 'connected',
        lastTestedAt: new Date(),
        testMessage: '连接成功',
      });
    } else {
      await updateDataSource(id, {
        connectionStatus: 'disconnected',
        lastTestedAt: new Date(),
        testMessage: result.error || '连接失败',
      });
    }

    return res.status(200).json(buildConnectionTestApiPayload(result));
  } catch (error) {
    logger.error('[testDataSourceConnectionHandler] Error:', error);
    const formatted = formatConnectionTestError(error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: formatted.error,
      error: formatted.error,
      code: formatted.code,
      ...(formatted.hint ? { hint: formatted.hint } : {}),
    });
  }
}

/**
 * 测试连接（用于新建数据源时）
 * @route POST /api/config/data-sources/test
 */
async function testConnectionHandler(req, res) {
  try {
    const { type, host, port, database, username, password, ssl } = req.body;

    if (!type || !host || !port || !database || !username || !password) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段',
      });
    }

    const result = await testDatabaseConnection({
      type,
      host,
      port,
      database,
      username,
      password,
      ssl,
    });

    return res.status(200).json(buildConnectionTestApiPayload(result));
  } catch (error) {
    logger.error('[testConnectionHandler] Error:', error);
    const formatted = formatConnectionTestError(error, { type: req.body?.type });
    return res.status(500).json({
      success: false,
      status: 'error',
      message: formatted.error,
      error: formatted.error,
      code: formatted.code,
      ...(formatted.hint ? { hint: formatted.hint } : {}),
    });
  }
}

/**
 * 校验数据源访问权限并返回数据源与明文密码
 */
async function resolveDataSourceWithPassword(req, id, logPrefix) {
  const { id: userId } = req.user;
  const isAdmin = req.user?.role === SystemRoles.ADMIN;

  const dataSource = await getDataSourceById(id);
  if (!dataSource) {
    const err = new Error('数据源不存在');
    err.statusCode = 404;
    throw err;
  }

  const isPublic = dataSource.isPublic !== undefined ? Boolean(dataSource.isPublic) : false;
  const isOwner = dataSource.createdBy.toString() === userId;
  if (!isAdmin && !isOwner && !isPublic) {
    logger.warn(`[${logPrefix}] 无权访问此数据源`, { id, userId, createdBy: dataSource.createdBy, isPublic });
    const err = new Error('无权访问此数据源');
    err.statusCode = 403;
    throw err;
  }

  try {
    const password = await decryptPassword(dataSource.password);
    return { dataSource, password };
  } catch (decryptError) {
    if (decryptError.code === 'LEGACY_ENCRYPTION_FORMAT') {
      decryptError.statusCode = 400;
    }
    throw decryptError;
  }
}

/**
 * 获取数据源的数据库结构
 * @route GET /api/config/data-sources/:id/schema
 */
async function getDataSourceSchemaHandler(req, res) {
  try {
    const { id } = req.params;
    const schemaName = String(req.query.schemaName || req.query.schema || 'public');
    const tableNames = req.query.tables
      ? String(req.query.tables).split(',').map((t) => t.trim()).filter(Boolean)
      : null;
    const { id: userId } = req.user;
    const isAdmin = req.user?.role === SystemRoles.ADMIN;

    logger.info('[getDataSourceSchemaHandler] 开始获取数据库结构', { id, userId });

    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      logger.warn('[getDataSourceSchemaHandler] 数据源不存在', { id });
      return res.status(404).json({
        success: false,
        error: '数据源不存在',
      });
    }

    // 检查权限：管理员可以访问所有数据源，普通用户只能访问公开的数据源
    const isPublic = dataSource.isPublic !== undefined ? Boolean(dataSource.isPublic) : false;
    const isOwner = dataSource.createdBy.toString() === userId;
    
    if (!isAdmin && !isOwner && !isPublic) {
      logger.warn('[getDataSourceSchemaHandler] 无权访问此数据源', { id, userId, createdBy: dataSource.createdBy, isPublic });
      return res.status(403).json({
        success: false,
        error: '无权访问此数据源',
      });
    }

    // 解密密码
    let password;
    try {
      password = await decryptPassword(dataSource.password);
      logger.info('[getDataSourceSchemaHandler] 密码解密成功');
    } catch (decryptError) {
      // 处理密码解密错误
      if (decryptError.code === 'LEGACY_ENCRYPTION_FORMAT') {
        return res.status(400).json({
          success: false,
          error: decryptError.message,
          code: 'LEGACY_ENCRYPTION_FORMAT',
        });
      }
      logger.error('[getDataSourceSchemaHandler] 密码解密失败', { error: decryptError.message, stack: decryptError.stack });
      return res.status(500).json({
        success: false,
        error: decryptError.message || '密码解密失败',
        code: 'DECRYPTION_FAILED',
      });
    }

    // 获取数据库结构
    logger.info('[getDataSourceSchemaHandler] 开始获取数据库结构', {
      type: dataSource.type,
      host: dataSource.host,
      port: dataSource.port,
      database: dataSource.database,
      username: dataSource.username,
    });

    const result = await getDatabaseSchema({
      type: dataSource.type,
      host: dataSource.host,
      port: dataSource.port,
      database: dataSource.database,
      username: dataSource.username,
      password,
      ssl: dataSource.ssl,
      schemaName,
      tableNames,
    });

    if (!result.success) {
      logger.error('[getDataSourceSchemaHandler] 获取数据库结构失败', { error: result.error });
      return res.status(500).json({
        success: false,
        error: result.error || '获取数据库结构失败',
      });
    }

    logger.info('[getDataSourceSchemaHandler] 获取数据库结构成功', {
      tableCount: Object.keys(result.schema || {}).length,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('[getDataSourceSchemaHandler] Error:', error);
    logger.error('[getDataSourceSchemaHandler] Error stack:', error.stack);
    logger.error('[getDataSourceSchemaHandler] Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
    });
    return res.status(500).json({
      success: false,
      error: error.message || '获取数据库结构失败',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

/**
 * 获取数据源下的 schema 列表（轻量）
 * @route GET /api/config/data-sources/:id/schemas
 */
async function listDataSourceSchemasHandler(req, res) {
  const { id } = req.params;
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }
    const TableExtractService = require('~/server/services/Knowledge/TableExtractService');
    if (TableExtractService.isKnowledgeExtractMockDataSource(dataSource)) {
      return res.json({ success: true, data: TableExtractService.getMockSchemaCatalog() });
    }

    const { password } = await resolveDataSourceWithPassword(req, id, 'listDataSourceSchemasHandler');
    const result = await listDatabaseSchemas({
      type: dataSource.type,
      host: dataSource.host,
      port: dataSource.port,
      database: dataSource.database,
      username: dataSource.username,
      password,
      ssl: dataSource.ssl,
    });
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || '获取 schema 列表失败' });
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    logger.error('[listDataSourceSchemasHandler] Error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '获取 schema 列表失败',
      code: error.code,
    });
  }
}

/**
 * 获取指定 schema 下的表名列表（轻量）
 * @route GET /api/config/data-sources/:id/schemas/:schemaName/tables
 */
async function listDataSourceSchemaTablesHandler(req, res) {
  const { id, schemaName } = req.params;
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }
    const TableExtractService = require('~/server/services/Knowledge/TableExtractService');
    if (TableExtractService.isKnowledgeExtractMockDataSource(dataSource)) {
      return res.json({
        success: true,
        data: TableExtractService.getMockTablesForSchema(schemaName),
      });
    }

    const { password } = await resolveDataSourceWithPassword(
      req,
      id,
      'listDataSourceSchemaTablesHandler',
    );
    const result = await listDatabaseTables({
      type: dataSource.type,
      host: dataSource.host,
      port: dataSource.port,
      database: dataSource.database,
      username: dataSource.username,
      password,
      ssl: dataSource.ssl,
      schemaName,
    });
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || '获取表列表失败' });
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    logger.error('[listDataSourceSchemaTablesHandler] Error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || '获取表列表失败',
      code: error.code,
    });
  }
}

// ─────────────────────────────── Light Schema ────────────────────────────────

const LightSchemaService = require('~/server/services/LightSchemaService');
const CellVectorizationService = require('~/server/services/CellVectorizationService');
const VectorDBService = require('~/server/services/RAG/VectorDBService');
const EmbeddingService = require('~/server/services/RAG/EmbeddingService');

let _vectorDB = null;
let _embeddingService = null;

async function getSharedServices() {
  if (!_vectorDB) {
    _vectorDB = new VectorDBService();
    await _vectorDB.initialize();
  }
  if (!_embeddingService) {
    // EmbeddingService 无需显式 initialize()，内部会延迟加载 ONNX 模型
    _embeddingService = new EmbeddingService();
  }
  return { vectorDB: _vectorDB, embeddingService: _embeddingService };
}

/**
 * POST /data-sources/:id/light-schema/generate
 * 生成并存储指定数据源的 Light Schema
 */
async function generateLightSchemaHandler(req, res) {
  const { id } = req.params;
  const { tableNames, sampleLimit = 5, schemaName } = req.body || {};

  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    let password;
    try {
      password = await decryptPassword(dataSource.password);
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message, code: err.code });
    }

    const { vectorDB, embeddingService } = await getSharedServices();
    const service = new LightSchemaService();

    const schemas = await service.generateForDataSource(dataSource, password, {
      sampleLimit: Number(sampleLimit),
      selectedTables: Array.isArray(tableNames) && tableNames.length > 0 ? tableNames : null,
      schemaName: schemaName || undefined,
    });
    const count = await service.storeToVectorDB(String(dataSource._id), schemas, vectorDB, embeddingService);

    logger.info(`[generateLightSchemaHandler] Generated ${count} light schemas for datasource: ${id}`);
    return res.json({ success: true, count, tables: schemas.map((s) => s.tableName) });
  } catch (error) {
    logger.error('[generateLightSchemaHandler] Error:', error.message);
    logger.error('[generateLightSchemaHandler] Stack:', error.stack);
    return res.status(500).json({ success: false, error: error.message || 'Light Schema 生成失败' });
  }
}

/**
 * POST /data-sources/:id/cells/vectorize
 * 对数据源的文本列进行单元格向量化
 */
async function vectorizeCellsHandler(req, res) {
  const { id } = req.params;
  const { tableNames, rowLimit = 100, schemaName } = req.body || {};

  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    let password;
    try {
      password = await decryptPassword(dataSource.password);
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message, code: err.code });
    }

    const { vectorDB, embeddingService } = await getSharedServices();
    const service = new CellVectorizationService();

    const count = await service.vectorizeDataSource(dataSource, password, vectorDB, embeddingService, {
      rowLimit: Number(rowLimit),
      selectedTables: Array.isArray(tableNames) && tableNames.length > 0 ? tableNames : null,
      schemaName: schemaName || undefined,
    });

    logger.info(`[vectorizeCellsHandler] Vectorized ${count} cells for datasource: ${id}`);
    return res.json({ success: true, count });
  } catch (error) {
    logger.error('[vectorizeCellsHandler] Error:', error.message);
    logger.error('[vectorizeCellsHandler] Stack:', error.stack);
    return res.status(500).json({ success: false, error: error.message || '单元格向量化失败' });
  }
}

/**
 * GET /data-sources/:id/light-schema
 * 查询已存储的 Light Schema 列表
 */
async function getLightSchemasHandler(req, res) {
  const { id } = req.params;
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const { vectorDB } = await getSharedServices();
    const schemas = await vectorDB.getLightSchemas(String(dataSource._id));
    return res.json({ success: true, data: schemas });
  } catch (error) {
    logger.error('[getLightSchemasHandler] Error:', error);
    return res.status(500).json({ success: false, error: error.message || '查询 Light Schema 失败' });
  }
}

/**
 * GET /data-sources/:id/cells/summary
 * 按表聚合 Cell 向量统计（列表展示用，不受明细 LIMIT 影响）
 */
async function getCellSummaryHandler(req, res) {
  const { id } = req.params;
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const { vectorDB } = await getSharedServices();
    const summary = await vectorDB.getCellSummary(String(dataSource._id));
    return res.json({ success: true, data: summary });
  } catch (error) {
    logger.error('[getCellSummaryHandler] Error:', error);
    return res.status(500).json({ success: false, error: error.message || '查询 Cell 向量统计失败' });
  }
}

/**
 * GET /data-sources/:id/cells
 * 查询已存储的 Cell 向量列表
 */
async function getCellsHandler(req, res) {
  const { id } = req.params;
  const { tableName, columnName, limit } = req.query || {};
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const { vectorDB } = await getSharedServices();
    const cells = await vectorDB.getCells(String(dataSource._id), {
      tableName: tableName ? String(tableName) : undefined,
      columnName: columnName ? String(columnName) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return res.json({ success: true, data: cells });
  } catch (error) {
    logger.error('[getCellsHandler] Error:', error);
    return res.status(500).json({ success: false, error: error.message || '查询 Cell 向量失败' });
  }
}

/**
 * DELETE /data-sources/:id/light-schema/:tableName
 * 删除指定表的 Light Schema
 */
async function deleteLightSchemaHandler(req, res) {
  const { id, tableName } = req.params;
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }
    if (!tableName) {
      return res.status(400).json({ success: false, error: '缺少表名' });
    }

    const { vectorDB } = await getSharedServices();
    const deletedCount = await vectorDB.deleteLightSchemas(String(dataSource._id), [tableName]);
    if (deletedCount === 0) {
      return res.status(404).json({ success: false, error: `未找到表 ${tableName} 的 Light Schema`, deletedCount: 0 });
    }
    logger.info(`[deleteLightSchemaHandler] Deleted light schema for table: ${tableName}, datasource: ${id}, rows: ${deletedCount}`);
    return res.json({ success: true, tableName, deletedCount });
  } catch (error) {
    logger.error('[deleteLightSchemaHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || '删除 Light Schema 失败' });
  }
}

/**
 * PUT /data-sources/:id/light-schema/:tableName
 * 更新指定表的 Light Schema 内容（列增删改），重新 embed 后 upsert
 * body: { columns: [...], primaryKeys: [...] }
 */
async function updateLightSchemaHandler(req, res) {
  const { id, tableName } = req.params;
  const { columns, primaryKeys } = req.body || {};

  if (!Array.isArray(columns)) {
    return res.status(400).json({ success: false, error: 'columns 必须为数组' });
  }

  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const { vectorDB, embeddingService } = await getSharedServices();

    // 组装新的 LightSchema 对象
    const newSchema = {
      tableName,
      columns: columns.map((c) => ({
        name: String(c.name || '').trim(),
        type: String(c.type || '').trim(),
        nullable: Boolean(c.nullable),
        description: String(c.description || '').trim(),
        sampleValues: Array.isArray(c.sampleValues) ? c.sampleValues.map(String) : [],
      })).filter((c) => c.name),
      primaryKeys: Array.isArray(primaryKeys) ? primaryKeys.map(String) : [],
    };

    // 生成 DDL 文本
    const cols = newSchema.columns
      .map((c) => {
        let line = `  ${c.name} ${c.type}`;
        if (!c.nullable) line += ' NOT NULL';
        if (c.description) line += ` -- ${c.description}`;
        return line;
      })
      .join(',\n');
    const pkLine = newSchema.primaryKeys.length > 0
      ? `,\n  PRIMARY KEY (${newSchema.primaryKeys.join(', ')})`
      : '';
    const samples = newSchema.columns
      .filter((c) => c.sampleValues?.length > 0)
      .map((c) => `-- ${c.name} examples: ${c.sampleValues.slice(0, 5).join(', ')}`)
      .join('\n');
    const ddlText = `CREATE TABLE ${tableName} (\n${cols}${pkLine}\n);\n${samples}`.trim();

    // 生成 embedding（用 DDL 文本）
    let embedding = null;
    try {
      embedding = await embeddingService.embedText(ddlText);
    } catch (e) {
      logger.warn('[updateLightSchemaHandler] embed 失败，使用 null embedding:', e.message);
    }

    await vectorDB.upsertLightSchemas(String(dataSource._id), [{
      tableName,
      content: JSON.stringify(newSchema),
      ddlText,
      embedding,
    }]);

    logger.info(`[updateLightSchemaHandler] 更新 light schema: ${tableName}, datasource: ${id}`);
    return res.json({
      success: true,
      tableName,
      columnCount: newSchema.columns.length,
    });
  } catch (error) {
    logger.error('[updateLightSchemaHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || '更新 Light Schema 失败' });
  }
}

/**
 * POST /data-sources/:id/cells
 * 新增单条 Cell 向量记录
 */
async function createCellHandler(req, res) {
  const { id } = req.params;
  const { tableName, columnName, cellValue } = req.body || {};

  if (!String(tableName || '').trim() || !String(columnName || '').trim() || !String(cellValue || '').trim()) {
    return res.status(400).json({ success: false, error: 'tableName、columnName、cellValue 不能为空' });
  }

  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const { vectorDB, embeddingService } = await getSharedServices();

    let embedding = null;
    try {
      embedding = await embeddingService.embedText(String(cellValue).trim());
    } catch (e) {
      logger.warn('[createCellHandler] embed 失败，使用 null embedding:', e.message);
    }

    const created = await vectorDB.createCell(String(dataSource._id), {
      tableName: String(tableName).trim(),
      columnName: String(columnName).trim(),
      cellValue: String(cellValue).trim(),
      embedding,
    });

    return res.json({ success: true, data: created });
  } catch (error) {
    logger.error('[createCellHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || '新增 Cell 向量失败' });
  }
}

/**
 * PUT /data-sources/:id/cells/:cellId
 * 更新单条 Cell 向量记录
 */
async function updateCellHandler(req, res) {
  const { id, cellId } = req.params;
  const { tableName, columnName, cellValue } = req.body || {};

  if (!String(tableName || '').trim() || !String(columnName || '').trim() || !String(cellValue || '').trim()) {
    return res.status(400).json({ success: false, error: 'tableName、columnName、cellValue 不能为空' });
  }

  const cellIdNum = Number(cellId);
  if (!Number.isInteger(cellIdNum) || cellIdNum <= 0) {
    return res.status(400).json({ success: false, error: '无效的 cellId' });
  }

  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const { vectorDB, embeddingService } = await getSharedServices();

    let embedding = null;
    try {
      embedding = await embeddingService.embedText(String(cellValue).trim());
    } catch (e) {
      logger.warn('[updateCellHandler] embed 失败，使用 null embedding:', e.message);
    }

    const updated = await vectorDB.updateCell(String(dataSource._id), cellIdNum, {
      tableName: String(tableName).trim(),
      columnName: String(columnName).trim(),
      cellValue: String(cellValue).trim(),
      embedding,
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Cell 向量记录不存在' });
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('[updateCellHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || '更新 Cell 向量失败' });
  }
}

/**
 * DELETE /data-sources/:id/cells/by-table/:tableName
 * 删除指定表的全部 Cell 向量记录
 */
async function deleteCellsByTableHandler(req, res) {
  const { id, tableName } = req.params;
  if (!tableName) {
    return res.status(400).json({ success: false, error: '缺少表名' });
  }

  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const { vectorDB } = await getSharedServices();
    const deletedCount = await vectorDB.deleteCells(String(dataSource._id), [tableName]);
    if (deletedCount === 0) {
      return res.status(404).json({ success: false, error: `未找到表 ${tableName} 的 Cell 向量`, deletedCount: 0 });
    }
    logger.info(`[deleteCellsByTableHandler] Deleted cell vectors for table: ${tableName}, datasource: ${id}, rows: ${deletedCount}`);
    return res.json({ success: true, tableName, deletedCount });
  } catch (error) {
    logger.error('[deleteCellsByTableHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || '删除 Cell 向量失败' });
  }
}

/**
 * DELETE /data-sources/:id/cells/:cellId
 * 删除单条 Cell 向量记录
 */
async function deleteCellHandler(req, res) {
  const { id, cellId } = req.params;
  const cellIdNum = Number(cellId);
  if (!Number.isInteger(cellIdNum) || cellIdNum <= 0) {
    return res.status(400).json({ success: false, error: '无效的 cellId' });
  }

  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const { vectorDB } = await getSharedServices();
    const deleted = await vectorDB.deleteCellById(String(dataSource._id), cellIdNum);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Cell 向量记录不存在' });
    }

    return res.json({ success: true, cellId: cellIdNum });
  } catch (error) {
    logger.error('[deleteCellHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || '删除 Cell 向量失败' });
  }
}

// ─────────────────────── Excel 文件单元格向量化 ───────────────────────────────

const multer = require('multer');
const excelUpload = multer({ storage: multer.memoryStorage() }).single('file');

function decodeUploadedFilename(rawName) {
  const raw = rawName || 'unknown.xlsx';
  return Buffer.from(raw, 'latin1').toString('utf8');
}

function parseExcelColumnConfig(body = {}) {
  const { parseColumnList } = require('~/server/services/Files/ExcelColumnSearchUtils');
  const primaryColumns = parseColumnList(body.primary_columns);
  const excludedColumns = parseColumnList(body.excluded_columns);
  return { primaryColumns, excludedColumns };
}

/**
 * POST /data-sources/:id/excel-files/preview-headers
 * 上传前预览 Excel 表头（首行）
 */
async function previewExcelHeadersHandler(req, res) {
  excelUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, error: uploadErr.message || '文件上传失败' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: '未收到文件，请上传 .xlsx 或 .xls 文件' });
    }

    try {
      const ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
      const svc = new ExcelCellVectorizationService();
      const parsed = svc.parseHeaders(req.file.buffer);
      const headers = [...new Set(parsed.sheets.flatMap((s) => s.headers))];
      return res.json({
        success: true,
        filename: decodeUploadedFilename(req.file.originalname),
        sheetNames: parsed.sheetNames,
        sheets: parsed.sheets,
        headers,
      });
    } catch (error) {
      logger.error('[previewExcelHeadersHandler] Error:', error.message, error.stack);
      return res.status(500).json({ success: false, error: error.message || '解析 Excel 表头失败' });
    }
  });
}

/**
 * POST /data-sources/:id/excel-files
 * 上传 xlsx 文件并向量化所有单元格
 */
async function uploadExcelFileHandler(req, res) {
  excelUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, error: uploadErr.message || '文件上传失败' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: '未收到文件，请上传 .xlsx 或 .xls 文件' });
    }

    const { id } = req.params;
    const filename = decodeUploadedFilename(req.file.originalname);

    try {
      const dataSource = await getDataSourceById(id);
      if (!dataSource) {
        return res.status(404).json({ success: false, error: '数据源不存在' });
      }

      const ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
      const svc = new ExcelCellVectorizationService();
      const { primaryColumns, excludedColumns } = parseExcelColumnConfig(req.body);

      const result = await svc.vectorize({
        fileBufferOrPath: req.file.buffer,
        entityId: String(dataSource._id),
        userId: req.user?.id || null,
        filename,
        sheetName: req.body.sheet_name || undefined,
        primaryColumns,
        excludedColumns,
      });

      logger.info(
        `[uploadExcelFileHandler] 向量化完成：fileId=${result.fileId}, cells=${result.cellCount}, rows=${result.rowCount}, primary=[${primaryColumns.join(',')}], excluded=[${excludedColumns.join(',')}]`,
      );
      return res.json({ success: true, ...result });
    } catch (error) {
      logger.error('[uploadExcelFileHandler] Error:', error.message, error.stack);
      return res.status(500).json({ success: false, error: error.message || 'Excel 向量化失败' });
    }
  });
}

/**
 * GET /data-sources/:id/excel-files
 * 列出该数据源下已向量化的 Excel 文件
 */
async function listExcelFilesHandler(req, res) {
  const { id } = req.params;
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
    const svc = new ExcelCellVectorizationService();
    const files = await svc.listByEntityId(String(dataSource._id));
    return res.json({ success: true, data: files });
  } catch (error) {
    logger.error('[listExcelFilesHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || '查询 Excel 文件列表失败' });
  }
}

/**
 * DELETE /data-sources/:id/excel-files/:fileId
 * 删除指定 Excel 文件的所有向量记录
 */
async function deleteExcelFileHandler(req, res) {
  const { id, fileId } = req.params;
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
    const svc = new ExcelCellVectorizationService();
    const deletedCount = await svc.deleteByFileId(fileId, String(dataSource._id));
    if (deletedCount === 0) {
      return res.status(404).json({ success: false, error: '文件不存在或不属于该数据源' });
    }
    return res.json({ success: true, deletedCount });
  } catch (error) {
    logger.error('[deleteExcelFileHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || '删除 Excel 文件失败' });
  }
}

/**
 * GET /data-sources/:id/excel-files/:fileId/rows
 * 返回指定 Excel 文件的原始行数据（用于预览）；支持 q / aliasFilter，并附带 aliases
 * 筛选在服务端完成，避免「先 LIMIT 500 再本地过滤」漏行
 */
async function getExcelFileRowsHandler(req, res) {
  const { id, fileId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const aliasFilter = typeof req.query.aliasFilter === 'string' ? req.query.aliasFilter : 'all';
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
    const ExcelCellAliasService = require('~/server/services/Files/ExcelCellAliasService');
    const svc = new ExcelCellVectorizationService();
    const aliasSvc = new ExcelCellAliasService(svc);
    const entityId = String(dataSource._id);

    await svc.initialize();
    const exists = await svc.fileExistsInEntity(fileId, entityId);
    if (!exists) {
      return res.status(404).json({ success: false, error: '文件不存在或不属于该数据源' });
    }

    const fnRes = await svc.pool.query(
      `SELECT metadata->>'filename' AS filename
       FROM file_vectors
       WHERE file_id = $1 AND entity_id = $2 AND metadata->>'source' = 'excel_cell'
       LIMIT 1`,
      [fileId, entityId],
    );
    const filename = fnRes.rows[0]?.filename || '';

    const preview = await aliasSvc.queryPreviewRows({
      entityId,
      fileId,
      filename,
      q,
      aliasFilter,
      limit,
    });
    return res.json({
      success: true,
      data: preview.rows,
      filename,
      totalMatched: preview.totalMatched,
      truncated: preview.truncated,
    });
  } catch (error) {
    logger.error('[getExcelFileRowsHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || '获取 Excel 预览失败' });
  }
}

/**
 * POST /data-sources/:id/excel-files/search
 * 语义检索 Excel 单元格，返回命中行
 */
async function searchExcelCellsHandler(req, res) {
  const { id } = req.params;
  const { query, top_k = 10, min_score = 0.5, filename } = req.body;

  if (!query) {
    return res.status(400).json({ success: false, error: '请提供查询文本 query' });
  }

  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    const ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
    const ExcelCellAliasService = require('~/server/services/Files/ExcelCellAliasService');
    const svc = new ExcelCellVectorizationService();
    const results = await svc.search({
      entityId: String(dataSource._id),
      query,
      topK: Number(top_k),
      minScore: Number(min_score),
      filename: typeof filename === 'string' && filename.trim() ? filename.trim() : null,
    });

    const aliasSvc = new ExcelCellAliasService(svc);
    const enriched = await aliasSvc.attachAliasesToSearchResults({
      entityId: String(dataSource._id),
      filename: typeof filename === 'string' && filename.trim() ? filename.trim() : null,
      results,
    });

    return res.json({ success: true, data: enriched });
  } catch (error) {
    logger.error('[searchExcelCellsHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || 'Excel 检索失败' });
  }
}

/**
 * 抽取/向量化前解析数据源；Mock 数据源或显式 mock 跳过密码解密
 */
async function resolveDataSourceForKnowledgeExtract(req, id, logPrefix, options = {}) {
  const TableExtractService = require('~/server/services/Knowledge/TableExtractService');
  const { id: userId } = req.user;
  const isAdmin = req.user?.role === SystemRoles.ADMIN;

  const dataSource = await getDataSourceById(id);
  if (!dataSource) {
    const err = new Error('数据源不存在');
    err.statusCode = 404;
    throw err;
  }

  const isPublic = dataSource.isPublic !== undefined ? Boolean(dataSource.isPublic) : false;
  const isOwner = dataSource.createdBy.toString() === userId;
  if (!isAdmin && !isOwner && !isPublic) {
    logger.warn(`[${logPrefix}] 无权访问此数据源`, {
      id,
      userId,
      createdBy: dataSource.createdBy,
      isPublic,
    });
    const err = new Error('无权访问此数据源');
    err.statusCode = 403;
    throw err;
  }

  if (TableExtractService.shouldUseMock(options, dataSource)) {
    return { dataSource, password: '' };
  }

  try {
    const password = await decryptPassword(dataSource.password);
    return { dataSource, password };
  } catch (decryptError) {
    if (decryptError.code === 'LEGACY_ENCRYPTION_FORMAT') {
      decryptError.statusCode = 400;
    }
    throw decryptError;
  }
}

/**
 * POST /data-sources/:id/knowledge-extract/kpi
 * 从库表抽取指标定义（最新 data_dt + index_number 去重）
 */
async function extractKpiDefinitionHandler(req, res) {
  const { id } = req.params;
  const { schema, table, source } = req.body || {};
  try {
    const { dataSource, password } = await resolveDataSourceForKnowledgeExtract(
      req,
      id,
      'extractKpiDefinition',
      { source },
    );
    const TableExtractService = require('~/server/services/Knowledge/TableExtractService');
    const result = await TableExtractService.extractKpiDefinition({
      dataSource,
      password,
      schema,
      table,
      entityId: String(dataSource._id),
      options: { source },
    });
    return res.json({
      success: true,
      ...TableExtractService.toPreviewPayload(result),
    });
  } catch (error) {
    const status = error.statusCode || 500;
    const message = error?.message || String(error) || '指标抽取失败';
    logger.error(`[extractKpiDefinitionHandler] Error: ${message}`, error?.stack || error);
    return res.status(status).json({ success: false, error: message });
  }
}

/**
 * POST /data-sources/:id/knowledge-extract/org
 * 从库表抽取机构信息并派生 org_master 列
 */
async function extractOrgInfoHandler(req, res) {
  const { id } = req.params;
  const { schema, table, source } = req.body || {};
  try {
    const { dataSource, password } = await resolveDataSourceForKnowledgeExtract(
      req,
      id,
      'extractOrgInfo',
      { source },
    );
    const TableExtractService = require('~/server/services/Knowledge/TableExtractService');
    const result = await TableExtractService.extractOrgInfo({
      dataSource,
      password,
      schema,
      table,
      entityId: String(dataSource._id),
      options: { source },
    });
    return res.json({
      success: true,
      ...TableExtractService.toPreviewPayload(result),
    });
  } catch (error) {
    const status = error.statusCode || 500;
    const message = error?.message || String(error) || '机构抽取失败';
    logger.error(`[extractOrgInfoHandler] Error: ${message}`, error?.stack || error);
    return res.status(status).json({ success: false, error: message });
  }
}

/**
 * POST /data-sources/:id/knowledge-extract/kpi/vectorize
 * 将上次抽取的指标定义写入 file_vectors
 */
async function vectorizeKpiDefinitionHandler(req, res) {
  const { id } = req.params;
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }
    const entityId = String(dataSource._id);
    const TableExtractService = require('~/server/services/Knowledge/TableExtractService');
    const cached = TableExtractService.getExtractCache(entityId, 'kpi');
    if (!cached || !cached.rows?.length) {
      return res.status(400).json({
        success: false,
        error: '请先从库抽取指标定义（当前无可用快照）',
      });
    }
    const { primaryColumns, excludedColumns } = parseExcelColumnConfig(req.body);
    const ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
    const svc = new ExcelCellVectorizationService();
    const fileId = TableExtractService.stableFileId('kpi', entityId);
    const result = await svc.vectorizeFromRows({
      entityId,
      userId: req.user?.id || null,
      fileId,
      filename: cached.filename || TableExtractService.KPI_FILENAME,
      headers: cached.headers,
      rows: cached.rows,
      primaryColumns,
      excludedColumns,
      sheetName: '指标定义',
      replaceExisting: true,
      dataDt: cached.dataDt || null,
    });
    const ExcelCellAliasService = require('~/server/services/Files/ExcelCellAliasService');
    const aliasSvc = new ExcelCellAliasService(svc);
    await aliasSvc.reapplyAliasesForFile({
      entityId,
      fileId: result.fileId,
      filename: result.filename || cached.filename || TableExtractService.KPI_FILENAME,
      userId: req.user?.id || null,
    });
    logger.info(
      `[vectorizeKpiDefinitionHandler] 完成 fileId=${result.fileId} cells=${result.cellCount}`,
    );
    return res.json({ success: true, ...result });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('[vectorizeKpiDefinitionHandler] Error:', error.message, error.stack);
    return res.status(status).json({ success: false, error: error.message || '指标向量化失败' });
  }
}

/**
 * POST /data-sources/:id/knowledge-extract/org/vectorize
 */
async function vectorizeOrgInfoHandler(req, res) {
  const { id } = req.params;
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }
    const entityId = String(dataSource._id);
    const TableExtractService = require('~/server/services/Knowledge/TableExtractService');
    const cached = TableExtractService.getExtractCache(entityId, 'org');
    if (!cached || !cached.rows?.length) {
      return res.status(400).json({
        success: false,
        error: '请先从库抽取机构信息（当前无可用快照）',
      });
    }
    const { primaryColumns, excludedColumns } = parseExcelColumnConfig(req.body);
    const ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
    const svc = new ExcelCellVectorizationService();
    const fileId = TableExtractService.stableFileId('org', entityId);
    const result = await svc.vectorizeFromRows({
      entityId,
      userId: req.user?.id || null,
      fileId,
      filename: cached.filename || TableExtractService.ORG_FILENAME,
      headers: cached.headers,
      rows: cached.rows,
      primaryColumns,
      excludedColumns,
      sheetName: '机构信息',
      replaceExisting: true,
      dataDt: cached.dataDt || null,
    });
    const ExcelCellAliasService = require('~/server/services/Files/ExcelCellAliasService');
    const aliasSvc = new ExcelCellAliasService(svc);
    await aliasSvc.reapplyAliasesForFile({
      entityId,
      fileId: result.fileId,
      filename: result.filename || cached.filename || TableExtractService.ORG_FILENAME,
      userId: req.user?.id || null,
    });
    logger.info(
      `[vectorizeOrgInfoHandler] 完成 fileId=${result.fileId} cells=${result.cellCount}`,
    );
    return res.json({ success: true, ...result });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('[vectorizeOrgInfoHandler] Error:', error.message, error.stack);
    return res.status(status).json({ success: false, error: error.message || '机构向量化失败' });
  }
}

/**
 * GET /data-sources/:id/excel-files/:fileId/aliases
 */
async function listExcelFileAliasesHandler(req, res) {
  const { id, fileId } = req.params;
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }
    const entityId = String(dataSource._id);
    const ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
    const ExcelCellAliasService = require('~/server/services/Files/ExcelCellAliasService');
    const svc = new ExcelCellVectorizationService();
    await svc.initialize();
    const exists = await svc.fileExistsInEntity(fileId, entityId);
    if (!exists) {
      return res.status(404).json({ success: false, error: '文件不存在或不属于该数据源' });
    }
    const fnRes = await svc.pool.query(
      `SELECT metadata->>'filename' AS filename
       FROM file_vectors
       WHERE file_id = $1 AND entity_id = $2 AND metadata->>'source' = 'excel_cell'
       LIMIT 1`,
      [fileId, entityId],
    );
    const filename = fnRes.rows[0]?.filename || '';
    const aliasSvc = new ExcelCellAliasService(svc);
    const map = await aliasSvc.listAliases({ entityId, filename });
    return res.json({ success: true, filename, data: map });
  } catch (error) {
    logger.error('[listExcelFileAliasesHandler] Error:', error.message);
    return res.status(500).json({ success: false, error: error.message || '获取别名失败' });
  }
}

/**
 * PUT /data-sources/:id/excel-files/:fileId/aliases
 * body: { rowKey, rowIndex?, aliases: string[], fullRow?, sheetName? }
 */
async function setExcelFileAliasesHandler(req, res) {
  const { id, fileId } = req.params;
  const { rowKey, rowIndex, aliases, fullRow, sheetName } = req.body || {};
  try {
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }
    const entityId = String(dataSource._id);
    const ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
    const ExcelCellAliasService = require('~/server/services/Files/ExcelCellAliasService');
    const {
      parseRowKey,
      isAliasCapableFilename,
    } = require('~/server/services/Files/ExcelCellAliasService');
    const svc = new ExcelCellVectorizationService();
    await svc.initialize();
    const exists = await svc.fileExistsInEntity(fileId, entityId);
    if (!exists) {
      return res.status(404).json({ success: false, error: '文件不存在或不属于该数据源' });
    }

    const fnRes = await svc.pool.query(
      `SELECT metadata->>'filename' AS filename
       FROM file_vectors
       WHERE file_id = $1 AND entity_id = $2 AND metadata->>'source' = 'excel_cell'
       LIMIT 1`,
      [fileId, entityId],
    );
    const filename = fnRes.rows[0]?.filename || '';
    if (!isAliasCapableFilename(filename)) {
      return res.status(400).json({
        success: false,
        error: '仅「指标定义信息」或「机构信息」支持别名',
      });
    }

    let resolvedRowIndex = rowIndex != null ? Number(rowIndex) : null;
    let resolvedFullRow = typeof fullRow === 'string' ? fullRow : '';
    let resolvedSheetName = typeof sheetName === 'string' && sheetName.trim() ? sheetName.trim() : '';
    const key = String(rowKey || '').trim() || parseRowKey(resolvedFullRow);

    // 始终用库内真实 sheet_name / full_row 校正；若前端传了 sheetName 则优先精确匹配
    if (resolvedRowIndex != null && !Number.isNaN(resolvedRowIndex)) {
      const params = [fileId, entityId, resolvedRowIndex];
      let sheetClause = '';
      if (resolvedSheetName) {
        params.push(resolvedSheetName);
        sheetClause = ` AND COALESCE(metadata->>'sheet_name', 'Sheet1') = $${params.length}`;
      }
      let rowRes = await svc.pool.query(
        `SELECT metadata->>'full_row' AS full_row,
                COALESCE(metadata->>'sheet_name', 'Sheet1') AS sheet_name
         FROM file_vectors
         WHERE file_id = $1 AND entity_id = $2 AND metadata->>'source' = 'excel_cell'
           AND (metadata->>'row_index')::int = $3
           AND metadata->>'column_name' IS DISTINCT FROM '别名'
           ${sheetClause}
         ORDER BY chunk_index
         LIMIT 1`,
        params,
      );
      // 指定 sheet 未命中时回退到同 rowIndex 任意 sheet（兼容旧前端未传 sheet）
      if (!rowRes.rows[0] && resolvedSheetName) {
        rowRes = await svc.pool.query(
          `SELECT metadata->>'full_row' AS full_row,
                  COALESCE(metadata->>'sheet_name', 'Sheet1') AS sheet_name
           FROM file_vectors
           WHERE file_id = $1 AND entity_id = $2 AND metadata->>'source' = 'excel_cell'
             AND (metadata->>'row_index')::int = $3
             AND metadata->>'column_name' IS DISTINCT FROM '别名'
           ORDER BY chunk_index
           LIMIT 1`,
          [fileId, entityId, resolvedRowIndex],
        );
      }
      if (rowRes.rows[0]) {
        if (!resolvedFullRow) resolvedFullRow = rowRes.rows[0].full_row || '';
        resolvedSheetName = rowRes.rows[0].sheet_name || resolvedSheetName || 'Sheet1';
      }
    }

    if ((resolvedRowIndex == null || Number.isNaN(resolvedRowIndex)) && key) {
      const rowRes = await svc.pool.query(
        `SELECT (metadata->>'row_index')::int AS row_index,
                metadata->>'full_row' AS full_row,
                COALESCE(metadata->>'sheet_name', 'Sheet1') AS sheet_name
         FROM file_vectors
         WHERE file_id = $1 AND entity_id = $2 AND metadata->>'source' = 'excel_cell'
           AND metadata->>'full_row' ILIKE $3
           AND metadata->>'column_name' IS DISTINCT FROM '别名'
         ORDER BY chunk_index
         LIMIT 1`,
        [fileId, entityId, `%${key}%`],
      );
      if (rowRes.rows[0]) {
        resolvedRowIndex = rowRes.rows[0].row_index;
        if (!resolvedFullRow) resolvedFullRow = rowRes.rows[0].full_row || '';
        resolvedSheetName = rowRes.rows[0].sheet_name || resolvedSheetName || 'Sheet1';
      }
    }

    if (!resolvedSheetName) resolvedSheetName = 'Sheet1';

    const finalKey = key || parseRowKey(resolvedFullRow);
    if (!finalKey) {
      return res.status(400).json({ success: false, error: '无法解析 rowKey（指标编号/org_code）' });
    }
    if (resolvedRowIndex == null || Number.isNaN(resolvedRowIndex)) {
      return res.status(400).json({ success: false, error: '无法定位行 rowIndex' });
    }

    const aliasSvc = new ExcelCellAliasService(svc);
    const result = await aliasSvc.setAliases({
      entityId,
      filename,
      fileId,
      rowKey: finalKey,
      rowIndex: resolvedRowIndex,
      aliases: Array.isArray(aliases) ? aliases : [],
      fullRow: resolvedFullRow,
      userId: req.user?.id || null,
      sheetName: resolvedSheetName,
    });

    return res.json({
      success: true,
      ...result,
      rowIndex: resolvedRowIndex,
      sheetName: resolvedSheetName,
      filename,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('[setExcelFileAliasesHandler] Error:', error.message);
    return res.status(status).json({ success: false, error: error.message || '保存别名失败' });
  }
}

/**
 * PUT /data-sources/:id/agent-bindings
 * 绑定智能体到数据源（可多选），并同步 Agent.data_source_id
 */
async function bindDataSourceAgentsHandler(req, res) {
  try {
    const { id } = req.params;
    const { id: userId } = req.user;
    const { agentIds } = req.body;

    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      return res.status(404).json({ success: false, error: '数据源不存在' });
    }

    if (dataSource.createdBy.toString() !== userId && req.user.role !== SystemRoles.ADMIN) {
      return res.status(403).json({ success: false, error: '无权修改此数据源' });
    }

    const { syncDataSourceAgentBindings } = require('~/server/services/DataSourceAgentBindingService');
    const updated = await syncDataSourceAgentBindings(id, agentIds || []);
    const { password: _, ...rest } = updated;
    const sanitized = {
      ...rest,
      isPublic: rest.isPublic !== undefined ? Boolean(rest.isPublic) : false,
      agentIds: rest.agentIds || [],
    };

    return res.status(200).json({
      success: true,
      data: sanitized,
      message: '智能体绑定已更新',
    });
  } catch (error) {
    logger.error('[bindDataSourceAgentsHandler] Error:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      error: error.message || '更新智能体绑定失败',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  createDataSourceHandler,
  getDataSourcesHandler,
  getDataSourceHandler,
  updateDataSourceHandler,
  deleteDataSourceHandler,
  testDataSourceConnectionHandler,
  testConnectionHandler,
  getDataSourceSchemaHandler,
  listDataSourceSchemasHandler,
  listDataSourceSchemaTablesHandler,
  generateLightSchemaHandler,
  vectorizeCellsHandler,
  getLightSchemasHandler,
  getCellsHandler,
  getCellSummaryHandler,
  deleteLightSchemaHandler,
  updateLightSchemaHandler,
  createCellHandler,
  updateCellHandler,
  deleteCellHandler,
  deleteCellsByTableHandler,
  uploadExcelFileHandler,
  previewExcelHeadersHandler,
  listExcelFilesHandler,
  deleteExcelFileHandler,
  getExcelFileRowsHandler,
  searchExcelCellsHandler,
  listExcelFileAliasesHandler,
  setExcelFileAliasesHandler,
  extractKpiDefinitionHandler,
  extractOrgInfoHandler,
  vectorizeKpiDefinitionHandler,
  vectorizeOrgInfoHandler,
  bindDataSourceAgentsHandler,
  getDatabaseSchema,
  decryptPassword,
  encryptPassword,
  PasswordDecryptionError,
};
