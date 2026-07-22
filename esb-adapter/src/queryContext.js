const { config } = require('./config');

const QUERY_CONTEXT_LABEL_MAP = {
  indicator: '指标',
  index: '指标',
  indexNumber: '指标',
  indexName: '指标',
  metric: '指标',
  date: '日期',
  dataDate: '日期',
  org: '机构',
  orgCode: '机构',
  organization: '机构',
  context: '上下文',
};

function normalizeContextValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 0);
  } catch {
    return String(value);
  }
}

/**
 * 根据 queryContext 构造要拼接的上下文行（含归因提示后缀）；无有效内容时返回空字符串。
 */
function buildQueryContextLine(queryContext) {
  if (queryContext === undefined || queryContext === null) {
    return '';
  }

  const suffix = String(config.queryContextAttributionSuffix || '').trim();

  if (typeof queryContext === 'string') {
    const ctx = queryContext.trim();
    if (!ctx) return '';
    return suffix ? `【${ctx}】${suffix}` : `【${ctx}】`;
  }

  if (typeof queryContext !== 'object' || Array.isArray(queryContext)) {
    return '';
  }

  const segments = Object.entries(queryContext)
    .map(([key, value]) => {
      const normalized = normalizeContextValue(value);
      if (!normalized) return '';
      const label = QUERY_CONTEXT_LABEL_MAP[key] || key;
      return `${label}:${normalized}`;
    })
    .filter(Boolean);

  if (segments.length === 0) return '';

  return suffix ? `【${segments.join('；')}】${suffix}` : `【${segments.join('；')}】`;
}

/** queryContext 是否包含可用于生成 text 的有效内容（供 esbParser 校验「text 或 queryContext 二选一必填」） */
function hasQueryContextContent(queryContext) {
  return buildQueryContextLine(queryContext).length > 0;
}

/**
 * 将 queryContext 拼接到 text 末尾。
 * text 为空（未传 / 空白）但 queryContext 有效内容时，text 直接使用 queryContext 内容
 * （即【上下文】+ 归因提示后缀，不再有开头的用户问题）。
 */
function appendQueryContextToText(text, queryContext) {
  const base = String(text || '').trim();
  const contextLine = buildQueryContextLine(queryContext);

  if (!contextLine) return base;
  if (!base) return contextLine;
  return `${base}\n${contextLine}`;
}

module.exports = {
  buildQueryContextLine,
  hasQueryContextContent,
  appendQueryContextToText,
};
