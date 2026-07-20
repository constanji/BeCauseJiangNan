const express = require('express');
const { getTask, startProbe } = require('../services/ProbeOrchestrator');
const { getDb } = require('../db/sqlite');
const { ApiError, badRequest, notFound } = require('../lib/apiErrors');

const router = express.Router();

router.post('/run', (req, res) => {
  const { endpointId, model, config } = req.body || {};

  if (!endpointId || !model) {
    return badRequest(res, ApiError.ENDPOINT_AND_MODEL_REQUIRED);
  }

  const endpoint = getDb().prepare('SELECT id FROM endpoints WHERE id = ?').get(endpointId);
  if (!endpoint) {
    return notFound(res, ApiError.ENDPOINT_NOT_FOUND);
  }

  const defaultConfig = {
    layers: ['direct', 'assembled'],
    warmup: 1,
    latencySamples: 3,
    concurrency: 2,
    throughputDurationSec: 20,
    probeGeneration: true,
    decodeMaxTokens: 256,
    decodeSamples: 2,
    probeLongOutput: true,
    longOutputMaxTokens: 256,
    probeLongInput: false,
    longInputTokens: 4096,
    longInputMaxTokens: 32,
    probeContext: false,
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
    return notFound(res, ApiError.TASK_NOT_FOUND);
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
