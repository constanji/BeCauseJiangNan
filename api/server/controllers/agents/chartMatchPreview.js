const {
  extractTableFromToolOutput,
  matchAutoChartData,
  resolveChartMatchRules,
} = require('@because/agents');
const { agentChartConfigSchema } = require('@because/api');

function parsePlainRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.rows)) return value.rows;
    if (Array.isArray(value.data)) return value.data;
  }
  return null;
}

function previewTable(toolOutput, toolName) {
  const content = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput ?? '');
  const plain = (() => {
    try {
      return parsePlainRows(JSON.parse(content));
    } catch {
      return null;
    }
  })();
  if (plain?.length) {
    return { rows: plain, columns: Object.keys(plain[0] ?? {}) };
  }
  return extractTableFromToolOutput(toolName || 'ask_data_mcp_preview', {}, content);
}

async function chartMatchPreview(req, res) {
  try {
    const rawConfig = req.body?.chartConfig ?? {};
    const chartConfig = agentChartConfigSchema.parse(rawConfig);
    const toolOutput = req.body?.toolOutput;
    if (typeof toolOutput !== 'string' && (toolOutput == null || typeof toolOutput !== 'object')) {
      return res.status(400).json({ error: 'toolOutput 必须是工具返回文本或 JSON' });
    }
    const content = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput);
    if (content.length > 1024 * 1024) {
      return res.status(413).json({ error: 'toolOutput 超过 1MB 限制' });
    }
    const table = previewTable(toolOutput, req.body?.toolName);
    if (!table) {
      return res.json({ status: 'parse_failed' });
    }
    const result = matchAutoChartData(
      table.rows,
      table.columns,
      typeof req.body?.query === 'string' ? req.body.query : undefined,
      chartConfig?.match_rules,
    );
    const chartability = result.status === 'matched' ? result.chartability : undefined;
    return res.json({
      status: result.status,
      rule: 'rule' in result ? result.rule : undefined,
      chartType: chartability?.type,
      dimensionField: chartability?.type === 'line' ? chartability.dateCol : chartability?.dimCol,
      measureFields: chartability?.type === 'pie' ? [chartability.measureCol] : chartability?.measureCols,
      rowCount: result.rowCount,
      categoryCount: result.categoryCount,
      effectiveRule: resolveChartMatchRules(chartConfig?.match_rules),
      previewData: result.status === 'matched' ? result.rows : [],
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || '图表匹配试算失败' });
  }
}

module.exports = { chartMatchPreview };
