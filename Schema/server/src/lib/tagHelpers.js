function formatTagDisplayName(name, parentName) {
  return parentName ? `${parentName}：${name}` : name;
}

function mapTagRow(row) {
  const parentName = row.parent_name || null;
  return {
    id: row.id,
    name: row.name,
    displayName: formatTagDisplayName(row.name, parentName),
    parentId: row.parent_id ?? null,
    parentName,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usageCount: Number(row.usage_count || 0),
    childCount: Number(row.child_count || 0),
  };
}

const TAG_JOIN_SELECT = `
  t.id, t.name, t.color, t.parent_id, t.created_at, t.updated_at,
  p.name AS parent_name
`;

function fetchTagsForSchemaIds(db, ids) {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT lst.light_schema_id, ${TAG_JOIN_SELECT}
    FROM light_schema_tags lst
    JOIN tags t ON t.id = lst.tag_id
    LEFT JOIN tags p ON p.id = t.parent_id
    WHERE lst.light_schema_id IN (${placeholders})
    ORDER BY COALESCE(p.name, t.name) COLLATE NOCASE, t.name COLLATE NOCASE
  `).all(...ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.light_schema_id)) map.set(row.light_schema_id, []);
    const parentName = row.parent_name || null;
    map.get(row.light_schema_id).push({
      id: row.id,
      name: row.name,
      displayName: formatTagDisplayName(row.name, parentName),
      parentId: row.parent_id ?? null,
      parentName,
      color: row.color,
    });
  }
  return map;
}

function validateParentTag(db, parentId) {
  if (parentId == null) return { ok: true };
  if (!Number.isInteger(parentId) || parentId <= 0) {
    return { ok: false, status: 400, error: '无效的父标签 ID' };
  }
  const parent = db.prepare('SELECT id, parent_id FROM tags WHERE id = ?').get(parentId);
  if (!parent) return { ok: false, status: 404, error: '父标签不存在' };
  if (parent.parent_id != null) {
    return { ok: false, status: 400, error: '子标签下不能再创建子标签' };
  }
  return { ok: true, parent };
}

function findDuplicateTag(db, name, parentId, excludeId = null) {
  if (parentId != null) {
    const sql = excludeId
      ? 'SELECT id FROM tags WHERE parent_id = ? AND name = ? AND id <> ?'
      : 'SELECT id FROM tags WHERE parent_id = ? AND name = ?';
    const params = excludeId ? [parentId, name, excludeId] : [parentId, name];
    return db.prepare(sql).get(...params);
  }
  const sql = excludeId
    ? 'SELECT id FROM tags WHERE parent_id IS NULL AND name = ? AND id <> ?'
    : 'SELECT id FROM tags WHERE parent_id IS NULL AND name = ?';
  const params = excludeId ? [name, excludeId] : [name];
  return db.prepare(sql).get(...params);
}

module.exports = {
  TAG_JOIN_SELECT,
  formatTagDisplayName,
  mapTagRow,
  fetchTagsForSchemaIds,
  validateParentTag,
  findDuplicateTag,
};
