const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const logger = require('./lib/logger');
const dataSources = require('./routes/dataSources');
const catalog = require('./routes/catalog');
const lightSchema = require('./routes/lightSchema');
const exportRoutes = require('./routes/export');
const tags = require('./routes/tags');
const lightSchemaExport = require('./routes/lightSchemaExport');
const lightSchemaCatalog = require('./routes/lightSchemaCatalog');
const { seedMockDataSource, mockEnabled } = require('./mock/seedMockDataSource');

const app = express();
const port = Number(process.env.PORT || 4100);
const host = process.env.HOST || '0.0.0.0';
const webDist = path.resolve(__dirname, '../../web/dist');

app.use(cors({ origin: true, credentials: true, exposedHeaders: ['X-Export-Mode', 'X-Export-Skipped'] }));
app.use(express.json({ limit: '8mb' }));

app.use((req, res, next) => {
  if (!req.path.startsWith('/api') || req.path === '/api/health') return next();
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});

app.get('/api/health', (req, res) => res.json({ success: true, ok: true }));
app.use('/api/tags', tags);
app.use('/api/light-schemas', lightSchemaExport);
app.use('/api/light-schemas', lightSchemaCatalog);
app.use('/api/data-sources', dataSources);
app.use('/api/data-sources/:id', catalog);
app.use('/api/data-sources/:id/light-schema', lightSchema);
app.use('/api/data-sources/:id/light-schemas', lightSchema);
app.use('/api/data-sources/:id/export', exportRoutes);

const mockDataSourceId = seedMockDataSource();
if (mockDataSourceId) {
  logger.info(`mock data source ready · id=${mockDataSourceId}`, {
    enabled: mockEnabled(),
  });
}

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
    dataDir: process.env.SCHEMA_DATA_DIR || '(default)',
    logLevel: process.env.SCHEMA_LOG_LEVEL || 'info',
  });
});
