/**
 * Excel 单元格结构化检索公共逻辑
 * 供 knowledge-discovery / 指标理解 / 机构背景 复用
 */

const path = require('path');
const { logger } = require('@because/data-schemas');

const KPI_FILENAME = '指标定义信息';
const ORG_FILENAME = '机构信息';

let ExcelCellVectorizationService = null;
function loadVectorService() {
  if (!ExcelCellVectorizationService) {
    try {
      ExcelCellVectorizationService = require('~/server/services/Files/ExcelCellVectorizationService');
    } catch (e) {
      ExcelCellVectorizationService = require(
        path.resolve(__dirname, '../../api/server/services/Files/ExcelCellVectorizationService'),
      );
    }
  }
  return ExcelCellVectorizationService;
}

let ExcelCellAliasService = null;
function loadAliasService() {
  if (!ExcelCellAliasService) {
    try {
      ExcelCellAliasService = require('~/server/services/Files/ExcelCellAliasService');
    } catch (e) {
      ExcelCellAliasService = require(
        path.resolve(__dirname, '../../api/server/services/Files/ExcelCellAliasService'),
      );
    }
  }
  return ExcelCellAliasService;
}

let getProjectById = null;
function loadProjectModel() {
  if (!getProjectById) {
    try {
      getProjectById = require('~/models/Project').getProjectById;
    } catch (e) {
      getProjectById = require(path.resolve(__dirname, '../../api/models/Project')).getProjectById;
    }
  }
  return getProjectById;
}

let resolveAgentDataSourceId = null;
function loadAgentDataSourceResolver() {
  if (!resolveAgentDataSourceId) {
    try {
      resolveAgentDataSourceId = require('~/server/services/AgentDataSourceResolver')
        .resolveAgentDataSourceId;
    } catch (e) {
      resolveAgentDataSourceId = require(
        path.resolve(__dirname, '../../api/server/services/AgentDataSourceResolver'),
      ).resolveAgentDataSourceId;
    }
  }
  return resolveAgentDataSourceId;
}

function cleanId(id) {
  if (!id) return null;
  if (typeof id === 'object') {
    const raw = id._id || id.id || (typeof id.toString === 'function' ? id.toString() : null);
    if (raw && String(raw) !== '[object Object]') {
      return cleanId(raw);
    }
  }
  let s = String(id)
    .replace(/^ObjectId\("(.+)"\)$/, '$1')
    .trim();
  while (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s || null;
}

/**
 * 从 tool 上下文解析数据源 entityId
 * @param {object} ctx { entityId, agentDataSourceId, req, conversation }
 * @param {object} input 工具入参
 */
async function resolveEntityId(ctx = {}, input = {}) {
  if (ctx.entityId) return cleanId(ctx.entityId);
  if (input.data_source_id) return cleanId(input.data_source_id);
  if (input.entity_id) return cleanId(input.entity_id);

  const conv = ctx.conversation;
  if (conv?.data_source_id) return cleanId(conv.data_source_id);

  const body = ctx.req?.body;
  if (body?.data_source_id) return cleanId(body.data_source_id);
  if (body?.endpointOption?.data_source_id) return cleanId(body.endpointOption.data_source_id);

  const agentOptions = conv?.agentOptions || conv?.model_parameters || {};
  const fromAgentOpts = cleanId(
    agentOptions.data_source_id || agentOptions.dataSourceId || agentOptions.datasource_id,
  );
  if (fromAgentOpts) return fromAgentOpts;

  if (ctx.agentDataSourceId) return cleanId(ctx.agentDataSourceId);

  if (conv?.project_id) {
    try {
      const getProjectByIdFn = loadProjectModel();
      const project = await getProjectByIdFn(cleanId(conv.project_id));
      if (project?.data_source_id) return cleanId(project.data_source_id);
    } catch (e) {
      logger.warn('[excelCellDiscovery] 从 project_id 获取数据源失败:', e.message);
    }
  }

  if (body?.project_id || body?.endpointOption?.project_id) {
    try {
      const getProjectByIdFn = loadProjectModel();
      const projectId = cleanId(body.project_id || body.endpointOption?.project_id);
      const project = await getProjectByIdFn(projectId);
      if (project?.data_source_id) return cleanId(project.data_source_id);
    } catch (e) {
      logger.warn('[excelCellDiscovery] 从 req.body.project_id 获取数据源失败:', e.message);
    }
  }

  const agentId = cleanId(body?.agent_id || body?.endpointOption?.agent_id);
  if (agentId) {
    try {
      const resolveFn = loadAgentDataSourceResolver();
      const resolved = await resolveFn(agentId);
      if (resolved) return cleanId(resolved);
    } catch (e) {
      logger.warn('[excelCellDiscovery] agent 绑定数据源解析失败:', e.message);
    }
  }

  return null;
}

/**
 * 执行 Excel 单元格混合检索（可选挂别名）
 * @returns {Promise<object>} 可 JSON.stringify 的结果对象
 */
async function runExcelCellSearch({
  entityId,
  query,
  topK = 5,
  minScore = 0.4,
  filename = null,
  attachAliases = false,
  logPrefix = 'excelCellDiscovery',
}) {
  const filenameFilter =
    typeof filename === 'string' && filename.trim() ? filename.trim() : null;

  logger.info(
    `[${logPrefix}] query="${query}", entityId=${entityId}, topK=${topK}, filename=${filenameFilter || '(all)'}`,
  );

  if (!entityId) {
    return {
      success: false,
      entityId: null,
      error:
        '未找到关联的数据源 ID（entityId）。请在「项目管理」绑定智能体与数据源，或在左侧业务列表选择数据源。',
      results: [],
    };
  }

  const ServiceClass = loadVectorService();
  const svc = new ServiceClass();

  let results = await svc.search({
    entityId,
    query,
    topK,
    minScore,
    filename: filenameFilter,
  });

  if (attachAliases && results?.length && filenameFilter) {
    try {
      const AliasClass = loadAliasService();
      const aliasSvc = new AliasClass(svc);
      results = await aliasSvc.attachAliasesToSearchResults({
        entityId,
        filename: filenameFilter,
        results,
      });
    } catch (e) {
      logger.warn(`[${logPrefix}] 挂载别名失败（忽略）: ${e.message}`);
    }
  }

  if (!results || results.length === 0) {
    const scope = filenameFilter
      ? `文件「${filenameFilter}」`
      : `数据源 ${entityId} 的结构化知识文件`;
    return {
      success: true,
      query,
      entityId,
      filename: filenameFilter || null,
      results: [],
      summary: `未在${scope}中找到与「${query}」相关的数据行。`,
    };
  }

  const formatted = results.map((r, i) => ({
    rank: i + 1,
    score: Math.round(r.score * 100) / 100,
    matched_column: r.columnName,
    matched_value: r.cellValue,
    is_primary_column: r.isPrimaryColumn || false,
    matched_via_alias: Boolean(r.matchedViaAlias),
    row_key: r.rowKey || undefined,
    aliases: Array.isArray(r.aliases) ? r.aliases : undefined,
    full_row: r.fullRow,
    filename: r.filename,
    sheet: r.sheetName,
    row_index: r.rowIndex,
  }));

  const primaryHits = formatted.filter((r) => r.is_primary_column);
  const aliasHits = formatted.filter((r) => r.matched_via_alias);
  const scopeHint = filenameFilter ? `（限定文件 ${filenameFilter}）` : '';
  let summary =
    primaryHits.length > 0
      ? `在主列中精确命中 ${primaryHits.length} 条，共返回 ${formatted.length} 条相关数据行${scopeHint}。`
      : `共返回 ${formatted.length} 条相关数据行（语义匹配）${scopeHint}。`;
  if (aliasHits.length > 0) {
    summary += ` 其中 ${aliasHits.length} 条经别名命中。`;
  }

  logger.info(
    `[${logPrefix}] 返回 ${formatted.length} 条，主列命中 ${primaryHits.length}，别名命中 ${aliasHits.length}`,
  );

  return {
    success: true,
    query,
    entityId,
    filename: filenameFilter || null,
    total: formatted.length,
    summary,
    results: formatted,
  };
}

module.exports = {
  KPI_FILENAME,
  ORG_FILENAME,
  cleanId,
  resolveEntityId,
  runExcelCellSearch,
};
