const express = require('express');
const { getDb } = require('../db/sqlite');

const router = express.Router();

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
    data: rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      endpointId: r.endpoint_id,
      endpointName: r.endpoint_name,
      endpointType: r.endpoint_type,
      model: r.model,
      status: r.status,
      progress: r.progress,
      error: r.error,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    })),
  });
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

  if (!row) return res.status(404).json({ success: false, error: 'Not found' });

  res.json({
    success: true,
    data: {
      taskId: row.task_id,
      endpoint: { id: row.endpoint_id, name: row.endpoint_name, type: row.endpoint_type, base_url: row.base_url },
      model: row.model,
      status: row.status,
      progress: row.progress,
      config: row.config_json ? JSON.parse(row.config_json) : null,
      report: row.report_json ? JSON.parse(row.report_json) : null,
      statusLogs: row.status_logs_json ? JSON.parse(row.status_logs_json) : [],
      error: row.error,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    },
  });
});

module.exports = router;
