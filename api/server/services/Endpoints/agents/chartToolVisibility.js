const ECHARTS_TOOL_NAME = 'echarts_generator_app';

function getToolName(tool) {
  return typeof tool === 'string' ? tool : tool?.name;
}

/** Keep the chart tool executable server-side while optionally hiding it from model bindings. */
function getModelHiddenTools(agent, resolvedTools = agent?.tools) {
  const hasEchartsTool = (resolvedTools ?? []).some(
    (tool) => getToolName(tool) === ECHARTS_TOOL_NAME,
  );
  if (hasEchartsTool && agent?.chart_config?.hide_from_model === true) {
    return [ECHARTS_TOOL_NAME];
  }
  return [];
}

module.exports = { ECHARTS_TOOL_NAME, getModelHiddenTools };
