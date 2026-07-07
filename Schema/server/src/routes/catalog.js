const express = require('express');
const { getDb } = require('../db/sqlite');
const { decrypt } = require('../services/crypto');
const {
  getSchemas,
  getTables,
  refreshCatalog,
  refreshSchemaTables,
} = require('../services/CatalogCacheService');
const {
  searchSchemaTables,
  countTableColumns,
  getTableSchema,
  queryTableRows,
  queryDistinctColumnValues,
  normalizePreviewColumns,
} = require('../services/DatabaseService');
const {
  columnMatchesQuery,
  buildColumnMatchSnippet,
  getColumnCount,
} = require('../lib/lightSchemaIndex');
const { toConnectionConfig } = require('../lib/dataSourceConfig');

const router = express.Router({ mergeParams: true });

function getSource(id) {
  return getDb().prepare('SELECT * FROM data_sources WHERE id = ?').get(id);
}

function creds(row) {
  return toConnectionConfig(row);
}

function parseSource(value) {
  const s = String(value || 'auto').toLowerCase();
  if (s === 'remote' || s === 'sqlite') return s;
  return 'auto';
}

function handleDbError(err, res) {
  if (err.code === 'UNSUPPORTED_DB_TYPE' || err.name === 'UnsupportedDbTypeError') {
    return res.status(501).json({ success: false, error: err.message, code: 'UNSUPPORTED_DB_TYPE' });
  }
  return res.status(500).json({ success: false, error: err.message });
}

router.get('/schemas', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  try {
    const result = await getSchemas(
      Number(source.id),
      creds(source),
      decrypt(source.password_enc),
      parseSource(req.query.source),
    );
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    handleDbError(err, res);
  }
});

router.get('/schemas/:schemaName/tables', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  try {
    const result = await getTables(
      Number(source.id),
      creds(source),
      decrypt(source.password_enc),
      req.params.schemaName,
      parseSource(req.query.source),
    );
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    handleDbError(err, res);
  }
});

router.post('/catalog/refresh', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  const body = req.body || {};
  const currentSchemaName = typeof body.schemaName === 'string' ? body.schemaName : '';
  try {
    const result = await refreshCatalog(
      Number(source.id),
      creds(source),
      decrypt(source.password_enc),
      currentSchemaName,
    );
    res.json({
      success: true,
      data: {
        schemas: result.schemas,
        tables: result.tables,
        schemaName: result.schemaName || null,
      },
      meta: {
        schemas: result.schemasMeta,
        tables: result.tablesMeta,
      },
    });
  } catch (err) {
    handleDbError(err, res);
  }
});

function fetchLightSchemaByTables(dataSourceId, schemaName, tableNames) {
  if (!tableNames.length) return new Map();
  const placeholders = tableNames.map(() => '?').join(',');
  const rows = getDb().prepare(`
    SELECT ls.*, ds.name AS data_source_name
    FROM light_schemas ls
    JOIN data_sources ds ON ds.id = ls.data_source_id
    WHERE ls.data_source_id = ? AND ls.schema_name = ? AND ls.table_name IN (${placeholders})
  `).all(dataSourceId, schemaName, ...tableNames);
  const tagIds = rows.map((row) => row.id);
  const tagMap = new Map();
  if (tagIds.length > 0) {
    const tagPlaceholders = tagIds.map(() => '?').join(',');
    const tagRows = getDb().prepare(`
      SELECT lst.light_schema_id, t.id, t.name, t.color
      FROM light_schema_tags lst
      JOIN tags t ON t.id = lst.tag_id
      WHERE lst.light_schema_id IN (${tagPlaceholders})
      ORDER BY t.name COLLATE NOCASE
    `).all(...tagIds);
    for (const row of tagRows) {
      if (!tagMap.has(row.light_schema_id)) tagMap.set(row.light_schema_id, []);
      tagMap.get(row.light_schema_id).push({ id: row.id, name: row.name, color: row.color });
    }
  }
  const map = new Map();
  for (const row of rows) {
    map.set(row.table_name, {
      id: row.id,
      tags: tagMap.get(row.id) || [],
      columnCount: getColumnCount(row.content),
    });
  }
  return map;
}

function groupSchemaSearchHits(rows, query) {
  const needle = String(query || '').trim().toLowerCase();
  const tableMap = new Map();
  for (const row of rows) {
    const key = row.tableName;
    if (!tableMap.has(key)) {
      tableMap.set(key, { tableName: row.tableName, schemaName: row.schemaName, matches: [], seenColumns: new Set() });
    }
    const entry = tableMap.get(key);
    const col = { name: row.columnName, description: row.description };
    if (entry.seenColumns.has(row.columnName)) continue;
    entry.seenColumns.add(row.columnName);
    if (columnMatchesQuery(col, needle) || row.tableName.toLowerCase().includes(needle)) {
      entry.matches.push({
        columnName: row.columnName,
        description: row.description || '',
        snippet: buildColumnMatchSnippet(col, query),
      });
    }
  }
  return [...tableMap.values()].filter((entry) => (
    entry.matches.length > 0 || entry.tableName.toLowerCase().includes(needle)
  ));
}

router.get('/catalog/explore-search', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ success: false, error: '搜索关键词 q 不能为空' });
  const schemaName = typeof req.query.schemaName === 'string' ? req.query.schemaName.trim() : '';
  if (!schemaName) return res.status(400).json({ success: false, error: '请选择 Schema' });
  try {
    const config = creds(source);
    const password = decrypt(source.password_enc);
    const rawRows = await searchSchemaTables(config, password, { schemaName, q });
    const grouped = groupSchemaSearchHits(rawRows, q);
    const tableNames = grouped.map((item) => item.tableName);
    const [lsMap, columnCounts] = await Promise.all([
      Promise.resolve(fetchLightSchemaByTables(Number(source.id), schemaName, tableNames)),
      countTableColumns(config, password, schemaName, tableNames),
    ]);
    const data = grouped.map((item) => {
      const ls = lsMap.get(item.tableName);
      return {
        lightSchemaId: ls?.id ?? null,
        dataSourceId: String(source.id),
        dataSourceName: source.name,
        schemaName,
        tableName: item.tableName,
        tags: ls?.tags || [],
        columnCount: ls?.columnCount ?? columnCounts.get(item.tableName) ?? item.matches.length,
        matches: item.matches,
      };
    }).sort((a, b) => a.tableName.localeCompare(b.tableName, 'zh-CN'));
    res.json({
      success: true,
      data,
      meta: { totalTables: data.length, schemaName, source: 'remote' },
    });
  } catch (err) {
    handleDbError(err, res);
  }
});

router.get('/schemas/:schemaName/tables/:tableName/preview', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  const schemaName = req.params.schemaName;
  const tableName = req.params.tableName;
  try {
    const config = creds(source);
    const password = decrypt(source.password_enc);
    const schema = await getTableSchema(config, password, schemaName, tableName, 5, 'text_only');
    const ls = getDb().prepare(`
      SELECT id FROM light_schemas
      WHERE data_source_id = ? AND schema_name = ? AND table_name = ?
    `).get(source.id, schemaName, tableName);
    res.json({
      success: true,
      data: {
        lightSchemaId: ls?.id ?? null,
        dataSourceId: String(source.id),
        dataSourceName: source.name,
        schemaName,
        tableName,
        content: {
          tableName: schema.tableName,
          columns: schema.columns,
          primaryKeys: schema.primaryKeys || [],
        },
        ddlText: schema.ddlText,
        columnCount: schema.columns?.length || 0,
      },
    });
  } catch (err) {
    handleDbError(err, res);
  }
});

router.post('/schemas/:schemaName/tables/:tableName/preview-rows', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  const schemaName = req.params.schemaName;
  const tableName = req.params.tableName;
  const body = req.body || {};
  const limit = Math.max(1, Math.min(Number(body.limit || 50), 50));
  const rawFilters = Array.isArray(body.filters) ? body.filters : [];
  const dedupeBy = String(body.dedupeBy || '').trim();
  let columns;
  try {
    columns = normalizePreviewColumns(body.columns);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
  const columnSet = new Set(columns);
  for (const filter of rawFilters) {
    const column = String(filter?.column || '').trim();
    if (column && !columnSet.has(column)) {
      return res.status(400).json({ success: false, error: `无效筛选列: ${column}` });
    }
  }
  if (dedupeBy && !columnSet.has(dedupeBy)) {
    return res.status(400).json({ success: false, error: `无效去重列: ${dedupeBy}` });
  }
  try {
    const config = creds(source);
    const password = decrypt(source.password_enc);
    const result = await queryTableRows(config, password, {
      schemaName,
      tableName,
      columns,
      filters: rawFilters,
      limit,
      dedupeBy,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    handleDbError(err, res);
  }
});

router.post('/schemas/:schemaName/tables/:tableName/preview-distinct', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  const schemaName = req.params.schemaName;
  const tableName = req.params.tableName;
  const body = req.body || {};
  const column = String(body.column || '').trim();
  if (!column) return res.status(400).json({ success: false, error: '无效列' });
  const limit = Math.max(1, Math.min(Number(body.limit || 200), 500));
  try {
    const config = creds(source);
    const password = decrypt(source.password_enc);
    const result = await queryDistinctColumnValues(config, password, {
      schemaName,
      tableName,
      column,
      limit,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    handleDbError(err, res);
  }
});

router.post('/catalog/refresh-schema/:schemaName', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  try {
    const result = await refreshSchemaTables(
      Number(source.id),
      creds(source),
      decrypt(source.password_enc),
      req.params.schemaName,
    );
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    handleDbError(err, res);
  }
});

module.exports = router;
