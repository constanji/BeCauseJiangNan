const express = require('express');
const { getDb, now } = require('../db/sqlite');
const { encrypt } = require('../lib/crypto');
const { ApiError, badRequest, notFound } = require('../lib/apiErrors');
const { formatProviderError } = require('../lib/formatProviderError');
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
  if (!row) return notFound(res, ApiError.ENDPOINT_NOT_FOUND);
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
    return badRequest(res, ApiError.ENDPOINT_FIELDS_REQUIRED);
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
  if (!row) return notFound(res, ApiError.ENDPOINT_NOT_FOUND);

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
  if (!result.changes) return notFound(res, ApiError.ENDPOINT_NOT_FOUND);
  res.json({ success: true });
});

router.post('/:id/copy', (req, res) => {
  const row = getDb().prepare('SELECT * FROM endpoints WHERE id = ?').get(req.params.id);
  if (!row) return notFound(res, ApiError.ENDPOINT_NOT_FOUND);
  if (row.name === '__imported__') {
    return badRequest(res, ApiError.IMPORT_ENDPOINT_FORBIDDEN);
  }

  const ts = now();
  const baseName = String(row.name || '端点').replace(/\s*副本(\d+)?$/, '');
  let newName = `${baseName} 副本`;
  const exists = getDb().prepare('SELECT id FROM endpoints WHERE name = ?').get(newName);
  if (exists) {
    let n = 2;
    while (getDb().prepare('SELECT id FROM endpoints WHERE name = ?').get(`${baseName} 副本${n}`)) {
      n += 1;
    }
    newName = `${baseName} 副本${n}`;
  }

  const result = getDb()
    .prepare(`
      INSERT INTO endpoints (
        name, type, base_url, api_key_enc, default_model, claimed_context_tokens,
        azure_json, drop_params_json, add_params_json, extra_headers_json,
        last_test_at, last_test_ok, last_test_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `)
    .run(
      newName,
      row.type,
      row.base_url,
      row.api_key_enc,
      row.default_model,
      row.claimed_context_tokens,
      row.azure_json,
      row.drop_params_json,
      row.add_params_json,
      row.extra_headers_json,
      ts,
      ts,
    );

  const created = getDb().prepare('SELECT * FROM endpoints WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, data: rowToPublic(created) });
});

router.post('/test', async (req, res) => {
  const b = req.body || {};
  const model = b.model || b.default_model;
  if (!model) {
    return badRequest(res, ApiError.MODEL_REQUIRED);
  }
  if (!b.base_url) {
    return badRequest(res, '请填写服务地址 (Base URL)');
  }

  let apiKeyEnc = null;
  if (b.api_key) {
    apiKeyEnc = encrypt(b.api_key);
  } else if (b.endpointId != null) {
    const row = getDb().prepare('SELECT * FROM endpoints WHERE id = ?').get(b.endpointId);
    if (!row) return notFound(res, ApiError.ENDPOINT_NOT_FOUND);
    apiKeyEnc = row.api_key_enc;
  }
  if (!apiKeyEnc) {
    return badRequest(res, '测连需要 API Key（新建请填写；编辑可留空沿用已保存密钥）');
  }

  const endpoint = {
    id: b.endpointId ?? null,
    name: b.name || 'draft',
    type: b.type || 'openai',
    base_url: b.base_url,
    api_key_enc: apiKeyEnc,
    default_model: model,
    azure: b.azure || null,
    dropParams: Array.isArray(b.dropParams) ? b.dropParams : [],
    addParams: b.addParams && typeof b.addParams === 'object' ? b.addParams : {},
    extra_headers: b.extra_headers && typeof b.extra_headers === 'object' ? b.extra_headers : {},
  };

  try {
    const result = await testConnection({ endpoint, model });
    if (b.endpointId != null) {
      getDb()
        .prepare('UPDATE endpoints SET last_test_at = ?, last_test_ok = 1, last_test_error = NULL WHERE id = ?')
        .run(now(), b.endpointId);
    }
    res.json({ success: true, data: result });
  } catch (err) {
    const detail = formatProviderError(err, { model, baseURL: endpoint.base_url });
    if (b.endpointId != null) {
      getDb()
        .prepare('UPDATE endpoints SET last_test_at = ?, last_test_ok = 0, last_test_error = ? WHERE id = ?')
        .run(now(), detail, b.endpointId);
    }
    res.status(502).json({
      success: false,
      error: detail,
      status: err?.status ?? err?.statusCode,
      providerMessage: err?.error?.message || err?.message,
      model,
      baseURL: endpoint.base_url,
    });
  }
});

router.post('/:id/test', async (req, res) => {
  const row = getDb().prepare('SELECT * FROM endpoints WHERE id = ?').get(req.params.id);
  if (!row) return notFound(res, ApiError.ENDPOINT_NOT_FOUND);

  const b = req.body || {};
  const saved = parseEndpointRow(row);
  const model = b.model || b.default_model || saved.default_model;

  if (!model) {
    return badRequest(res, ApiError.MODEL_REQUIRED);
  }

  // 表单未保存改动优先：用 body 覆盖 DB，api_key 留空则沿用已保存密钥
  const endpoint = {
    ...saved,
    type: b.type ?? saved.type,
    base_url: b.base_url ?? saved.base_url,
    default_model: model,
    azure: b.azure !== undefined ? b.azure : saved.azure,
    dropParams: b.dropParams !== undefined ? b.dropParams : saved.dropParams,
    addParams: b.addParams !== undefined ? b.addParams : saved.addParams,
    extra_headers: b.extra_headers !== undefined ? b.extra_headers : saved.extra_headers,
    api_key_enc: b.api_key ? encrypt(b.api_key) : saved.api_key_enc,
  };

  try {
    const result = await testConnection({ endpoint, model });
    getDb()
      .prepare('UPDATE endpoints SET last_test_at = ?, last_test_ok = 1, last_test_error = NULL WHERE id = ?')
      .run(now(), req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    const detail = formatProviderError(err, { model, baseURL: endpoint.base_url });
    getDb()
      .prepare('UPDATE endpoints SET last_test_at = ?, last_test_ok = 0, last_test_error = ? WHERE id = ?')
      .run(now(), detail, req.params.id);
    res.status(502).json({
      success: false,
      error: detail,
      status: err?.status ?? err?.statusCode,
      providerMessage: err?.error?.message || err?.message,
      model,
      baseURL: endpoint.base_url,
    });
  }
});

module.exports = router;
