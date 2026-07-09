const express = require('express');
const { getDb } = require('../db/sqlite');
const logger = require('../lib/logger');
const { buildWorkbook, buildDataWorkbook } = require('../services/ExcelExportService');
const { decrypt } = require('../services/crypto');
const { toConnectionConfig } = require('../lib/dataSourceConfig');
const { isSupportedType } = require('../lib/dbTypes');
const { buildAttachmentContentDisposition } = require('../lib/httpContentDisposition');
const { queryTableRows, EXPORT_ROW_LIMIT } = require('../services/DatabaseService');

const router = express.Router();

function resolveExportRows({ items = [], tagIds = [] }) {
  const db = getDb();
  const seen = new Set();
  const rows = [];

  function addRow(row) {
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  }

  const normalizedTagIds = [...new Set(
    (Array.isArray(tagIds) ? tagIds : [])
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0),
  )];

  if (normalizedTagIds.length > 0) {
    const placeholders = normalizedTagIds.map(() => '?').join(',');
    const tagRows = db.prepare(`
      SELECT ls.*, ds.name AS data_source_name
      FROM light_schemas ls
      JOIN data_sources ds ON ds.id = ls.data_source_id
      JOIN light_schema_tags lst ON lst.light_schema_id = ls.id
      WHERE lst.tag_id IN (${placeholders})
      ORDER BY ds.name, ls.schema_name, ls.table_name
    `).all(...normalizedTagIds);
    for (const row of tagRows) addRow(row);
  }

  for (const item of Array.isArray(items) ? items : []) {
    if (item?.lightSchemaId != null) {
      const row = db.prepare(`
        SELECT ls.*, ds.name AS data_source_name
        FROM light_schemas ls
        JOIN data_sources ds ON ds.id = ls.data_source_id
        WHERE ls.id = ?
      `).get(Number(item.lightSchemaId));
      addRow(row);
      continue;
    }
    if (item?.dataSourceId && item?.schemaName && item?.tableName) {
      const row = db.prepare(`
        SELECT ls.*, ds.name AS data_source_name
        FROM light_schemas ls
        JOIN data_sources ds ON ds.id = ls.data_source_id
        WHERE ls.data_source_id = ? AND ls.schema_name = ? AND ls.table_name = ?
      `).get(Number(item.dataSourceId), String(item.schemaName), String(item.tableName));
      addRow(row);
    }
  }

  return rows;
}

function parseSchemaContent(row) {
  return {
    ...JSON.parse(row.content),
    tableName: row.table_name,
    schemaName: row.schema_name,
    dataSourceName: row.data_source_name,
    updatedAt: row.updated_at,
  };
}

function buildExportFilename(mode, rows) {
  const date = new Date().toISOString().slice(0, 10);
  const singleTable = rows.length === 1 ? rows[0].table_name : '';
  const suffix = singleTable ? `-${singleTable}` : '';
  if (mode === 'table_data') return `table-data${suffix}-${date}.xlsx`;
  return `light-schema${suffix}-${date}.xlsx`;
}

function sendWorkbook(res, { buffer, mode, filename, skipped = [] }) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', buildAttachmentContentDisposition(filename));
  res.setHeader('X-Export-Mode', mode);
  if (skipped.length > 0) {
    res.setHeader('X-Export-Skipped', encodeURIComponent(JSON.stringify(skipped)));
  }
  res.send(Buffer.from(buffer));
}

async function fetchTableDataForExport(row, content) {
  const source = getDb().prepare('SELECT * FROM data_sources WHERE id = ?').get(row.data_source_id);
  if (!source) throw new Error('数据源不存在');
  const dataSource = toConnectionConfig(source);
  if (!isSupportedType(dataSource.type)) {
    throw new Error(`暂不支持的数据源类型: ${dataSource.type}`);
  }

  const lightColumns = (content.columns || []).filter((col) => col?.name);
  const columns = lightColumns.map((col) => col.name);
  if (columns.length === 0) throw new Error('LightSchema 无有效列');
  const descriptionByName = new Map(
    lightColumns.map((col) => [col.name, String(col.description || '')]),
  );

  const password = decrypt(source.password_enc);
  const result = await queryTableRows(dataSource, password, {
    schemaName: row.schema_name,
    tableName: row.table_name,
    columns,
    filters: [],
    purpose: 'export',
    limit: EXPORT_ROW_LIMIT,
  });

  return {
    schemaName: row.schema_name,
    tableName: row.table_name,
    tableDescription: String(content.tableDescription || ''),
    dataSourceName: row.data_source_name,
    columns: result.columns,
    columnDescriptions: result.columns.map((name) => descriptionByName.get(name) || ''),
    rows: result.rows,
    truncated: result.truncated,
    limit: result.limit,
  };
}

router.post('/export/excel', async (req, res) => {
  const body = req.body || {};
  const mode = body.mode === 'table_data' ? 'table_data' : 'light_schema';
  const rows = resolveExportRows({ items: body.items, tagIds: body.tagIds });
  if (rows.length === 0) {
    return res.status(400).json({ success: false, error: '没有可导出的表，请先选择表或 Tag' });
  }

  const dataSourceNames = new Set();
  const skipped = [];

  for (const row of rows) {
    dataSourceNames.add(row.data_source_name);
  }

  try {
    const multiSource = dataSourceNames.size > 1;
    const filename = buildExportFilename(mode, rows);
    logger.info('export excel', { mode, tableCount: rows.length, filename });

    if (mode === 'table_data') {
      const tables = [];
      for (const row of rows) {
        try {
          const content = parseSchemaContent(row);
          const tableData = await fetchTableDataForExport(row, content);
          tables.push(tableData);
        } catch (error) {
          skipped.push({
            tableName: row.table_name,
            dataSourceName: row.data_source_name,
            error: error.message,
          });
        }
      }

      if (tables.length === 0) {
        return res.status(400).json({ success: false, error: '所选表没有可导出的数据', skipped });
      }

      const buffer = await buildDataWorkbook({
        dataSourceName: multiSource ? '多数据源' : tables[0].dataSourceName,
        tables,
        multiSource,
      });
      return sendWorkbook(res, { buffer, mode, filename, skipped });
    }

    const schemas = [];
    for (const row of rows) {
      try {
        schemas.push(parseSchemaContent(row));
      } catch (error) {
        skipped.push({
          tableName: row.table_name,
          dataSourceName: row.data_source_name,
          error: error.message,
        });
      }
    }

    if (schemas.length === 0) {
      return res.status(400).json({ success: false, error: '所选表没有可导出的 LightSchema', skipped });
    }

    const buffer = await buildWorkbook({
      dataSourceName: multiSource ? '多数据源' : schemas[0].dataSourceName,
      schemas,
      multiSource,
    });
    return sendWorkbook(res, { buffer, mode, filename, skipped });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || '导出失败' });
  }
});

module.exports = router;
