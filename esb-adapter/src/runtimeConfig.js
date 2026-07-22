const fs = require('fs');
const path = require('path');
const { config, parseEnvBool, validateConfig, applyEnvBaseline } = require('./config');
const { logger } = require('./logger');

/** 可热更新字段定义（不含 PORT） */
const EDITABLE_FIELDS = [
  {
    key: 'becauseBaseUrl',
    env: 'BECAUSE_BASE_URL',
    type: 'string',
    label: 'Because 默认地址',
    group: 'because',
    help: '默认 http://本机IP；可用 HOST_IP 指定宿主机 IP（Docker 推荐）',
  },
  {
    key: 'becauseBaseUrlResult',
    env: 'BECAUSE_BASE_URL_RESULT',
    type: 'string',
    label: 'Because result 地址',
    group: 'because',
    help: 'scene=result（指标问数 / 归因）；默认 http://本机IP:18080',
  },
  {
    key: 'becauseBaseUrlZb',
    env: 'BECAUSE_BASE_URL_ZB',
    type: 'string',
    label: 'Because zb 地址',
    group: 'because',
    help: 'scene=zb（指标查询）；默认与 Because 默认地址相同',
  },
  {
    key: 'becauseEmail',
    env: 'BECAUSE_EMAIL',
    type: 'string',
    label: 'Because 登录邮箱',
    group: 'auth',
    help: 'ESB 专用服务账号',
  },
  {
    key: 'becausePassword',
    env: 'BECAUSE_PASSWORD',
    type: 'secret',
    label: 'Because 登录密码',
    group: 'auth',
    help: '保存后立即清 token 缓存并重新登录；默认隐藏，点击眼睛可显示',
  },
  {
    key: 'agentIdResult',
    env: 'AGENT_ID_RESULT',
    type: 'string',
    label: 'Agent ID（result）',
    group: 'agent',
    help: 'scene=result 对应 Agent ID',
  },
  {
    key: 'agentIdZb',
    env: 'AGENT_ID_ZB',
    type: 'string',
    label: 'Agent ID（zb）',
    group: 'agent',
    help: 'scene=zb 对应 Agent ID',
  },
  {
    key: 'esbServerCd',
    env: 'ESB_SERVER_CD',
    type: 'string',
    label: 'ESB 我方应用编号',
    group: 'misc',
    help: '日志标识，可选',
  },
  {
    key: 'chatTimeoutMs',
    env: 'CHAT_TIMEOUT_MS',
    type: 'number',
    label: '聊天空闲超时（ms）',
    group: 'timeout',
    help: '连续无 SSE 数据才中断；有输出时重置计时。归因建议 300000',
  },
  {
    key: 'authTimeoutMs',
    env: 'AUTH_TIMEOUT_MS',
    type: 'number',
    label: '登录/refresh 超时（ms）',
    group: 'timeout',
    help: 'Because 登录与 refresh token 接口超时',
  },
  {
    key: 'tokenRefreshSkewMs',
    env: 'TOKEN_REFRESH_SKEW_MS',
    type: 'number',
    label: 'Token 提前刷新偏移（ms）',
    group: 'timeout',
    help: 'JWT 过期前多久触发 refresh',
  },
  {
    key: 'streamTaskTtlMs',
    env: 'STREAM_TASK_TTL_MS',
    type: 'number',
    label: '流任务 TTL（ms）',
    group: 'stream',
    help: '内存中 streamId 过期时间；SSE 活动会刷新',
  },
  {
    key: 'streamMaxBufferChars',
    env: 'STREAM_MAX_BUFFER_CHARS',
    type: 'number',
    label: '流缓冲最大字符数',
    group: 'stream',
    help: '单任务 answer 累计上限',
  },
  {
    key: 'streamPollBatchMaxChars',
    env: 'STREAM_POLL_BATCH_MAX_CHARS',
    type: 'number',
    label: '每轮 POLL 最大 chunk 字符',
    group: 'stream',
    help: '单次 poll 下发的新增尾部上限',
  },
  {
    key: 'queryContextAttributionSuffix',
    env: 'QUERY_CONTEXT_ATTRIBUTION_SUFFIX',
    type: 'string',
    label: '归因提示后缀',
    group: 'misc',
    help: 'queryContext 拼接到 text 后的归因提示词',
  },
  {
    key: 'logPollState',
    env: 'LOG_POLL_STATE',
    type: 'boolean',
    label: '记录中间 POLL 详细日志',
    group: 'log',
    help: '开启后输出 POLL_IN / ROUTE_RESOLVED / POLL_STATE',
  },
  {
    key: 'textLastBlockOnlyResult',
    env: 'TEXT_LAST_BLOCK_ONLY_RESULT',
    type: 'boolean',
    label: 'result 只取最后 text 块',
    group: 'parse',
    help: 'scene=result 解析 SSE 最终 text 时只取最后一个 text 块',
  },
  {
    key: 'textLastBlockOnlyZb',
    env: 'TEXT_LAST_BLOCK_ONLY_ZB',
    type: 'boolean',
    label: 'zb 只取最后 text 块',
    group: 'parse',
    help: 'scene=zb 解析 SSE 最终 text 时只取最后一个 text 块',
  },
  {
    key: 'userAgent',
    env: 'USER_AGENT',
    type: 'string',
    label: 'HTTP User-Agent',
    group: 'misc',
    help: '请求 Because 时带的 User-Agent 头；未设 USER_AGENT 时默认用内置 Chrome UA（一般不用改）',
  },
];

const FIELD_BY_KEY = Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.key, f]));

/** @type {Record<string, unknown>} */
let overlay = {};

function getRuntimeConfigPath() {
  return (
    process.env.ESB_RUNTIME_CONFIG_PATH ||
    path.join(process.cwd(), 'data', 'runtime-config.json')
  );
}

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/$/, '');
}

function coerceValue(field, raw) {
  if (raw === undefined) return { skip: true };
  if (field.type === 'secret' && (raw === null || raw === '' || raw === undefined)) {
    return { skip: true };
  }
  if (field.type === 'boolean') {
    if (typeof raw === 'boolean') return { value: raw };
    return { value: parseEnvBool(raw, false) };
  }
  if (field.type === 'number') {
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 0) {
      return { error: `${field.env} 必须是非负整数` };
    }
    return { value: n };
  }
  // string / secret
  let value = raw === null || raw === undefined ? '' : String(raw);
  if (field.key.startsWith('becauseBaseUrl')) {
    value = normalizeBaseUrl(value);
  }
  return { value };
}

function applyOverlayToConfig(nextOverlay) {
  const snapshot = { ...config };
  try {
    for (const field of EDITABLE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(nextOverlay, field.key)) continue;
      const coerced = coerceValue(field, nextOverlay[field.key]);
      if (coerced.error) throw new Error(coerced.error);
      if (coerced.skip) continue;
      config[field.key] = coerced.value;
    }
    validateConfig();
  } catch (err) {
    Object.assign(config, snapshot);
    throw err;
  }
}

function loadRuntimeConfig() {
  const filePath = getRuntimeConfigPath();
  if (!fs.existsSync(filePath)) {
    overlay = {};
    return { loaded: false, path: filePath };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('runtime-config.json 必须是对象');
    }
    const cleaned = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!FIELD_BY_KEY[key]) continue;
      cleaned[key] = value;
    }
    applyOverlayToConfig(cleaned);
    overlay = cleaned;
    logger.info('已加载运行时配置覆盖层', {
      path: filePath,
      keys: Object.keys(cleaned),
    });
    return { loaded: true, path: filePath, keys: Object.keys(cleaned) };
  } catch (err) {
    logger.error('加载运行时配置失败，继续使用环境变量', {
      path: filePath,
      message: err.message,
    });
    overlay = {};
    return { loaded: false, path: filePath, error: err.message };
  }
}

function persistOverlay(nextOverlay) {
  const filePath = getRuntimeConfigPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(nextOverlay, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
  return filePath;
}

/**
 * 用 partial 更新覆盖层并立即应用到内存 config。
 * secret 字段传空字符串表示不修改。
 * @param {Record<string, unknown>} patch
 * @param {{ resetAuthCache?: () => void }} [hooks]
 */
function updateRuntimeConfig(patch, hooks = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('请求体必须是对象');
  }

  const nextOverlay = { ...overlay };
  const changedKeys = [];
  let authChanged = false;

  for (const [key, raw] of Object.entries(patch)) {
    const field = FIELD_BY_KEY[key];
    if (!field) {
      throw new Error(`不支持的配置项: ${key}`);
    }
    const coerced = coerceValue(field, raw);
    if (coerced.error) throw new Error(coerced.error);
    if (coerced.skip) continue;

    const prev = Object.prototype.hasOwnProperty.call(nextOverlay, key)
      ? nextOverlay[key]
      : config[key];
    if (prev === coerced.value) continue;

    nextOverlay[key] = coerced.value;
    changedKeys.push(key);
    if (key === 'becauseEmail' || key === 'becausePassword' || key.startsWith('becauseBaseUrl')) {
      authChanged = true;
    }
  }

  if (changedKeys.length === 0) {
    return getPublicConfig();
  }

  applyOverlayToConfig(nextOverlay);
  const filePath = persistOverlay(nextOverlay);
  overlay = nextOverlay;

  if (authChanged && typeof hooks.resetAuthCache === 'function') {
    hooks.resetAuthCache();
  }

  logger.info('运行时配置已热更新', { path: filePath, changedKeys, authChanged });
  return getPublicConfig();
}

function getPublicConfig() {
  const values = {};
  const overridden = [];
  for (const field of EDITABLE_FIELDS) {
    // secret 在管理端返回明文（页面默认 password + 眼睛切换；接口本身需 ESB_ADMIN_SECRET）
    values[field.key] = config[field.key];
    if (Object.prototype.hasOwnProperty.call(overlay, field.key)) {
      overridden.push(field.key);
    }
  }
  return {
    values,
    overridden,
    fields: EDITABLE_FIELDS.map(({ key, env, type, label, group, help }) => ({
      key,
      env,
      type,
      label,
      group,
      help,
    })),
    runtimeConfigPath: getRuntimeConfigPath(),
    port: config.port,
  };
}

function clearRuntimeConfig(hooks = {}) {
  const filePath = getRuntimeConfigPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  overlay = {};
  applyEnvBaseline();
  if (typeof hooks.resetAuthCache === 'function') {
    hooks.resetAuthCache();
  }
  logger.info('已清除运行时配置覆盖层', { path: filePath });
  return getPublicConfig();
}

module.exports = {
  EDITABLE_FIELDS,
  getRuntimeConfigPath,
  loadRuntimeConfig,
  updateRuntimeConfig,
  getPublicConfig,
  clearRuntimeConfig,
  // 测试用
  _getOverlay: () => ({ ...overlay }),
  _setOverlayForTest: (v) => {
    overlay = { ...(v || {}) };
  },
};
