const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyTestEnv } = require('./helpers/testEnv');

describe('runtimeConfig 热更新', () => {
  let tmpDir;
  let runtimePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-runtime-'));
    runtimePath = path.join(tmpDir, 'runtime-config.json');
    process.env.ESB_RUNTIME_CONFIG_PATH = runtimePath;
    applyTestEnv({
      becauseBaseUrl: 'http://env-default.example',
      CHAT_TIMEOUT_MS: '300000',
      LOG_POLL_STATE: 'false',
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    delete process.env.ESB_RUNTIME_CONFIG_PATH;
  });

  it('updateRuntimeConfig 立即改写内存 config 并持久化', () => {
    const { config } = require('../src/config');
    const {
      updateRuntimeConfig,
      getPublicConfig,
      _getOverlay,
    } = require('../src/runtimeConfig');

    assert.equal(config.chatTimeoutMs, 300000);
    assert.equal(config.logPollState, false);

    const result = updateRuntimeConfig({
      chatTimeoutMs: 120000,
      logPollState: true,
    });

    assert.equal(config.chatTimeoutMs, 120000);
    assert.equal(config.logPollState, true);
    assert.ok(result.overridden.includes('chatTimeoutMs'));
    assert.ok(fs.existsSync(runtimePath));

    const saved = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    assert.equal(saved.chatTimeoutMs, 120000);
    assert.equal(saved.logPollState, true);
    assert.deepEqual(_getOverlay().chatTimeoutMs, 120000);
  });

  it('密码留空时不覆盖已有 becausePassword', () => {
    const { config } = require('../src/config');
    const { updateRuntimeConfig } = require('../src/runtimeConfig');
    const before = config.becausePassword;

    updateRuntimeConfig({ becausePassword: '', chatTimeoutMs: 111000 });
    assert.equal(config.becausePassword, before);
    assert.equal(config.chatTimeoutMs, 111000);
  });

  it('非法配置会回滚且不写文件', () => {
    const { config } = require('../src/config');
    const { updateRuntimeConfig } = require('../src/runtimeConfig');
    const before = config.agentIdResult;

    assert.throws(
      () => updateRuntimeConfig({ agentIdResult: '' }),
      /AGENT_ID_RESULT|缺少必需/,
    );
    assert.equal(config.agentIdResult, before);
    assert.equal(fs.existsSync(runtimePath), false);
  });

  it('loadRuntimeConfig 启动时应用覆盖层', () => {
    fs.writeFileSync(
      runtimePath,
      JSON.stringify({ chatTimeoutMs: 999000, queryContextAttributionSuffix: '开始归因测试' }),
      'utf8',
    );
    applyTestEnv({
      becauseBaseUrl: 'http://env-default.example',
      CHAT_TIMEOUT_MS: '300000',
    });
    process.env.ESB_RUNTIME_CONFIG_PATH = runtimePath;

    const { config } = require('../src/config');
    const { loadRuntimeConfig } = require('../src/runtimeConfig');
    loadRuntimeConfig();

    assert.equal(config.chatTimeoutMs, 999000);
    assert.equal(config.queryContextAttributionSuffix, '开始归因测试');
  });

  it('clearRuntimeConfig 恢复环境变量并删除覆盖文件', () => {
    const { config } = require('../src/config');
    const { updateRuntimeConfig, clearRuntimeConfig, getPublicConfig } = require('../src/runtimeConfig');

    updateRuntimeConfig({ chatTimeoutMs: 555000 });
    assert.equal(config.chatTimeoutMs, 555000);

    const result = clearRuntimeConfig();
    assert.equal(config.chatTimeoutMs, 300000);
    assert.equal(fs.existsSync(runtimePath), false);
    assert.equal(result.overridden.length, 0);
    assert.equal(getPublicConfig().values.chatTimeoutMs, 300000);
  });

  it('GET 视图返回 becausePassword 明文供管理页显示', () => {
    const { config } = require('../src/config');
    const { getPublicConfig } = require('../src/runtimeConfig');
    const view = getPublicConfig();
    assert.equal(view.values.becausePassword, config.becausePassword);
    assert.ok(view.values.becausePassword);
    assert.ok(!view.fields.some((f) => f.key === 'port'));
  });
});
