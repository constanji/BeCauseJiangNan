const path = require('path');

function clearAdapterModuleCache() {
  const root = path.resolve(__dirname, '../..');
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(root, 'src')) || key === path.join(root, 'index.js')) {
      delete require.cache[key];
    }
  }
}

function applyTestEnv(overrides = {}) {
  const defaults = {
    PORT: '18088',
    BECAUSE_BASE_URL: overrides.becauseBaseUrl || overrides.BECAUSE_BASE_URL || 'http://127.0.0.1:1',
    BECAUSE_BASE_URL_RESULT: overrides.becauseBaseUrlResult || overrides.BECAUSE_BASE_URL_RESULT || '',
    BECAUSE_BASE_URL_ZB: overrides.becauseBaseUrlZb || overrides.BECAUSE_BASE_URL_ZB || '',
    BECAUSE_EMAIL: 'integration@test.com',
    BECAUSE_PASSWORD: 'test-password',
    AGENT_ID_RESULT: 'agent_result_test',
    AGENT_ID_ZB: 'agent_zb_test',
    CHAT_TIMEOUT_MS: '30000',
    AUTH_TIMEOUT_MS: overrides.authTimeoutMs || overrides.AUTH_TIMEOUT_MS || '30000',
    TOKEN_REFRESH_SKEW_MS: '60000',
    QUERY_CONTEXT_ATTRIBUTION_SUFFIX: '根据以上信息，开始归因',
  };

  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    if (value === undefined || value === null || value === '') {
      // 显式空串：清除，以便走 config 内「本机 IP」默认逻辑做回退测试
      if (/^BECAUSE_BASE_URL/.test(key)) delete process.env[key];
      continue;
    }
    process.env[key] = String(value);
  }

  clearAdapterModuleCache();
}

function buildEsbRequest(overrides = {}) {
  return {
    Transaction: {
      Header: {
        sysHeader: {
          msgId: 'integration-test-001',
          msgDate: '20260608',
          msgTime: '120000',
          serviceCd: 'P00002006946',
          clientCd: '538',
          serverCd: '033',
          ...overrides.sysHeader,
        },
      },
      Body: {
        request: {
          bizHeader: null,
          bizBody: {
            orgCode: '538',
            userNum: 'integration_user',
            scene: 'result',
            text: '你好，联调测试',
            ...overrides.bizBody,
          },
        },
      },
    },
  };
}

module.exports = {
  clearAdapterModuleCache,
  applyTestEnv,
  buildEsbRequest,
};
