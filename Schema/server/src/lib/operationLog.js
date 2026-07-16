const logger = require('./logger');
const { formatDuration } = require('./formatDuration');
const { parseContent } = require('./lightSchemaIndex');
const { shortenDbError } = require('../services/DatabaseService');

function columnNamesFromContent(content) {
  const parsed = typeof content === 'string' ? parseContent(content) : content;
  if (!parsed?.columns) return [];
  return parsed.columns.map((col) => String(col.name || '').trim()).filter(Boolean);
}

function diffColumnNames(beforeNames, afterNames) {
  const beforeSet = new Set(beforeNames);
  const afterSet = new Set(afterNames);
  return {
    beforeCount: beforeNames.length,
    afterCount: afterNames.length,
    removed: beforeNames.filter((name) => !afterSet.has(name)),
    added: afterNames.filter((name) => !beforeSet.has(name)),
  };
}

function tableLabel(ctx) {
  return `${ctx.schemaName}.${ctx.tableName}`;
}

function sourceLabel(ctx) {
  const name = ctx.dataSourceName || '数据源';
  const id = ctx.dataSourceId != null ? `#${ctx.dataSourceId}` : '';
  return `${name}${id}`;
}

function buildCtxFromRow(row, dataSource) {
  return {
    dataSourceId: row.data_source_id,
    dataSourceName: row.data_source_name,
    dbType: dataSource?.type,
    schemaName: row.schema_name,
    tableName: row.table_name,
    lightSchemaId: row.id,
  };
}

function buildCtxFromSource(source, dataSource, schemaName, tableName) {
  return {
    dataSourceId: source.id,
    dataSourceName: source.name,
    dbType: dataSource?.type,
    schemaName,
    tableName,
  };
}

function formatColumnChangeDetail(diff) {
  const parts = [`${diff.beforeCount}列 → ${diff.afterCount}列`];
  if (diff.removed.length > 0) parts.push(`删除列: ${diff.removed.join(', ')}`);
  if (diff.added.length > 0) parts.push(`新增列: ${diff.added.join(', ')}`);
  return parts.join(' · ');
}

function logLightSchemaUpdate(row, beforeContent, normalized, error) {
  const ref = `${sourceLabel(buildCtxFromRow(row))} · ${tableLabel(buildCtxFromRow(row))}`;
  if (error) {
    logger.error(`LightSchema 更新失败 · ${ref} · ${error.message || String(error)}`, {
      lightSchemaId: row?.id,
    });
    return;
  }
  const diff = diffColumnNames(
    columnNamesFromContent(beforeContent),
    columnNamesFromContent(normalized),
  );
  logger.info(`LightSchema 更新成功 · ${ref} · ${formatColumnChangeDetail(diff)}`, {
    lightSchemaId: row.id,
    removedColumns: diff.removed.length || undefined,
    addedColumns: diff.added.length || undefined,
  });
}

function logLightSchemaDelete(row, success, error) {
  if (!row) {
    logger.error(`LightSchema 整表删除失败 · 记录不存在 · ${error?.message || error || '未找到'}`);
    return;
  }
  const ctx = buildCtxFromRow(row);
  const ref = `${sourceLabel(ctx)} · ${tableLabel(ctx)}`;
  if (!success) {
    logger.error(`LightSchema 整表删除失败 · ${ref} · ${error?.message || error || '未找到'}`, {
      lightSchemaId: row.id,
    });
    return;
  }
  const columnCount = columnNamesFromContent(row.content).length;
  logger.info(`LightSchema 整表删除成功 · ${ref} · 已移除 ${columnCount} 列定义`, {
    lightSchemaId: row.id,
    columnCount,
  });
}

function logDbQueryStart(action, ctx, extra = {}) {
  logger.info(`连库 ${action} 开始 · ${sourceLabel(ctx)} · ${ctx.dbType || 'unknown'} · ${tableLabel(ctx)}`, {
    lightSchemaId: ctx.lightSchemaId,
    ...extra,
  });
}

function logDbQueryOk(action, ctx, result = {}, elapsedMs) {
  const rowCount = result.rowCount ?? result.rows?.length ?? result.values?.length ?? 0;
  const parts = [
    `连库 ${action} 成功`,
    sourceLabel(ctx),
    tableLabel(ctx),
    `返回 ${rowCount} 条`,
  ];
  if (result.truncated) parts.push('已截断');
  if (result.filtered) parts.push('含筛选');
  if (result.deduped) parts.push(`去重列 ${result.dedupeBy}`);
  logger.info(parts.join(' · '), {
    lightSchemaId: ctx.lightSchemaId,
    elapsedMs,
    rowCount,
  });
}

function logDbQueryFail(action, ctx, error, elapsedMs) {
  const message = shortenDbError(error?.message || String(error));
  logger.error(`连库 ${action} 失败 · ${sourceLabel(ctx)} · ${tableLabel(ctx)} · ${message}`, {
    lightSchemaId: ctx.lightSchemaId,
    elapsedMs,
    dbType: ctx.dbType,
  });
}

function logDbTableMissing(action, ctx) {
  logger.warn(`连库 ${action} 跳过 · ${sourceLabel(ctx)} · 远程表不存在 · ${tableLabel(ctx)}`, {
    lightSchemaId: ctx.lightSchemaId,
  });
}

module.exports = {
  columnNamesFromContent,
  diffColumnNames,
  buildCtxFromRow,
  buildCtxFromSource,
  logLightSchemaUpdate,
  logLightSchemaDelete,
  logDbQueryStart,
  logDbQueryOk,
  logDbQueryFail,
  logDbTableMissing,
  formatColumnChangeDetail,
  formatDuration,
};
