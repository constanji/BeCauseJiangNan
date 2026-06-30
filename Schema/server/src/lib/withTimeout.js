const { formatDuration } = require('./formatDuration');

class TimeoutError extends Error {
  constructor(message, elapsedMs) {
    super(message);
    this.name = 'TimeoutError';
    this.elapsedMs = elapsedMs;
  }
}

/** 为 Promise 增加超时；timeoutMs <= 0 时不限制 */
function withTimeout(promise, timeoutMs, label = '操作') {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return promise;

  const startedAt = Date.now();
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`${label}超时（${formatDuration(ms)}）`, Date.now() - startedAt));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** 慢表告警阈值，可用 SCHEMA_SLOW_TABLE_MS 覆盖（默认 5 分钟） */
function slowTableThresholdMs() {
  const raw = Number(process.env.SCHEMA_SLOW_TABLE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000;
}

module.exports = { withTimeout, TimeoutError, slowTableThresholdMs };
