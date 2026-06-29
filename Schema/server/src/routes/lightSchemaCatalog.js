const express = require('express');
const { getDb, now } = require('../db/sqlite');
const {
  parseContent,
  getColumnCount,
  buildSnippet,
} = require('../lib/lightSchemaIndex');
const {
  updateLightSchemaById,
  deleteLightSchemaById,
  getLightSchemaRow,
} = require('../lib/lightSchemaContent');

const router = express.Router();

function parseTagIds(raw) {
  if (raw == null || raw === '') return [];
  const parts = String(raw).split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(parts)];
}

function fetchTagsForSchemaIds(ids) {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb().prepare(`
    SELECT lst.light_schema_id, t.id, t.name, t.color
    FROM light_schema_tags lst
    JOIN tags t ON t.id = lst.tag_id
    WHERE lst.light_schema_id IN (${placeholders})
    ORDER BY t.name COLLATE NOCASE
  `).all(...ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.light_schema_id)) map.set(row.light_schema_id, []);
    map.get(row.light_schema_id).push({ id: row.id, name: row.name, color: row.color });
  }
  return map;
}

function toCatalogItem(row, tags = []) {
  return {
    id: row.id,
    dataSourceId: String(row.data_source_id),
    dataSourceName: row.data_source_name,
    schemaName: row.schema_name,
    tableName: row.table_name,
    tags,
    updatedAt: row.updated_at,
    columnCount: getColumnCount(row.content),
  };
}

function buildListQuery(filters) {
  const clauses = ['1=1'];
  const params = [];
  if (filters.dataSourceId) {
    clauses.push('ls.data_source_id = ?');
    params.push(Number(filters.dataSourceId));
  }
  if (filters.schemaName) {
    clauses.push('ls.schema_name = ?');
    params.push(filters.schemaName);
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    clauses.push('(ls.table_name LIKE ? OR IFNULL(ls.column_search_text, \'\') LIKE ?)');
    params.push(like, like);
  }
  const tagIds = filters.tagIds || [];
  if (tagIds.length === 1) {
    clauses.push(`EXISTS (
      SELECT 1 FROM light_schema_tags lst
      WHERE lst.light_schema_id = ls.id AND lst.tag_id = ?
    )`);
    params.push(tagIds[0]);
  } else if (tagIds.length > 1) {
    const placeholders = tagIds.map(() => '?').join(',');
    clauses.push(`EXISTS (
      SELECT 1 FROM light_schema_tags lst
      WHERE lst.light_schema_id = ls.id AND lst.tag_id IN (${placeholders})
    )`);
    params.push(...tagIds);
  }
  return { where: clauses.join(' AND '), params };
}

router.get('/stats', (req, res) => {
  const db = getDb();
  const byDataSource = db.prepare(`
    SELECT ds.id, ds.name, COUNT(ls.id) AS count
    FROM data_sources ds
    LEFT JOIN light_schemas ls ON ls.data_source_id = ds.id
    GROUP BY ds.id
    ORDER BY ds.name COLLATE NOCASE
  `).all().map((row) => ({
    dataSourceId: String(row.id),
    dataSourceName: row.name,
    count: Number(row.count || 0),
  }));

  const bySchema = db.prepare(`
    SELECT schema_name, COUNT(*) AS count
    FROM light_schemas
    GROUP BY schema_name
    ORDER BY schema_name COLLATE NOCASE
  `).all().map((row) => ({
    schemaName: row.schema_name,
    count: Number(row.count || 0),
  }));

  const byTag = db.prepare(`
    SELECT t.id, t.name, t.color, COUNT(lst.light_schema_id) AS count
    FROM tags t
    LEFT JOIN light_schema_tags lst ON lst.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name COLLATE NOCASE
  `).all().map((row) => ({
    tagId: row.id,
    tagName: row.name,
    color: row.color,
    count: Number(row.count || 0),
  }));

  res.json({
    success: true,
    data: { byDataSource, bySchema, byTag, total: bySchema.reduce((sum, item) => sum + item.count, 0) },
  });
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ success: false, error: '搜索关键词 q 不能为空' });
  const filters = {
    dataSourceId: req.query.dataSourceId,
    schemaName: typeof req.query.schemaName === 'string' ? req.query.schemaName : undefined,
    tagIds: parseTagIds(req.query.tagId || req.query.tagIds),
  };
  const { where, params } = buildListQuery(filters);
  const like = `%${q}%`;
  const rows = getDb().prepare(`
    SELECT ls.*, ds.name AS data_source_name
    FROM light_schemas ls
    JOIN data_sources ds ON ds.id = ls.data_source_id
    WHERE ${where}
      AND (ls.column_search_text LIKE ? OR ls.table_name LIKE ?)
    ORDER BY ds.name, ls.schema_name, ls.table_name
  `).all(...params, like, like);

  const tagMap = fetchTagsForSchemaIds(rows.map((row) => row.id));
  const data = [];
  let totalColumns = 0;
  const needle = q.toLowerCase();

  for (const row of rows) {
    const parsed = parseContent(row.content);
    if (!parsed?.columns) continue;
    const matches = [];
    for (const col of parsed.columns) {
      const desc = String(col.description || '');
      if (!desc.toLowerCase().includes(needle)) continue;
      matches.push({
        columnName: col.name,
        description: desc,
        snippet: buildSnippet(desc, q),
      });
    }
    if (matches.length === 0 && !String(row.table_name).toLowerCase().includes(needle)) continue;
    totalColumns += matches.length;
    data.push({
      lightSchemaId: row.id,
      dataSourceId: String(row.data_source_id),
      dataSourceName: row.data_source_name,
      schemaName: row.schema_name,
      tableName: row.table_name,
      tags: tagMap.get(row.id) || [],
      matches,
    });
  }

  res.json({
    success: true,
    data,
    meta: { totalTables: data.length, totalColumns },
  });
});

router.get('/', (req, res) => {
  const filters = {
    dataSourceId: req.query.dataSourceId,
    schemaName: typeof req.query.schemaName === 'string' ? req.query.schemaName : undefined,
    q: typeof req.query.q === 'string' ? req.query.q.trim() : undefined,
    tagIds: parseTagIds(req.query.tagId || req.query.tagIds),
  };
  const { where, params } = buildListQuery(filters);
  const rows = getDb().prepare(`
    SELECT ls.*, ds.name AS data_source_name
    FROM light_schemas ls
    JOIN data_sources ds ON ds.id = ls.data_source_id
    WHERE ${where}
    ORDER BY ds.name, ls.schema_name, ls.table_name
  `).all(...params);
  const tagMap = fetchTagsForSchemaIds(rows.map((row) => row.id));
  res.json({
    success: true,
    data: rows.map((row) => toCatalogItem(row, tagMap.get(row.id) || [])),
  });
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: '无效的 ID' });
  }
  const row = getDb().prepare(`
    SELECT ls.*, ds.name AS data_source_name
    FROM light_schemas ls
    JOIN data_sources ds ON ds.id = ls.data_source_id
    WHERE ls.id = ?
  `).get(id);
  if (!row) return res.status(404).json({ success: false, error: '未找到 LightSchema' });
  const tags = fetchTagsForSchemaIds([id]).get(id) || [];
  res.json({
    success: true,
    data: {
      ...toCatalogItem(row, tags),
      content: parseContent(row.content),
      ddlText: row.ddl_text,
      createdAt: row.created_at,
    },
  });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: '无效的 ID' });
  }
  try {
    const { normalized, ddlText, updatedAt } = updateLightSchemaById(id, req.body?.content);
    const tags = fetchTagsForSchemaIds([id]).get(id) || [];
    const row = getLightSchemaRow(id);
    res.json({
      success: true,
      data: {
        ...toCatalogItem(row, tags),
        content: normalized,
        ddlText,
        createdAt: row.created_at,
      },
    });
  } catch (error) {
    const status = error.message === '未找到 LightSchema' ? 404 : 400;
    res.status(status).json({ success: false, error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: '无效的 ID' });
  }
  try {
    deleteLightSchemaById(id);
    res.json({ success: true, deleted: true });
  } catch (error) {
    const status = error.message === '未找到 LightSchema' ? 404 : 400;
    res.status(status).json({ success: false, error: error.message });
  }
});

router.put('/:id/tags', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: '无效的 ID' });
  }
  const row = getDb().prepare('SELECT id FROM light_schemas WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ success: false, error: '未找到 LightSchema' });
  const tagIds = Array.isArray(req.body?.tagIds)
    ? [...new Set(req.body.tagIds.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  if (tagIds.length > 0) {
    const placeholders = tagIds.map(() => '?').join(',');
    const found = getDb().prepare(`SELECT id FROM tags WHERE id IN (${placeholders})`).all(...tagIds);
    if (found.length !== tagIds.length) {
      return res.status(400).json({ success: false, error: '包含无效的 Tag ID' });
    }
  }
  const db = getDb();
  db.prepare('DELETE FROM light_schema_tags WHERE light_schema_id = ?').run(id);
  const insert = db.prepare('INSERT INTO light_schema_tags (light_schema_id, tag_id) VALUES (?, ?)');
  for (const tagId of tagIds) insert.run(id, tagId);
  const tags = fetchTagsForSchemaIds([id]).get(id) || [];
  res.json({ success: true, data: { id, tags } });
});

module.exports = router;
