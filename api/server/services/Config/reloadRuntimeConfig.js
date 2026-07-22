const { CacheKeys } = require('@because/data-provider');
const { logger } = require('@because/data-schemas');
const { reloadAppConfig } = require('./app');
const { setCachedTools, invalidateCachedTools, ToolCacheKeys } = require('./getCachedTools');
const { mergeAppTools } = require('./mcp');
const getLogStores = require('~/cache/getLogStores');

/** @typedef {'all' | 'endpoints' | 'models' | 'mcp' | 'interface'} ReloadScope */

/** @type {Promise<unknown>} */
let reloadChain = Promise.resolve();

/**
 * @param {object} [options]
 * @param {ReloadScope} [options.scope='all']
 * @param {import('express').Request} [options.req]
 * @param {boolean} [options.yamlSaved=true]
 * @returns {Promise<{
 *   yamlSaved: boolean,
 *   runtimeReloaded: boolean,
 *   warnings: string[],
 *   needRestart: boolean,
 *   scope: string,
 * }>}
 */
async function reloadRuntimeConfig(options = {}) {
  const scope = options.scope || 'all';
  const yamlSaved = options.yamlSaved !== false;
  const req = options.req;

  const run = async () => {
    const warnings = [];
    let runtimeReloaded = false;
    let needRestart = false;

    try {
      logger.info(`[reloadRuntimeConfig] Starting reload scope=${scope}`);

      const appConfig = await reloadAppConfig();

      const cache = getLogStores(CacheKeys.CONFIG_STORE);
      await Promise.all([
        cache.delete(CacheKeys.STARTUP_CONFIG),
        cache.delete(CacheKeys.ENDPOINT_CONFIG),
        cache.delete(CacheKeys.MODELS_CONFIG),
        cache.delete(CacheKeys.TOOLS),
        cache.delete(ToolCacheKeys.GLOBAL),
      ]);
      await invalidateCachedTools({ invalidateGlobal: true });

      if (appConfig?.availableTools) {
        await setCachedTools(appConfig.availableTools);
      }

      if (req) {
        try {
          const { getEndpointsConfig } = require('./getEndpointsConfig');
          await getEndpointsConfig({ ...req, config: appConfig });
        } catch (err) {
          warnings.push(`Failed to warm endpoints config: ${err.message}`);
        }
        try {
          const { loadModels } = require('~/server/controllers/ModelController');
          await loadModels({ ...req, config: appConfig });
        } catch (err) {
          warnings.push(`Failed to warm models config: ${err.message}`);
        }
      }

      if (scope === 'mcp' || scope === 'all') {
        const mcpResult = await reloadMCPRuntime(appConfig);
        warnings.push(...mcpResult.warnings);
        if (mcpResult.needRestart) {
          needRestart = true;
        }
      }

      runtimeReloaded = !needRestart;
      logger.info(
        `[reloadRuntimeConfig] Done scope=${scope} runtimeReloaded=${runtimeReloaded} warnings=${warnings.length}`,
      );
    } catch (err) {
      logger.error('[reloadRuntimeConfig] Failed:', err);
      warnings.push(err.message || 'Runtime reload failed');
      runtimeReloaded = false;
      needRestart = true;
    }

    return {
      yamlSaved,
      runtimeReloaded,
      warnings,
      needRestart,
      scope,
    };
  };

  const queued = reloadChain.then(run, run);
  reloadChain = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

/**
 * @param {object} appConfig
 * @returns {Promise<{ warnings: string[], needRestart: boolean }>}
 */
async function reloadMCPRuntime(appConfig) {
  const warnings = [];
  let needRestart = false;
  const mcpServers = appConfig?.mcpConfig || {};

  try {
    const { getMCPManager } = require('~/config');
    let mcpManager;
    try {
      mcpManager = getMCPManager();
    } catch (err) {
      warnings.push(`MCPManager not initialized: ${err.message}`);
      needRestart = true;
      return { warnings, needRestart };
    }

    // Collect known user/server combos BEFORE disconnect clears userConnections
    const knownUserIds = [
      ...new Set([
        ...Array.from(mcpManager.userConnections?.keys?.() || []),
        ...Array.from(mcpManager.userLastActivity?.keys?.() || []),
      ]),
    ];
    const knownServerNames = new Set(Object.keys(mcpServers));
    try {
      for (const userMap of mcpManager.userConnections?.values?.() || []) {
        for (const name of userMap.keys()) {
          knownServerNames.add(name);
        }
      }
    } catch {
      // ignore
    }
    try {
      const { mcpServersRegistry } = require('@because/api');
      const existing = await mcpServersRegistry.getAllServerConfigs();
      for (const name of Object.keys(existing || {})) {
        knownServerNames.add(name);
      }
    } catch {
      // registry may be unavailable during early boot
    }

    const { warnings: mcpWarnings } = await mcpManager.reinitializeFromConfigs(mcpServers);
    warnings.push(...mcpWarnings);

    // Drop stale per-user MCP tool lists (tools:mcp:userId:serverName)
    try {
      await invalidateCachedTools({
        invalidateAllMCP: true,
        userIds: knownUserIds,
        serverNames: [...knownServerNames],
      });
    } catch (err) {
      warnings.push(`Failed to clear user MCP tool caches: ${err.message}`);
    }

    // Rebuild global tools: AppConfig baseline + MCP app tools
    if (appConfig?.availableTools) {
      await setCachedTools({ ...appConfig.availableTools });
    }
    try {
      const mcpTools = await mcpManager.getAppToolFunctions();
      await mergeAppTools(mcpTools || {});
    } catch (err) {
      warnings.push(`Failed to merge MCP tools into global cache: ${err.message}`);
    }

    const cache = getLogStores(CacheKeys.CONFIG_STORE);
    await cache.delete(CacheKeys.TOOLS);
  } catch (err) {
    logger.error('[reloadMCPRuntime] Failed:', err);
    warnings.push(err.message || 'MCP runtime reload failed');
    needRestart = true;
  }

  return { warnings, needRestart };
}

module.exports = {
  reloadRuntimeConfig,
  reloadMCPRuntime,
};
