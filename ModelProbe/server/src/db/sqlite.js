const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

let db;

function dataDir() {
  return path.resolve(process.env.MODEL_PROBE_DATA_DIR || path.join(__dirname, '../../../data'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

function migrate(database) {
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'openai',
      base_url TEXT NOT NULL,
      api_key_enc TEXT NOT NULL,
      default_model TEXT,
      claimed_context_tokens INTEGER,
      azure_json TEXT,
      drop_params_json TEXT,
      add_params_json TEXT,
      extra_headers_json TEXT,
      last_test_at TEXT,
      last_test_ok INTEGER,
      last_test_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS probe_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL UNIQUE,
      endpoint_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL,
      report_json TEXT,
      status_logs_json TEXT,
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_probe_reports_endpoint ON probe_reports(endpoint_id);
    CREATE INDEX IF NOT EXISTS idx_probe_reports_created ON probe_reports(created_at DESC);
  `);
}

function getDb() {
  if (db) return db;
  const dir = dataDir();
  ensureDir(dir);
  const file = path.join(dir, 'modelprobe.sqlite');
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
