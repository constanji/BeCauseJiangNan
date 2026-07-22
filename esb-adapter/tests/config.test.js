const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { applyTestEnv } = require('./helpers/testEnv');

describe('config resolveSceneConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    applyTestEnv({ becauseBaseUrl: originalEnv.BECAUSE_BASE_URL || 'http://127.0.0.1:1' });
  });

  it('scene 专用 URL 优先于默认 BECAUSE_BASE_URL', () => {
    applyTestEnv({
      becauseBaseUrl: 'http://default.example',
      becauseBaseUrlResult: 'http://result.example',
      becauseBaseUrlZb: 'http://zb.example',
    });
    const { resolveSceneConfig } = require('../src/config');

    assert.deepEqual(resolveSceneConfig('result'), {
      ok: true,
      scene: 'result',
      agentId: 'agent_result_test',
      becauseBaseUrl: 'http://result.example',
    });
    assert.deepEqual(resolveSceneConfig('zb'), {
      ok: true,
      scene: 'zb',
      agentId: 'agent_zb_test',
      becauseBaseUrl: 'http://zb.example',
    });
  });

  it('未配置 scene 专用 URL 时回退 BECAUSE_BASE_URL', () => {
    applyTestEnv({
      becauseBaseUrl: 'http://default.example',
      becauseBaseUrlResult: '',
      becauseBaseUrlZb: '',
    });
    const { resolveSceneConfig } = require('../src/config');

    assert.equal(resolveSceneConfig('zb').becauseBaseUrl, 'http://default.example');
    assert.equal(resolveSceneConfig('result').becauseBaseUrl, 'http://default.example');
  });

  it('未配置任何 BECAUSE_* 时按 HOST_IP 拼默认地址', () => {
    applyTestEnv({
      BECAUSE_BASE_URL: '',
      BECAUSE_BASE_URL_RESULT: '',
      BECAUSE_BASE_URL_ZB: '',
      HOST_IP: '10.1.2.3',
    });
    delete process.env.QUERY_CONTEXT_ATTRIBUTION_SUFFIX;
    const { clearAdapterModuleCache } = require('./helpers/testEnv');
    clearAdapterModuleCache();
    const { config, DEFAULT_ATTRIBUTION_SUFFIX } = require('../src/config');
    assert.equal(config.becauseBaseUrl, 'http://10.1.2.3');
    assert.equal(config.becauseBaseUrlZb, 'http://10.1.2.3');
    assert.equal(config.becauseBaseUrlResult, 'http://10.1.2.3:18080');
    assert.equal(config.queryContextAttributionSuffix, DEFAULT_ATTRIBUTION_SUFFIX);
  });

  it('未知 scene 返回错误', () => {
    applyTestEnv();
    const { resolveSceneConfig } = require('../src/config');
    const resolved = resolveSceneConfig('unknown');
    assert.equal(resolved.ok, false);
    assert.match(resolved.error, /未知 scene/);
  });

  it('resolveTextExtractOptions 按 scene 读取 TEXT_LAST_BLOCK_ONLY_*', () => {
    applyTestEnv({
      TEXT_LAST_BLOCK_ONLY_RESULT: 'false',
      TEXT_LAST_BLOCK_ONLY_ZB: 'true',
    });
    const { resolveTextExtractOptions } = require('../src/config');

    assert.deepEqual(resolveTextExtractOptions('result'), { useLastTextBlockOnly: false });
    assert.deepEqual(resolveTextExtractOptions('zb'), { useLastTextBlockOnly: true });
    assert.deepEqual(resolveTextExtractOptions(''), { useLastTextBlockOnly: false });
  });
});
