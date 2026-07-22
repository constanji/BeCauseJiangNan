const express = require('express');
const path = require('path');
const { config, validateConfig } = require('./src/config');
const { handleEsbTransaction } = require('./src/handler');
const { buildSystemErrorResponse } = require('./src/esbParser');
const { logger } = require('./src/logger');
const { createAdminRouter, loadRuntimeConfig } = require('./src/adminRoutes');

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'esb-adapter',
    becauseBaseUrl: config.becauseBaseUrl || null,
    admin: '/admin/',
  });
});

app.post('/esb/transaction', async (req, res) => {
  try {
    const response = await handleEsbTransaction(req.body);
    res.json(response);
  } catch (err) {
    logger.error('未处理异常', { message: err.message, stack: err.stack?.split('\n')[0] });
    res.status(500).json(buildSystemErrorResponse(err.message || '内部服务错误'));
  }
});

app.use('/api/admin', createAdminRouter());

const publicDir = path.join(__dirname, 'public');
app.use('/admin', express.static(path.join(publicDir, 'admin'), { index: 'index.html' }));
app.get('/admin', (_req, res) => {
  res.redirect(302, '/admin/');
});

function start() {
  validateConfig();
  loadRuntimeConfig();
  app.listen(config.port, () => {
    logger.info(`已启动: http://0.0.0.0:${config.port}`);
    logger.info('ESB 入口: POST /esb/transaction');
    logger.info(`管理端:   http://0.0.0.0:${config.port}/admin/`);
    logger.info(`Because 默认地址:   ${config.becauseBaseUrl || '(未配置)'}`);
    logger.info(`Because result地址: ${config.becauseBaseUrlResult || '(回退默认)'}`);
    logger.info(`Because zb地址:     ${config.becauseBaseUrlZb || '(回退默认)'}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
