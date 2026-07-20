const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, now } = require('../db/sqlite');
const { ApiError, badRequest, notFound } = require('../lib/apiErrors');

const router = express.Router();

function normalizeImportPayload(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.format === 'tokenprobe-report' && body.report) return body.report;
  if (body.report && typeof body.report === 'object') {
    return { ...body.report, ...(['taskId', 'summary', 'steps'].some((k) => k in body) ? {} : {}) };
  }
  if (body.summary && body.steps) return body;
  return null;
}

router.get('/', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT r.task_id, r.status, r.progress, r.created_at, r.completed_at, r.error,
              r.report_json, r.config_json, c.name AS connection_name
       FROM probe_reports r
       LEFT JOIN connections c ON c.id = r.connection_id
       ORDER BY r.created_at DESC
       LIMIT 200`,
    )
    .all();

  const data = rows.map((r) => {
    let question = null;
    let chainTotal = null;
    let peak = null;
    let source = null;
    try {
      const report = r.report_json ? JSON.parse(r.report_json) : null;
      const config = r.config_json ? JSON.parse(r.config_json) : null;
      question = report?.question || config?.question || null;
      chainTotal = report?.summary?.chainTotalTokens ?? null;
      peak = report?.summary?.peakContextTokens ?? null;
      source = report?.source || null;
    } catch {
      // ignore
    }
    return {
      taskId: r.task_id,
      status: r.status,
      progress: r.progress,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      error: r.error,
      connectionName: r.connection_name || (source === 'imported' ? '导入报告' : null),
      question,
      chainTotalTokens: chainTotal,
      peakContextTokens: peak,
      source,
    };
  });

  res.json({ success: true, data });
});

router.get('/:taskId', (req, res) => {
  const row = getDb().prepare('SELECT * FROM probe_reports WHERE task_id = ?').get(req.params.taskId);
  if (!row) return notFound(res, ApiError.REPORT_NOT_FOUND);
  return res.json({
    success: true,
    data: {
      taskId: row.task_id,
      status: row.status,
      progress: row.progress,
      error: row.error,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      statusLogs: row.status_logs_json ? JSON.parse(row.status_logs_json) : [],
      config: row.config_json ? JSON.parse(row.config_json) : null,
      report: row.report_json ? JSON.parse(row.report_json) : null,
    },
  });
});

router.delete('/:taskId', (req, res) => {
  const info = getDb().prepare('DELETE FROM probe_reports WHERE task_id = ?').run(req.params.taskId);
  if (!info.changes) return notFound(res, ApiError.REPORT_NOT_FOUND);
  return res.json({ success: true });
});

router.post('/delete-batch', (req, res) => {
  const taskIds = req.body?.taskIds;
  if (!Array.isArray(taskIds) || !taskIds.length) {
    return badRequest(res, ApiError.TASK_IDS_REQUIRED);
  }
  const stmt = getDb().prepare('DELETE FROM probe_reports WHERE task_id = ?');
  let deleted = 0;
  const tx = getDb().transaction((ids) => {
    for (const id of ids) {
      deleted += stmt.run(id).changes;
    }
  });
  tx(taskIds);
  return res.json({ success: true, deleted });
});

router.post('/import', (req, res) => {
  const report = normalizeImportPayload(req.body);
  if (!report || !report.summary || !report.steps) {
    return badRequest(res, '无法识别的报告格式，需要 tokenprobe-report 或含 summary/steps 的对象');
  }
  const taskId = uuidv4();
  const ts = now();
  const imported = {
    ...report,
    taskId,
    generatedAt: report.generatedAt || ts,
    source: 'imported',
    originalTaskId: report.taskId || null,
  };
  getDb()
    .prepare(
      `INSERT INTO probe_reports (
        task_id, connection_id, status, progress, config_json, report_json, status_logs_json,
        started_at, completed_at, created_at
      ) VALUES (?, NULL, 'completed', 100, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      taskId,
      JSON.stringify({ imported: true }),
      JSON.stringify(imported),
      JSON.stringify([`[${ts}] 导入报告`]),
      ts,
      ts,
      ts,
    );
  return res.json({ success: true, taskId, message: '导入成功' });
});

module.exports = router;
