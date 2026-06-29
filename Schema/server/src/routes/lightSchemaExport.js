const express = require('express');
const { getDb } = require('../db/sqlite');
const { buildWorkbook } = require('../services/ExcelExportService');

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

router.post('/export/excel', async (req, res) => {
  const body = req.body || {};
  const rows = resolveExportRows({ items: body.items, tagIds: body.tagIds });
  if (rows.length === 0) {
    return res.status(400).json({ success: false, error: '没有可导出的表，请先选择表或 Tag' });
  }

  const schemas = [];
  const skipped = [];
  const dataSourceNames = new Set();

  for (const row of rows) {
    dataSourceNames.add(row.data_source_name);
    try {
      schemas.push({
        ...JSON.parse(row.content),
        tableName: row.table_name,
        schemaName: row.schema_name,
        dataSourceName: row.data_source_name,
        updatedAt: row.updated_at,
      });
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

  try {
    const multiSource = dataSourceNames.size > 1;
    const buffer = await buildWorkbook({
      dataSourceName: multiSource ? '多数据源' : schemas[0].dataSourceName,
      schemas,
      multiSource,
    });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=light-schema-export-${date}.xlsx`);
    if (skipped.length > 0) {
      res.setHeader('X-Export-Skipped', encodeURIComponent(JSON.stringify(skipped)));
    }
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || '导出失败' });
  }
});

module.exports = router;
