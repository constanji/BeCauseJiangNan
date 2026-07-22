const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyTestEnv } = require('./helpers/testEnv');

function request(baseUrl, method, urlPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request(
      `${baseUrl}${urlPath}`,
      {
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode, body: json, raw: text });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('admin API 热更新', () => {
  let server;
  let baseUrl;
  let tmpDir;
  let runtimePath;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-admin-'));
    runtimePath = path.join(tmpDir, 'runtime-config.json');
    process.env.ESB_RUNTIME_CONFIG_PATH = runtimePath;
    process.env.ESB_ADMIN_SECRET = 'test-admin-secret';
    applyTestEnv({
      becauseBaseUrl: 'http://127.0.0.1:9',
      CHAT_TIMEOUT_MS: '300000',
      ESB_ADMIN_SECRET: 'test-admin-secret',
    });

    const { app } = require('../index');
    server = app.listen(0, '127.0.0.1');
    await new Promise((res) => server.once('listening', res));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) await new Promise((res) => server.close(res));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    delete process.env.ESB_RUNTIME_CONFIG_PATH;
    delete process.env.ESB_ADMIN_SECRET;
  });

  it('无密钥访问管理 API 返回 401', async () => {
    const res = await request(baseUrl, 'GET', '/api/admin/config');
    assert.equal(res.status, 401);
  });

  it('带密钥可读配置，且 /admin/ 静态页可访问', async () => {
    const res = await request(baseUrl, 'GET', '/api/admin/config', {
      headers: { 'X-Esb-Admin-Secret': 'test-admin-secret' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.values.chatTimeoutMs, 300000);
    assert.equal(res.body.authRequired, true);

    const page = await request(baseUrl, 'GET', '/admin/');
    assert.equal(page.status, 200);
    assert.match(page.raw, /ESB Adapter/);
  });

  it('PUT 配置后内存立即生效且不影响 /esb/transaction 路由存在', async () => {
    const { config } = require('../src/config');
    const put = await request(baseUrl, 'PUT', '/api/admin/config', {
      headers: { 'X-Esb-Admin-Secret': 'test-admin-secret' },
      body: { chatTimeoutMs: 180000, logPollState: true },
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.ok, true);
    assert.equal(config.chatTimeoutMs, 180000);
    assert.equal(config.logPollState, true);
    assert.ok(fs.existsSync(runtimePath));

    // ESB 入口仍在（缺字段会校验失败，但路由可达）
    const esb = await request(baseUrl, 'POST', '/esb/transaction', { body: {} });
    assert.equal(esb.status, 200);
    assert.equal(esb.body.Transaction.Header.sysHeader.resCode, '999999');
  });

  it('健康检查包含 admin 路径提示', async () => {
    const res = await request(baseUrl, 'GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.admin, '/admin/');
  });
});
