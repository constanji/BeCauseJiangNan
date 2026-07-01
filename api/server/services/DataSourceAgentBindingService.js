const { logger } = require('@because/data-schemas');
const { getDataSourceById, getDataSources, updateDataSource } = require('~/models/DataSource');
const { getAgent, updateAgent } = require('~/models/Agent');

function normalizeAgentIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  return [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
}

/**
 * 将智能体列表绑定到数据源，并同步各 Agent.data_source_id。
 * 一个智能体同一时间只能绑定一个数据源；绑到新源时自动从旧源 agentIds 中移除。
 */
async function syncDataSourceAgentBindings(dataSourceId, agentIds) {
  const dsId = String(dataSourceId);
  const newAgentIds = normalizeAgentIds(agentIds);
  const current = await getDataSourceById(dsId);
  if (!current) {
    throw new Error('数据源不存在');
  }

  const oldAgentIds = normalizeAgentIds(current.agentIds || []);
  const allSources = await getDataSources({});

  for (const agentId of newAgentIds) {
    for (const other of allSources) {
      const otherId = String(other._id);
      if (otherId === dsId) {
        continue;
      }
      const otherAgents = normalizeAgentIds(other.agentIds || []);
      if (otherAgents.includes(agentId)) {
        await updateDataSource(otherId, {
          agentIds: otherAgents.filter((id) => id !== agentId),
        });
      }
    }

    await updateAgent({ id: agentId }, { data_source_id: dsId }, { skipVersioning: true });
  }

  const removed = oldAgentIds.filter((id) => !newAgentIds.includes(id));
  for (const agentId of removed) {
    const agent = await getAgent({ id: agentId });
    if (agent && String(agent.data_source_id || '') === dsId) {
      await updateAgent({ id: agentId }, { data_source_id: null }, { skipVersioning: true });
    }
  }

  const updated = await updateDataSource(dsId, { agentIds: newAgentIds });
  logger.info(
    `[DataSourceAgentBinding] dataSource=${dsId} agents=[${newAgentIds.join(', ')}] (prev=[${oldAgentIds.join(', ')}])`,
  );
  return updated;
}

module.exports = {
  syncDataSourceAgentBindings,
  normalizeAgentIds,
};
