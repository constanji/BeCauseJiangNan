const { v4: uuidv4 } = require('uuid');
const { getDb, now } = require('../db/sqlite');
const { parseEndpointRow } = require('./RequestAssembler');
const { runDirectProbe, runAssembledProbe } = require('./StreamingProbe');
const {
  collectLatencySamples,
  measureThroughput,
  measureContextWindow,
  buildCompareReport,
} = require('./MetricsCollector');

const tasks = new Map();

function getTask(taskId) {
  return tasks.get(taskId);
}

function persistReport(taskId, patch) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM probe_reports WHERE task_id = ?').get(taskId);
  if (!row) return;

  const fields = [];
  const values = [];

  for (const [key, val] of Object.entries(patch)) {
    if (key === 'status_logs') {
      fields.push('status_logs_json = ?');
      values.push(JSON.stringify(val));
    } else if (key === 'report') {
      fields.push('report_json = ?');
      values.push(JSON.stringify(val));
    } else if (key === 'config') {
      fields.push('config_json = ?');
      values.push(JSON.stringify(val));
    } else {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  values.push(taskId);
  db.prepare(`UPDATE probe_reports SET ${fields.join(', ')} WHERE task_id = ?`).run(...values);
}

async function runProbeTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return;

  const pushLog = (msg) => {
    task.statusLogs.push(`[${new Date().toISOString()}] ${msg}`);
    task.progress = Math.min(task.progress + 1, 99);
    persistReport(taskId, { status_logs: task.statusLogs, progress: task.progress });
  };

  try {
    task.status = 'running';
    task.startedAt = now();
    persistReport(taskId, { status: 'running', started_at: task.startedAt, progress: 5 });

    const db = getDb();
    const endpointRow = db.prepare('SELECT * FROM endpoints WHERE id = ?').get(task.endpointId);
    if (!endpointRow) throw new Error('Endpoint not found');

    const endpoint = parseEndpointRow(endpointRow);
    const { model, config } = task;
    const layers = config.layers || ['direct', 'assembled'];

    pushLog(`开始探测 endpoint=${endpoint.name} model=${model} layers=${layers.join(',')}`);

    const identity = {};

    if (layers.includes('direct')) {
      pushLog('[identity] direct layer');
      const r = await runDirectProbe({ endpoint, model });
      identity.direct = {
        l1: r.l1,
        l2: r.l2,
        l3: r.l3,
        match: r.match,
        assemblyNotes: r.assemblyNotes,
        baseURL: endpoint.base_url,
      };
    }

    if (layers.includes('assembled')) {
      pushLog('[identity] assembled layer');
      const r = await runAssembledProbe({ endpoint, model });
      identity.assembled = {
        l1: r.l1,
        l2: r.l2,
        l3: r.l3,
        match: r.match,
        assemblyNotes: r.assemblyNotes,
        baseURL: endpoint.base_url,
      };
    }

    task.progress = 25;
    persistReport(taskId, { progress: 25 });

    pushLog('[latency] collecting samples');
    const latency = await collectLatencySamples({
      endpoint,
      model,
      layers,
      config,
      onLog: pushLog,
    });

    task.progress = 50;
    persistReport(taskId, { progress: 50 });

    const throughput = {};
    for (const layer of layers) {
      pushLog(`[throughput] ${layer}`);
      throughput[layer] = await measureThroughput({
        endpoint,
        model,
        layer,
        config,
        onLog: pushLog,
      });
    }

    task.progress = 75;
    persistReport(taskId, { progress: 75 });

    const context = {};
    if (config.probeContext !== false) {
      for (const layer of layers) {
        pushLog(`[context] ${layer}`);
        context[layer] = await measureContextWindow({
          endpoint,
          model,
          layer,
          config: { ...config, claimedContextTokens: endpoint.claimed_context_tokens },
          onLog: pushLog,
        });
      }
    }

    const report = {
      taskId,
      endpoint: { id: endpoint.id, name: endpoint.name, type: endpoint.type, base_url: endpoint.base_url },
      model,
      config,
      identity,
      latency,
      throughput,
      context,
      compare: buildCompareReport(identity, latency, throughput),
      generatedAt: now(),
    };

    task.status = 'completed';
    task.progress = 100;
    task.report = report;
    task.completedAt = now();

    persistReport(taskId, {
      status: 'completed',
      progress: 100,
      report,
      status_logs: task.statusLogs,
      completed_at: task.completedAt,
    });

    pushLog('探测完成');
  } catch (err) {
    task.status = 'failed';
    task.error = err.message;
    persistReport(taskId, {
      status: 'failed',
      error: err.message,
      status_logs: task.statusLogs,
      completed_at: now(),
    });
    pushLog(`失败: ${err.message}`);
  }
}

function startProbe({ endpointId, model, config = {} }) {
  const taskId = uuidv4();
  const db = getDb();

  db.prepare(`
    INSERT INTO probe_reports (task_id, endpoint_id, model, status, progress, config_json, status_logs_json, created_at)
    VALUES (?, ?, ?, 'pending', 0, ?, '[]', ?)
  `).run(taskId, endpointId, model, JSON.stringify(config), now());

  const task = {
    taskId,
    endpointId,
    model,
    config,
    status: 'pending',
    progress: 0,
    statusLogs: [],
    report: null,
    error: null,
  };

  tasks.set(taskId, task);
  setImmediate(() => runProbeTask(taskId));
  return taskId;
}

module.exports = { tasks, getTask, startProbe, runProbeTask };
