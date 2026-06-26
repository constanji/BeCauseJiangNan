/**
 * LightSchemaService
 *
 * 参考 dat 的 LightSchemaGenerator，提取数据库表结构元数据（列名/类型/主键/采样值）
 * 生成 JSON + DDL 文本，并将嵌入向量存储到 pgvector 的 light_schema_vectors 表。
 * 支持 MySQL、PostgreSQL、GaussDB（通过 Java JDBC bridge）。
 */

const path = require('path');
const { logger } = require('@because/data-schemas');

// GaussDB 专用桥（企业定制安全协议）
const { gaussdbJdbcQuery } = require(
  path.join(__dirname, '../../../Because-2.0/utils/gaussdbJdbcBridge'),
);

// 文本列类型集合（这些列有采样值意义）
const TEXT_COLUMN_TYPES = new Set([
  'char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum',
  'character varying', 'character', 'bpchar',
  'nchar', 'nvarchar', 'ntext',
]);

/**
 * 判断列类型是否为文本类型（用于采样时过滤）
 */
function isTextType(dataType = '') {
  const lower = dataType.toLowerCase();
  return TEXT_COLUMN_TYPES.has(lower) || lower.includes('char') || lower.includes('text');
}

/**
 * 将 LightSchema 对象序列化为简洁的 DDL 文本（用于 embed）
 * @param {Object} schema
 * @returns {string}
 */
function toDDL(schema) {
  const cols = schema.columns
    .map((c) => {
      let line = `  ${c.name} ${c.type}`;
      if (!c.nullable) line += ' NOT NULL';
      if (c.description) line += ` -- ${c.description}`;
      return line;
    })
    .join(',\n');

  const pkLine =
    schema.primaryKeys && schema.primaryKeys.length > 0
      ? `,\n  PRIMARY KEY (${schema.primaryKeys.join(', ')})`
      : '';

  const samples = schema.columns
    .filter((c) => c.sampleValues && c.sampleValues.length > 0)
    .map((c) => `-- ${c.name} examples: ${c.sampleValues.slice(0, 5).join(', ')}`)
    .join('\n');

  return `CREATE TABLE ${schema.tableName} (\n${cols}${pkLine}\n);\n${samples}`.trim();
}

// ─────────────────── MySQL helpers ───────────────────

async function getMySQLSchema(pool, dbName, tableName, sampleLimit) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_COMMENT, COLUMN_KEY
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [dbName, tableName],
  );

  const primaryKeys = cols
    .filter((c) => c.COLUMN_KEY === 'PRI')
    .map((c) => c.COLUMN_NAME);

  const columns = await Promise.all(
    cols.map(async (c) => {
      const col = {
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === 'YES',
        description: c.COLUMN_COMMENT || '',
        sampleValues: [],
      };
      if (isTextType(c.DATA_TYPE)) {
        try {
          const [rows] = await pool.query(
            `SELECT DISTINCT \`${c.COLUMN_NAME}\` FROM \`${tableName}\` WHERE \`${c.COLUMN_NAME}\` IS NOT NULL LIMIT ${sampleLimit}`,
          );
          col.sampleValues = rows.map((r) => String(r[c.COLUMN_NAME]));
        } catch (_) {
          // 采样失败不阻断流程
        }
      }
      return col;
    }),
  );

  return { tableName, columns, primaryKeys };
}

// ─────────────────── PostgreSQL helpers ───────────────────

async function getPGSchema(pool, schemaName, tableName, sampleLimit) {
  const { rows: cols } = await pool.query(
    `SELECT
       c.column_name,
       c.data_type,
       c.is_nullable,
       pgd.description AS col_comment
     FROM information_schema.columns c
     LEFT JOIN pg_catalog.pg_statio_all_tables st
       ON st.schemaname = c.table_schema AND st.relname = c.table_name
     LEFT JOIN pg_catalog.pg_description pgd
       ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
     WHERE c.table_schema = $1 AND c.table_name = $2
     ORDER BY c.ordinal_position`,
    [schemaName, tableName],
  );

  const { rows: pkRows } = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema = $1 AND tc.table_name = $2`,
    [schemaName, tableName],
  );
  const primaryKeys = pkRows.map((r) => r.column_name);

  const columns = await Promise.all(
    cols.map(async (c) => {
      const col = {
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        description: c.col_comment || '',
        sampleValues: [],
      };
      if (isTextType(c.data_type)) {
        try {
          const { rows } = await pool.query(
            `SELECT DISTINCT "${c.column_name}" FROM "${tableName}" WHERE "${c.column_name}" IS NOT NULL LIMIT ${sampleLimit}`,
          );
          col.sampleValues = rows.map((r) => String(r[c.column_name]));
        } catch (_) {
          // 采样失败不阻断
        }
      }
      return col;
    }),
  );

  return { tableName, columns, primaryKeys };
}

// ─────────────────── GaussDB helpers (via JDBC bridge) ───────────────────
// gaussdbJdbcQuery(sql, params, dataSource, password) → rows[]  （直接返回行数组）

async function getGaussDBSchema(dataSourceCfg, plainPassword, schemaName, tableName, sampleLimit) {
  const cols = await gaussdbJdbcQuery(
    `SELECT
       a.attname                                       AS column_name,
       t.typname                                       AS data_type,
       CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
       d.description                                   AS col_comment
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
     JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
     LEFT JOIN pg_catalog.pg_description d
       ON d.objoid = c.oid AND d.objsubid = a.attnum
     WHERE n.nspname = ?
       AND c.relname = ?
       AND c.relkind IN ('r', 'p')
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [schemaName, tableName],
    dataSourceCfg,
    plainPassword,
  );

  const pkRows = await gaussdbJdbcQuery(
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
    dataSourceCfg,
    plainPassword,
  );
  const primaryKeys = pkRows.map((r) => r.column_name);

  const columns = await Promise.all(
    cols.map(async (c) => {
      const col = {
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        description: c.col_comment || '',
        sampleValues: [],
      };
      if (isTextType(c.data_type)) {
        try {
          const sampleRows = await gaussdbJdbcQuery(
            `SELECT DISTINCT "${c.column_name}" FROM "${schemaName}"."${tableName}" WHERE "${c.column_name}" IS NOT NULL LIMIT ${sampleLimit}`,
            [],
            dataSourceCfg,
            plainPassword,
          );
          col.sampleValues = sampleRows.map((r) => String(r[c.column_name]));
        } catch (_) {
          // 采样失败不阻断
        }
      }
      return col;
    }),
  );

  return { tableName, columns, primaryKeys };
}

// ─────────────────── 获取表名列表 ───────────────────

async function listTablesMySQL(pool, dbName) {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [dbName],
  );
  return rows.map((r) => r.TABLE_NAME);
}

async function listTablesPG(pool, schemaName) {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
    [schemaName],
  );
  return rows.map((r) => r.table_name);
}

async function listTablesGaussDB(dataSourceCfg, plainPassword, schemaName) {
  const rows = await gaussdbJdbcQuery(
    `SELECT c.relname AS table_name
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ?
       AND c.relkind IN ('r', 'p')
     ORDER BY c.relname`,
    [schemaName],
    dataSourceCfg,
    plainPassword,
  );
  return rows.map((r) => r.table_name);
}

// ─────────────────── 主服务类 ───────────────────

class LightSchemaService {
  /**
   * 生成数据源的 Light Schema 列表
   * @param {Object} dataSource  Mongoose DataSource document
   * @param {string} plainPassword  明文密码
   * @param {Object} options
   * @param {number} options.sampleLimit  采样行数，默认 5
   * @param {string[]|null} options.selectedTables  指定表名，null 则全部
   * @returns {Promise<Array>}  LightSchema 对象数组
   */
  async generateForDataSource(dataSource, plainPassword, { sampleLimit = 5, selectedTables = null, schemaName: selectedSchemaName } = {}) {
    const type = dataSource.type;
    const schemas = [];

    if (type === 'gaussdb') {
      const cfg = {
        host: dataSource.host,
        port: dataSource.port,
        database: dataSource.database,
        username: dataSource.username,
      };
      const schemaName = selectedSchemaName || dataSource.schema || 'public';
      const tables = selectedTables || (await listTablesGaussDB(cfg, plainPassword, schemaName));
      for (const tbl of tables) {
        try {
          const schema = await getGaussDBSchema(cfg, plainPassword, schemaName, tbl, sampleLimit);
          schemas.push(schema);
        } catch (err) {
          logger.warn(`[LightSchemaService] GaussDB: skipping table ${tbl}: ${err.message}`);
        }
      }
    } else if (type === 'mysql') {
      const mysql = require('mysql2/promise');
      const pool = await mysql.createPool({
        host: dataSource.host,
        port: dataSource.port || 3306,
        database: dataSource.database,
        user: dataSource.username,
        password: plainPassword,
        connectionLimit: 2,
      });
      try {
        const tables = selectedTables || (await listTablesMySQL(pool, dataSource.database));
        for (const tbl of tables) {
          try {
            const schema = await getMySQLSchema(pool, dataSource.database, tbl, sampleLimit);
            schemas.push(schema);
          } catch (err) {
            logger.warn(`[LightSchemaService] MySQL: skipping table ${tbl}: ${err.message}`);
          }
        }
      } finally {
        await pool.end();
      }
    } else if (type === 'postgresql' || type === 'postgres') {
      const { Pool } = require('pg');
      const pool = new Pool({
        host: dataSource.host,
        port: dataSource.port || 5432,
        database: dataSource.database,
        user: dataSource.username,
        password: plainPassword,
        max: 2,
      });
      try {
        const schemaName = selectedSchemaName || dataSource.schema || 'public';
        const tables = selectedTables || (await listTablesPG(pool, schemaName));
        for (const tbl of tables) {
          try {
            const schema = await getPGSchema(pool, schemaName, tbl, sampleLimit);
            schemas.push(schema);
          } catch (err) {
            logger.warn(`[LightSchemaService] PG: skipping table ${tbl}: ${err.message}`);
          }
        }
      } finally {
        await pool.end();
      }
    } else {
      throw new Error(`[LightSchemaService] Unsupported data source type: ${type}`);
    }

    logger.info(`[LightSchemaService] Generated ${schemas.length} light schemas for datasource: ${dataSource._id}`);
    return schemas;
  }

  /**
   * 将 Light Schema 列表向量化并存入 pgvector
   * @param {string} datasourceId
   * @param {Array} schemas  generateForDataSource 的返回值
   * @param {Object} vectorDB  VectorDBService 实例
   * @param {Object} embeddingService  EmbeddingService 实例
   */
  async storeToVectorDB(datasourceId, schemas, vectorDB, embeddingService) {
    const records = [];
    for (const schema of schemas) {
      const ddlText = toDDL(schema);
      let embedding = null;
      try {
        embedding = await embeddingService.embedText(ddlText);
      } catch (err) {
        logger.warn(`[LightSchemaService] Embedding failed for ${schema.tableName}: ${err.message}`);
      }
      records.push({
        tableName: schema.tableName,
        content: JSON.stringify(schema),
        ddlText,
        embedding,
      });
    }
    await vectorDB.upsertLightSchemas(datasourceId, records);
    logger.info(`[LightSchemaService] Stored ${records.length} light schema vectors for: ${datasourceId}`);
    return records.length;
  }
}

module.exports = LightSchemaService;
