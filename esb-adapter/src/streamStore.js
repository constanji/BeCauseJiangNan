const { randomUUID } = require('crypto');
const { config } = require('./config');

/** @type {Map<string, {
 *   seq: number,
 *   done: boolean,
 *   error: string | null,
 *   answer: string,
 *   deliveredAnswerLength: number,
 *   conversationId: string | null,
 *   parentMessageId: string | null,
 *   title: string | null,
 *   echartdata: Array<{id: string, title: string, analysisType: string, echartsOption: object}> | null,
 *   similarQuestions: {similar_indices: Array<object>, index_source: Array<{index_number: string, standard_name: string}>} | null,
 *   attributiondata: {indexName: Array<string>, orgCode: Array<string> | null, dataDate: string} | null,
 *   agentId: string | null,
 *   scene: string | null,
 *   becauseBaseUrl: string | null,
 *   createdAt: number,
 *   expiresAt: number,
 * }>} */
const tasks = new Map();

function now() {
  return Date.now();
}

function createStreamTask({ agentId, scene, becauseBaseUrl } = {}) {
  const streamId = randomUUID();
  const task = {
    agentId: agentId || null,
    scene: scene || null,
    becauseBaseUrl: becauseBaseUrl || null,
    seq: 0,
    done: false,
    error: null,
    answer: '',
    deliveredAnswerLength: 0,
    conversationId: null,
    parentMessageId: null,
    title: null,
    echartdata: null,
    similarQuestions: null,
    attributiondata: null,
    createdAt: now(),
    expiresAt: now() + config.streamTaskTtlMs,
  };
  tasks.set(streamId, task);
  return { streamId, task };
}

function getTask(streamId) {
  return tasks.get(streamId) || null;
}

function appendChunk(streamId, chunk) {
  const task = tasks.get(streamId);
  if (!task || !chunk) return;
  let text = String(chunk);
  if (!text) return;

  // answer 尚无实质内容时，丢弃开头纯空白，避免上游 SSE 先吐 \n\n 污染展示
  if (!task.answer) {
    text = text.replace(/^[\s\n\r\t]+/, '');
    if (!text) return;
  }

  const nextAnswer = task.answer + text;
  if (nextAnswer.length > config.streamMaxBufferChars) {
    const remain = Math.max(0, config.streamMaxBufferChars - task.answer.length);
    if (remain <= 0) return;
    task.answer += text.slice(0, remain);
  } else {
    task.answer = nextAnswer;
  }
  task.expiresAt = now() + config.streamTaskTtlMs;
}

function markDone(streamId, result = {}) {
  const task = tasks.get(streamId);
  if (!task) return;
  task.done = true;
  task.error = result.error || null;
  task.conversationId = result.conversationId || task.conversationId;
  task.parentMessageId = result.parentMessageId || task.parentMessageId;
  task.title = result.title || task.title;
  task.expiresAt = now() + config.streamTaskTtlMs;
}

function markRunningMeta(streamId, meta = {}) {
  const task = tasks.get(streamId);
  if (!task) return;
  if (meta.conversationId) task.conversationId = meta.conversationId;
  if (meta.parentMessageId) task.parentMessageId = meta.parentMessageId;
  if (meta.title) task.title = meta.title;
  task.expiresAt = now() + config.streamTaskTtlMs;
}

function setEchartdata(streamId, echartdata) {
  const task = tasks.get(streamId);
  if (!task) return;
  task.echartdata = echartdata;
  task.expiresAt = now() + config.streamTaskTtlMs;
}

function setSimilarQuestions(streamId, similarQuestions) {
  const task = tasks.get(streamId);
  if (!task) return;
  task.similarQuestions = similarQuestions;
  task.expiresAt = now() + config.streamTaskTtlMs;
}

function setAttributionData(streamId, attributiondata) {
  const task = tasks.get(streamId);
  if (!task) return;
  task.attributiondata = attributiondata;
  task.expiresAt = now() + config.streamTaskTtlMs;
}

/**
 * 仅刷新任务 TTL，不改变任何业务字段。
 * 供 SSE 活动回调使用：工具调用执行期间可能持续有非文本事件/心跳，
 * 但长时间没有 chunk/echartdata 等字段更新，避免任务被 cleanup 提前清掉。
 */
function touchTask(streamId) {
  const task = tasks.get(streamId);
  if (!task) return;
  task.expiresAt = now() + config.streamTaskTtlMs;
}

/**
 * 读取一轮 poll 应返回的流式状态。
 * chunk 严格等于 answer 中尚未下发给调用方的尾部（可按 maxChunkChars 截断）。
 */
function readPollState(streamId, options = {}) {
  const task = tasks.get(streamId);
  if (!task) return null;

  const maxChunkChars = Math.max(
    1,
    parseInt(options.maxChunkChars, 10) || config.streamPollBatchMaxChars,
  );
  const pending = task.answer.slice(task.deliveredAnswerLength);
  const chunk = pending.slice(0, maxChunkChars);

  if (chunk.length > 0) {
    task.deliveredAnswerLength += chunk.length;
    task.seq += 1;
  }

  const isFinal = task.done && task.deliveredAnswerLength >= task.answer.length;
  const seq = task.seq > 0 ? task.seq : 1;

  return {
    chunk,
    seq,
    isFinal,
    done: task.done,
    error: task.error,
    answer: task.answer,
    conversationId: task.conversationId,
    parentMessageId: task.parentMessageId,
    title: task.title,
    echartdata: task.echartdata,
    similarQuestions: task.similarQuestions,
    attributiondata: task.attributiondata,
  };
}

function removeTask(streamId) {
  tasks.delete(streamId);
}

function cleanupExpiredTasks() {
  const ts = now();
  for (const [streamId, task] of tasks.entries()) {
    if (task.expiresAt <= ts) {
      tasks.delete(streamId);
    }
  }
}

function clearStreamStore() {
  tasks.clear();
}

setInterval(cleanupExpiredTasks, 60_000).unref();

module.exports = {
  createStreamTask,
  getTask,
  appendChunk,
  markDone,
  markRunningMeta,
  setEchartdata,
  setSimilarQuestions,
  setAttributionData,
  touchTask,
  readPollState,
  removeTask,
  clearStreamStore,
  cleanupExpiredTasks,
};
