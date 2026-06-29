const express = require('express');
const { getDb, now } = require('../db/sqlite');

const router = express.Router();

function listTagsWithUsage() {
  return getDb().prepare(`
    SELECT t.id, t.name, t.color, t.created_at, t.updated_at,
      COUNT(lst.light_schema_id) AS usage_count
    FROM tags t
    LEFT JOIN light_schema_tags lst ON lst.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name COLLATE NOCASE
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usageCount: Number(row.usage_count || 0),
  }));
}

router.get('/', (req, res) => {
  res.json({ success: true, data: listTagsWithUsage() });
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ success: false, error: 'Tag 名称不能为空' });
  const color = body.color ? String(body.color).trim() : null;
  const existing = getDb().prepare('SELECT id FROM tags WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ success: false, error: 'Tag 名称已存在' });
  const ts = now();
  const result = getDb().prepare(`
    INSERT INTO tags (name, color, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run(name, color, ts, ts);
  res.status(201).json({
    success: true,
    data: { id: result.lastInsertRowid, name, color, createdAt: ts, updatedAt: ts, usageCount: 0 },
  });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: '无效的 Tag ID' });
  }
  const row = getDb().prepare('SELECT * FROM tags WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ success: false, error: 'Tag 不存在' });
  const body = req.body || {};
  const name = body.name != null ? String(body.name).trim() : row.name;
  if (!name) return res.status(400).json({ success: false, error: 'Tag 名称不能为空' });
  const color = body.color != null ? (String(body.color).trim() || null) : row.color;
  const dup = getDb().prepare('SELECT id FROM tags WHERE name = ? AND id <> ?').get(name, id);
  if (dup) return res.status(409).json({ success: false, error: 'Tag 名称已存在' });
  const ts = now();
  getDb().prepare('UPDATE tags SET name = ?, color = ?, updated_at = ? WHERE id = ?').run(name, color, ts, id);
  const usage = getDb().prepare('SELECT COUNT(*) AS c FROM light_schema_tags WHERE tag_id = ?').get(id);
  res.json({
    success: true,
    data: {
      id,
      name,
      color,
      createdAt: row.created_at,
      updatedAt: ts,
      usageCount: Number(usage?.c || 0),
    },
  });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: '无效的 Tag ID' });
  }
  const row = getDb().prepare('SELECT id FROM tags WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ success: false, error: 'Tag 不存在' });
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id);
  res.json({ success: true, deleted: true });
});

module.exports = router;
