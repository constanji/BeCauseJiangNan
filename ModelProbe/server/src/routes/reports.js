const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, now } = require('../db/sqlite');
const { encrypt } = require('../lib/crypto');
const { ApiError, badRequest, notFound } = require('../lib/apiErrors');

const router = express.Router();

const IMPORT_ENDPOINT_NAME = '__imported__';

function ensureImportEndpoint() {
  const db = getDb();
  let row = db.prepare('SELECT id FROM endpoints WHERE name = ?').get(IMPORT_ENDPOINT_NAME);
  if (row) return row.id;

  const ts = now();
  const result = db
    .prepare(`
      INSERT INTO endpoints (
        name, type, base_url, api_key_enc, default_model,
        created_at, updated_at
      ) VALUES (?, 'custom', 'imported://local', ?, NULL, ?, ?)
    `)
    .run(IMPORT_ENDPOINT_NAME, encrypt('imported-placeholder'), ts, ts);
  return Number(result.lastInsertRowid);
}

function normalizeImportPayload(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('无效的 JSON：需要对象');
  }

  // 包装格式：{ format, version, report }
  if (body.format === 'modelprobe-report' && body.report) {
    return body.report;
  }

  // 详情接口整包：{ taskId, report, model, endpoint, ... }
  if (body.report && typeof body.report === 'object') {
    return {
      ...body.report,
      model: body.report.model || body.model,
      endpoint: body.report.endpoint || body.endpoint,
      config: body.report.config || body.config,
      generatedAt: body.report.generatedAt || body.completedAt || body.createdAt,
    };
  }

  // 导出的纯 report：{ taskId, endpoint, model, identity, latency, ... }
  if (body.identity || body.latency || body.throughput) {
    return body;
  }

  throw new Error(
    '无法识别的报告格式。请使用本工具「导出 JSON」生成的文件（含 identity / latency 等字段）',
  );
}

router.get('/', (req, res) => {
  const rows = getDb()
    .prepare(`
      SELECT r.*, e.name AS endpoint_name, e.type AS endpoint_type
      FROM probe_reports r
      JOIN endpoints e ON e.id = r.endpoint_id
      ORDER BY r.created_at DESC
      LIMIT 100
    `)
    .all();

  res.json({
    success: true,
    data: rows.map((r) => {
      let endpointName = r.endpoint_name;
      let imported = endpointName === IMPORT_ENDPOINT_NAME;
      if (imported && r.report_json) {
        try {
          const report = JSON.parse(r.report_json);
          endpointName = report.endpoint?.name || '导入报告';
        } catch {
          endpointName = '导入报告';
        }
      }
      return {
        id: r.id,
        taskId: r.task_id,
        endpointId: r.endpoint_id,
        endpointName,
        endpointType: r.endpoint_type,
        model: r.model,
        status: r.status,
        progress: r.progress,
        error: r.error,
        imported,
        kind: (() => {
          try {
            const cfg = r.config_json ? JSON.parse(r.config_json) : {};
            if (cfg.kind === 'capability') return 'capability';
            if (r.report_json) {
              const rep = JSON.parse(r.report_json);
              if (rep.kind === 'capability') return 'capability';
            }
            return 'performance';
          } catch {
            return 'performance';
          }
        })(),
        createdAt: r.created_at,
        completedAt: r.completed_at,
      };
    }),
  });
});

router.post('/import', (req, res) => {
  try {
    const report = normalizeImportPayload(req.body);
    const model = report.model || report.endpoint?.default_model;
    if (!model) {
      return badRequest(res, '报告缺少 model 字段');
    }
    if (!report.identity && !report.latency && !report.throughput) {
      return badRequest(res, '报告内容不完整：至少应包含 identity / latency / throughput 之一');
    }

    const taskId = uuidv4();
    const endpointId = ensureImportEndpoint();
    const ts = now();
    const generatedAt = report.generatedAt || ts;

    const storedReport = {
      ...report,
      taskId,
      imported: true,
      importedAt: ts,
      originalTaskId: report.taskId || null,
    };

    getDb()
      .prepare(`
        INSERT INTO probe_reports (
          task_id, endpoint_id, model, status, progress,
          config_json, report_json, status_logs_json,
          started_at, completed_at, created_at
        ) VALUES (?, ?, ?, 'completed', 100, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        taskId,
        endpointId,
        model,
        JSON.stringify(report.config || { imported: true }),
        JSON.stringify(storedReport),
        JSON.stringify([`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 已从 JSON 导入报告`]),
        generatedAt,
        generatedAt,
        ts,
      );

    res.status(201).json({
      success: true,
      taskId,
      message: '导入成功',
    });
  } catch (err) {
    return badRequest(res, err.message);
  }
});

router.delete('/:taskId', (req, res) => {
  const result = getDb().prepare('DELETE FROM probe_reports WHERE task_id = ?').run(req.params.taskId);
  if (!result.changes) {
    return notFound(res, ApiError.REPORT_NOT_FOUND);
  }
  res.json({ success: true });
});

router.post('/delete-batch', (req, res) => {
  const ids = Array.isArray(req.body?.taskIds) ? req.body.taskIds.filter(Boolean) : [];
  if (!ids.length) {
    return badRequest(res, ApiError.TASK_IDS_REQUIRED);
  }
  const db = getDb();
  const stmt = db.prepare('DELETE FROM probe_reports WHERE task_id = ?');
  const tx = db.transaction((list) => {
    let n = 0;
    for (const id of list) n += stmt.run(id).changes;
    return n;
  });
  const deleted = tx(ids);
  res.json({ success: true, deleted });
});

router.get('/:taskId', (req, res) => {
  const row = getDb()
    .prepare(`
      SELECT r.*, e.name AS endpoint_name, e.type AS endpoint_type, e.base_url
      FROM probe_reports r
      JOIN endpoints e ON e.id = r.endpoint_id
      WHERE r.task_id = ?
    `)
    .get(req.params.taskId);

  if (!row) return notFound(res, ApiError.REPORT_NOT_FOUND);

  const report = row.report_json ? JSON.parse(row.report_json) : null;
  const imported = row.endpoint_name === IMPORT_ENDPOINT_NAME;
  const endpoint = imported && report?.endpoint
    ? {
        id: row.endpoint_id,
        name: report.endpoint.name || '导入报告',
        type: report.endpoint.type || 'custom',
        base_url: report.endpoint.base_url || '',
      }
    : {
        id: row.endpoint_id,
        name: row.endpoint_name,
        type: row.endpoint_type,
        base_url: row.base_url,
      };

  res.json({
    success: true,
    data: {
      taskId: row.task_id,
      endpoint,
      model: row.model,
      status: row.status,
      progress: row.progress,
      config: row.config_json ? JSON.parse(row.config_json) : null,
      report,
      statusLogs: row.status_logs_json ? JSON.parse(row.status_logs_json) : [],
      error: row.error,
      imported,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    },
  });
});

module.exports = router;
