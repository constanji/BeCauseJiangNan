const { getDb, now } = require('../db/sqlite');
const { encrypt } = require('../services/crypto');

function mockEnabled() {
  if (process.env.SCHEMA_ENABLE_MOCK === '0' || process.env.SCHEMA_ENABLE_MOCK === 'false') return false;
  if (process.env.SCHEMA_ENABLE_MOCK === '1' || process.env.SCHEMA_ENABLE_MOCK === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

function seedMockDataSource() {
  if (!mockEnabled()) return null;
  const db = getDb();
  const existing = db.prepare(`
    SELECT id FROM data_sources
    WHERE type = 'mock' AND host = 'mock.local' AND database_name = 'mock_warehouse'
  `).get();
  if (existing) return existing.id;

  const ts = now();
  const info = db.prepare(`
    INSERT INTO data_sources (
      name, type, host, port, database_name, username, password_enc, ssl_json,
      status, last_test_at, last_test_ok, last_test_error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Mock GaussDB 数仓',
    'mock',
    'mock.local',
    0,
    'mock_warehouse',
    'mock',
    encrypt('mock'),
    null,
    'active',
    ts,
    1,
    null,
    ts,
    ts,
  );
  return info.lastInsertRowid;
}

module.exports = { seedMockDataSource, mockEnabled };
