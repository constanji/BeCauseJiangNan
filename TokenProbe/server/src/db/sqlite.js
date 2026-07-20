const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

let db;

function dataDir() {
  return path.resolve(process.env.TOKEN_PROBE_DATA_DIR || path.join(__dirname, '../../../data'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

function hasColumn(database, table, column) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function migrate(database) {
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      email TEXT,
      password TEXT,
      jwt_token TEXT,
      agent_id TEXT,
      data_source_id TEXT,
      encoding TEXT NOT NULL DEFAULT 'cl100k_base',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS probe_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL UNIQUE,
      connection_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL,
      report_json TEXT,
      status_logs_json TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_token_reports_created ON probe_reports(created_at DESC);
  `);

  // 兼容旧库：仅有 jwt_token 时补 email/password 列
  if (!hasColumn(database, 'connections', 'email')) {
    database.exec('ALTER TABLE connections ADD COLUMN email TEXT');
  }
  if (!hasColumn(database, 'connections', 'password')) {
    database.exec('ALTER TABLE connections ADD COLUMN password TEXT');
  }
}

function getDb() {
  if (db) return db;
  const dir = dataDir();
  ensureDir(dir);
  const file = path.join(dir, 'tokenprobe.sqlite');
  db = new Database(file);
  migrate(db);
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, now, closeDb, dataDir };
