const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const dataSources = require('./routes/dataSources');
const catalog = require('./routes/catalog');
const lightSchema = require('./routes/lightSchema');
const exportRoutes = require('./routes/export');
const tags = require('./routes/tags');
const lightSchemaExport = require('./routes/lightSchemaExport');
const lightSchemaCatalog = require('./routes/lightSchemaCatalog');

const app = express();
const port = Number(process.env.PORT || 4100);
const host = process.env.HOST || '0.0.0.0';
const webDist = path.resolve(__dirname, '../../web/dist');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (req, res) => res.json({ success: true, ok: true }));
app.use('/api/tags', tags);
app.use('/api/light-schemas', lightSchemaExport);
app.use('/api/light-schemas', lightSchemaCatalog);
app.use('/api/data-sources', dataSources);
app.use('/api/data-sources/:id', catalog);
app.use('/api/data-sources/:id/light-schema', lightSchema);
app.use('/api/data-sources/:id/light-schemas', lightSchema);
app.use('/api/data-sources/:id/export', exportRoutes);

if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(port, host, () => {
  console.log(`[Schema] listening on http://localhost:${port}`);
});
