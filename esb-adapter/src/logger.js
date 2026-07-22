/**
 * 统一日志：自带本地时间戳 + 级别 + [esb-adapter] 前缀。
 * 输出示例：
 *   [2026-07-03 17:11:23.456] [ERROR] [esb-adapter] chatStream 异常 | scene=zb agentId=agent_xxx streamId=xxx user=25 cause=UND_ERR_SOCKET message="fetch failed"
 */

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

function parseBool(raw, defaultValue = true) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  return defaultValue;
}

function colorEnabled() {
  if (process.env.NO_COLOR) return false;
  return parseBool(process.env.LOG_COLOR, true);
}

function color(text, code) {
  if (!colorEnabled()) return text;
  return `${code}${text}${ANSI.reset}`;
}

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

/** 本地时间戳（跟随进程/容器时区，容器建议设置 TZ=Asia/Shanghai） */
function timestamp() {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

function levelColor(level) {
  if (level === 'ERROR') return ANSI.red;
  if (level === 'WARN') return ANSI.yellow;
  return ANSI.green;
}

function prefix(level) {
  const ts = color(`[${timestamp()}]`, ANSI.gray);
  const lv = color(`[${level}]`, `${levelColor(level)}${ANSI.bold}`);
  const app = color('[esb-adapter]', ANSI.cyan);
  return `${ts} ${lv} ${app}`;
}

/**
 * 将 { key: value, ... } 拼接为 `key=value key2=value2` 形式，便于日志系统检索/grep。
 * 值为 undefined/null 时省略该字段；字符串含空格时加双引号。
 */
function formatFields(fields, options = {}) {
  if (!fields || typeof fields !== 'object') return '';
  const useColor = options.color !== false && colorEnabled();
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const str = String(v);
      const value = /\s/.test(str) ? `"${str}"` : str;
      if (!useColor) return `${k}=${value}`;
      return `${color(k, ANSI.blue)}=${color(value, ANSI.dim)}`;
    })
    .join(' ');
}

/**
 * 从 fetch/undici 抛出的错误中提取根因（cause 链），返回简明的 code/message。
 */
function describeError(err) {
  if (!err) return { message: '' };
  const cause = err.cause;
  const causeCode = cause?.code || cause?.errno || null;
  const causeMessage = cause && !causeCode ? cause.message || String(cause) : null;
  return {
    message: err.message || String(err),
    cause: causeCode || causeMessage || undefined,
  };
}

const logger = {
  info: (message, fields) => {
    const suffix = formatFields(fields);
    console.log(`${prefix('INFO')} ${color(message, ANSI.green)}${suffix ? ` ${color('|', ANSI.gray)} ${suffix}` : ''}`);
  },
  warn: (message, fields) => {
    const suffix = formatFields(fields);
    console.warn(`${prefix('WARN')} ${color(message, ANSI.yellow)}${suffix ? ` ${color('|', ANSI.gray)} ${suffix}` : ''}`);
  },
  error: (message, fields) => {
    const suffix = formatFields(fields);
    console.error(`${prefix('ERROR')} ${color(message, ANSI.red)}${suffix ? ` ${color('|', ANSI.gray)} ${suffix}` : ''}`);
  },
};

module.exports = { logger, timestamp, formatFields, describeError, colorEnabled };
