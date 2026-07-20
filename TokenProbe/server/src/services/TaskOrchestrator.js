const { v4: uuidv4 } = require('uuid');
const { getDb, now } = require('../db/sqlite');
const logger = require('../lib/logger');
const { clientFromDbRow } = require('./BecauseClient');
const { analyzeChain } = require('./ChainAnalyzer');

/** @type {Map<string, object>} */
const liveTasks = new Map();

function pushLog(task, msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  task.statusLogs.push(line);
  logger.info(msg, { taskId: task.taskId });
  persistPartial(task);
}

function persistPartial(task) {
  getDb()
    .prepare(
      `UPDATE probe_reports SET status = ?, progress = ?, status_logs_json = ?, error = ?,
       report_json = COALESCE(?, report_json), started_at = COALESCE(started_at, ?), completed_at = ?
       WHERE task_id = ?`,
    )
    .run(
      task.status,
      task.progress,
      JSON.stringify(task.statusLogs),
      task.error || null,
      task.report ? JSON.stringify(task.report) : null,
      task.startedAt || null,
      task.completedAt || null,
      task.taskId,
    );
}

function getConnection(id) {
  return getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id);
}

function createTaskRow({ taskId, connectionId, config }) {
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO probe_reports (
        task_id, connection_id, status, progress, config_json, status_logs_json, created_at
      ) VALUES (?, ?, 'pending', 0, ?, '[]', ?)`,
    )
    .run(taskId, connectionId ?? null, JSON.stringify(config), ts);
}

async function runAnalyzeTask(taskId) {
  const task = liveTasks.get(taskId);
  if (!task) return;

  task.status = 'running';
  task.startedAt = now();
  task.progress = 5;
  pushLog(task, '任务开始');

  try {
    const conn = task.connectionId ? getConnection(task.connectionId) : null;
    if (!conn) throw new Error('未找到 BeCause 连接配置');

    const client = clientFromDbRow(conn);
    pushLog(task, conn.email ? `使用账号登录: ${conn.email}` : '使用静态 JWT');
    const encoding = conn.encoding || 'cl100k_base';
    const agentId = task.config.agentId || conn.agent_id;
    if (!agentId) throw new Error('请配置 agentId');

    let conversationId = task.config.conversationId || null;
    const mode = task.config.mode || (conversationId ? 'attach' : 'live');

    if (mode === 'live' || (!conversationId && task.config.question)) {
      if (!task.config.question) throw new Error('真跑采集需要填写问句');
      task.progress = 15;
      pushLog(task, `向 BeCause 发问（agent=${agentId}）…`);
      const chatResult = await client.runAgentChat({
        agentId,
        text: task.config.question,
        conversationId: conversationId || undefined,
        dataSourceId: task.config.dataSourceId || conn.data_source_id || undefined,
      });
      conversationId = chatResult.conversationId;
      pushLog(task, `聊天结束，conversationId=${conversationId}`);
    } else {
      pushLog(task, `绑定已有会话 conversationId=${conversationId}`);
    }

    if (!conversationId) throw new Error('缺少 conversationId');

    task.progress = 45;
    pushLog(task, '拉取 Agent 配置（instructions / tools）…');
    let agent = null;
    try {
      agent = await client.getAgent(agentId);
      // some APIs wrap in { agent } or { data }
      if (agent?.agent) agent = agent.agent;
      if (agent?.data && !agent.instructions) agent = agent.data;
    } catch (err) {
      pushLog(task, `拉取 Agent 失败（将跳过系统提示统计）: ${err.message}`);
    }

    task.progress = 65;
    pushLog(task, '拉取会话消息 Message.content …');
    const messages = await client.getMessages(conversationId);
    pushLog(task, `消息条数=${messages.length}`);

    task.progress = 85;
    pushLog(task, '按工具 I/O 重构 token 统计…');
    const analysis = analyzeChain({
      messages,
      agent,
      encoding,
      meta: {
        source: mode === 'attach' ? 'because-attach' : 'because-live',
        conversationId,
        question: task.config.question || null,
        connectionName: conn.name,
        baseUrl: conn.base_url,
        agentId,
      },
    });

    const report = {
      taskId,
      generatedAt: now(),
      source: analysis.meta.source,
      conversationId,
      question: task.config.question || analysis.samples.userQuestion || null,
      encoding,
      methodology: analysis.methodology,
      summary: analysis.summary,
      steps: analysis.steps,
      optimization: analysis.optimization,
      samples: analysis.samples,
      meta: analysis.meta,
      connection: { id: conn.id, name: conn.name, baseUrl: conn.base_url },
    };

    task.report = report;
    task.status = 'completed';
    task.progress = 100;
    task.completedAt = now();
    pushLog(task, '完成');
    persistPartial(task);
  } catch (err) {
    task.status = 'failed';
    task.error = err.message || String(err);
    task.completedAt = now();
    pushLog(task, `失败: ${task.error}`);
    persistPartial(task);
  } finally {
    liveTasks.delete(taskId);
  }
}

function startTask({ connectionId, config }) {
  const taskId = uuidv4();
  const task = {
    taskId,
    connectionId,
    config,
    status: 'pending',
    progress: 0,
    statusLogs: [],
    report: null,
    error: null,
    startedAt: null,
    completedAt: null,
  };
  liveTasks.set(taskId, task);
  createTaskRow({ taskId, connectionId, config });
  setImmediate(() => {
    runAnalyzeTask(taskId).catch((err) => logger.error('task crash', { err: err.message }));
  });
  return taskId;
}

function getTaskSnapshot(taskId) {
  const live = liveTasks.get(taskId);
  if (live) {
    return {
      taskId,
      status: live.status,
      progress: live.progress,
      statusLogs: live.statusLogs,
      error: live.error,
      report: live.report,
      config: live.config,
    };
  }
  const row = getDb().prepare('SELECT * FROM probe_reports WHERE task_id = ?').get(taskId);
  if (!row) return null;
  return {
    taskId: row.task_id,
    status: row.status,
    progress: row.progress,
    statusLogs: row.status_logs_json ? JSON.parse(row.status_logs_json) : [],
    error: row.error,
    report: row.report_json ? JSON.parse(row.report_json) : null,
    config: row.config_json ? JSON.parse(row.config_json) : null,
  };
}

module.exports = { startTask, getTaskSnapshot };
