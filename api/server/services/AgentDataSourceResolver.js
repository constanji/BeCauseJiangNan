const { logger } = require('@because/data-schemas');

/**
 * 解析智能体绑定的数据源 ID，按以下优先级依次尝试：
 *
 *  1. Agent.data_source_id                  ← 数据源绑定 Agent 时写入
 *  2. DataSource.agentIds 反查              ← 防止绑定 API 只写了 DataSource 侧
 *  3. Agent.projectIds → Project.data_source_id ← 项目管理绑定数据源的场景
 *
 * @param {string} agentId
 * @returns {Promise<string|null>}
 */
async function resolveAgentDataSourceId(agentId) {
  if (!agentId) return null;
  const id = String(agentId).trim();
  if (!id) return null;

  let agent = null;

  // ── 1. Agent.data_source_id ──────────────────────────────────────────────
  try {
    const { getAgent } = require('~/models/Agent');
    agent = await getAgent({ id });
    if (agent?.data_source_id) {
      logger.info(
        `[AgentDataSourceResolver] agent=${id} via Agent.data_source_id → ${agent.data_source_id}`,
      );
      return String(agent.data_source_id);
    }
  } catch (error) {
    logger.warn('[AgentDataSourceResolver] getAgent 失败:', error.message);
  }

  // ── 2. DataSource.agentIds 反查 ──────────────────────────────────────────
  try {
    const { getDataSources } = require('~/models/DataSource');
    const sources = await getDataSources({});
    for (const ds of sources) {
      const bound = (ds.agentIds || []).map((aid) => String(aid));
      if (bound.includes(id)) {
        logger.info(
          `[AgentDataSourceResolver] agent=${id} via DataSource.agentIds → ${ds._id}`,
        );
        return String(ds._id);
      }
    }
  } catch (error) {
    logger.warn('[AgentDataSourceResolver] getDataSources 失败:', error.message);
  }

  // ── 3. Agent.projectIds → Project.data_source_id ─────────────────────────
  try {
    const projectIds = agent?.projectIds;
    if (Array.isArray(projectIds) && projectIds.length > 0) {
      const { getProjectById } = require('~/models/Project');
      for (const pid of projectIds) {
        const project = await getProjectById(String(pid));
        if (project?.data_source_id) {
          logger.info(
            `[AgentDataSourceResolver] agent=${id} via projectIds[${pid}] → ${project.data_source_id}`,
          );
          return String(project.data_source_id);
        }
      }
    }
  } catch (error) {
    logger.warn('[AgentDataSourceResolver] projectIds 反查失败:', error.message);
  }

  logger.warn(`[AgentDataSourceResolver] agent=${id} 未找到绑定的数据源`);
  return null;
}

function pickAgentId(agent, req) {
  return (
    agent?.id ||
    req?.body?.agent_id ||
    req?.body?.endpointOption?.agent_id ||
    null
  );
}

module.exports = {
  resolveAgentDataSourceId,
  pickAgentId,
};
