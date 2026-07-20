const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const logger = require('./lib/logger');
const { unauthorized } = require('./lib/apiErrors');
const endpoints = require('./routes/endpoints');
const probe = require('./routes/probe');
const capability = require('./routes/capability');
const reports = require('./routes/reports');

const app = express();
const port = Number(process.env.PORT || 4200);
const host = process.env.HOST || '0.0.0.0';
const webDist = path.resolve(__dirname, '../../web/dist');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '4mb' }));

function authMiddleware(req, res, next) {
  if (req.path === '/api/health') return next();
  const secret = process.env.MODEL_PROBE_SECRET;
  // 空 / 开发默认值 / 示例占位 change-me：不鉴权（便于首次部署）
  const skipAuth =
    !secret ||
    secret === 'modelprobe-dev-secret' ||
    secret === 'change-me';
  if (skipAuth) {
    if (process.env.NODE_ENV === 'production' && (!secret || secret === 'change-me')) {
      logger.warn('MODEL_PROBE_SECRET 仍为默认值，API 未启用鉴权；生产请改为随机串');
    }
    return next();
  }
  const header = req.headers['x-model-probe-secret'];
  if (header !== secret) {
    return unauthorized(res);
  }
  return next();
}

app.use(authMiddleware);

app.use((req, res, next) => {
  if (!req.path.startsWith('/api') || req.path === '/api/health') return next();
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, ok: true, service: 'model-probe' });
});

app.use('/api/endpoints', endpoints);
app.use('/api/probe', probe);
app.use('/api/capability', capability);
app.use('/api/reports', reports);

if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(port, host, () => {
  logger.info(`listening on http://${host}:${port}`, {
    nodeEnv: process.env.NODE_ENV || 'development',
    dataDir: process.env.MODEL_PROBE_DATA_DIR || '(default)',
  });
});
