const express = require('express');
const { getDb } = require('../db/sqlite');
const { decrypt } = require('../services/crypto');
const { listSchemas, listTables } = require('../services/DatabaseService');
const { toConnectionConfig } = require('../lib/dataSourceConfig');

const router = express.Router({ mergeParams: true });

function getSource(id) {
  return getDb().prepare('SELECT * FROM data_sources WHERE id = ?').get(id);
}

function creds(row) {
  return toConnectionConfig(row);
}

router.get('/schemas', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  try {
    const rows = await listSchemas(creds(source), decrypt(source.password_enc));
    res.json({ success: true, data: rows });
  } catch (err) {
    if (err.code === 'UNSUPPORTED_DB_TYPE' || err.name === 'UnsupportedDbTypeError') {
      return res.status(501).json({ success: false, error: err.message, code: 'UNSUPPORTED_DB_TYPE' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/schemas/:schemaName/tables', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  try {
    const rows = await listTables(creds(source), decrypt(source.password_enc), req.params.schemaName);
    res.json({ success: true, data: rows });
  } catch (err) {
    if (err.code === 'UNSUPPORTED_DB_TYPE' || err.name === 'UnsupportedDbTypeError') {
      return res.status(501).json({ success: false, error: err.message, code: 'UNSUPPORTED_DB_TYPE' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
