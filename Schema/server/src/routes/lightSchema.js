const express = require('express');
const { getDb, now } = require('../db/sqlite');
const { decrypt } = require('../services/crypto');
const { getTableSchema, isTableEmpty } = require('../services/DatabaseService');
const { buildColumnSearchText } = require('../lib/lightSchemaIndex');
const { updateLightSchemaById, deleteLightSchemaById } = require('../lib/lightSchemaContent');
const { toConnectionConfig } = require('../lib/dataSourceConfig');
const logger = require('../lib/logger');
const { formatDuration, progressPrefix } = require('../lib/formatDuration');
const { withTimeout, TimeoutError, slowTableThresholdMs } = require('../lib/withTimeout');

const router = express.Router({ mergeParams: true });

function sourceById(id) {
  return getDb().prepare('SELECT * FROM data_sources WHERE id = ?').get(id);
}

function listRows(id, schemaName) {
  const stmt = schemaName
    ? getDb().prepare('SELECT * FROM light_schemas WHERE data_source_id = ? AND schema_name = ? ORDER BY table_name')
    : getDb().prepare('SELECT * FROM light_schemas WHERE data_source_id = ? ORDER BY table_name');
  return schemaName ? stmt.all(id, schemaName) : stmt.all(id);
}

router.post('/generate', async (req, res) => {
  const source = sourceById(req.params.id);
  if (!source) return res.status(404).json({ success: false, error: '数据源不存在' });
  const body = req.body || {};
  const tableNames = Array.isArray(body.tableNames) ? body.tableNames : [];
  if (tableNames.length === 0) {
    return res.status(400).json({ success: false, error: '请至少选择一张表' });
  }
  const sampleLimit = Math.max(1, Math.min(Number(body.sampleLimit || 5), 20));
  const sampleScope = body.sampleScope === 'all_columns' ? 'all_columns' : 'text_only';
  const skipEmptyTables = body.skipEmptyTables === true;
  const tableTimeoutMs = Math.max(0, Number(body.tableTimeoutMs) || 0);
  const slowThresholdMs = slowTableThresholdMs();
  const progress = body.progress && typeof body.progress === 'object' ? body.progress : null;
  const prefix = progressPrefix(progress);
  const password = decrypt(source.password_enc);
  const dataSource = toConnectionConfig(source);
  let schemaName = body.schemaName;
  if (!schemaName) {
    schemaName = dataSource.type === 'mysql' ? dataSource.database : 'public';
  }
  const out = [];
  const skipped = [];
  const slowTables = [];
  const sampleWarnings = [];
  const startedAt = Date.now();
  const batchLabel = tableNames.length === 1 && prefix
    ? prefix
    : `[batch ${tableNames.length}]`;
  logger.info(`${batchLabel} LightSchema 生成开始 · ${source.name} · ${schemaName}`, {
    dataSourceId: source.id,
    dbType: dataSource.type,
    tableCount: tableNames.length,
    sampleLimit,
    sampleScope,
    skipEmptyTables,
    tableTimeoutMs: tableTimeoutMs || '无',
  });
  const stmt = getDb().prepare(`
    INSERT INTO light_schemas (data_source_id, schema_name, table_name, content, ddl_text, column_search_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_source_id, schema_name, table_name)
    DO UPDATE SET content = excluded.content, ddl_text = excluded.ddl_text,
      column_search_text = excluded.column_search_text, updated_at = excluded.updated_at
  `);
  for (let ti = 0; ti < tableNames.length; ti += 1) {
    const tableName = tableNames[ti];
    const tableStartedAt = Date.now();
    const tablePrefix = prefix || (tableNames.length > 1 ? `[${ti + 1}/${tableNames.length}]` : '');
    logger.info(`${tablePrefix} 开始 ${schemaName}.${tableName}`.trim(), {
      dataSourceId: source.id,
      columnHint: '采样中',
    });

    const processTable = async () => {
      if (skipEmptyTables) {
        try {
          if (await isTableEmpty(dataSource, password, schemaName, tableName)) {
            return { kind: 'skipped', record: { tableName, error: '空表', reason: 'empty_table' } };
          }
        } catch (error) {
          return { kind: 'skipped', record: { tableName, error: error.message, reason: 'row_count_failed' } };
        }
      }
      const schema = await getTableSchema(dataSource, password, schemaName, tableName, sampleLimit, sampleScope);
      return { kind: 'ok', schema };
    };

    try {
      const result = await withTimeout(processTable(), tableTimeoutMs, `表 ${tableName} 处理`);

      if (result.kind === 'skipped') {
        const elapsedMs = Date.now() - tableStartedAt;
        skipped.push({ ...result.record, elapsedMs });
        const isEmpty = result.record.reason === 'empty_table';
        const logFn = isEmpty ? logger.info.bind(logger) : logger.warn.bind(logger);
        logFn(`${tablePrefix} 跳过 ${schemaName}.${tableName} · ${result.record.error}`.trim(), {
          dataSourceId: source.id,
          elapsedMs,
          reason: result.record.reason,
        });
        continue;
      }

      const schema = result.schema;
      const searchText = buildColumnSearchText(schema);
      stmt.run(source.id, schemaName, tableName, JSON.stringify(schema), schema.ddlText, searchText, now(), now());
      out.push(schema);
      if (Array.isArray(schema.sampleWarnings) && schema.sampleWarnings.length > 0) {
        sampleWarnings.push(...schema.sampleWarnings.map((item) => ({ tableName, ...item })));
      }
      const elapsedMs = Date.now() - tableStartedAt;
      const columnCount = schema.columns?.length || 0;
      logger.info(`${tablePrefix} 完成 ${schemaName}.${tableName} · ${columnCount} 列`.trim(), {
        dataSourceId: source.id,
        sampleWarnings: schema.sampleWarnings?.length || 0,
        elapsedMs,
      });
      if (elapsedMs >= slowThresholdMs) {
        const slow = { tableName, columnCount, elapsedMs, reason: 'slow_success' };
        slowTables.push(slow);
        logger.warn(`${tablePrefix} 慢表 ${schemaName}.${tableName} · ${columnCount} 列 · 成功`.trim(), {
          dataSourceId: source.id,
          elapsedMs,
          columnCount,
          reason: 'slow_success',
        });
      }
    } catch (error) {
      const elapsedMs = error instanceof TimeoutError && error.elapsedMs
        ? error.elapsedMs
        : Date.now() - tableStartedAt;
      const reason = error instanceof TimeoutError ? 'timeout' : 'generate_failed';
      skipped.push({ tableName, error: error.message, reason, elapsedMs });
      const slow = { tableName, elapsedMs, reason, error: error.message };
      slowTables.push(slow);
      if (reason === 'timeout') {
        logger.warn(`${tablePrefix} 跳过 ${schemaName}.${tableName} · 超时`.trim(), {
          dataSourceId: source.id,
          elapsedMs,
          tableTimeoutMs,
          reason: 'timeout',
        });
      } else {
        logger.error(`${tablePrefix} 失败 ${schemaName}.${tableName} · ${error.message}`.trim(), {
          dataSourceId: source.id,
          elapsedMs,
          reason: 'generate_failed',
        });
      }
    }
  }
  if (slowTables.length > 0) {
    logger.warn(`${batchLabel} 慢表/跳过汇总 · ${slowTables.length} 张`, {
      dataSourceId: source.id,
      schemaName,
      tables: slowTables.map((t) => `${t.tableName}(${formatDuration(t.elapsedMs)}${t.columnCount != null ? `,${t.columnCount}列` : ''},${t.reason})`).join('; '),
    });
  }
  logger.info(`${batchLabel} LightSchema 生成结束 · 成功 ${out.length} · 跳过 ${skipped.length}`.trim(), {
    dataSourceId: source.id,
    schemaName,
    requested: tableNames.length,
    generated: out.length,
    skipped: skipped.length,
    elapsedMs: Date.now() - startedAt,
  });
  res.json({
    success: true,
    data: out,
    summary: {
      schemaName,
      requested: tableNames.length,
      generated: out.length,
      skipped: skipped.length,
      skippedEmpty: skipped.filter((x) => x.reason === 'empty_table').length,
      skippedTables: skipped,
      slowTables,
      sampleWarnings,
    },
  });
});

router.get('/', (req, res) => {
  const schemaName = typeof req.query.schemaName === 'string' ? req.query.schemaName : undefined;
  const rows = listRows(req.params.id, schemaName);
  res.json({ success: true, data: rows });
});

router.get('/:tableName', (req, res) => {
  const schemaName = typeof req.query.schemaName === 'string' ? req.query.schemaName : 'public';
  const row = getDb()
    .prepare('SELECT * FROM light_schemas WHERE data_source_id = ? AND schema_name = ? AND table_name = ?')
    .get(req.params.id, schemaName, req.params.tableName);
  if (!row) return res.status(404).json({ success: false, error: '未找到 LightSchema' });
  res.json({ success: true, data: row });
});

router.put('/:tableName', (req, res) => {
  const schemaName = typeof req.query.schemaName === 'string' ? req.query.schemaName : 'public';
  const row = getDb()
    .prepare('SELECT id FROM light_schemas WHERE data_source_id = ? AND schema_name = ? AND table_name = ?')
    .get(req.params.id, schemaName, req.params.tableName);
  if (!row) return res.status(404).json({ success: false, error: '未找到 LightSchema' });
  try {
    const { normalized, ddlText, updatedAt } = updateLightSchemaById(row.id, req.body?.content);
    res.json({
      success: true,
      data: {
        id: row.id,
        data_source_id: Number(req.params.id),
        schema_name: schemaName,
        table_name: req.params.tableName,
        content: JSON.stringify(normalized),
        ddl_text: ddlText,
        updated_at: updatedAt,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/:tableName', (req, res) => {
  const schemaName = typeof req.query.schemaName === 'string' ? req.query.schemaName : 'public';
  const result = getDb()
    .prepare('DELETE FROM light_schemas WHERE data_source_id = ? AND schema_name = ? AND table_name = ?')
    .run(req.params.id, schemaName, req.params.tableName);
  res.json({ success: true, deleted: result.changes > 0 });
});

module.exports = router;
