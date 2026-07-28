/**
 * DAT 引擎缓存刷新工具
 *
 * Because 对项目/数据源的增删改是直接写 MongoDB 的，不会经过 DAT 引擎自己的
 * ProjectController/DatasourceController，因此也不会触发 DAT 内部的
 * ProjectChangedEvent。DAT 的 ProjectRunner（承载 LLM/embedding/agents 配置，
 * 以及数据源的 JDBC 连接信息）在首次被使用后会一直缓存，不会感知这次 Mongo
 * 层面的改动。
 *
 * DAT 引擎自身在 ProjectController 上暴露了 `POST /api/v1/projects/{id}/refresh`
 * 接口，内部按 `key.contains(projectId)` 清理 projectRunnerPool，一次调用即可
 * 让该项目下所有数据源关联的缓存一并失效（下次请求会重新从 Mongo 加载最新配置）。
 *
 * 这里把这次调用接到 Because 后端的项目/数据源写操作之后，让配置改动不需要
 * 重启 DAT 引擎容器就能生效。调用失败只记 warning，不影响主流程——Mongo 已经
 * 写入才是权威事实，DAT 那边最坏情况是退化回"需要手动重启"的旧行为。
 *
 * 地址优先用 DAT_OPENAPI_INTERNAL_URL（容器到宿主机的内部地址，默认走
 * host.docker.internal，不出公网、不受防火墙/NAT 影响），没配置时退回到
 * DAT_OPENAPI_BASE_URL（浏览器直连用的公网地址）作为兼容兜底。
 */
const { logger } = require('@because/data-schemas');

const REFRESH_TIMEOUT_MS = 5000;

/**
 * 通知 DAT 引擎清理指定项目的 ProjectRunner 缓存。
 * @param {string} projectId
 */
async function refreshDatProjectCache(projectId) {
    if (!projectId) {
        return;
    }
    const baseUrl = process.env.DAT_OPENAPI_INTERNAL_URL || process.env.DAT_OPENAPI_BASE_URL;
    if (!baseUrl) {
        logger.debug('[datEngineRefresh] DAT_OPENAPI_INTERNAL_URL/DAT_OPENAPI_BASE_URL not configured, skip cache refresh');
        return;
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/projects/${projectId}/refresh`;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
        const response = await fetch(url, { method: 'POST', signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) {
            logger.warn(`[datEngineRefresh] DAT refresh returned ${response.status} for project ${projectId}`);
            return;
        }
        logger.info(`[datEngineRefresh] Refreshed DAT ProjectRunner cache for project ${projectId}`);
    } catch (error) {
        logger.warn(`[datEngineRefresh] Failed to refresh DAT cache for project ${projectId}: ${error.message}`);
    }
}

module.exports = { refreshDatProjectCache };
