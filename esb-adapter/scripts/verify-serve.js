#!/usr/bin/env node
/**
 * 供 verify-admin-hot-reload.sh 临时拉起 adapter（随机端口）。
 * 环境变量：
 *   PORT_FILE 写入监听端口的文件路径
 *   ESB_RUNTIME_CONFIG_PATH 覆盖层路径
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
require('dotenv').config();

const { validateConfig } = require('../src/config');
const { loadRuntimeConfig } = require('../src/runtimeConfig');
const { app } = require('../index');

validateConfig();
loadRuntimeConfig();

const portFile = process.env.PORT_FILE;
if (!portFile) {
  console.error('缺少 PORT_FILE');
  process.exit(1);
}

const server = app.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  fs.writeFileSync(portFile, String(port));
  console.error('[verify] listening on', port);
});
