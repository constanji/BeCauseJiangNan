const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createMockBecauseServer } = require('./helpers/mockBecauseServer');
const { applyTestEnv } = require('./helpers/testEnv');

describe('becauseClient 登录/refresh 超时保护', () => {
  /** @type {Awaited<ReturnType<createMockBecauseServer>>} */
  let mockBecause;

  after(async () => {
    if (mockBecause) {
      await mockBecause.close();
      mockBecause = null;
    }
  });

  it('login 在登录接口长时间无响应时超时报错，而非无限挂起', async () => {
    mockBecause = await createMockBecauseServer({ loginDelayMs: 500 });
    applyTestEnv({ becauseBaseUrl: mockBecause.baseUrl, authTimeoutMs: '100' });

    const { resetAuthCache, login } = require('../src/becauseClient');
    resetAuthCache();

    await assert.rejects(
      () => login(),
      (err) => {
        assert.match(err.message, /登录超时/);
        return true;
      },
    );
  });

  it('login 在超时时间充足时可正常返回 token', async () => {
    if (mockBecause) await mockBecause.close();
    mockBecause = await createMockBecauseServer({ loginDelayMs: 50 });
    applyTestEnv({ becauseBaseUrl: mockBecause.baseUrl, authTimeoutMs: '5000' });

    const { resetAuthCache, login } = require('../src/becauseClient');
    resetAuthCache();

    const token = await login();
    assert.ok(token);
  });

  it('refreshToken 在 refresh 接口超时时回退重新登录而不是抛异常', async () => {
    if (mockBecause) await mockBecause.close();
    mockBecause = await createMockBecauseServer({ refreshDelayMs: 500 });
    applyTestEnv({ becauseBaseUrl: mockBecause.baseUrl, authTimeoutMs: '100' });

    const { resetAuthCache, login, refreshToken } = require('../src/becauseClient');
    resetAuthCache();

    await login();
    const token = await refreshToken();
    assert.ok(token);

    const reqs = mockBecause.getRequests();
    assert.ok(reqs.filter((r) => r.url === '/api/auth/login').length >= 2);
  });
});
