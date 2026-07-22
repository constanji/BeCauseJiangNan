const express = require('express');
const { config } = require('./config');
const {
  getPublicConfig,
  updateRuntimeConfig,
  clearRuntimeConfig,
  loadRuntimeConfig,
} = require('./runtimeConfig');
const { resetAuthCache } = require('./becauseClient');
const { logger } = require('./logger');

function isAdminAuthDisabled() {
  const secret = String(config.adminSecret || '').trim();
  return !secret || secret === 'change-me';
}

function requireAdminSecret(req, res, next) {
  if (isAdminAuthDisabled()) return next();
  const provided =
    req.get('x-esb-admin-secret') ||
    (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (provided !== config.adminSecret) {
    return res.status(401).json({ ok: false, error: '未授权：请提供正确的 ESB_ADMIN_SECRET' });
  }
  return next();
}

function createAdminRouter() {
  const router = express.Router();
  router.use(requireAdminSecret);

  router.get('/config', (_req, res) => {
    res.json({ ok: true, ...getPublicConfig(), authRequired: !isAdminAuthDisabled() });
  });

  router.put('/config', (req, res) => {
    try {
      const result = updateRuntimeConfig(req.body || {}, { resetAuthCache });
      res.json({ ok: true, ...result, authRequired: !isAdminAuthDisabled() });
    } catch (err) {
      logger.warn('ADMIN_CONFIG_UPDATE_FAILED', { message: err.message });
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.post('/config/reset', (_req, res) => {
    try {
      const result = clearRuntimeConfig({ resetAuthCache });
      res.json({ ok: true, ...result, authRequired: !isAdminAuthDisabled() });
    } catch (err) {
      logger.warn('ADMIN_CONFIG_RESET_FAILED', { message: err.message });
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = {
  createAdminRouter,
  requireAdminSecret,
  isAdminAuthDisabled,
  loadRuntimeConfig,
};
