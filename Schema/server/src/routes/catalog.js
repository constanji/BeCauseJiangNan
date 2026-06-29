const express = require('express');
const { getDb } = require('../db/sqlite');
const { decrypt } = require('../services/crypto');
const {
  getSchemas,
  getTables,
  refreshCatalog,
  refreshSchemaTables,
} = require('../services/CatalogCacheService');
const { toConnectionConfig } = require('../lib/dataSourceConfig');

const router = express.Router({ mergeParams: true });

function getSource(id) {
  return getDb().prepare('SELECT * FROM data_sources WHERE id = ?').get(id);
}

function creds(row) {
  return toConnectionConfig(row);
}

function parseSource(value) {
  const s = String(value || 'auto').toLowerCase();
  if (s === 'remote' || s === 'sqlite') return s;
  return 'auto';
}

function handleDbError(err, res) {
  if (err.code === 'UNSUPPORTED_DB_TYPE' || err.name === 'UnsupportedDbTypeError') {
    return res.status(501).json({ success: false, error: err.message, code: 'UNSUPPORTED_DB_TYPE' });
  }
  return res.status(500).json({ success: false, error: err.message });
}

router.get('/schemas', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  try {
    const result = await getSchemas(
      Number(source.id),
      creds(source),
      decrypt(source.password_enc),
      parseSource(req.query.source),
    );
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    handleDbError(err, res);
  }
});

router.get('/schemas/:schemaName/tables', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  try {
    const result = await getTables(
      Number(source.id),
      creds(source),
      decrypt(source.password_enc),
      req.params.schemaName,
      parseSource(req.query.source),
    );
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    handleDbError(err, res);
  }
});

router.post('/catalog/refresh', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  const body = req.body || {};
  const currentSchemaName = typeof body.schemaName === 'string' ? body.schemaName : '';
  try {
    const result = await refreshCatalog(
      Number(source.id),
      creds(source),
      decrypt(source.password_enc),
      currentSchemaName,
    );
    res.json({
      success: true,
      data: {
        schemas: result.schemas,
        tables: result.tables,
        schemaName: result.schemaName || null,
      },
      meta: {
        schemas: result.schemasMeta,
        tables: result.tablesMeta,
      },
    });
  } catch (err) {
    handleDbError(err, res);
  }
});

router.post('/catalog/refresh-schema/:schemaName', async (req, res) => {
  const source = getSource(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  try {
    const result = await refreshSchemaTables(
      Number(source.id),
      creds(source),
      decrypt(source.password_enc),
      req.params.schemaName,
    );
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    handleDbError(err, res);
  }
});

module.exports = router;
