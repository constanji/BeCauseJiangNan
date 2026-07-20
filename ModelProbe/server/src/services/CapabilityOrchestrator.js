const { v4: uuidv4 } = require('uuid');
const { getDb, now } = require('../db/sqlite');
const { parseEndpointRow } = require('./RequestAssembler');
const { formatProviderError } = require('../lib/formatProviderError');
const { FORMAT_CASES, TOOL_CASES, BECAUSE_CASES } = require('../lib/capabilityFixtures');
const { scoreLayerResults } = require('./ComplianceScorer');
const { runFormatCase, runToolCase } = require('./ToolProtocolProbe');

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

function summarizeSuite(cases) {
  const allChecks = cases.flatMap((c) => c.checks || []);
  const agg = scoreLayerResults(cases);
  return {
    score: agg.score,
    failures: agg.failures,
    passedCases: cases.filter((c) => c.pass).length,
    totalCases: cases.length,
    cases,
  };
}

async function runCapabilityTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return;

  const layerName = (layer) => (layer === 'assembled' ? '组装层' : '直连层');

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
    const suites = config.suites || ['format', 'tools', 'because'];
    const timeoutMs = config.timeoutMs || 120000;

    pushLog(
      `开始规范/工具探测：端点「${endpoint.name}」，模型 ${model}，套件 ${suites.join('、')}`,
    );

    const report = {
      kind: 'capability',
      taskId,
      endpoint: {
        id: endpoint.id,
        name: endpoint.name,
        type: endpoint.type,
        base_url: endpoint.base_url,
      },
      model,
      config,
      format: {},
      tools: {},
      because: {},
      generatedAt: null,
    };

    const totalSteps =
      layers.length * (suites.includes('format') ? FORMAT_CASES.length : 0) +
      layers.length * (suites.includes('tools') ? TOOL_CASES.length : 0) +
      layers.length * (suites.includes('because') ? BECAUSE_CASES.length : 0);
    let step = 0;

    for (const layer of layers) {
      if (suites.includes('format')) {
        const cases = [];
        pushLog(`[输出规范] ${layerName(layer)}：${FORMAT_CASES.length} 个用例`);
        for (const caseDef of FORMAT_CASES) {
          pushLog(`[输出规范] ${layerName(layer)} · ${caseDef.label}…`);
          const r = await runFormatCase({ endpoint, model, layer, caseDef, timeoutMs });
          cases.push(r);
          step += 1;
          task.progress = Math.min(5 + Math.floor((step / Math.max(totalSteps, 1)) * 90), 95);
          persistReport(taskId, { progress: task.progress });
          pushLog(
            `[输出规范] ${caseDef.label}：${r.error ? `失败（${r.error.slice(0, 80)}）` : r.pass ? '通过' : `未通过（${(r.failures || []).join('、')}）`}`,
          );
        }
        report.format[layer] = summarizeSuite(cases);
      }

      if (suites.includes('tools')) {
        const cases = [];
        pushLog(`[工具协议] ${layerName(layer)}：${TOOL_CASES.length} 个用例`);
        for (const caseDef of TOOL_CASES) {
          pushLog(`[工具协议] ${layerName(layer)} · ${caseDef.label}…`);
          const r = await runToolCase({ endpoint, model, layer, caseDef, timeoutMs });
          cases.push(r);
          step += 1;
          task.progress = Math.min(5 + Math.floor((step / Math.max(totalSteps, 1)) * 90), 95);
          persistReport(taskId, { progress: task.progress });
          pushLog(
            `[工具协议] ${caseDef.label}：${r.error ? `失败（${r.error.slice(0, 80)}）` : r.pass ? '通过' : `未通过（${(r.failures || []).join('、')}）`}`,
          );
        }
        report.tools[layer] = summarizeSuite(cases);
      }

      if (suites.includes('because')) {
        const cases = [];
        pushLog(`[问数工具] ${layerName(layer)}：${BECAUSE_CASES.length} 个用例`);
        for (const caseDef of BECAUSE_CASES) {
          pushLog(`[问数工具] ${layerName(layer)} · ${caseDef.label}…`);
          const r = await runToolCase({ endpoint, model, layer, caseDef, timeoutMs });
          cases.push(r);
          step += 1;
          task.progress = Math.min(5 + Math.floor((step / Math.max(totalSteps, 1)) * 90), 95);
          persistReport(taskId, { progress: task.progress });
          pushLog(
            `[问数工具] ${caseDef.label}：${r.error ? `失败（${r.error.slice(0, 80)}）` : r.pass ? '通过' : `未通过（${(r.failures || []).join('、')}）`}`,
          );
        }
        report.because[layer] = summarizeSuite(cases);
      }
    }

    report.generatedAt = now();
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

    pushLog('规范/工具探测完成，可查看报告');
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

function startCapability({ endpointId, model, config = {} }) {
  const taskId = uuidv4();
  const db = getDb();

  const defaultConfig = {
    kind: 'capability',
    layers: ['direct', 'assembled'],
    suites: ['format', 'tools', 'because'],
    timeoutMs: 120000,
  };

  const merged = { ...defaultConfig, ...config, kind: 'capability' };

  db.prepare(`
    INSERT INTO probe_reports (task_id, endpoint_id, model, status, progress, config_json, status_logs_json, created_at)
    VALUES (?, ?, ?, 'pending', 0, ?, '[]', ?)
  `).run(taskId, endpointId, model, JSON.stringify(merged), now());

  const task = {
    taskId,
    endpointId,
    model,
    config: merged,
    status: 'pending',
    progress: 0,
    statusLogs: [],
    report: null,
    error: null,
  };

  tasks.set(taskId, task);
  setImmediate(() => runCapabilityTask(taskId));
  return taskId;
}

module.exports = { tasks, getTask, startCapability, runCapabilityTask };
