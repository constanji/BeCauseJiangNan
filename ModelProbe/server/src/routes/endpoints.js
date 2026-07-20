const express = require('express');
const { getDb, now } = require('../db/sqlite');
const { encrypt } = require('../lib/crypto');
const { parseEndpointRow } = require('../services/RequestAssembler');
const { testConnection } = require('../services/MetricsCollector');

const router = express.Router();

function rowToPublic(row) {
  const ep = parseEndpointRow(row);
  return {
    id: ep.id,
    name: ep.name,
    type: ep.type,
    base_url: ep.base_url,
    default_model: ep.default_model,
    claimed_context_tokens: ep.claimed_context_tokens,
    azure: ep.azure,
    dropParams: ep.dropParams,
    addParams: ep.addParams,
    extra_headers: ep.extra_headers,
    last_test_at: ep.last_test_at,
    last_test_ok: ep.last_test_ok,
    last_test_error: ep.last_test_error,
    created_at: ep.created_at,
    updated_at: ep.updated_at,
    hasApiKey: Boolean(ep.api_key_enc),
  };
}

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM endpoints ORDER BY id DESC').all();
  res.json({ success: true, data: rows.map(rowToPublic) });
});

router.get('/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM endpoints WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, data: rowToPublic(row) });
});

router.post('/', (req, res) => {
  const {
    name,
    type = 'openai',
    base_url,
    api_key,
    default_model,
    claimed_context_tokens,
    azure,
    dropParams,
    addParams,
    extra_headers,
  } = req.body || {};

  if (!name || !base_url || !api_key) {
    return res.status(400).json({ success: false, error: 'name, base_url, api_key required' });
  }

  const ts = now();
  const result = getDb()
    .prepare(`
      INSERT INTO endpoints (
        name, type, base_url, api_key_enc, default_model, claimed_context_tokens,
        azure_json, drop_params_json, add_params_json, extra_headers_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      name,
      type,
      base_url,
      encrypt(api_key),
      default_model || null,
      claimed_context_tokens ?? null,
      azure ? JSON.stringify(azure) : null,
      dropParams ? JSON.stringify(dropParams) : null,
      addParams ? JSON.stringify(addParams) : null,
      extra_headers ? JSON.stringify(extra_headers) : null,
      ts,
      ts,
    );

  const row = getDb().prepare('SELECT * FROM endpoints WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, data: rowToPublic(row) });
});

router.put('/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM endpoints WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'Not found' });

  const b = req.body || {};
  const ts = now();
  const apiKeyEnc = b.api_key ? encrypt(b.api_key) : row.api_key_enc;

  getDb()
    .prepare(`
      UPDATE endpoints SET
        name = ?, type = ?, base_url = ?, api_key_enc = ?,
        default_model = ?, claimed_context_tokens = ?,
        azure_json = ?, drop_params_json = ?, add_params_json = ?,
        extra_headers_json = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(
      b.name ?? row.name,
      b.type ?? row.type,
      b.base_url ?? row.base_url,
      apiKeyEnc,
      b.default_model ?? row.default_model,
      b.claimed_context_tokens ?? row.claimed_context_tokens,
      b.azure != null ? JSON.stringify(b.azure) : row.azure_json,
      b.dropParams != null ? JSON.stringify(b.dropParams) : row.drop_params_json,
      b.addParams != null ? JSON.stringify(b.addParams) : row.add_params_json,
      b.extra_headers != null ? JSON.stringify(b.extra_headers) : row.extra_headers_json,
      ts,
      req.params.id,
    );

  const updated = getDb().prepare('SELECT * FROM endpoints WHERE id = ?').get(req.params.id);
  res.json({ success: true, data: rowToPublic(updated) });
});

router.delete('/:id', (req, res) => {
  const result = getDb().prepare('DELETE FROM endpoints WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true });
});

router.post('/:id/test', async (req, res) => {
  const row = getDb().prepare('SELECT * FROM endpoints WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'Not found' });

  const endpoint = parseEndpointRow(row);
  const model = req.body?.model || endpoint.default_model;

  if (!model) {
    return res.status(400).json({ success: false, error: 'model required' });
  }

  try {
    const result = await testConnection({ endpoint, model });
    getDb()
      .prepare('UPDATE endpoints SET last_test_at = ?, last_test_ok = 1, last_test_error = NULL WHERE id = ?')
      .run(now(), req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    getDb()
      .prepare('UPDATE endpoints SET last_test_at = ?, last_test_ok = 0, last_test_error = ? WHERE id = ?')
      .run(now(), err.message, req.params.id);
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
