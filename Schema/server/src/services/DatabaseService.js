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

module.exports = {
  testConnection,
  listSchemas,
  listTables,
  getTableSchema,
  isTableEmpty,
  toDDL,
  isTextType,
  UnsupportedDbTypeError,
};
