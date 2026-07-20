const express = require('express');
const { getTask, startProbe } = require('../services/ProbeOrchestrator');
const { getDb } = require('../db/sqlite');

const router = express.Router();

router.post('/run', (req, res) => {
  const { endpointId, model, config } = req.body || {};

  if (!endpointId || !model) {
    return res.status(400).json({ success: false, error: 'endpointId and model required' });
  }

  const endpoint = getDb().prepare('SELECT id FROM endpoints WHERE id = ?').get(endpointId);
  if (!endpoint) {
    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  }

  const defaultConfig = {
    layers: ['direct', 'assembled'],
    warmup: 1,
    latencySamples: 3,
    concurrency: 2,
    throughputDurationSec: 20,
    probeContext: true,
  };

  const taskId = startProbe({
    endpointId,
    model,
    config: { ...defaultConfig, ...config },
  });

  res.status(202).json({ success: true, taskId });
});

router.get('/task/:taskId', (req, res) => {
  const mem = getTask(req.params.taskId);
  const row = getDb().prepare('SELECT * FROM probe_reports WHERE task_id = ?').get(req.params.taskId);

  if (!mem && !row) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  const statusLogs = mem?.statusLogs || (row?.status_logs_json ? JSON.parse(row.status_logs_json) : []);

  res.json({
    success: true,
    taskId: req.params.taskId,
    status: mem?.status || row?.status,
    progress: mem?.progress ?? row?.progress ?? 0,
    error: mem?.error || row?.error,
    statusLogs,
    report: mem?.report || (row?.report_json ? JSON.parse(row.report_json) : null),
    model: row?.model,
    endpointId: row?.endpoint_id,
    config: row?.config_json ? JSON.parse(row.config_json) : null,
    startedAt: row?.started_at,
    completedAt: row?.completed_at,
  });
});

module.exports = router;
