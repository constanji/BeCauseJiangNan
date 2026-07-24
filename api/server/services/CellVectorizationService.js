/**
 * CellVectorizationService
 *
 * 参考 dat 的单元格向量化策略：
 * 遍历数据源中所有（或指定）表的文本列，提取 DISTINCT 值，
 * 转换为向量嵌入后存入 pgvector 的 cell_vectors 表，
 * 用于问数时的字面量语义匹配（如"一月"→ 找到 column: month, value: "January"）。
 * 支持 MySQL、PostgreSQL、GaussDB（Java JDBC bridge）。
 */

const path = require('path');
const { logger } = require('@because/data-schemas');

// 相对项目根 /app/Because-2.0（勿用 __dirname 相对上溯，深度不同会拼错）
const { gaussdbJdbcQuery } = require(
  path.join(require('~/config/paths').root, 'Because-2.0/utils/gaussdbJdbcBridge'),
);

// 仅对这些类型的列做枚举值向量化
const TEXT_COLUMN_TYPES = new Set([
  'char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum',
  'character varying', 'character', 'bpchar',
  'nchar', 'nvarchar', 'ntext',
]);

function isTextType(dataType = '') {
  const lower = dataType.toLowerCase();
  return TEXT_COLUMN_TYPES.has(lower) || lower.includes('char') || lower.includes('text');
}

// ─────────────────── MySQL ───────────────────

async function vectorizeMySQL(pool, dbName, tableName, rowLimit) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, tableName],
  );
  const textCols = cols.filter((c) => isTextType(c.DATA_TYPE));
  const cells = [];
  for (const c of textCols) {
    try {
      const [rows] = await pool.query(
        `SELECT DISTINCT \`${c.COLUMN_NAME}\` FROM \`${tableName}\`
         WHERE \`${c.COLUMN_NAME}\` IS NOT NULL LIMIT ${rowLimit}`,
      );
      for (const r of rows) {
        const val = r[c.COLUMN_NAME];
        if (val !== null && val !== undefined && String(val).trim() !== '') {
          cells.push({ columnName: c.COLUMN_NAME, cellValue: String(val) });
        }
      }
    } catch (_) {
      // 单列失败不阻断
    }
  }
  return cells;
}

// ─────────────────── PostgreSQL ───────────────────

async function vectorizePG(pool, schemaName, tableName, rowLimit) {
  const { rows: cols } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [schemaName, tableName],
  );
  const textCols = cols.filter((c) => isTextType(c.data_type));
  const cells = [];
  for (const c of textCols) {
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT "${c.column_name}" FROM "${tableName}"
         WHERE "${c.column_name}" IS NOT NULL LIMIT ${rowLimit}`,
      );
      for (const r of rows) {
        const val = r[c.column_name];
        if (val !== null && val !== undefined && String(val).trim() !== '') {
          cells.push({ columnName: c.column_name, cellValue: String(val) });
        }
      }
    } catch (_) {
      // 单列失败不阻断
    }
  }
  return cells;
}

// ─────────────────── GaussDB ───────────────────

// gaussdbJdbcQuery(sql, params, dataSource, password) → rows[]  （直接返回行数组）
async function vectorizeGaussDB(cfg, plainPassword, schemaName, tableName, rowLimit) {
  const cols = await gaussdbJdbcQuery(
    `SELECT a.attname AS column_name, t.typname AS data_type
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
     JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
     WHERE n.nspname = ?
       AND c.relname = ?
       AND c.relkind IN ('r', 'p')
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [schemaName, tableName],
    cfg,
    plainPassword,
  );
  const textCols = cols.filter((c) => isTextType(c.data_type));
  const cells = [];
  for (const c of textCols) {
    try {
      const sampleRows = await gaussdbJdbcQuery(
        `SELECT DISTINCT "${c.column_name}" FROM "${schemaName}"."${tableName}"
         WHERE "${c.column_name}" IS NOT NULL LIMIT ${rowLimit}`,
        [],
        cfg,
        plainPassword,
      );
      for (const r of sampleRows) {
        const val = r[c.column_name];
        if (val !== null && val !== undefined && String(val).trim() !== '') {
          cells.push({ columnName: c.column_name, cellValue: String(val) });
        }
      }
    } catch (_) {
      // 单列失败不阻断
    }
  }
  return cells;
}

// ─────────────────── 主服务类 ───────────────────

class CellVectorizationService {
  /**
   * 对数据源进行单元格向量化，并存入 pgvector
   * @param {Object} dataSource    Mongoose DataSource document
   * @param {string} plainPassword 明文密码
   * @param {Object} vectorDB      VectorDBService 实例
   * @param {Object} embeddingService EmbeddingService 实例
   * @param {Object} options
   * @param {number} options.rowLimit        DISTINCT 行数上限，默认 100
   * @param {string[]|null} options.selectedTables 指定表名，null 则全部
   * @returns {Promise<number>} 写入的总向量条数
   */
  async vectorizeDataSource(
    dataSource,
    plainPassword,
    vectorDB,
    embeddingService,
    { rowLimit = 100, selectedTables = null, schemaName: selectedSchemaName } = {},
  ) {
    const type = dataSource.type;
    const datasourceId = String(dataSource._id);
    let totalCells = 0;

    const processTables = async (tables, fetchCellsFn) => {
      for (const tbl of tables) {
        let cells = [];
        try {
          cells = await fetchCellsFn(tbl);
        } catch (err) {
          logger.warn(`[CellVectorizationService] Skipping table ${tbl}: ${err.message}`);
          continue;
        }
        if (cells.length === 0) continue;

        // 先清除该表的旧记录，再写入新记录
        await vectorDB.deleteCells(datasourceId, [tbl]);

        const rows = [];
        for (const { columnName, cellValue } of cells) {
          let embedding = null;
          try {
            embedding = await embeddingService.embedText(cellValue);
          } catch (err) {
            logger.warn(`[CellVectorizationService] Embed failed for "${cellValue}": ${err.message}`);
          }
          rows.push({ tableName: tbl, columnName, cellValue, embedding });
        }
        await vectorDB.insertCells(datasourceId, rows);
        totalCells += rows.length;
        logger.debug(`[CellVectorizationService] Table ${tbl}: ${rows.length} cell vectors stored`);
      }
    };

    if (type === 'gaussdb') {
      const cfg = {
        host: dataSource.host,
        port: dataSource.port,
        database: dataSource.database,
        username: dataSource.username,
      };
      const schemaName = selectedSchemaName || dataSource.schema || 'public';
      const tables = selectedTables || await (async () => {
        const rows = await gaussdbJdbcQuery(
          `SELECT c.relname AS table_name
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = ?
             AND c.relkind IN ('r', 'p')
           ORDER BY c.relname`,
          [schemaName],
          cfg,
          plainPassword,
        );
        return rows.map((r) => r.table_name);
      })();
      await processTables(tables, (tbl) => vectorizeGaussDB(cfg, plainPassword, schemaName, tbl, rowLimit));
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
        const tables = selectedTables || await (async () => {
          const [rows] = await pool.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
            [dataSource.database],
          );
          return rows.map((r) => r.TABLE_NAME);
        })();
        await processTables(tables, (tbl) => vectorizeMySQL(pool, dataSource.database, tbl, rowLimit));
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
        const tables = selectedTables || await (async () => {
          const { rows } = await pool.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
            [schemaName],
          );
          return rows.map((r) => r.table_name);
        })();
        await processTables(tables, (tbl) => vectorizePG(pool, schemaName, tbl, rowLimit));
      } finally {
        await pool.end();
      }
    } else {
      throw new Error(`[CellVectorizationService] Unsupported data source type: ${type}`);
    }

    logger.info(`[CellVectorizationService] Total cell vectors stored: ${totalCells} for datasource: ${datasourceId}`);
    return totalCells;
  }
}

module.exports = CellVectorizationService;
