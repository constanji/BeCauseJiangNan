const express = require('express');
const { getDb, now } = require('../db/sqlite');
const { encrypt, decrypt } = require('../services/crypto');
const { testConnection } = require('../services/DatabaseService');
const { parseSsl, toConnectionConfig, connectionFromBody } = require('../lib/dataSourceConfig');
const { normalizeType, UnsupportedDbTypeError } = require('../lib/dbTypes');

const router = express.Router();

function mapDataSource(row) {
  const ssl = parseSsl(row.ssl_json);
  return {
    id: String(row.id),
    name: row.name,
    type: row.type || 'gaussdb',
    host: row.host,
    port: row.port,
    database: row.database_name,
    username: row.username,
    ssl,
    status: row.status,
    last_test_at: row.last_test_at,
    last_test_ok: row.last_test_ok ? true : false,
    last_test_error: row.last_test_error || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getOne(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id);
}

function defaultPort(type) {
  if (type === 'mysql') return 3306;
  if (type === 'postgresql') return 5432;
  return 8000;
}

function handleDbError(res, err) {
  if (err instanceof UnsupportedDbTypeError || err.code === 'UNSUPPORTED_DB_TYPE') {
    return res.status(501).json({ success: false, error: err.message, code: 'UNSUPPORTED_DB_TYPE' });
  }
  return res.status(500).json({ success: false, error: err.message });
}

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM data_sources ORDER BY id DESC').all();
  res.json({ success: true, data: rows.map(mapDataSource) });
});

router.post('/test', async (req, res) => {
  const body = req.body || {};
  const type = normalizeType(body.type);
  if (!type) return res.status(400).json({ success: false, error: '不支持的数据库类型' });
  if (!body.host || !body.port || !body.database || !body.username || !body.password) {
    return res.status(400).json({ success: false, error: '请填写完整的连接信息（含密码）' });
  }
  try {
    await testConnection(connectionFromBody({ ...body, type }), body.password);
    res.json({ success: true, message: '连接成功' });
  } catch (err) {
    handleDbError(res, err);
  }
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const type = normalizeType(body.type);
  if (!type) return res.status(400).json({ success: false, error: '不支持的数据库类型' });
  const ts = now();
  const info = getDb().prepare(`
    INSERT INTO data_sources (name, type, host, port, database_name, username, password_enc, ssl_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.name,
    type,
    body.host,
    Number(body.port || defaultPort(type)),
    body.database,
    body.username,
    encrypt(body.password || ''),
    body.ssl ? JSON.stringify(body.ssl) : null,
    body.status || 'active',
    ts,
    ts,
  );
  res.json({ success: true, data: mapDataSource(getOne(info.lastInsertRowid)) });
});

router.put('/:id', (req, res) => {
  const existing = getOne(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: '数据源不存在' });
  const body = req.body || {};
  const type = body.type != null ? normalizeType(body.type) : (existing.type || 'gaussdb');
  if (body.type != null && !type) {
    return res.status(400).json({ success: false, error: '不支持的数据库类型' });
  }
  const passwordEnc = body.password != null ? encrypt(body.password || '') : existing.password_enc;
  getDb().prepare(`
    UPDATE data_sources
    SET name = ?, type = ?, host = ?, port = ?, database_name = ?, username = ?, password_enc = ?, ssl_json = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    body.name ?? existing.name,
    type,
    body.host ?? existing.host,
    Number(body.port ?? existing.port),
    body.database ?? existing.database_name,
    body.username ?? existing.username,
    passwordEnc,
    body.ssl !== undefined ? JSON.stringify(body.ssl) : existing.ssl_json,
    body.status ?? existing.status,
    now(),
    req.params.id,
  );
  res.json({ success: true, data: mapDataSource(getOne(req.params.id)) });
});

router.delete('/:id', (req, res) => {
  const result = getDb().prepare('DELETE FROM data_sources WHERE id = ?').run(req.params.id);
  res.json({ success: true, deleted: result.changes > 0 });
});

router.post('/:id/test', async (req, res) => {
  const row = getOne(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: '数据源不存在' });
  try {
    const password = decrypt(row.password_enc);
    await testConnection(toConnectionConfig(row), password);
    getDb().prepare(`UPDATE data_sources SET status='active', last_test_at=?, last_test_ok=1, last_test_error=NULL, updated_at=? WHERE id = ?`).run(now(), now(), req.params.id);
    res.json({ success: true, message: '连接成功' });
  } catch (err) {
    getDb().prepare(`UPDATE data_sources SET status='inactive', last_test_at=?, last_test_ok=0, last_test_error=?, updated_at=? WHERE id = ?`).run(now(), err.message, now(), req.params.id);
    if (err instanceof UnsupportedDbTypeError || err.code === 'UNSUPPORTED_DB_TYPE') {
      return res.status(501).json({ success: false, error: err.message, code: 'UNSUPPORTED_DB_TYPE' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const row = getOne(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: '数据源不存在' });
  const data = mapDataSource(row);
  res.json({
    success: true,
    data: {
      ...data,
      password: undefined,
    },
  });
});

module.exports = router;
