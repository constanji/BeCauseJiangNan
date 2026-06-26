/**
 * Light Schema + Cell 向量联合检索（纯 pgvector，零 DB 连接）
 *
 * 供 light_schema / database_schema 缓存路径共用。
 */

const { logger } = require('@because/data-schemas');

const MAX_CELL_BOOST_TABLES = 5;
const DEFAULT_CELL_TOP_K = 10;
const DEFAULT_CELL_MIN_SCORE = 0.5;

/**
 * 合并检索文本：tool 入参 query → session 用户原话 → question 字段
 * @param {{ input?: object, req?: object, conversation?: object }} ctx
 * @returns {string}
 */
function resolveSearchText({ input = {}, req, conversation } = {}) {
  const fromInput = String(input.query || input.question || '').trim();
  if (fromInput) return fromInput;

  const fromReq = String(
    req?.body?.text || req?.body?.message || req?.body?.content || '',
  ).trim();
  if (fromReq) return fromReq;

  const fromConv = String(
    conversation?.lastUserMessage
    || conversation?.userMessage
    || '',
  ).trim();
  return fromConv;
}

/**
 * @param {Array<{ tableName: string, columnName: string, cellValue: string, score?: number }>} cellMatches
 * @returns {string}
 */
function formatCellMatchStr(cellMatches) {
  if (!cellMatches?.length) return '';
  return cellMatches
    .map((m) => `${m.tableName}.${m.columnName} = "${m.cellValue}"`)
    .join(', ');
}

/**
 * @param {object} params
 * @param {string} params.datasourceId
 * @param {string} [params.queryText]  语义 + cell 检索文本
 * @param {string[]} [params.tables]   精确表名列表
 * @param {number} [params.schemaTopK]
 * @param {number} [params.cellTopK]
 * @param {number} [params.cellMinScore]
 * @param {object} params.vectorDB     已初始化的 VectorDBService
 * @param {object} params.embeddingService
 * @returns {Promise<{
 *   rows: Array<{ tableName: string, content: string, score: number, source: string }>,
 *   cellMatches: Array<{ tableName: string, columnName: string, cellValue: string, score: number }>,
 *   cellMatchStr: string,
 *   cellTableBoost: string[],
 *   exactTableNames: string[],
 *   semanticTableNames: string[],
 * }>}
 */
async function retrieveLightSchemaBundle({
  datasourceId,
  queryText = '',
  tables = [],
  schemaTopK = 8,
  cellTopK = DEFAULT_CELL_TOP_K,
  cellMinScore = DEFAULT_CELL_MIN_SCORE,
  vectorDB,
  embeddingService,
}) {
  const mergedMap = new Map();
  const exactTableNames = [];
  const semanticTableNames = [];
  const cellTableBoost = [];
  let cellMatches = [];

  const addRow = (row, source) => {
    if (!row?.tableName || !row?.content) return;
    const existing = mergedMap.get(row.tableName);
    if (existing) {
      // 精确 > 语义 > cell_boost
      const priority = { exact: 3, semantic: 2, cell_boost: 1 };
      if ((priority[source] || 0) > (priority[existing.source] || 0)) {
        mergedMap.set(row.tableName, {
          tableName: row.tableName,
          content: row.content,
          score: row.score ?? existing.score,
          source,
        });
      }
      return;
    }
    mergedMap.set(row.tableName, {
      tableName: row.tableName,
      content: row.content,
      score: row.score ?? (source === 'exact' ? 1.0 : 0),
      source,
    });
  };

  // 1. 精确模式
  const tableList = Array.isArray(tables) ? tables.filter(Boolean) : [];
  if (tableList.length > 0) {
    const exactRows = await vectorDB.getLightSchemasByTableNames(datasourceId, tableList);
    for (const row of exactRows) {
      addRow(row, 'exact');
      exactTableNames.push(row.tableName);
    }
    logger.debug(
      `[lightSchemaRetrieval] 精确命中 ${exactRows.length}/${tableList.length} 张表`,
    );
  }

  const trimmedQuery = String(queryText || '').trim();

  // 2. 语义 + cell（一次 embed）
  if (trimmedQuery) {
    let queryEmbedding = null;
    try {
      queryEmbedding = await embeddingService.embedText(trimmedQuery);
    } catch (err) {
      logger.warn('[lightSchemaRetrieval] embedding 失败，跳过语义/cell 检索:', err.message);
    }

    if (queryEmbedding) {
      const searchTasks = [
        cellTopK > 0
          ? vectorDB.searchCells(datasourceId, queryEmbedding, cellTopK, cellMinScore)
          : Promise.resolve([]),
      ];
      if (schemaTopK > 0) {
        searchTasks.unshift(
          vectorDB.searchLightSchema(datasourceId, queryEmbedding, schemaTopK),
        );
      }

      const results = await Promise.all(searchTasks);
      const schemaResults = schemaTopK > 0 ? results[0] : [];
      const cellResults = schemaTopK > 0 ? results[1] : results[0];

      for (const row of schemaResults || []) {
        if (!mergedMap.has(row.tableName)) {
          semanticTableNames.push(row.tableName);
        }
        addRow(row, 'semantic');
      }

      cellMatches = cellResults || [];

      // 3. cell 命中表补 schema
      const boostCandidates = [...new Set(
        cellMatches.map((m) => m.tableName).filter((t) => t && !mergedMap.has(t)),
      )].slice(0, MAX_CELL_BOOST_TABLES);

      if (boostCandidates.length > 0) {
        const boostRows = await vectorDB.getLightSchemasByTableNames(datasourceId, boostCandidates);
        for (const row of boostRows) {
          addRow(row, 'cell_boost');
          cellTableBoost.push(row.tableName);
        }
        logger.debug(
          `[lightSchemaRetrieval] cell 补 schema ${boostRows.length} 张: ${cellTableBoost.join(', ')}`,
        );
      }
    }
  }

  const cellMatchStr = formatCellMatchStr(cellMatches);

  logger.info(
    `[lightSchemaRetrieval] 合计 ${mergedMap.size} 张表 ` +
    `(精确 ${exactTableNames.length}, 语义 ${semanticTableNames.length}, ` +
    `cell补 ${cellTableBoost.length}, cell匹配 ${cellMatches.length} 条)`,
  );

  return {
    rows: [...mergedMap.values()],
    cellMatches,
    cellMatchStr,
    cellTableBoost,
    exactTableNames,
    semanticTableNames: semanticTableNames.filter((n) => !exactTableNames.includes(n)),
  };
}

module.exports = {
  resolveSearchText,
  formatCellMatchStr,
  retrieveLightSchemaBundle,
  MAX_CELL_BOOST_TABLES,
  DEFAULT_CELL_TOP_K,
  DEFAULT_CELL_MIN_SCORE,
};
