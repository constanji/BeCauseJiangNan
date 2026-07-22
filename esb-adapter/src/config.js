require('dotenv').config();
const os = require('os');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_ATTRIBUTION_SUFFIX =
  '如果是管理行/总行，按其下一级机构维度分解归因，返回前五贡献/拖累项；如果是无下属的网点，则对指标进行拆解归因。根据以上逻辑，开始归因。';

function normalizeBaseUrl(url) {
  return (url || '').replace(/\/$/, '');
}

function parseEnvBool(raw, defaultValue = true) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return defaultValue;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  return defaultValue;
}

/** 本机主网卡 IPv4；Docker 内可设 HOST_IP 为宿主机 IP */
function detectPrimaryIPv4() {
  const fromEnv = String(process.env.HOST_IP || '').trim();
  if (fromEnv) return fromEnv;

  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      const family = net.family;
      if ((family === 'IPv4' || family === 4) && !net.internal && net.address) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

/** 从 process.env 解析运行时可热更新字段（不含 PORT） */
function readEnvConfigValues() {
  const hostIp = detectPrimaryIPv4();
  const rawBase = String(process.env.BECAUSE_BASE_URL || '').trim();
  const rawZb = String(process.env.BECAUSE_BASE_URL_ZB || '').trim();
  const rawResult = String(process.env.BECAUSE_BASE_URL_RESULT || '').trim();

  // 均未配置时：默认 http://本机IP，zb 同默认，result 为 http://本机IP:18080
  // 只配了 BECAUSE_BASE_URL 时：zb/result 回退到该地址（便于联调只改一处）
  const becauseBaseUrl = normalizeBaseUrl(rawBase || `http://${hostIp}`);
  const becauseBaseUrlZb = normalizeBaseUrl(rawZb || becauseBaseUrl);
  const becauseBaseUrlResult = normalizeBaseUrl(
    rawResult || (rawBase ? becauseBaseUrl : `http://${hostIp}:18080`),
  );

  return {
    becauseBaseUrl,
    becauseBaseUrlResult,
    becauseBaseUrlZb,
    becauseEmail: process.env.BECAUSE_EMAIL || '',
    becausePassword: process.env.BECAUSE_PASSWORD || '',
    agentIdResult: process.env.AGENT_ID_RESULT || '',
    agentIdZb: process.env.AGENT_ID_ZB || '',
    esbServerCd: process.env.ESB_SERVER_CD || '',
    chatTimeoutMs: parseInt(process.env.CHAT_TIMEOUT_MS, 10) || 300000,
    authTimeoutMs: parseInt(process.env.AUTH_TIMEOUT_MS, 10) || 30000,
    userAgent: process.env.USER_AGENT || DEFAULT_USER_AGENT,
    tokenRefreshSkewMs: parseInt(process.env.TOKEN_REFRESH_SKEW_MS, 10) || 60_000,
    streamTaskTtlMs: parseInt(process.env.STREAM_TASK_TTL_MS, 10) || 600_000,
    streamMaxBufferChars: parseInt(process.env.STREAM_MAX_BUFFER_CHARS, 10) || 50_000,
    streamPollBatchMaxChunks: parseInt(process.env.STREAM_POLL_BATCH_MAX_CHUNKS, 10) || 20,
    streamPollBatchMaxChars: parseInt(process.env.STREAM_POLL_BATCH_MAX_CHARS, 10) || 4000,
    queryContextAttributionSuffix:
      process.env.QUERY_CONTEXT_ATTRIBUTION_SUFFIX || DEFAULT_ATTRIBUTION_SUFFIX,
    logPollState: parseEnvBool(process.env.LOG_POLL_STATE, false),
    textLastBlockOnlyResult: parseEnvBool(process.env.TEXT_LAST_BLOCK_ONLY_RESULT, true),
    textLastBlockOnlyZb: parseEnvBool(process.env.TEXT_LAST_BLOCK_ONLY_ZB, true),
  };
}

const config = {
  port: parseInt(process.env.PORT, 10) || 13001,
  // 管理端可选访问密钥（空 / change-me 时不强制鉴权，与 ModelProbe 一致）
  adminSecret: process.env.ESB_ADMIN_SECRET || '',
  ...readEnvConfigValues(),
};

/** 将 config 中可热更新字段重置为当前 process.env（清除 runtime overlay 时用） */
function applyEnvBaseline() {
  Object.assign(config, readEnvConfigValues());
}

/** @type {Record<string, { agentId: () => string, becauseBaseUrl: () => string }>} */
const SCENE_CONFIG = {
  result: {
    agentId: () => config.agentIdResult,
    becauseBaseUrl: () => config.becauseBaseUrlResult || config.becauseBaseUrl,
  },
  zb: {
    agentId: () => config.agentIdZb,
    becauseBaseUrl: () => config.becauseBaseUrlZb || config.becauseBaseUrl,
  },
};

function resolveSceneConfig(scene) {
  const key = String(scene || '').trim();
  const entry = SCENE_CONFIG[key];
  if (!entry) {
    return { ok: false, error: `未知 scene: ${key}` };
  }

  const agentId = entry.agentId();
  const becauseBaseUrl = entry.becauseBaseUrl();

  if (!agentId) {
    return { ok: false, error: `scene=${key} 未配置 Agent ID` };
  }
  if (!becauseBaseUrl) {
    return {
      ok: false,
      error: `scene=${key} 未配置 Because 地址（请设置 BECAUSE_BASE_URL 或 BECAUSE_BASE_URL_${key.toUpperCase()}）`,
    };
  }

  return { ok: true, agentId, becauseBaseUrl, scene: key };
}

/**
 * @param {string} scene
 * @returns {{ useLastTextBlockOnly: boolean }}
 */
function resolveTextExtractOptions(scene) {
  const key = String(scene || '').trim();
  if (key === 'zb') {
    return { useLastTextBlockOnly: config.textLastBlockOnlyZb };
  }
  return { useLastTextBlockOnly: config.textLastBlockOnlyResult };
}

function validateConfig() {
  const missing = [];
  if (!config.becauseEmail) missing.push('BECAUSE_EMAIL');
  if (!config.becausePassword) missing.push('BECAUSE_PASSWORD');
  if (!config.agentIdResult) missing.push('AGENT_ID_RESULT');
  if (!config.agentIdZb) missing.push('AGENT_ID_ZB');

  const resultUrl = config.becauseBaseUrlResult || config.becauseBaseUrl;
  const zbUrl = config.becauseBaseUrlZb || config.becauseBaseUrl;
  if (!resultUrl) missing.push('BECAUSE_BASE_URL 或 BECAUSE_BASE_URL_RESULT');
  if (!zbUrl) missing.push('BECAUSE_BASE_URL 或 BECAUSE_BASE_URL_ZB');

  if (missing.length) {
    throw new Error(`缺少必需环境变量: ${missing.join(', ')}`);
  }
}

module.exports = {
  config,
  SCENE_CONFIG,
  resolveSceneConfig,
  resolveTextExtractOptions,
  validateConfig,
  parseEnvBool,
  applyEnvBaseline,
  readEnvConfigValues,
  normalizeBaseUrl,
  detectPrimaryIPv4,
  DEFAULT_ATTRIBUTION_SUFFIX,
};
