const express = require('express');
const { getDb, now } = require('../db/sqlite');
const { decrypt } = require('../services/crypto');
const { getTableSchema } = require('../services/DatabaseService');
const { buildColumnSearchText } = require('../lib/lightSchemaIndex');
const { updateLightSchemaById, deleteLightSchemaById } = require('../lib/lightSchemaContent');
const { toConnectionConfig } = require('../lib/dataSourceConfig');

const router = express.Router({ mergeParams: true });

function sourceById(id) {
  return getDb().prepare('SELECT * FROM data_sources WHERE id = ?').get(id);
}

function listRows(id, schemaName) {
  const stmt = schemaName
    ? getDb().prepare('SELECT * FROM light_schemas WHERE data_source_id = ? AND schema_name = ? ORDER BY table_name')
    : getDb().prepare('SELECT * FROM light_schemas WHERE data_source_id = ? ORDER BY table_name');
  return schemaName ? stmt.all(id, schemaName) : stmt.all(id);
}

router.post('/generate', async (req, res) => {
  const source = sourceById(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  const body = req.body || {};
  const tableNames = Array.isArray(body.tableNames) ? body.tableNames : [];
  if (tableNames.length === 0) {
    return res.status(400).json({ success: false, error: '请至少选择一张表' });
  }
  const sampleLimit = Math.max(1, Math.min(Number(body.sampleLimit || 5), 20));
  const sampleScope = body.sampleScope === 'all_columns' ? 'all_columns' : 'text_only';
  const password = decrypt(source.password_enc);
  const dataSource = toConnectionConfig(source);
  let schemaName = body.schemaName;
  if (!schemaName) {
    schemaName = dataSource.type === 'mysql' ? dataSource.database : 'public';
  }
  const out = [];
  const skipped = [];
  const sampleWarnings = [];
  const stmt = getDb().prepare(`
    INSERT INTO light_schemas (data_source_id, schema_name, table_name, content, ddl_text, column_search_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_source_id, schema_name, table_name)
    DO UPDATE SET content = excluded.content, ddl_text = excluded.ddl_text,
      column_search_text = excluded.column_search_text, updated_at = excluded.updated_at
  `);
  for (const tableName of tableNames) {
    try {
      const schema = await getTableSchema(dataSource, password, schemaName, tableName, sampleLimit, sampleScope);
      const searchText = buildColumnSearchText(schema);
      stmt.run(source.id, schemaName, tableName, JSON.stringify(schema), schema.ddlText, searchText, now(), now());
      out.push(schema);
      if (Array.isArray(schema.sampleWarnings) && schema.sampleWarnings.length > 0) {
        sampleWarnings.push(...schema.sampleWarnings.map((item) => ({ tableName, ...item })));
      }
    } catch (error) {
      skipped.push({ tableName, error: error.message });
    }
  }
  res.json({
    success: true,
    data: out,
    summary: {
      schemaName,
      requested: tableNames.length,
      generated: out.length,
      skipped: skipped.length,
      skippedTables: skipped,
      sampleWarnings,
    },
  });
});

router.get('/', (req, res) => {
  const schemaName = typeof req.query.schemaName === 'string' ? req.query.schemaName : undefined;
  const rows = listRows(req.params.id, schemaName);
  res.json({ success: true, data: rows });
});

router.get('/:tableName', (req, res) => {
  const schemaName = typeof req.query.schemaName === 'string' ? req.query.schemaName : 'public';
  const row = getDb()
    .prepare('SELECT * FROM light_schemas WHERE data_source_id = ? AND schema_name = ? AND table_name = ?')
    .get(req.params.id, schemaName, req.params.tableName);
  if (!row) return res.status(404).json({ success: false, error: '未找到 LightSchema' });
  res.json({ success: true, data: row });
});

router.put('/:tableName', (req, res) => {
  const schemaName = typeof req.query.schemaName === 'string' ? req.query.schemaName : 'public';
  const row = getDb()
    .prepare('SELECT id FROM light_schemas WHERE data_source_id = ? AND schema_name = ? AND table_name = ?')
    .get(req.params.id, schemaName, req.params.tableName);
  if (!row) return res.status(404).json({ success: false, error: '未找到 LightSchema' });
  try {
    const { normalized, ddlText, updatedAt } = updateLightSchemaById(row.id, req.body?.content);
    res.json({
      success: true,
      data: {
        id: row.id,
        data_source_id: Number(req.params.id),
        schema_name: schemaName,
        table_name: req.params.tableName,
        content: JSON.stringify(normalized),
        ddl_text: ddlText,
        updated_at: updatedAt,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/:tableName', (req, res) => {
  const schemaName = typeof req.query.schemaName === 'string' ? req.query.schemaName : 'public';
  const result = getDb()
    .prepare('DELETE FROM light_schemas WHERE data_source_id = ? AND schema_name = ? AND table_name = ?')
    .run(req.params.id, schemaName, req.params.tableName);
  res.json({ success: true, deleted: result.changes > 0 });
});

module.exports = router;
