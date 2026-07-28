/**
 * JN 平台 DataSource 只读查询服务
 * 从 SqlExecutorTool 抽取连接/解密逻辑，供机构权限「从表导入」等管理功能复用。
 */
const path = require('path');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const { logger } = require('@because/data-schemas');
const { decryptV2 } = require('@because/api');
const { getDataSourceById } = require('~/models/DataSource');
const { getDataSourceRevision } = require('./DataSourceCacheRegistry');

const { gaussdbJdbcQuery, killProcess: killGaussdbProcess } = require(
  path.join(require('~/config/paths').root, 'Because-2.0/utils/gaussdbJdbcBridge'),
);

const pools = new Map();

/**
 * 淘汰一个已过期（数据源配置已变更）的缓存连接。
 * GaussDB 走 JDBC 常驻子进程，需要显式杀掉；MySQL/PostgreSQL 的 pool 调用 end() 优雅关闭。
 */
async function evictConnectionPool(cleanedId, cached) {
  pools.delete(cleanedId);
  try {
    if (cached?.dataSource?.type === 'gaussdb') {
      killGaussdbProcess(cleanedId);
    } else if (cached?.pool && typeof cached.pool.end === 'function') {
      await cached.pool.end();
    }
  } catch (err) {
    logger.warn('[DataSourceQueryService] 关闭旧连接池失败（忽略，继续按最新配置重建）:', err.message);
  }
}

function cleanDataSourceId(id) {
  if (!id) {
    return null;
  }
  if (typeof id === 'object') {
    id = id._id || id.id || id.toString();
  }
  let cleaned = String(id).trim().replace(/^["']+|["']+$/g, '');
  while (cleaned !== cleaned.replace(/^["']+|["']+$/g, '')) {
    cleaned = cleaned.replace(/^["']+|["']+$/g, '');
  }
  return cleaned || null;
}

async function decryptPassword(encryptedText) {
  try {
    return await decryptV2(encryptedText);
  } catch (error) {
    const parts = String(encryptedText || '').split(':');
    if (parts.length === 3) {
      throw new Error('无法解密旧格式的密码。请编辑该数据源，重新输入密码并保存配置。');
    }
    throw new Error(`密码解密失败: ${error.message}`);
  }
}

/**
 * @param {string} dataSourceId
 * @returns {Promise<{ pool: any, dataSource: object, cleanedId: string }>}
 */
async function getConnectionPool(dataSourceId) {
  const cleanedId = cleanDataSourceId(dataSourceId);
  if (!cleanedId) {
    throw new Error(`无效的数据源ID: ${dataSourceId}`);
  }
  const currentRevision = getDataSourceRevision(cleanedId);
  if (pools.has(cleanedId)) {
    const cached = pools.get(cleanedId);
    if ((cached.revision || 0) === currentRevision) {
      return { ...cached, cleanedId };
    }
    logger.info(`[DataSourceQueryService] 数据源配置已变更，淘汰旧连接池并重建: ${cleanedId}`);
    await evictConnectionPool(cleanedId, cached);
  }

  const dataSource = await getDataSourceById(cleanedId);
  if (!dataSource) {
    throw new Error(`数据源不存在: ${dataSourceId}`);
  }
  if (dataSource.status && dataSource.status !== 'active') {
    throw new Error(`数据源未激活: ${dataSource.name}`);
  }

  const password = await decryptPassword(dataSource.password);

  if (dataSource.type === 'gaussdb') {
    const entry = { pool: { type: 'gaussdb-jdbc', password }, dataSource, revision: currentRevision };
    pools.set(cleanedId, entry);
    return { ...entry, cleanedId };
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
      connectionLimit: dataSource.connectionPool?.max || 5,
      queueLimit: 0,
      connectTimeout: dataSource.connectionPool?.connectionTimeoutMillis || 10000,
    };
    if (dataSource.ssl?.enabled) {
      poolConfig.ssl = {};
      if (dataSource.ssl.ca) poolConfig.ssl.ca = dataSource.ssl.ca;
      if (dataSource.ssl.cert) poolConfig.ssl.cert = dataSource.ssl.cert;
      if (dataSource.ssl.key) poolConfig.ssl.key = dataSource.ssl.key;
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
      max: dataSource.connectionPool?.max || 5,
      min: dataSource.connectionPool?.min || 0,
      idleTimeoutMillis: dataSource.connectionPool?.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: dataSource.connectionPool?.connectionTimeoutMillis || 10000,
    };
    if (dataSource.ssl?.enabled) {
      poolConfig.ssl = {};
      if (dataSource.ssl.rejectUnauthorized !== undefined) {
        poolConfig.ssl.rejectUnauthorized = dataSource.ssl.rejectUnauthorized;
      }
      if (dataSource.ssl.ca) poolConfig.ssl.ca = dataSource.ssl.ca;
      if (dataSource.ssl.cert) poolConfig.ssl.cert = dataSource.ssl.cert;
      if (dataSource.ssl.key) poolConfig.ssl.key = dataSource.ssl.key;
    }
    pool = new Pool(poolConfig);
  } else {
    throw new Error(`不支持的数据库类型: ${dataSource.type}`);
  }

  const entry = { pool, dataSource, revision: currentRevision };
  pools.set(cleanedId, entry);
  logger.info(`[DataSourceQueryService] pool ready: ${cleanedId} (${dataSource.type})`);
  return { ...entry, cleanedId };
}

/**
 * @param {object} params
 * @param {any} params.pool
 * @param {object} params.dataSource
 * @param {string} params.sql
 */
async function executeQuery({ pool, dataSource, sql }) {
  if (dataSource.type === 'mysql') {
    const [rows] = await pool.execute(sql);
    return rows;
  }
  if (dataSource.type === 'postgresql') {
    const result = await pool.query(sql);
    return result.rows;
  }
  if (dataSource.type === 'gaussdb') {
    return await gaussdbJdbcQuery(sql, [], dataSource, pool.password);
  }
  throw new Error(`不支持的数据库类型: ${dataSource.type}`);
}

/**
 * 校验表名，仅允许字母数字下划线与点号（schema.table）
 * @param {string} tableName
 */
function sanitizeTableName(tableName) {
  const name = String(tableName || '').trim();
  if (!/^[A-Za-z0-9_\.]+$/.test(name)) {
    throw new Error(`非法表名: ${tableName}`);
  }
  return name;
}

/**
 * 按数据库类型给 schema.table 加引号
 * @param {string} tableName
 * @param {string} dbType
 */
function quoteQualifiedTable(tableName, dbType) {
  const safe = sanitizeTableName(tableName);
  const parts = safe.split('.').filter(Boolean);
  if (dbType === 'mysql') {
    return parts.map((p) => `\`${p}\``).join('.');
  }
  if (dbType === 'postgresql' || dbType === 'gaussdb') {
    return parts.map((p) => `"${p}"`).join('.');
  }
  return safe;
}

/**
 * @param {object} params
 * @param {string} params.dataSourceId
 * @param {string} params.sql
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function queryRows({ dataSourceId, sql }) {
  const { pool, dataSource } = await getConnectionPool(dataSourceId);
  return executeQuery({ pool, dataSource, sql });
}

/**
 * 从表读取机构行（SELECT *，由调用方做列映射/快照过滤）
 * @param {object} params
 * @param {string} params.dataSourceId
 * @param {string} params.tableName
 * @param {number} [params.limit]
 */
async function queryTableRows({ dataSourceId, tableName, limit = 50000 }) {
  const { pool, dataSource } = await getConnectionPool(dataSourceId);
  const quoted = quoteQualifiedTable(tableName, dataSource.type);
  const safeLimit = Math.min(Math.max(Number(limit) || 50000, 1), 100000);
  const sql = `SELECT * FROM ${quoted} LIMIT ${safeLimit}`;
  return executeQuery({ pool, dataSource, sql });
}

module.exports = {
  getConnectionPool,
  executeQuery,
  queryRows,
  queryTableRows,
  sanitizeTableName,
  quoteQualifiedTable,
  cleanDataSourceId,
};
