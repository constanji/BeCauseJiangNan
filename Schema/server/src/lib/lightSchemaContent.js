const { getDb, now } = require('../db/sqlite');
const { buildColumnSearchText } = require('./lightSchemaIndex');
const { toDDL } = require('../services/DatabaseService');

function normalizeNullable(value) {
  if (value === true || value === 'YES') return true;
  if (value === false || value === 'NO') return false;
  return Boolean(value);
}

function validateAndNormalizeContent(content, expectedTableName) {
  if (!content || typeof content !== 'object') {
    throw new Error('content 无效');
  }
  const tableName = String(content.tableName || expectedTableName || '').trim();
  if (!tableName) throw new Error('tableName 不能为空');
  if (!Array.isArray(content.columns) || content.columns.length === 0) {
    throw new Error('至少保留一列');
  }

  const names = new Set();
  const columns = content.columns.map((col, idx) => {
    const name = String(col?.name || '').trim();
    const type = String(col?.type || '').trim();
    if (!name) throw new Error(`第 ${idx + 1} 列缺少列名`);
    if (!type) throw new Error(`列 ${name} 缺少类型`);
    if (names.has(name)) throw new Error(`列名重复: ${name}`);
    names.add(name);
    return {
      name,
      type,
      nullable: normalizeNullable(col?.nullable),
      description: String(col?.description || ''),
      sampleValues: Array.isArray(col?.sampleValues)
        ? col.sampleValues.map((v) => String(v ?? '')).filter((v) => v.length > 0)
        : [],
    };
  });

  const primaryKeys = Array.isArray(content.primaryKeys)
    ? [...new Set(content.primaryKeys.map((k) => String(k)).filter((k) => names.has(k)))]
    : [];

  return { tableName, columns, primaryKeys };
}

function getLightSchemaRow(id) {
  return getDb().prepare(`
    SELECT ls.*, ds.name AS data_source_name
    FROM light_schemas ls
    JOIN data_sources ds ON ds.id = ls.data_source_id
    WHERE ls.id = ?
  `).get(id);
}

function updateLightSchemaById(id, content) {
  const row = getLightSchemaRow(id);
  if (!row) throw new Error('未找到 LightSchema');
  const normalized = validateAndNormalizeContent(content, row.table_name);
  const ddlText = toDDL(normalized);
  const searchText = buildColumnSearchText(normalized);
  const updatedAt = now();
  getDb().prepare(`
    UPDATE light_schemas
    SET content = ?, ddl_text = ?, column_search_text = ?, updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(normalized), ddlText, searchText, updatedAt, id);
  return { row, normalized, ddlText, updatedAt };
}

function deleteLightSchemaById(id) {
  const result = getDb().prepare('DELETE FROM light_schemas WHERE id = ?').run(id);
  if (result.changes === 0) throw new Error('未找到 LightSchema');
  return true;
}

module.exports = {
  validateAndNormalizeContent,
  updateLightSchemaById,
  deleteLightSchemaById,
  getLightSchemaRow,
};
