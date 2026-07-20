const { v4: uuidv4 } = require('uuid');
const { getDb, now } = require('../db/sqlite');
const { formatProviderError } = require('../lib/formatProviderError');
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

  const layerName = (layer) => (layer === 'assembled' ? '组装层' : layer === 'direct' ? '直连层' : layer);

  const pushLog = (msg) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    task.statusLogs.push(`[${time}] ${msg}`);
    task.progress = Math.min(task.progress + 1, 99);
    persistReport(taskId, { status_logs: task.statusLogs, progress: task.progress });
  };

  try {
    task.status = 'running';
    task.startedAt = now();
    persistReport(taskId, { status: 'running', started_at: task.startedAt, progress: 5 });

    const db = getDb();
    const endpointRow = db.prepare('SELECT * FROM endpoints WHERE id = ?').get(task.endpointId);
    if (!endpointRow) throw new Error('端点不存在');

    const endpoint = parseEndpointRow(endpointRow);
    const { model, config } = task;
    const layers = config.layers || ['direct', 'assembled'];
    const layerText = layers.map(layerName).join('、');

    pushLog(`开始探测：端点「${endpoint.name}」，模型 ${model}，层：${layerText}`);

    const identity = {};

    if (layers.includes('direct')) {
      pushLog('[身份] 正在探测直连层（原样发送模型名）…');
      const r = await runDirectProbe({ endpoint, model });
      identity.direct = {
        l1: r.l1,
        l2: r.l2,
        l3: r.l3,
        match: r.match,
        assemblyNotes: r.assemblyNotes,
        baseURL: endpoint.base_url,
      };
      pushLog(
        `[身份] 直连层完成：L3 回包模型=${r.l3?.model || '无'}，${r.match ? '与所选一致' : '与所选不一致'}`,
      );
    }

    if (layers.includes('assembled')) {
      pushLog('[身份] 正在探测组装层（按 Because/LibreChat 规则改写请求）…');
      const r = await runAssembledProbe({ endpoint, model });
      identity.assembled = {
        l1: r.l1,
        l2: r.l2,
        l3: r.l3,
        match: r.match,
        assemblyNotes: r.assemblyNotes,
        baseURL: endpoint.base_url,
      };
      pushLog(
        `[身份] 组装层完成：L3 回包模型=${r.l3?.model || '无'}，${r.match ? '与所选一致' : '与所选不一致'}`,
      );
    }

    task.progress = 25;
    persistReport(taskId, { progress: 25 });

    pushLog('[延迟] 开始采集首 token 时间（TTFT）与 token 间隔（ITL）…');
    const latency = await collectLatencySamples({
      endpoint,
      model,
      layers,
      config,
      onLog: pushLog,
    });
    pushLog('[延迟] 采集完成');

    task.progress = 50;
    persistReport(taskId, { progress: 50 });

    const throughput = {};
    for (const layer of layers) {
      pushLog(`[吞吐] 开始压测${layerName(layer)}…`);
      throughput[layer] = await measureThroughput({
        endpoint,
        model,
        layer,
        config,
        onLog: pushLog,
      });
      const tp = throughput[layer];
      pushLog(
        `[吞吐] ${layerName(layer)}完成：约 ${tp.rpm} 次/分钟，${tp.tpm} tokens/分钟，错误率 ${(tp.errorRate * 100).toFixed(1)}%`,
      );
    }

    task.progress = 75;
    persistReport(taskId, { progress: 75 });

    const context = {};
    if (config.probeContext === true) {
      for (const layer of layers) {
        pushLog(`[上下文] 开始探测${layerName(layer)}可接受窗口（可能较慢）…`);
        context[layer] = await measureContextWindow({
          endpoint,
          model,
          layer,
          config: { ...config, claimedContextTokens: endpoint.claimed_context_tokens },
          onLog: pushLog,
        });
        pushLog(
          `[上下文] ${layerName(layer)}完成：实测上限约 ${context[layer].measuredMaxAccepted || 0} tokens`,
        );
      }
    } else {
      pushLog('[上下文] 已跳过（未勾选「探测上下文窗口」）');
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

    pushLog('全部探测完成，可查看报告');
  } catch (err) {
    const db = getDb();
    const endpointRow = db.prepare('SELECT base_url FROM endpoints WHERE id = ?').get(task.endpointId);
    const detail = formatProviderError(err, {
      model: task.model,
      baseURL: endpointRow?.base_url,
    });
    task.status = 'failed';
    task.error = detail;
    persistReport(taskId, {
      status: 'failed',
      error: detail,
      status_logs: task.statusLogs,
      completed_at: now(),
    });
    pushLog(`探测失败：${detail}`);
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
