jest.mock('~/server/services/start/tools', () => ({
  loadAndFormatTools: jest.fn(() => ({ system_tool: { type: 'function' } })),
}));

jest.mock('~/config/paths', () => ({
  structuredTools: '/tmp/tools',
}));

jest.mock('../loadCustomConfig', () => jest.fn());

jest.mock('@because/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  AppService: jest.fn(({ config, systemTools }) => ({
    availableTools: systemTools,
    endpoints: config.endpoints || {},
    modelSpecs: config.modelSpecs || {},
    mcpConfig: config.mcpServers || null,
    _version: config._version || 1,
  })),
}));

const mockCacheStore = new Map();
const mockAppConfigCache = {
  get: jest.fn(async (key) => mockCacheStore.get(`APP:${key}`)),
  set: jest.fn(async (key, value) => {
    mockCacheStore.set(`APP:${key}`, value);
    return true;
  }),
  delete: jest.fn(async (key) => {
    mockCacheStore.delete(`APP:${key}`);
    return true;
  }),
  clear: jest.fn(async () => {
    for (const key of [...mockCacheStore.keys()]) {
      if (key.startsWith('APP:')) {
        mockCacheStore.delete(key);
      }
    }
  }),
};

const mockConfigStore = {
  get: jest.fn(async (key) => mockCacheStore.get(`CFG:${key}`)),
  set: jest.fn(async (key, value) => {
    mockCacheStore.set(`CFG:${key}`, value);
    return true;
  }),
  delete: jest.fn(async (key) => {
    mockCacheStore.delete(`CFG:${key}`);
    return true;
  }),
};

jest.mock('~/cache/getLogStores', () =>
  jest.fn((namespace) => {
    if (namespace === 'APP_CONFIG') {
      return mockAppConfigCache;
    }
    return mockConfigStore;
  }),
);

const loadCustomConfig = require('../loadCustomConfig');
const {
  getAppConfig,
  clearAppConfigCache,
  reloadAppConfig,
  BASE_CONFIG_KEY,
} = require('../app');

describe('AppConfig cache clear/reload', () => {
  beforeEach(() => {
    mockCacheStore.clear();
    jest.clearAllMocks();
    loadCustomConfig.mockResolvedValue({
      version: '1.2.1',
      endpoints: { custom: [{ name: 'v1' }] },
      _version: 1,
    });
  });

  it('clearAppConfigCache removes APP_CONFIG _BASE_ (correct namespace)', async () => {
    await reloadAppConfig();
    expect(await mockAppConfigCache.get(BASE_CONFIG_KEY)).toBeTruthy();

    await clearAppConfigCache();
    expect(await mockAppConfigCache.get(BASE_CONFIG_KEY)).toBeUndefined();
    expect(mockAppConfigCache.clear).toHaveBeenCalled();
  });

  it('reloadAppConfig rebuilds from yaml immediately after clear', async () => {
    const first = await reloadAppConfig();
    expect(first.endpoints.custom[0].name).toBe('v1');

    loadCustomConfig.mockResolvedValue({
      version: '1.2.1',
      endpoints: { custom: [{ name: 'v2' }] },
      _version: 2,
    });

    const second = await reloadAppConfig();
    expect(second.endpoints.custom[0].name).toBe('v2');
    expect(second._version).toBe(2);

    const cached = await getAppConfig();
    expect(cached.endpoints.custom[0].name).toBe('v2');
  });

  it('getAppConfig({ refresh: true }) alone would still return stale _BASE_ if not cleared', async () => {
    await reloadAppConfig();
    loadCustomConfig.mockResolvedValue({
      version: '1.2.1',
      endpoints: { custom: [{ name: 'should-not-appear' }] },
      _version: 99,
    });

    // refresh skips role key read but still uses cached _BASE_ when present
    const stale = await getAppConfig({ refresh: true });
    expect(stale.endpoints.custom[0].name).toBe('v1');
  });
});
