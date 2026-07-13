const { gaussdbJdbcQuery, gaussdbTestConnection } = require('../lib/gaussdbJdbcBridge');
const { isSupportedType, UnsupportedDbTypeError } = require('../lib/dbTypes');

const TEXT_TYPES = new Set([
  'char', 'varchar', 'text', 'bpchar', 'name', 'citext', 'character varying', 'character',
  'nvarchar', 'nchar', 'json', 'jsonb', 'xml',
]);

function isTextType(type = '') {
  const t = String(type).toLowerCase();
  return TEXT_TYPES.has(t) || t.includes('char') || t.includes('text') || t.includes('json');
}

function toDDL(schema, sampleLimit = 5) {
  const cols = schema.columns.map((c) => {
    let line = `  ${c.name} ${c.type}`;
    if (!c.nullable) line += ' NOT NULL';
    if (c.description) line += ` -- ${c.description}`;
    return line;
  }).join(',\n');
  const pk = schema.primaryKeys?.length ? `,\n  PRIMARY KEY (${schema.primaryKeys.join(', ')})` : '';
  const examples = schema.columns
    .filter((c) => Array.isArray(c.sampleValues) && c.sampleValues.length)
    .map((c) => `-- ${c.name} examples: ${c.sampleValues.slice(0, sampleLimit).join(', ')}`)
    .join('\n');
  return `CREATE TABLE ${schema.tableName} (\n${cols}${pk}\n);\n${examples}`.trim();
}

function quoteIdentPg(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteIdentMySQL(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

const SAFE_COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PREVIEW_ROW_LIMIT = 50;
const EXPORT_ROW_LIMIT = 50000;
const EXPORT_MAX_COLUMNS = 500;
const EXPORT_MAX_COLUMN_NAME_LENGTH = 256;

function escapeLikePattern(value) {
  return String(value).replace(/[%_\\]/g, '\\$&');
}

function normalizePreviewColumns(columns) {
  const unique = [];
  const seen = new Set();
  for (const col of columns || []) {
    const name = String(col || '').trim();
    if (!name || !SAFE_COLUMN_NAME.test(name) || seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  if (unique.length === 0) throw new Error('无有效列');
  return unique;
}

function normalizeExportColumns(columns) {
  const unique = [];
  const seen = new Set();
  for (const col of columns || []) {
    const name = String(col || '').trim();
    if (!name || seen.has(name)) continue;
    if (name.length > EXPORT_MAX_COLUMN_NAME_LENGTH) {
      throw new Error(`列名过长（上限 ${EXPORT_MAX_COLUMN_NAME_LENGTH} 字符）: ${name.slice(0, 32)}…`);
    }
    seen.add(name);
    unique.push(name);
  }
  if (unique.length === 0) throw new Error('无有效列');
  if (unique.length > EXPORT_MAX_COLUMNS) {
    throw new Error(`导出列数超过上限 ${EXPORT_MAX_COLUMNS}`);
  }
  return unique;
}

function normalizePreviewFilters(filters, columnSet) {
  const normalized = [];
  for (const item of filters || []) {
    const column = String(item?.column || '').trim();
    const value = String(item?.value ?? '').trim();
    if (!value || !columnSet.has(column)) continue;
    normalized.push({ column, value });
  }
  return normalized;
}

function buildPreviewWhereClause(filters, quoteCol, castType) {
  const clauses = [];
  const params = [];
  for (const filter of filters) {
    clauses.push(`CAST(${quoteCol(filter.column)} AS ${castType}) LIKE ?`);
    params.push(`%${escapeLikePattern(filter.value)}%`);
  }
  return { clauses, params };
}

function pickDedupeOrderColumn(columns, dedupeBy) {
  return columns.find((col) => col !== dedupeBy) || dedupeBy;
}

async function gaussQueryTableRows(config, password, schemaName, tableName, columns, filters, limit, dedupeBy) {
  const tableRef = `${quoteIdentPg(schemaName)}.${quoteIdentPg(tableName)}`;
  const selectCols = columns.map((col) => quoteIdentPg(col)).join(', ');
  const quoteCol = (name) => quoteIdentPg(name);
  const { clauses, params } = buildPreviewWhereClause(filters, quoteCol, 'TEXT');
  const whereSql = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  let sql;
  if (dedupeBy) {
    const orderCol = pickDedupeOrderColumn(columns, dedupeBy);
    sql = `SELECT DISTINCT ON (${quoteCol(dedupeBy)}) ${selectCols} FROM ${tableRef}${whereSql} ORDER BY ${quoteCol(dedupeBy)}, ${quoteCol(orderCol)} LIMIT ${Number(limit)}`;
  } else {
    sql = `SELECT ${selectCols} FROM ${tableRef}${whereSql} LIMIT ${Number(limit)}`;
  }
  const rows = await gaussdbJdbcQuery(sql, params, config, password);
  return rows;
}

async function mysqlQueryTableRows(config, password, schemaName, tableName, columns, filters, limit, dedupeBy) {
  const mysql = loadMysql();
  const dbName = schemaName || config.database;
  const connection = await mysql.createConnection(mysqlConnectionConfig(config, password));
  try {
    const tableRef = `${quoteIdentMySQL(dbName)}.${quoteIdentMySQL(tableName)}`;
    const selectCols = columns.map((col) => quoteIdentMySQL(col)).join(', ');
    const quoteCol = (name) => quoteIdentMySQL(name);
    const { clauses, params } = buildPreviewWhereClause(filters, quoteCol, 'CHAR');
    const whereSql = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    let sql;
    let queryParams;
    if (dedupeBy) {
      const orderCol = pickDedupeOrderColumn(columns, dedupeBy);
      const innerCols = columns.map((col) => quoteIdentMySQL(col)).join(', ');
      sql = `SELECT ${innerCols} FROM (
        SELECT ${innerCols}, ROW_NUMBER() OVER (PARTITION BY ${quoteIdentMySQL(dedupeBy)} ORDER BY ${quoteIdentMySQL(orderCol)}) AS __rn
        FROM ${tableRef}${whereSql}
      ) __deduped WHERE __rn = 1 LIMIT ?`;
      queryParams = [...params, Number(limit)];
    } else {
      sql = `SELECT ${selectCols} FROM ${tableRef}${whereSql} LIMIT ?`;
      queryParams = [...params, Number(limit)];
    }
    const [rows] = await connection.query(sql, queryParams);
    return rows;
  } finally {
    await connection.end();
  }
}

async function queryTableRows(config, password, options) {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  const schemaName = String(options.schemaName || '').trim();
  const tableName = String(options.tableName || '').trim();
  if (!schemaName || !tableName) throw new Error('schemaName 与 tableName 不能为空');
  const purpose = options.purpose === 'export' ? 'export' : 'preview';
  const columns = purpose === 'export'
    ? normalizeExportColumns(options.columns)
    : normalizePreviewColumns(options.columns);
  const columnSet = new Set(columns);
  const filters = normalizePreviewFilters(options.filters, columnSet);
  const maxLimit = purpose === 'export' ? EXPORT_ROW_LIMIT : PREVIEW_ROW_LIMIT;
  const defaultLimit = purpose === 'export' ? EXPORT_ROW_LIMIT : PREVIEW_ROW_LIMIT;
  const limit = Math.max(1, Math.min(Number(options.limit || defaultLimit), maxLimit));
  const dedupeBy = String(options.dedupeBy || '').trim();
  if (dedupeBy && !columnSet.has(dedupeBy)) {
    throw new Error(`无效去重列: ${dedupeBy}`);
  }
  let rows;
  if (type === 'gaussdb') {
    rows = await gaussQueryTableRows(config, password, schemaName, tableName, columns, filters, limit, dedupeBy);
  } else if (type === 'mysql') {
    rows = await mysqlQueryTableRows(config, password, schemaName, tableName, columns, filters, limit, dedupeBy);
  } else {
    throw new UnsupportedDbTypeError(type);
  }
  return {
    columns,
    rows,
    truncated: rows.length >= limit,
    limit,
    filtered: filters.length > 0,
    deduped: Boolean(dedupeBy),
    dedupeBy: dedupeBy || undefined,
  };
}

async function gaussQueryDistinctValues(config, password, schemaName, tableName, column, limit) {
  const tableRef = `${quoteIdentPg(schemaName)}.${quoteIdentPg(tableName)}`;
  const safeCol = quoteIdentPg(column);
  const sql = `SELECT DISTINCT CAST(${safeCol} AS TEXT) AS value FROM ${tableRef} WHERE ${safeCol} IS NOT NULL ORDER BY value LIMIT ${Number(limit)}`;
  const rows = await gaussdbJdbcQuery(sql, [], config, password);
  return rows.map((row) => String(row.value ?? Object.values(row)[0] ?? ''));
}

async function mysqlQueryDistinctValues(config, password, schemaName, tableName, column, limit) {
  const mysql = loadMysql();
  const dbName = schemaName || config.database;
  const connection = await mysql.createConnection(mysqlConnectionConfig(config, password));
  try {
    const tableRef = `${quoteIdentMySQL(dbName)}.${quoteIdentMySQL(tableName)}`;
    const safeCol = quoteIdentMySQL(column);
    const sql = `SELECT DISTINCT CAST(${safeCol} AS CHAR) AS value FROM ${tableRef} WHERE ${safeCol} IS NOT NULL ORDER BY value LIMIT ?`;
    const [rows] = await connection.query(sql, [Number(limit)]);
    return rows.map((row) => String(row.value ?? Object.values(row)[0] ?? ''));
  } finally {
    await connection.end();
  }
}

async function queryDistinctColumnValues(config, password, options) {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  const schemaName = String(options.schemaName || '').trim();
  const tableName = String(options.tableName || '').trim();
  const column = String(options.column || '').trim();
  if (!schemaName || !tableName || !column) throw new Error('schemaName、tableName 与 column 不能为空');
  if (!SAFE_COLUMN_NAME.test(column)) throw new Error(`无效列名: ${column}`);
  const limit = Math.max(1, Math.min(Number(options.limit || 200), 500));
  let values;
  if (type === 'gaussdb') {
    values = await gaussQueryDistinctValues(config, password, schemaName, tableName, column, limit);
  } else if (type === 'mysql') {
    values = await mysqlQueryDistinctValues(config, password, schemaName, tableName, column, limit);
  } else {
    throw new UnsupportedDbTypeError(type);
  }
  return {
    column,
    values,
    truncated: values.length >= limit,
    limit,
  };
}

function assertSupported(type) {
  if (!isSupportedType(type)) throw new UnsupportedDbTypeError(type);
}

function loadMysql() {
  try {
    return require('mysql2/promise');
  } catch {
    const err = new Error('mysql2 包未安装，请运行: npm install mysql2');
    err.code = 'MYSQL2_MISSING';
    throw err;
  }
}

function mysqlConnectionConfig(config, password) {
  const connectionConfig = {
    host: config.host,
    port: config.port,
    user: config.username,
    password,
    database: config.database,
    connectTimeout: 10000,
  };
  if (config.ssl?.enabled) {
    connectionConfig.ssl = {};
    if (config.ssl.ca) connectionConfig.ssl.ca = config.ssl.ca;
    if (config.ssl.cert) connectionConfig.ssl.cert = config.ssl.cert;
    if (config.ssl.key) connectionConfig.ssl.key = config.ssl.key;
    if (config.ssl.rejectUnauthorized !== undefined) {
      connectionConfig.ssl.rejectUnauthorized = config.ssl.rejectUnauthorized;
    }
  }
  return connectionConfig;
}

async function gaussFetchColumns(ds, password, schemaName, tableName) {
  return gaussdbJdbcQuery(
    `SELECT
       a.attname AS column_name,
       t.typname AS type_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
       COALESCE(d.description, '') AS description
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
     JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
     LEFT JOIN pg_catalog.pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
     WHERE n.nspname = ?
       AND c.relname = ?
       AND c.relkind IN ('r', 'p')
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [schemaName, tableName],
    ds,
    password,
  );
}

async function gaussFetchPrimaryKeys(ds, password, schemaName, tableName) {
  const rows = await gaussdbJdbcQuery(
    `SELECT a.attname AS column_name
     FROM pg_catalog.pg_index i
     JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indisprimary
       AND n.nspname = ?
       AND c.relname = ?
       AND c.relkind IN ('r', 'p')`,
    [schemaName, tableName],
    ds,
    password,
  );
  return rows.map((r) => r.column_name);
}

async function gaussFetchSamples(ds, password, schemaName, tableName, column, sampleLimit, scope) {
  const safeCol = quoteIdentPg(column.name);
  const tableRef = `${quoteIdentPg(schemaName)}.${quoteIdentPg(tableName)}`;
  if (scope === 'all_columns' || isTextType(column.type)) {
    try {
      const rows = await gaussdbJdbcQuery(
        `SELECT DISTINCT CAST(${safeCol} AS TEXT) AS value FROM ${tableRef} WHERE ${safeCol} IS NOT NULL LIMIT ${Number(sampleLimit)}`,
        [],
        ds,
        password,
      );
      return { values: rows.map((r) => String(r.value ?? Object.values(r)[0] ?? '')) };
    } catch (error) {
      return { values: [], error: error.message };
    }
  }
  return { values: [] };
}

async function gaussGetTableSchema(config, password, schemaName, tableName, sampleLimit = 5, sampleScope = 'text_only') {
  const cols = await gaussFetchColumns(config, password, schemaName, tableName);
  const primaryKeys = await gaussFetchPrimaryKeys(config, password, schemaName, tableName);
  const columns = [];
  const sampleWarnings = [];
  for (const c of cols) {
    const col = {
      name: c.column_name,
      type: c.data_type || c.type_name,
      nullable: String(c.is_nullable) === 'YES',
      description: c.description || '',
      sampleValues: [],
    };
    const sampleResult = await gaussFetchSamples(config, password, schemaName, tableName, col, sampleLimit, sampleScope);
    col.sampleValues = sampleResult.values || [];
    if (sampleResult.error) {
      sampleWarnings.push({ tableName, column: col.name, error: sampleResult.error });
    }
    columns.push(col);
  }
  const table = { tableName, columns, primaryKeys };
  const output = { ...table, ddlText: toDDL(table, sampleLimit) };
  if (sampleWarnings.length > 0) output.sampleWarnings = sampleWarnings;
  return output;
}

async function gaussIsTableEmpty(config, password, schemaName, tableName) {
  const tableRef = `${quoteIdentPg(schemaName)}.${quoteIdentPg(tableName)}`;
  const rows = await gaussdbJdbcQuery(
    `SELECT 1 AS ok FROM ${tableRef} LIMIT 1`,
    [],
    config,
    password,
  );
  return rows.length === 0;
}

async function mysqlIsTableEmpty(config, password, schemaName, tableName) {
  const mysql = loadMysql();
  const dbName = schemaName || config.database;
  const connection = await mysql.createConnection(mysqlConnectionConfig(config, password));
  try {
    const tableRef = `${quoteIdentMySQL(dbName)}.${quoteIdentMySQL(tableName)}`;
    const [rows] = await connection.query(
      `SELECT 1 AS ok FROM ${tableRef} LIMIT 1`,
    );
    return rows.length === 0;
  } finally {
    await connection.end();
  }
}

async function isTableEmpty(config, password, schemaName, tableName) {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  if (type === 'gaussdb') return gaussIsTableEmpty(config, password, schemaName, tableName);
  if (type === 'mysql') return mysqlIsTableEmpty(config, password, schemaName, tableName);
  throw new UnsupportedDbTypeError(type);
}

async function gaussListTables(config, password, schemaName) {
  const rows = await gaussdbJdbcQuery(
    `SELECT c.relname AS table_name
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ?
       AND c.relkind IN ('r', 'p')
     ORDER BY c.relname`,
    [schemaName],
    config,
    password,
  );
  return rows.map((r) => r.table_name);
}

async function gaussListSchemas(config, password) {
  const rows = await gaussdbJdbcQuery(
    `SELECT n.nspname AS schema_name, COUNT(c.oid) AS table_count
     FROM pg_catalog.pg_namespace n
     LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p')
     WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
     GROUP BY n.nspname
     ORDER BY CASE WHEN n.nspname = 'public' THEN 0 ELSE 1 END, n.nspname`,
    [],
    config,
    password,
  );
  return rows.map((r) => ({ schemaName: r.schema_name, tableCount: Number(r.table_count || 0) }));
}

async function mysqlGetTableSchema(config, password, schemaName, tableName, sampleLimit = 5, sampleScope = 'text_only') {
  const mysql = loadMysql();
  const dbName = schemaName || config.database;
  const connection = await mysql.createConnection(mysqlConnectionConfig(config, password));
  try {
    const [cols] = await connection.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_COMMENT, COLUMN_KEY
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [dbName, tableName],
    );
    const primaryKeys = cols.filter((c) => c.COLUMN_KEY === 'PRI').map((c) => c.COLUMN_NAME);
    const columns = [];
    const sampleWarnings = [];
    for (const c of cols) {
      const col = {
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === 'YES',
        description: c.COLUMN_COMMENT || '',
        sampleValues: [],
      };
      if (sampleScope === 'all_columns' || isTextType(c.DATA_TYPE)) {
        try {
          const [rows] = await connection.query(
            `SELECT DISTINCT ${quoteIdentMySQL(c.COLUMN_NAME)} AS value FROM ${quoteIdentMySQL(tableName)} WHERE ${quoteIdentMySQL(c.COLUMN_NAME)} IS NOT NULL LIMIT ${Number(sampleLimit)}`,
          );
          col.sampleValues = rows.map((r) => String(r.value ?? Object.values(r)[0] ?? ''));
        } catch (error) {
          sampleWarnings.push({ tableName, column: col.name, error: error.message });
        }
      }
      columns.push(col);
    }
    const table = { tableName, columns, primaryKeys };
    const output = { ...table, ddlText: toDDL(table, sampleLimit) };
    if (sampleWarnings.length > 0) output.sampleWarnings = sampleWarnings;
    return output;
  } finally {
    await connection.end();
  }
}

async function mysqlListTables(config, password, schemaName) {
  const mysql = loadMysql();
  const dbName = schemaName || config.database;
  const connection = await mysql.createConnection(mysqlConnectionConfig(config, password));
  try {
    const [rows] = await connection.query(
      `SELECT TABLE_NAME AS table_name
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [dbName],
    );
    return rows.map((r) => r.table_name);
  } finally {
    await connection.end();
  }
}

async function mysqlListSchemas(config, password) {
  return [{ schemaName: config.database, tableCount: null }];
}

async function testConnection(config, password) {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  if (type === 'gaussdb') {
    await gaussdbTestConnection(config, password);
    return;
  }
  if (type === 'mysql') {
    const mysql = loadMysql();
    const connection = await mysql.createConnection(mysqlConnectionConfig(config, password));
    try {
      await connection.ping();
    } finally {
      await connection.end();
    }
  }
}

async function listSchemas(config, password) {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  if (type === 'gaussdb') return gaussListSchemas(config, password);
  if (type === 'mysql') return mysqlListSchemas(config, password);
  return [];
}

async function listTables(config, password, schemaName) {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  if (type === 'gaussdb') return gaussListTables(config, password, schemaName);
  if (type === 'mysql') return mysqlListTables(config, password, schemaName);
  return [];
}

async function getTableSchema(config, password, schemaName, tableName, sampleLimit = 5, sampleScope = 'text_only') {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  if (type === 'gaussdb') {
    return gaussGetTableSchema(config, password, schemaName, tableName, sampleLimit, sampleScope);
  }
  if (type === 'mysql') {
    return mysqlGetTableSchema(config, password, schemaName, tableName, sampleLimit, sampleScope);
  }
  throw new UnsupportedDbTypeError(type);
}

function buildSchemaSearchLike(query) {
  return `%${String(query || '').trim().toLowerCase()}%`;
}

async function gaussSearchSchemaTables(config, password, schemaName, query) {
  const like = buildSchemaSearchLike(query);
  const rows = await gaussdbJdbcQuery(
    `SELECT
       n.nspname AS schema_name,
       c.relname AS table_name,
       a.attname AS column_name,
       COALESCE(d.description, '') AS description
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
     LEFT JOIN pg_catalog.pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
     WHERE n.nspname = ?
       AND c.relkind IN ('r', 'p')
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND (
         LOWER(c.relname) LIKE ?
         OR LOWER(a.attname) LIKE ?
         OR LOWER(COALESCE(d.description, '')) LIKE ?
       )
     ORDER BY c.relname, a.attnum`,
    [schemaName, like, like, like],
    config,
    password,
  );
  return rows.map((row) => ({
    schemaName: row.schema_name,
    tableName: row.table_name,
    columnName: row.column_name,
    description: row.description || '',
  }));
}

async function mysqlSearchSchemaTables(config, password, schemaName, query) {
  const mysql = loadMysql();
  const dbName = schemaName || config.database;
  const like = buildSchemaSearchLike(query);
  const connection = await mysql.createConnection(mysqlConnectionConfig(config, password));
  try {
    const [rows] = await connection.query(
      `SELECT
         TABLE_SCHEMA AS schema_name,
         TABLE_NAME AS table_name,
         COLUMN_NAME AS column_name,
         COALESCE(COLUMN_COMMENT, '') AS description
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND (
           LOWER(TABLE_NAME) LIKE ?
           OR LOWER(COLUMN_NAME) LIKE ?
           OR LOWER(COALESCE(COLUMN_COMMENT, '')) LIKE ?
         )
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [dbName, like, like, like],
    );
    return rows.map((row) => ({
      schemaName: row.schema_name,
      tableName: row.table_name,
      columnName: row.column_name,
      description: row.description || '',
    }));
  } finally {
    await connection.end();
  }
}

async function searchSchemaTables(config, password, options = {}) {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  const schemaName = String(options.schemaName || '').trim();
  const query = String(options.q || '').trim();
  if (!schemaName) throw new Error('schemaName 不能为空');
  if (!query) throw new Error('搜索关键词不能为空');
  if (type === 'gaussdb') return gaussSearchSchemaTables(config, password, schemaName, query);
  if (type === 'mysql') return mysqlSearchSchemaTables(config, password, schemaName, query);
  throw new UnsupportedDbTypeError(type);
}

async function gaussCountTableColumns(config, password, schemaName, tableNames) {
  if (!tableNames.length) return new Map();
  const placeholders = tableNames.map(() => '?').join(',');
  const rows = await gaussdbJdbcQuery(
    `SELECT c.relname AS table_name, COUNT(*) AS column_count
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = ?
       AND c.relname IN (${placeholders})
       AND c.relkind IN ('r', 'p')
       AND a.attnum > 0
       AND NOT a.attisdropped
     GROUP BY c.relname`,
    [schemaName, ...tableNames],
    config,
    password,
  );
  return new Map(rows.map((row) => [row.table_name, Number(row.column_count || 0)]));
}

async function mysqlCountTableColumns(config, password, schemaName, tableNames) {
  if (!tableNames.length) return new Map();
  const mysql = loadMysql();
  const dbName = schemaName || config.database;
  const connection = await mysql.createConnection(mysqlConnectionConfig(config, password));
  try {
    const placeholders = tableNames.map(() => '?').join(',');
    const [rows] = await connection.query(
      `SELECT TABLE_NAME AS table_name, COUNT(*) AS column_count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})
       GROUP BY TABLE_NAME`,
      [dbName, ...tableNames],
    );
    return new Map(rows.map((row) => [row.table_name, Number(row.column_count || 0)]));
  } finally {
    await connection.end();
  }
}

async function countTableColumns(config, password, schemaName, tableNames) {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  if (type === 'gaussdb') return gaussCountTableColumns(config, password, schemaName, tableNames);
  if (type === 'mysql') return mysqlCountTableColumns(config, password, schemaName, tableNames);
  throw new UnsupportedDbTypeError(type);
}

async function gaussDeepSearchColumnValues(config, password, schemaName, tableName, column, query, limitPerColumn) {
  const tableRef = `${quoteIdentPg(schemaName)}.${quoteIdentPg(tableName)}`;
  const safeCol = quoteIdentPg(column);
  const like = `%${escapeLikePattern(query)}%`;
  const rows = await gaussdbJdbcQuery(
    `SELECT DISTINCT CAST(${safeCol} AS TEXT) AS value
     FROM ${tableRef}
     WHERE ${safeCol} IS NOT NULL AND CAST(${safeCol} AS TEXT) ILIKE ?
     LIMIT ${Number(limitPerColumn)}`,
    [like],
    config,
    password,
  );
  return rows.map((row) => String(row.value ?? Object.values(row)[0] ?? '')).filter(Boolean);
}

async function mysqlDeepSearchColumnValues(config, password, schemaName, tableName, column, query, limitPerColumn) {
  const mysql = loadMysql();
  const dbName = schemaName || config.database;
  const connection = await mysql.createConnection(mysqlConnectionConfig(config, password));
  try {
    const tableRef = `${quoteIdentMySQL(dbName)}.${quoteIdentMySQL(tableName)}`;
    const safeCol = quoteIdentMySQL(column);
    const like = `%${escapeLikePattern(query)}%`;
    const [rows] = await connection.query(
      `SELECT DISTINCT CAST(${safeCol} AS CHAR) AS value
       FROM ${tableRef}
       WHERE ${safeCol} IS NOT NULL AND CAST(${safeCol} AS CHAR) LIKE ?
       LIMIT ?`,
      [like, Number(limitPerColumn)],
    );
    return rows.map((row) => String(row.value ?? Object.values(row)[0] ?? '')).filter(Boolean);
  } finally {
    await connection.end();
  }
}

async function deepSearchTableValues(config, password, options = {}) {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  const schemaName = String(options.schemaName || '').trim();
  const tableName = String(options.tableName || '').trim();
  const query = String(options.q || '').trim();
  const textColumns = Array.isArray(options.textColumns) ? options.textColumns : [];
  const limitPerColumn = Math.max(1, Math.min(Number(options.limitPerColumn || 5), 20));
  if (!schemaName || !tableName) throw new Error('schemaName 与 tableName 不能为空');
  if (!query) throw new Error('搜索关键词不能为空');

  const matches = [];
  for (const column of textColumns) {
    const name = String(column || '').trim();
    if (!name || !SAFE_COLUMN_NAME.test(name)) continue;
    let values = [];
    try {
      if (type === 'gaussdb') {
        values = await gaussDeepSearchColumnValues(config, password, schemaName, tableName, name, query, limitPerColumn);
      } else if (type === 'mysql') {
        values = await mysqlDeepSearchColumnValues(config, password, schemaName, tableName, name, query, limitPerColumn);
      }
    } catch {
      continue;
    }
    if (values.length > 0) {
      matches.push({ columnName: name, values });
    }
  }
  return matches;
}

function formatTableNotFoundMessage(schemaName, tableName) {
  return `远程库中不存在表 ${schemaName}.${tableName}，LightSchema 可能已过期，请删除后重新生成`;
}

function shortenDbError(message) {
  const text = String(message || '').trim();
  if (!text) return '数据库查询失败';
  const relationMatch = text.match(/relation "([^"]+)" does not exist/i);
  if (relationMatch) {
    const parts = relationMatch[1].split('.');
    if (parts.length >= 2) {
      return formatTableNotFoundMessage(parts[0], parts.slice(1).join('.'));
    }
    return `远程库中不存在表 ${relationMatch[1]}，LightSchema 可能已过期`;
  }
  if (text.includes('does not exist')) {
    const firstLine = text.split('\n').find((line) => line.includes('does not exist')) || text;
    return firstLine.slice(0, 240);
  }
  const firstLine = text.split('\n')[0] || text;
  return firstLine.slice(0, 240);
}

async function gaussTableExists(config, password, schemaName, tableName) {
  const rows = await gaussdbJdbcQuery(
    `SELECT 1 AS ok
     FROM information_schema.tables
     WHERE table_schema = ? AND table_name = ?
     LIMIT 1`,
    [schemaName, tableName],
    config,
    password,
  );
  return rows.length > 0;
}

async function mysqlTableExists(config, password, schemaName, tableName) {
  const mysql = loadMysql();
  const dbName = schemaName || config.database;
  const connection = await mysql.createConnection(mysqlConnectionConfig(config, password));
  try {
    const [rows] = await connection.query(
      `SELECT 1 AS ok
       FROM information_schema.tables
       WHERE table_schema = ? AND table_name = ?
       LIMIT 1`,
      [dbName, tableName],
    );
    return rows.length > 0;
  } finally {
    await connection.end();
  }
}

async function tableExists(config, password, schemaName, tableName) {
  const type = config.type || 'gaussdb';
  assertSupported(type);
  const schema = String(schemaName || '').trim();
  const table = String(tableName || '').trim();
  if (!schema || !table) throw new Error('schemaName 与 tableName 不能为空');
  if (type === 'gaussdb') return gaussTableExists(config, password, schema, table);
  if (type === 'mysql') return mysqlTableExists(config, password, schema, table);
  throw new UnsupportedDbTypeError(type);
}

module.exports = {
  testConnection,
  listSchemas,
  listTables,
  getTableSchema,
  isTableEmpty,
  queryTableRows,
  queryDistinctColumnValues,
  searchSchemaTables,
  countTableColumns,
  deepSearchTableValues,
  normalizePreviewColumns,
  tableExists,
  formatTableNotFoundMessage,
  shortenDbError,
  normalizeExportColumns,
  toDDL,
  isTextType,
  UnsupportedDbTypeError,
  PREVIEW_ROW_LIMIT,
  EXPORT_ROW_LIMIT,
};
