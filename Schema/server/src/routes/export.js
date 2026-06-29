const express = require('express');
const { getDb } = require('../db/sqlite');
const { buildWorkbook } = require('../services/ExcelExportService');

const router = express.Router({ mergeParams: true });

router.post('/excel', async (req, res) => {
  const source = getDb().prepare('SELECT * FROM data_sources WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  const body = req.body || {};
  const schemaName = body.schemaName || 'public';
  const requested = Array.isArray(body.tableNames) && body.tableNames.length ? body.tableNames : null;
  const allRows = getDb()
    .prepare('SELECT * FROM light_schemas WHERE data_source_id = ? AND schema_name = ? ORDER BY table_name')
    .all(source.id, schemaName);
  const rows = requested
    ? allRows.filter((row) => requested.includes(row.table_name))
    : allRows;
  const schemas = [];
  const skipped = [];
  for (const row of rows) {
    try {
      schemas.push({
        ...JSON.parse(row.content),
        tableName: row.table_name,
        schemaName: row.schema_name,
        updatedAt: row.updated_at,
      });
    } catch (error) {
      skipped.push({ tableName: row.table_name, error: error.message });
    }
  }
  if (schemas.length === 0) {
    return res.status(400).json({
      success: false,
      error: requested
        ? '所选表没有可导出的 LightSchema'
        : '当前 schema 下没有可导出的 LightSchema',
      skipped,
    });
  }
  try {
    const buffer = await buildWorkbook({ dataSourceName: source.name, schemas });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=light-schema-${source.name}-${date}.xlsx`);
    if (skipped.length > 0) {
      res.setHeader('X-Export-Skipped', encodeURIComponent(JSON.stringify(skipped)));
    }
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || '导出失败',
    });
  }
});

module.exports = router;
