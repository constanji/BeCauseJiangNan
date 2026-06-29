const { getDb, now } = require('../db/sqlite');
const { listSchemas, listTables } = require('./DatabaseService');

function readTableCountFromDb(value) {
  if (value == null) return null;
  return Number(value);
}

function toDbTableCount(value) {
  if (value == null) return null;
  return Number(value);
}

function schemaIsSelectable(entry) {
  return entry.tableCount == null || entry.tableCount > 0;
}

function resolveRefreshSchemaName(schemas, preferred) {
  if (preferred && schemas.some((s) => s.schemaName === preferred)) {
    return preferred;
  }
  const pool = schemas.filter(schemaIsSelectable);
  const candidates = pool.length > 0 ? pool : schemas;
  return candidates.find((s) => s.schemaName === 'public')?.schemaName
    || candidates[0]?.schemaName
    || '';
}

function readSchemasFromCache(dataSourceId) {
  const db = getDb();
  const meta = db.prepare('SELECT schemas_updated_at FROM catalog_meta WHERE data_source_id = ?').get(dataSourceId);
  if (!meta) return null;
  const rows = db.prepare(`
    SELECT schema_name, table_count FROM catalog_schemas
    WHERE data_source_id = ?
    ORDER BY schema_name
  `).all(dataSourceId);
  if (rows.length === 0) return null;
  return {
    schemas: rows.map((r) => ({
      schemaName: r.schema_name,
      tableCount: readTableCountFromDb(r.table_count),
    })),
    cachedAt: meta.schemas_updated_at,
  };
}

function writeSchemasToCache(dataSourceId, schemas) {
  const db = getDb();
  const ts = now();
  const clearSchemas = db.prepare('DELETE FROM catalog_schemas WHERE data_source_id = ?');
  const insertSchema = db.prepare(`
    INSERT INTO catalog_schemas (data_source_id, schema_name, table_count, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const upsertMeta = db.prepare(`
    INSERT INTO catalog_meta (data_source_id, schemas_updated_at)
    VALUES (?, ?)
    ON CONFLICT(data_source_id) DO UPDATE SET schemas_updated_at = excluded.schemas_updated_at
  `);
  const tx = db.transaction(() => {
    clearSchemas.run(dataSourceId);
    for (const s of schemas) {
      insertSchema.run(
        dataSourceId,
        s.schemaName,
        toDbTableCount(s.tableCount),
        ts,
      );
    }
    upsertMeta.run(dataSourceId, ts);
  });
  tx();
  return ts;
}

function clearCatalogCache(dataSourceId) {
  const db = getDb();
  db.prepare('DELETE FROM catalog_tables WHERE data_source_id = ?').run(dataSourceId);
  db.prepare('DELETE FROM catalog_schema_meta WHERE data_source_id = ?').run(dataSourceId);
  db.prepare('DELETE FROM catalog_schemas WHERE data_source_id = ?').run(dataSourceId);
  db.prepare('DELETE FROM catalog_meta WHERE data_source_id = ?').run(dataSourceId);
}

function clearSchemaTablesCache(dataSourceId, schemaName) {
  const db = getDb();
  db.prepare('DELETE FROM catalog_tables WHERE data_source_id = ? AND schema_name = ?').run(dataSourceId, schemaName);
  db.prepare('DELETE FROM catalog_schema_meta WHERE data_source_id = ? AND schema_name = ?').run(dataSourceId, schemaName);
}

function hasTablesCache(dataSourceId, schemaName) {
  const row = getDb().prepare(`
    SELECT tables_updated_at FROM catalog_schema_meta
    WHERE data_source_id = ? AND schema_name = ? AND tables_updated_at IS NOT NULL
  `).get(dataSourceId, schemaName);
  return Boolean(row);
}

function readTablesFromCache(dataSourceId, schemaName) {
  if (!hasTablesCache(dataSourceId, schemaName)) return null;
  const meta = getDb().prepare(`
    SELECT tables_updated_at FROM catalog_schema_meta
    WHERE data_source_id = ? AND schema_name = ?
  `).get(dataSourceId, schemaName);
  const rows = getDb().prepare(`
    SELECT table_name FROM catalog_tables
    WHERE data_source_id = ? AND schema_name = ?
    ORDER BY table_name
  `).all(dataSourceId, schemaName);
  return {
    tables: rows.map((r) => r.table_name),
    cachedAt: meta?.tables_updated_at || null,
  };
}

function writeTablesToCache(dataSourceId, schemaName, tables) {
  const db = getDb();
  const ts = now();
  const del = db.prepare('DELETE FROM catalog_tables WHERE data_source_id = ? AND schema_name = ?');
  const insert = db.prepare(`
    INSERT INTO catalog_tables (data_source_id, schema_name, table_name)
    VALUES (?, ?, ?)
  `);
  const upsertMeta = db.prepare(`
    INSERT INTO catalog_schema_meta (data_source_id, schema_name, tables_updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(data_source_id, schema_name) DO UPDATE SET tables_updated_at = excluded.tables_updated_at
  `);
  const tx = db.transaction(() => {
    del.run(dataSourceId, schemaName);
    for (const tableName of tables) {
      insert.run(dataSourceId, schemaName, tableName);
    }
    upsertMeta.run(dataSourceId, schemaName, ts);
  });
  tx();
  return ts;
}

async function fetchSchemasRemote(config, password) {
  return listSchemas(config, password);
}

async function fetchTablesRemote(config, password, schemaName) {
  return listTables(config, password, schemaName);
}

async function getSchemas(dataSourceId, config, password, source = 'auto') {
  if (source !== 'remote') {
    const cached = readSchemasFromCache(dataSourceId);
    if (cached) {
      return { data: cached.schemas, meta: { source: 'sqlite', cachedAt: cached.cachedAt } };
    }
    if (source === 'sqlite') {
      return { data: [], meta: { source: 'sqlite', cachedAt: null } };
    }
  }
  const rows = await fetchSchemasRemote(config, password);
  const cachedAt = writeSchemasToCache(dataSourceId, rows);
  return { data: rows, meta: { source: 'remote', cachedAt } };
}

async function getTables(dataSourceId, config, password, schemaName, source = 'auto') {
  if (source !== 'remote') {
    const cached = readTablesFromCache(dataSourceId, schemaName);
    if (cached) {
      return { data: cached.tables, meta: { source: 'sqlite', cachedAt: cached.cachedAt } };
    }
    if (source === 'sqlite') {
      return { data: [], meta: { source: 'sqlite', cachedAt: null } };
    }
  }
  const rows = await fetchTablesRemote(config, password, schemaName);
  const sorted = rows.slice().sort();
  const cachedAt = writeTablesToCache(dataSourceId, schemaName, sorted);
  return { data: sorted, meta: { source: 'remote', cachedAt } };
}

async function refreshCatalog(dataSourceId, config, password, currentSchemaName) {
  clearCatalogCache(dataSourceId);
  const { data: schemas, meta } = await getSchemas(dataSourceId, config, password, 'remote');
  const targetSchema = resolveRefreshSchemaName(schemas, currentSchemaName);
  let tablesMeta = null;
  let tables = [];
  if (targetSchema) {
    try {
      const tablesResult = await getTables(dataSourceId, config, password, targetSchema, 'remote');
      tables = tablesResult.data;
      tablesMeta = tablesResult.meta;
    } catch (err) {
      tablesMeta = { source: 'remote', error: err.message };
    }
  }
  return {
    schemas,
    schemasMeta: meta,
    tables,
    tablesMeta,
    schemaName: targetSchema,
  };
}

async function refreshSchemaTables(dataSourceId, config, password, schemaName) {
  clearSchemaTablesCache(dataSourceId, schemaName);
  return getTables(dataSourceId, config, password, schemaName, 'remote');
}

module.exports = {
  getSchemas,
  getTables,
  refreshCatalog,
  refreshSchemaTables,
  clearCatalogCache,
  readSchemasFromCache,
};
