const mockStore = new Map();

jest.mock('~/cache/getLogStores', () => {
  return jest.fn(() => ({
    get: async (key) => mockStore.get(key) ?? undefined,
    set: async (key, value) => {
      mockStore.set(key, value);
      return true;
    },
    delete: async (key) => mockStore.delete(key),
    opts: {
      namespace: 'CONFIG_STORE',
      store: {
        keys: () => mockStore.keys(),
      },
    },
  }));
});

jest.mock(
  '@because/api',
  () => ({
    ioredisClient: null,
    cacheConfig: { USE_REDIS: false },
  }),
  { virtual: true },
);

const {
  ToolCacheKeys,
  setCachedTools,
  getMCPServerTools,
  invalidateCachedTools,
  invalidateAllMCPServerTools,
} = require('../getCachedTools');

describe('getCachedTools - Cache Isolation Security', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  describe('ToolCacheKeys.MCP_SERVER', () => {
    it('should generate cache keys that include userId', () => {
      const key = ToolCacheKeys.MCP_SERVER('user123', 'github');
      expect(key).toBe('tools:mcp:user123:github');
    });
  });

  describe('invalidateAllMCPServerTools', () => {
    it('should clear all tools:mcp:* entries without touching global tools', async () => {
      await setCachedTools({ global: true });
      await setCachedTools({ a: 1 }, { userId: 'u1', serverName: 'srv-a' });
      await setCachedTools({ b: 2 }, { userId: 'u2', serverName: 'srv-b' });

      const deleted = await invalidateAllMCPServerTools();

      expect(deleted).toBeGreaterThanOrEqual(2);
      expect(await getMCPServerTools('u1', 'srv-a')).toBeNull();
      expect(await getMCPServerTools('u2', 'srv-b')).toBeNull();
      expect(mockStore.get(ToolCacheKeys.GLOBAL)).toEqual({ global: true });
    });
  });

  describe('invalidateCachedTools with invalidateAllMCP', () => {
    it('should delete known user/server combos and scan leftovers', async () => {
      await setCachedTools({ a: 1 }, { userId: 'u1', serverName: 'old-server' });
      await setCachedTools({ b: 2 }, { userId: 'u2', serverName: 'kept-name' });

      await invalidateCachedTools({
        invalidateAllMCP: true,
        userIds: ['u1'],
        serverNames: ['old-server'],
      });

      expect(await getMCPServerTools('u1', 'old-server')).toBeNull();
      expect(await getMCPServerTools('u2', 'kept-name')).toBeNull();
    });
  });
});
