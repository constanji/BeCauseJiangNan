const express = require('express');
const { getTask, startCapability } = require('../services/CapabilityOrchestrator');
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

  const suites = Array.isArray(config?.suites) ? config.suites : ['format', 'tools', 'because'];
  const allowed = new Set(['format', 'tools', 'because']);
  const validSuites = suites.filter((s) => allowed.has(s));
  const unknown = suites.filter((s) => !allowed.has(s));
  if (unknown.length) {
    return badRequest(res, `未知套件：${unknown.join('、')}。可选：format / tools / because`);
  }
  if (!validSuites.length) {
    return badRequest(res, '请至少选择一个套件：输出规范(format)、工具协议(tools) 或问数工具(because)');
  }

  const defaultConfig = {
    kind: 'capability',
    layers: ['direct', 'assembled'],
    suites: validSuites,
    timeoutMs: 120000,
  };

  const taskId = startCapability({
    endpointId,
    model,
    config: { ...defaultConfig, ...config, suites: validSuites, kind: 'capability' },
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
