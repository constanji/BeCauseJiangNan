/**
 * gaussdbJdbcBridge.js
 *
 * GaussDB JDBC 持久进程桥（v2）
 *
 * 与 v1 的核心区别：不再每次查询都 spawn 新 JVM，而是每个数据源维护一个
 * 长驻 GaussJdbcServer 子进程。子进程通过 stdin/stdout newline-JSON 协议
 * 处理查询，避免了 JVM 冷启动（节省 2-8 秒/次）。
 *
 * 协议：
 *   → stdin  每行: { "id": "<uuid>", "sql": "<base64>", "params": "<base64-json-array>", "timeout": <秒> }
 *   ← stdout 每行: { "id": "<uuid>", "rows": [...] }
 *                  { "id": "<uuid>", "error": "<msg>" }
 *   首行:           { "ready": true }
 *
 * 依赖：
 *   - Because-2.0/drivers/gaussdb-jdbc/GaussJdbcServer.class（Dockerfile 编译）
 *   - Because-2.0/drivers/lib/gsjdbc4-1.0.jar
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const BRIDGE_DIR = path.join(__dirname, '..', 'drivers', 'gaussdb-jdbc');
const DEFAULT_JAR = path.join(__dirname, '..', 'drivers', 'lib', 'gsjdbc4-1.0.jar');

/**
 * 单个数据源对应的持久进程状态
 * @typedef {Object} ProcessState
 * @property {import('child_process').ChildProcess} child
 * @property {Map<string, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} pending
 * @property {boolean} ready   - 是否已收到 {"ready":true}
 * @property {Function[]} readyWaiters
 * @property {string} buffer   - stdout 累积缓冲区（未完整行）
 * @property {boolean} dead
 * @property {string} dsKey
 */

/** @type {Map<string, ProcessState>} */
const processPool = new Map();

// ---- 工具函数 ----

function buildEnv(dataSource, password) {
  const jarPath = process.env.GAUSSDB_JDBC_JAR || DEFAULT_JAR;
  const jdbcUrl =
    `jdbc:${process.env.GAUSSDB_JDBC_PROTOCOL || 'postgresql'}` +
    `://${dataSource.host}:${dataSource.port || 8000}/${dataSource.database}`;

  const childEnv = {
    ...process.env,
    DB_HOST: String(dataSource.host || ''),
    DB_PORT: String(dataSource.port || 8000),
    DB_USER: String(dataSource.username || ''),
    DB_PASSWORD: String(password || ''),
    DB_NAME: String(dataSource.database || ''),
    GAUSSDB_JDBC_URL: jdbcUrl,
    GAUSSDB_JDBC_JAR: jarPath,
    GAUSSDB_JDBC_QUERY_TIMEOUT_SEC: process.env.GAUSSDB_JDBC_QUERY_TIMEOUT_SEC || '180',
  };

  if (dataSource.ssl && dataSource.ssl.enabled) {
    childEnv.DB_SSL = 'true';
    if (dataSource.ssl.rejectUnauthorized === false) {
      childEnv.DB_SSL_REJECT_UNAUTHORIZED = 'false';
      childEnv.DB_SSLMODE = 'require';
    }
    if (dataSource.ssl.ca) childEnv.DB_SSL_CA = dataSource.ssl.ca;
    if (dataSource.ssl.cert) childEnv.DB_SSL_CERT = dataSource.ssl.cert;
    if (dataSource.ssl.key) childEnv.DB_SSL_KEY = dataSource.ssl.key;
  }

  return childEnv;
}

/**
 * 为指定 dsKey 启动（或复用）持久 Java 进程
 * @param {string} dsKey
 * @param {object} dataSource
 * @param {string} password
 * @returns {ProcessState}
 */
function getOrSpawnProcess(dsKey, dataSource, password) {
  const existing = processPool.get(dsKey);
  if (existing && !existing.dead) return existing;

  const jarPath = process.env.GAUSSDB_JDBC_JAR || DEFAULT_JAR;
  const javaBin = process.env.JAVA_BIN || 'java';
  const classPath = [BRIDGE_DIR, jarPath].join(path.delimiter);

  const child = spawn(javaBin, [
    '-Dfile.encoding=UTF-8',
    '-Dstdout.encoding=UTF-8',
    '-cp', classPath,
    'GaussJdbcServer',        // 持久服务主类
  ], {
    env: buildEnv(dataSource, password),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  /** @type {ProcessState} */
  const state = {
    child,
    pending: new Map(),
    ready: false,
    readyWaiters: [],
    buffer: '',
    dead: false,
    dsKey,
  };

  // ---- stdout 数据处理 ----
  child.stdout.on('data', (chunk) => {
    state.buffer += chunk.toString('utf8');
    const lines = state.buffer.split('\n');
    state.buffer = lines.pop(); // 保留末尾未完整行

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch (_) {
        // 非 JSON 行（JVM 日志）直接忽略
        continue;
      }

      if (msg.ready) {
        state.ready = true;
        const waiters = state.readyWaiters.splice(0);
        for (const fn of waiters) fn();
        continue;
      }

      if (msg.id) {
        const req = state.pending.get(msg.id);
        if (!req) continue;
        state.pending.delete(msg.id);
        clearTimeout(req.timer);
        if (msg.error) {
          req.reject(new Error(msg.error));
        } else {
          req.resolve(msg.rows || []);
        }
      }
    }
  });

  // ---- stderr 转日志（不阻断流程）----
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim();
    if (text) {
      // 只打印前 300 字符防止日志爆炸
      process.stderr.write(`[GaussJdbcServer:${dsKey.slice(0, 8)}] ${text.slice(0, 300)}\n`);
    }
  });

  // ---- 进程退出处理 ----
  const onExit = (code, signal) => {
    state.dead = true;
    processPool.delete(dsKey);

    const reason = `GaussDB JDBC 服务进程意外退出(code=${code}, signal=${signal})`;

    // 唤醒尚未就绪的等待者
    const waiters = state.readyWaiters.splice(0);
    for (const fn of waiters) fn(new Error(reason));

    // 拒绝所有 pending 请求
    for (const [, req] of state.pending) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    state.pending.clear();
  };

  child.on('close', (code, signal) => onExit(code, signal));
  child.on('error', (err) => {
    state.dead = true;
    processPool.delete(dsKey);
    for (const [, req] of state.pending) {
      clearTimeout(req.timer);
      req.reject(err);
    }
    state.pending.clear();
  });

  processPool.set(dsKey, state);
  return state;
}

/**
 * 等待进程就绪（超时则报错）
 * @param {ProcessState} state
 * @param {number} timeoutMs
 */
function waitReady(state, timeoutMs) {
  if (state.ready) return Promise.resolve();
  if (state.dead) return Promise.reject(new Error('GaussDB JDBC 进程已退出'));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // 移除等待者
      state.readyWaiters = state.readyWaiters.filter((fn) => fn !== handler);
      reject(new Error(`GaussDB JDBC 进程启动超时(${timeoutMs}ms)`));
    }, timeoutMs);

    function handler(err) {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    }

    state.readyWaiters.push(handler);
  });
}

// ---- 公开 API ----

/**
 * 通过持久 Java 进程执行 GaussDB SQL，返回行数组
 *
 * @param {string} sql
 * @param {string[]} params    PreparedStatement 参数
 * @param {object} dataSource  DataSource 对象
 * @param {string} password    明文密码
 * @returns {Promise<any[]>}
 */
async function gaussdbJdbcQuery(sql, params = [], dataSource, password) {
  const dsKey = String(dataSource._id || dataSource.id || `${dataSource.host}:${dataSource.port}/${dataSource.database}`);
  const queryTimeoutMs = parseInt(process.env.GAUSSDB_JDBC_TIMEOUT_MS, 10) || 240000;
  // 进程启动+就绪最多等 30s（首次冷启动包含 JVM 加载）
  const readyTimeoutMs = Math.min(queryTimeoutMs, 30000);

  const state = getOrSpawnProcess(dsKey, dataSource, password);
  await waitReady(state, readyTimeoutMs);

  if (state.dead) {
    throw new Error('GaussDB JDBC 进程已退出，请重试');
  }

  const reqId = crypto.randomUUID();
  const b64Sql = Buffer.from(sql, 'utf8').toString('base64');
  const safeParams = Array.isArray(params) ? params.map((p) => (p == null ? null : String(p))) : [];
  const b64Params = Buffer.from(JSON.stringify(safeParams), 'utf8').toString('base64');
  const timeoutSec = parseInt(process.env.GAUSSDB_JDBC_QUERY_TIMEOUT_SEC, 10) || 180;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(reqId);
      const preview = sql.replace(/\s+/g, ' ').slice(0, 180);
      reject(new Error(`GaussDB JDBC 查询超时(${queryTimeoutMs}ms): ${preview}`));
    }, queryTimeoutMs);

    state.pending.set(reqId, { resolve, reject, timer });

    try {
      const line = JSON.stringify({ id: reqId, sql: b64Sql, params: b64Params, timeout: timeoutSec });
      state.child.stdin.write(line + '\n');
    } catch (err) {
      state.pending.delete(reqId);
      clearTimeout(timer);
      // 标记进程死亡，下次调用会重启
      state.dead = true;
      processPool.delete(dsKey);
      reject(err);
    }
  });
}

/**
 * 简单连通性测试
 */
async function gaussdbTestConnection(dataSource, password) {
  const rows = await gaussdbJdbcQuery('SELECT 1', [], dataSource, password);
  return { success: true, rows };
}

/**
 * 优雅关闭所有持久进程（服务退出时调用）
 */
function shutdownAll() {
  for (const [, state] of processPool) {
    try {
      state.child.stdin.end();
      setTimeout(() => {
        if (!state.dead) state.child.kill('SIGTERM');
      }, 2000);
    } catch (_) {}
  }
  processPool.clear();
}

process.on('exit', shutdownAll);

module.exports = { gaussdbJdbcQuery, gaussdbTestConnection, shutdownAll };
