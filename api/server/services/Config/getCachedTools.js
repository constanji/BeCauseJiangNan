const { CacheKeys } = require('@because/data-provider');
const getLogStores = require('~/cache/getLogStores');

/**
 * Cache key generators for different tool access patterns
 */
const ToolCacheKeys = {
  /** Global tools available to all users */
  GLOBAL: 'tools:global',
  /** MCP tools cached by user ID and server name */
  MCP_SERVER: (userId, serverName) => `tools:mcp:${userId}:${serverName}`,
};

/**
 * Retrieves available tools from cache
 * @function getCachedTools
 * @param {Object} options - Options for retrieving tools
 * @param {string} [options.userId] - User ID for user-specific MCP tools
 * @param {string} [options.serverName] - MCP server name to get cached tools for
 * @returns {Promise<LCAvailableTools|null>} The available tools object or null if not cached
 */
async function getCachedTools(options = {}) {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  const { userId, serverName } = options;

  // Return MCP server-specific tools if requested
  if (serverName && userId) {
    return await cache.get(ToolCacheKeys.MCP_SERVER(userId, serverName));
  }

  // Default to global tools
  return await cache.get(ToolCacheKeys.GLOBAL);
}

/**
 * Sets available tools in cache
 * @function setCachedTools
 * @param {Object} tools - The tools object to cache
 * @param {Object} options - Options for caching tools
 * @param {string} [options.userId] - User ID for user-specific MCP tools
 * @param {string} [options.serverName] - MCP server name for server-specific tools
 * @param {number} [options.ttl] - Time to live in milliseconds
 * @returns {Promise<boolean>} Whether the operation was successful
 */
async function setCachedTools(tools, options = {}) {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  const { userId, serverName, ttl } = options;

  // Cache by MCP server if specified (requires userId)
  if (serverName && userId) {
    return await cache.set(ToolCacheKeys.MCP_SERVER(userId, serverName), tools, ttl);
  }

  // Default to global cache
  return await cache.set(ToolCacheKeys.GLOBAL, tools, ttl);
}

/**
 * Invalidates cached tools
 * @function invalidateCachedTools
 * @param {Object} options - Options for invalidating tools
 * @param {string} [options.userId] - User ID for user-specific MCP tools
 * @param {string} [options.serverName] - MCP server name to invalidate
 * @param {boolean} [options.invalidateGlobal=false] - Whether to invalidate global tools
 * @param {boolean} [options.invalidateAllMCP=false] - Whether to invalidate all tools:mcp:* entries
 * @param {string[]} [options.userIds] - Known user IDs for direct MCP cache deletes
 * @param {string[]} [options.serverNames] - Known server names for direct MCP cache deletes
 * @returns {Promise<void>}
 */
async function invalidateCachedTools(options = {}) {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  const {
    userId,
    serverName,
    invalidateGlobal = false,
    invalidateAllMCP = false,
    userIds = [],
    serverNames = [],
  } = options;

  const keysToDelete = new Set();

  if (invalidateGlobal) {
    keysToDelete.add(ToolCacheKeys.GLOBAL);
  }

  if (serverName && userId) {
    keysToDelete.add(ToolCacheKeys.MCP_SERVER(userId, serverName));
  }

  if (userIds.length > 0 && serverNames.length > 0) {
    for (const uid of userIds) {
      for (const name of serverNames) {
        if (uid && name) {
          keysToDelete.add(ToolCacheKeys.MCP_SERVER(uid, name));
        }
      }
    }
  }

  await Promise.all([...keysToDelete].map((key) => cache.delete(key)));

  if (invalidateAllMCP) {
    await invalidateAllMCPServerTools();
  }
}

/**
 * Deletes every `tools:mcp:${userId}:${serverName}` entry in CONFIG_STORE.
 * Covers Keyv iterator, in-memory Map stores, and Redis SCAN when available.
 * @returns {Promise<number>} Number of keys deleted via scan (known-combo deletes are separate)
 */
async function invalidateAllMCPServerTools() {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  const prefix = 'tools:mcp:';
  const keysToDelete = new Set();

  // Path 1: Keyv iterator (Redis Keyv / some stores)
  try {
    if (typeof cache.iterator === 'function') {
      for await (const [key] of cache.iterator()) {
        if (typeof key === 'string' && key.startsWith(prefix)) {
          keysToDelete.add(key);
        }
      }
    }
  } catch {
    // iterator unsupported — fall through
  }

  // Path 2: In-memory Map store (Keyv default / forced in-memory)
  try {
    const store = cache?.opts?.store;
    if (store?.keys) {
      const namespace = cache.opts?.namespace || '';
      for (const fullKey of store.keys()) {
        const key = String(fullKey);
        const idx = key.indexOf(prefix);
        if (idx === -1) {
          continue;
        }
        // Prefer logical key after namespace: (e.g. CONFIG_STORE:tools:mcp:...)
        if (namespace && key.startsWith(`${namespace}:`)) {
          keysToDelete.add(key.slice(namespace.length + 1));
        } else {
          keysToDelete.add(key.slice(idx));
        }
      }
    }
  } catch {
    // store.keys unsupported
  }

  // Path 3: Redis SCAN — covers keys iterator may miss across Keyv versions
  try {
    const { ioredisClient, cacheConfig } = require('@because/api');
    if (ioredisClient && cacheConfig?.USE_REDIS) {
      const redisPrefix = cacheConfig.REDIS_KEY_PREFIX || '';
      const sep = cacheConfig.GLOBAL_PREFIX_SEPARATOR || '::';
      const namespace = cache.opts?.namespace || CacheKeys.CONFIG_STORE;
      const pattern = `${redisPrefix}${sep}${namespace}:${prefix}*`;
      let cursor = '0';
      do {
        const [nextCursor, found] = await ioredisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        for (const redisKey of found) {
          const marker = `${namespace}:`;
          const markerIdx = redisKey.indexOf(marker);
          if (markerIdx !== -1) {
            keysToDelete.add(redisKey.slice(markerIdx + marker.length));
          }
        }
      } while (cursor !== '0');
    }
  } catch {
    // Redis unavailable or not configured
  }

  await Promise.all([...keysToDelete].map((key) => cache.delete(key)));
  return keysToDelete.size;
}

/**
 * Gets MCP tools for a specific server from cache
 * @function getMCPServerTools
 * @param {string} userId - The user ID
 * @param {string} serverName - The MCP server name
 * @returns {Promise<LCAvailableTools|null>} The available tools for the server
 */
async function getMCPServerTools(userId, serverName) {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  const serverTools = await cache.get(ToolCacheKeys.MCP_SERVER(userId, serverName));

  if (serverTools) {
    return serverTools;
  }

  return null;
}

module.exports = {
  ToolCacheKeys,
  getCachedTools,
  setCachedTools,
  getMCPServerTools,
  invalidateCachedTools,
  invalidateAllMCPServerTools,
};
