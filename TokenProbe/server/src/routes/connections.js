const express = require('express');
const { getDb, now } = require('../db/sqlite');
const { ApiError, badRequest, notFound } = require('../lib/apiErrors');
const { clientFromDbRow, createBecauseClient } = require('../services/BecauseClient');

const router = express.Router();

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    email: row.email || '',
    agent_id: row.agent_id,
    data_source_id: row.data_source_id,
    encoding: row.encoding,
    hasPassword: Boolean(row.password),
    hasJwt: Boolean(row.jwt_token),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** 未保存连接时：用邮箱密码试登录并拉 Agent 列表 */
router.post('/preview-agents', async (req, res) => {
  const { baseUrl, email, password } = req.body || {};
  if (!baseUrl || !email || !password) {
    return badRequest(res, '请填写 Base URL、邮箱、密码');
  }
  try {
    const client = createBecauseClient({
      baseUrl: String(baseUrl).trim(),
      email: String(email).trim(),
      password: String(password),
    });
    await client.loginTest();
    const agents = await client.listAgents();
    const data = agents
      .map((a) => ({
        id: a.id || a.agent_id,
        name: a.name || a.id,
        description: a.description || '',
      }))
      .filter((a) => a.id);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM connections ORDER BY id DESC').all();
  res.json({ success: true, data: rows.map(mapRow) });
});

router.get('/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(Number(req.params.id));
  if (!row) return notFound(res, ApiError.CONNECTION_NOT_FOUND);
  return res.json({ success: true, data: mapRow(row) });
});

router.post('/', (req, res) => {
  const { name, baseUrl, email, password, agentId, dataSourceId, encoding, jwtToken } = req.body || {};
  if (!name || !baseUrl) {
    return badRequest(res, '请填写名称和 BeCause Base URL');
  }
  const em = email ? String(email).trim() : '';
  const pw = password != null ? String(password) : '';
  const jwt = jwtToken ? String(jwtToken).trim() : '';
  if (!em && !jwt) {
    return badRequest(res, '请填写登录邮箱+密码（推荐），或粘贴 JWT');
  }
  if (em && !pw) {
    return badRequest(res, '请填写登录密码');
  }
  const ts = now();
  const info = getDb()
    .prepare(
      `INSERT INTO connections (
        name, base_url, email, password, jwt_token, agent_id, data_source_id, encoding, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      String(name).trim(),
      String(baseUrl).trim().replace(/\/+$/, ''),
      em || null,
      pw || null,
      jwt || '',
      agentId ? String(agentId).trim() : null,
      dataSourceId ? String(dataSourceId).trim() : null,
      encoding || 'cl100k_base',
      ts,
      ts,
    );
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(info.lastInsertRowid);
  return res.json({ success: true, data: mapRow(row) });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id);
  if (!existing) return notFound(res, ApiError.CONNECTION_NOT_FOUND);
  const { name, baseUrl, email, password, agentId, dataSourceId, encoding, jwtToken } = req.body || {};

  const nextEmail = email !== undefined ? (email ? String(email).trim() : null) : existing.email;
  const nextPassword =
    password !== undefined && String(password).length > 0 ? String(password) : existing.password;
  const nextJwt =
    jwtToken !== undefined ? (jwtToken ? String(jwtToken).trim() : null) : existing.jwt_token;

  getDb()
    .prepare(
      `UPDATE connections SET name = ?, base_url = ?, email = ?, password = ?, jwt_token = ?,
       agent_id = ?, data_source_id = ?, encoding = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      name != null ? String(name).trim() : existing.name,
      baseUrl != null ? String(baseUrl).trim().replace(/\/+$/, '') : existing.base_url,
      nextEmail,
      nextPassword,
      nextJwt,
      agentId !== undefined ? (agentId ? String(agentId).trim() : null) : existing.agent_id,
      dataSourceId !== undefined
        ? dataSourceId
          ? String(dataSourceId).trim()
          : null
        : existing.data_source_id,
      encoding || existing.encoding,
      now(),
      id,
    );
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id);
  return res.json({ success: true, data: mapRow(row) });
});

router.delete('/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM connections WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return notFound(res, ApiError.CONNECTION_NOT_FOUND);
  return res.json({ success: true });
});

router.post('/:id/test', async (req, res) => {
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(Number(req.params.id));
  if (!row) return notFound(res, ApiError.CONNECTION_NOT_FOUND);
  try {
    const client = clientFromDbRow(row);
    const health = await client.healthish();
    const login = await client.loginTest();
    let agentChecked = false;
    if (row.agent_id) {
      await client.getAgent(row.agent_id);
      agentChecked = true;
    }
    return res.json({
      success: true,
      data: { ok: health.ok && login.ok, health, login, agentChecked },
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/:id/agents', async (req, res) => {
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(Number(req.params.id));
  if (!row) return notFound(res, ApiError.CONNECTION_NOT_FOUND);
  try {
    const client = clientFromDbRow(row);
    const agents = await client.listAgents();
    const data = agents.map((a) => ({
      id: a.id || a.agent_id,
      name: a.name || a.id,
      description: a.description || '',
    })).filter((a) => a.id);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
