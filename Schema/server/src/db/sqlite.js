const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
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
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

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
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS light_schema_tags (
      light_schema_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (light_schema_id, tag_id),
      FOREIGN KEY(light_schema_id) REFERENCES light_schemas(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

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
  `);

  backfillColumnSearchText(database);
}

function getDb() {
  if (db) return db;
  const dir = dataDir();
  ensureDir(dir);
  const file = path.join(dir, 'schema.sqlite');
  db = new DatabaseSync(file);
  migrate(db);
  return db;
}

function now() {
  return new Date().toISOString();
}

module.exports = { getDb, now };
