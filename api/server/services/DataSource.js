const { logger } = require("@because/data-schemas");
const { getAgent } = require("~/models/Agent");
const { getDatDatasourceModel } = require("~/models/DatDatasource");

/**
 * Get data source information (projectId and datasourceId) for a given agent.
 * This is used by MCP tools (like dat-server) to automatically inject context.
 *
 * @param {string} agentId - The ID of the agent.
 * @returns {Promise<{ projectId: string, _id: string }|null>}
 */
const getDataSourceByAgentId = async (agentId) => {
  try {
    // 1. Get the agent to find its name
    const agent = await getAgent({ id: agentId });
    if (!agent) {
      logger.warn(`[DataSource] Agent not found: ${agentId}`);
      return null;
    }

    // 2. Get the DatDatasource model
    const DatDatasource = await getDatDatasourceModel();

    // 3. Search for a datasource that has this agent's name in its agentNames array
    // Note: We search by name because agentNames usually contains human-readable names
    const dataSource = await DatDatasource.findOne({
      agentNames: agent.name,
      enabled: true,
    }).lean();

    if (!dataSource) {
      logger.debug(
        `[DataSource] No active datasource found for agent name: ${agent.name}`,
      );
      return null;
    }

    return {
      projectId: dataSource.projectId,
      _id: dataSource._id.toString(),
    };
  } catch (error) {
    logger.error(
      `[DataSource] Error looking up datasource for agent ${agentId}:`,
      error,
    );
    return null;
  }
};

module.exports = {
  getDataSourceByAgentId,
};
