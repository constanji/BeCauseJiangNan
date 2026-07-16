const express = require('express');
const { getDb, now } = require('../db/sqlite');
const {
  TAG_JOIN_SELECT,
  mapTagRow,
  validateParentTag,
  findDuplicateTag,
} = require('../lib/tagHelpers');

const router = express.Router();

function getTagById(id) {
  const row = getDb().prepare(`
    SELECT ${TAG_JOIN_SELECT},
      (SELECT COUNT(*) FROM light_schema_tags lst WHERE lst.tag_id = t.id) AS usage_count,
      (SELECT COUNT(*) FROM tags c WHERE c.parent_id = t.id) AS child_count
    FROM tags t
    LEFT JOIN tags p ON p.id = t.parent_id
    WHERE t.id = ?
  `).get(id);
  return row ? mapTagRow(row) : null;
}

function listTagsWithUsage() {
  return getDb().prepare(`
    SELECT ${TAG_JOIN_SELECT},
      COUNT(lst.light_schema_id) AS usage_count,
      (SELECT COUNT(*) FROM tags c WHERE c.parent_id = t.id) AS child_count
    FROM tags t
    LEFT JOIN tags p ON p.id = t.parent_id
    LEFT JOIN light_schema_tags lst ON lst.tag_id = t.id
    GROUP BY t.id
    ORDER BY COALESCE(p.name, t.name) COLLATE NOCASE,
      CASE WHEN t.parent_id IS NULL THEN 0 ELSE 1 END,
      t.name COLLATE NOCASE
  `).all().map(mapTagRow);
}

router.get('/', (req, res) => {
  res.json({ success: true, data: listTagsWithUsage() });
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ success: false, error: 'Tag 名称不能为空' });
  const parentId = body.parentId != null && body.parentId !== ''
    ? Number(body.parentId)
    : null;
  const db = getDb();
  const parentCheck = validateParentTag(db, parentId);
  if (!parentCheck.ok) {
    return res.status(parentCheck.status).json({ success: false, error: parentCheck.error });
  }
  if (findDuplicateTag(db, name, parentId)) {
    return res.status(409).json({ success: false, error: '同级标签名称已存在' });
  }
  const color = body.color ? String(body.color).trim() : null;
  const ts = now();
  const result = db.prepare(`
    INSERT INTO tags (name, color, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
  `).run(name, color, parentId, ts, ts);
  res.status(201).json({
    success: true,
    data: getTagById(result.lastInsertRowid),
  });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: '无效的 Tag ID' });
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ success: false, error: 'Tag 不存在' });
  const body = req.body || {};
  const name = body.name != null ? String(body.name).trim() : row.name;
  if (!name) return res.status(400).json({ success: false, error: 'Tag 名称不能为空' });
  const color = body.color != null ? (String(body.color).trim() || null) : row.color;
  if (findDuplicateTag(db, name, row.parent_id, id)) {
    return res.status(409).json({ success: false, error: '同级标签名称已存在' });
  }
  const ts = now();
  db.prepare('UPDATE tags SET name = ?, color = ?, updated_at = ? WHERE id = ?').run(name, color, ts, id);
  res.json({ success: true, data: getTagById(id) });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: '无效的 Tag ID' });
  }
  const db = getDb();
  const row = db.prepare('SELECT id FROM tags WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ success: false, error: 'Tag 不存在' });
  db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  res.json({ success: true, deleted: true });
});

module.exports = router;
