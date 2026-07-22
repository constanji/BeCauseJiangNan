/**
 * 真实 Because 联调测试。
 *
 * 默认跳过。启用方式：
 *   BECAUSE_INTEGRATION_LIVE=1 npm run test:live
 *
 * 需配置 .env 或环境变量：
 *   BECAUSE_BASE_URL, BECAUSE_EMAIL, BECAUSE_PASSWORD,
 *   AGENT_ID_RESULT, AGENT_ID_ZB
 */
require('dotenv').config();

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { applyTestEnv, buildEsbRequest } = require('./helpers/testEnv');

const LIVE = process.env.BECAUSE_INTEGRATION_LIVE === '1';

function postJson(url, body, timeoutMs = 320000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = { _raw: raw };
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`请求超时 ${timeoutMs}ms: ${url}`));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(LIVE ? describe : describe.skip)('Because 真实联调（需 BECAUSE_INTEGRATION_LIVE=1）', () => {
  /** @type {import('http').Server} */
  let adapterServer;

  before(async () => {
    applyTestEnv({
      BECAUSE_BASE_URL: process.env.BECAUSE_BASE_URL,
      BECAUSE_EMAIL: process.env.BECAUSE_EMAIL,
      BECAUSE_PASSWORD: process.env.BECAUSE_PASSWORD,
      AGENT_ID_RESULT: process.env.AGENT_ID_RESULT,
      AGENT_ID_ZB: process.env.AGENT_ID_ZB,
      CHAT_TIMEOUT_MS: process.env.CHAT_TIMEOUT_MS || '300000',
    });

    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();

    const { app } = require('../index');
    adapterServer = app.listen(0, '127.0.0.1');
    await new Promise((res) => adapterServer.once('listening', res));
  });

  after(async () => {
    if (adapterServer) {
      await new Promise((res) => adapterServer.close(res));
    }
  });

  function adapterBaseUrl() {
    const { port } = adapterServer.address();
    return `http://127.0.0.1:${port}`;
  }

  it('becauseClient.login 可登录真实 Because', async () => {
    const { login } = require('../src/becauseClient');
    const token = await login();
    assert.ok(token);
    assert.match(token, /^eyJ/);
  });

  it('POST /esb/transaction scene=result 返回真实 answer', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();

    const { status, body } = await postJson(
      `${adapterBaseUrl()}/esb/transaction`,
      buildEsbRequest({ bizBody: { text: '你好，请简短回复一句确认收到。' } }),
    );

    assert.equal(status, 200);
    assert.equal(body.Transaction.Header.sysHeader.resCode, '000000');
    assert.equal(body.Transaction.Body.response.bizBody.result, '1');

    const answer = body.Transaction.Body.response.bizBody.answer;
    assert.ok(answer && String(answer).trim().length > 0, 'answer 不应为空');
    assert.ok(body.Transaction.Body.response.bizBody.conversationId);

    console.log('[live] conversationId:', body.Transaction.Body.response.bizBody.conversationId);
    console.log('[live] answer preview:', String(answer).slice(0, 200));
  });

  if (process.env.AGENT_ID_ZB) {
    it('POST /esb/transaction scene=zb Agent 可响应', async () => {
      const { resetAuthCache } = require('../src/becauseClient');
      resetAuthCache();

      const { status, body } = await postJson(
        `${adapterBaseUrl()}/esb/transaction`,
        buildEsbRequest({
          bizBody: {
            scene: 'zb',
            text: '请简要说明你可以做什么（一句话即可）。',
          },
        }),
        320000,
      );

      assert.equal(status, 200);
      assert.equal(body.Transaction.Body.response.bizBody.result, '1');
      assert.ok(body.Transaction.Body.response.bizBody.answer);
    });
  }
});
