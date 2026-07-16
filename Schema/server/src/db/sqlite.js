const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { buildColumnSearchText } = require('../lib/lightSchemaIndex');

let db;

function dataDir() {
  return path.resolve(process.env.SCHEMA_DATA_DIR || path.join(__dirname, '../../../data'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function hasColumn(database, table, column) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name === column);
}

const DB_SCHEMA_VERSION = 3;

function getDbSchemaVersion(database) {
  return Number(database.pragma('user_version', { simple: true }) || 0);
}

function setDbSchemaVersion(database, version) {
  database.pragma(`user_version = ${version}`);
}

function rebuildColumnSearchTextIndex(database) {
  const rows = database.prepare('SELECT id, content FROM light_schemas').all();
  if (rows.length === 0) return;
  const stmt = database.prepare('UPDATE light_schemas SET column_search_text = ? WHERE id = ?');
  const tx = database.transaction(() => {
    for (const row of rows) {
      stmt.run(buildColumnSearchText(row.content), row.id);
    }
  });
  tx();
}

function backfillColumnSearchText(database) {
  const rows = database.prepare(`
    SELECT id, content FROM light_schemas
    WHERE column_search_text IS NULL OR column_search_text = ''
  `).all();
  if (rows.length === 0) return;
  const stmt = database.prepare('UPDATE light_schemas SET column_search_text = ? WHERE id = ?');
  for (const row of rows) {
    stmt.run(buildColumnSearchText(row.content), row.id);
  }
}

function migrate(database) {
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS data_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      database_name TEXT NOT NULL,
      username TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      ssl_json TEXT,
      status TEXT NOT NULL DEFAULT 'inactive',
      last_test_at TEXT,
      last_test_ok INTEGER,
      last_test_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS light_schemas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_source_id INTEGER NOT NULL,
      schema_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      content TEXT NOT NULL,
      ddl_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(data_source_id, schema_name, table_name),
      FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT,
      parent_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(parent_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS light_schema_tags (
      light_schema_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (light_schema_id, tag_id),
      FOREIGN KEY(light_schema_id) REFERENCES light_schemas(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS catalog_meta (
      data_source_id INTEGER PRIMARY KEY,
      schemas_updated_at TEXT NOT NULL,
      FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS catalog_schemas (
      data_source_id INTEGER NOT NULL,
      schema_name TEXT NOT NULL,
      table_count INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (data_source_id, schema_name),
      FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS catalog_schema_meta (
      data_source_id INTEGER NOT NULL,
      schema_name TEXT NOT NULL,
      tables_updated_at TEXT,
      PRIMARY KEY (data_source_id, schema_name),
      FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS catalog_tables (
      data_source_id INTEGER NOT NULL,
      schema_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      PRIMARY KEY (data_source_id, schema_name, table_name),
      FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
    );
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_catalog_schemas_ds ON catalog_schemas(data_source_id);
    CREATE INDEX IF NOT EXISTS idx_catalog_tables_ds_schema ON catalog_tables(data_source_id, schema_name);
  `);

  migrateCatalogSchemasNullable(database);
  migrateTagsHierarchy(database);

  if (!hasColumn(database, 'light_schemas', 'column_search_text')) {
    database.exec('ALTER TABLE light_schemas ADD COLUMN column_search_text TEXT');
  }

  if (!hasColumn(database, 'data_sources', 'type')) {
    database.exec("ALTER TABLE data_sources ADD COLUMN type TEXT NOT NULL DEFAULT 'gaussdb'");
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_light_schemas_ds_schema ON light_schemas(data_source_id, schema_name);
    CREATE INDEX IF NOT EXISTS idx_light_schema_tags_tag ON light_schema_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_light_schemas_search ON light_schemas(column_search_text);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_root_name ON tags(name) WHERE parent_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_child_name ON tags(parent_id, name) WHERE parent_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id);
  `);

  backfillColumnSearchText(database);

  if (getDbSchemaVersion(database) < DB_SCHEMA_VERSION) {
    rebuildColumnSearchTextIndex(database);
    setDbSchemaVersion(database, DB_SCHEMA_VERSION);
  }
}

function migrateTagsHierarchy(database) {
  if (hasColumn(database, 'tags', 'parent_id')) return;
  database.exec(`
    CREATE TABLE tags_hierarchy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT,
      parent_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(parent_id) REFERENCES tags_hierarchy(id) ON DELETE CASCADE
    );
    INSERT INTO tags_hierarchy (id, name, color, parent_id, created_at, updated_at)
      SELECT id, name, color, NULL, created_at, updated_at FROM tags;
    DROP TABLE tags;
    ALTER TABLE tags_hierarchy RENAME TO tags;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_root_name ON tags(name) WHERE parent_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_child_name ON tags(parent_id, name) WHERE parent_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id);
  `);
}

function migrateCatalogSchemasNullable(database) {
  const row = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='catalog_schemas'",
  ).get();
  if (!row?.sql?.includes('table_count INTEGER NOT NULL')) return;
  database.exec(`
    DROP TABLE IF EXISTS catalog_tables;
    DROP TABLE IF EXISTS catalog_schema_meta;
    DROP TABLE IF EXISTS catalog_schemas;
    DROP TABLE IF EXISTS catalog_meta;
  `);
  database.exec(`
    CREATE TABLE catalog_meta (
      data_source_id INTEGER PRIMARY KEY,
      schemas_updated_at TEXT NOT NULL,
      FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
    );
    CREATE TABLE catalog_schemas (
      data_source_id INTEGER NOT NULL,
      schema_name TEXT NOT NULL,
      table_count INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (data_source_id, schema_name),
      FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
    );
    CREATE TABLE catalog_schema_meta (
      data_source_id INTEGER NOT NULL,
      schema_name TEXT NOT NULL,
      tables_updated_at TEXT,
      PRIMARY KEY (data_source_id, schema_name),
      FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
    );
    CREATE TABLE catalog_tables (
      data_source_id INTEGER NOT NULL,
      schema_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      PRIMARY KEY (data_source_id, schema_name, table_name),
      FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_catalog_schemas_ds ON catalog_schemas(data_source_id);
    CREATE INDEX idx_catalog_tables_ds_schema ON catalog_tables(data_source_id, schema_name);
  `);
}

function getDb() {
  if (db) return db;
  const dir = dataDir();
  ensureDir(dir);
  const file = path.join(dir, 'schema.sqlite');
  db = new Database(file);
  migrate(db);
  return db;
}

function initDatabase(database) {
  migrate(database);
  return database;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function now() {
  return new Date().toISOString();
}

module.exports = { getDb, now, initDatabase, closeDb };
