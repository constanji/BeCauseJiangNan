/**
 * 将 OpenAI SDK / 网络错误转成可读中文说明。
 * 覆盖 HTTP 状态码、系统 errno（如 111=连接被拒绝）等。
 */

const HTTP_STATUS_ZH = {
  400: '请求无效',
  401: '未授权',
  403: '禁止访问',
  404: '未找到',
  408: '请求超时',
  413: '请求体过大',
  429: '请求过于频繁',
  500: '服务器内部错误',
  502: '网关错误',
  503: '服务不可用',
  504: '网关超时',
};

/** Node / 系统 errno → 中文 */
const ERRNO_ZH = {
  111: '连接被拒绝',
  ECONNREFUSED: '连接被拒绝',
  110: '连接超时',
  ETIMEDOUT: '连接超时',
  ECONNRESET: '连接被重置',
  ENOTFOUND: '域名无法解析',
  EAI_AGAIN: 'DNS 暂时失败',
  EHOSTUNREACH: '主机不可达',
  ENETUNREACH: '网络不可达',
  EPIPE: '连接已断开',
  ECONNABORTED: '连接中止',
  CERT_HAS_EXPIRED: '证书已过期',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: '证书校验失败',
};

function pickErrno(err, providerMsg) {
  const candidates = [
    err?.errno,
    err?.cause?.errno,
    err?.code,
    err?.cause?.code,
    err?.error?.code,
  ].filter((v) => v != null && v !== '');

  const fromMsg = String(providerMsg || '').match(/error[:\s]*(-?\d+)/i);
  if (fromMsg) candidates.push(Number(fromMsg[1]));

  const fromErrnoWord = String(providerMsg || '').match(
    /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN)\b/i,
  );
  if (fromErrnoWord) candidates.push(fromErrnoWord[1].toUpperCase());

  for (const c of candidates) {
    const key = typeof c === 'number' ? c : String(c);
    if (ERRNO_ZH[key] || ERRNO_ZH[String(key).toUpperCase()]) {
      return { code: key, label: ERRNO_ZH[key] || ERRNO_ZH[String(key).toUpperCase()] };
    }
  }
  return null;
}

function pickHttpStatus(err, providerMsg) {
  let status = err?.status ?? err?.statusCode ?? err?.response?.status;
  if (!status) {
    const m = String(providerMsg || '').match(/\b(4\d{2}|5\d{2})\b/);
    if (m) status = Number(m[1]);
  }
  return status || null;
}

function formatProviderError(err, { model, baseURL } = {}) {
  const providerMsg =
    err?.error?.message ||
    err?.response?.data?.error?.message ||
    err?.cause?.message ||
    err?.message ||
    String(err);

  const status = pickHttpStatus(err, providerMsg);
  const errnoInfo = pickErrno(err, providerMsg);
  const code = err?.code || err?.error?.code || err?.type;
  const statusZh = status ? HTTP_STATUS_ZH[status] || `HTTP ${status}` : null;

  const hints = [];

  if (status === 401 || /invalid.?api.?key|unauthorized|authentication/i.test(providerMsg)) {
    hints.push('请检查 API Key 是否正确、是否已过期');
  }
  if (status === 404) {
    hints.push('请检查 Base URL 是否正确（一般到 /v1，不要多写 /chat/completions）');
  }
  if (
    status === 400 &&
    /invalid model|model.?id|model.?not.?found|does not exist|unknown model/i.test(providerMsg)
  ) {
    hints.push(
      `模型 ID「${model || ''}」不被该服务识别。ModelScope 等平台常用带组织前缀的全名，例如 Qwen/Qwen3-32B，请对照供应商模型列表`,
    );
  } else if (status === 400) {
    hints.push('请求参数不被接受，可检查模型名、是否需 dropParams');
  }
  if (status === 429 || /rate limit|too many requests/i.test(providerMsg)) {
    hints.push('触发限流，请稍后重试或降低并发');
  }
  if (status === 403) {
    hints.push('无权限访问该模型或密钥权限不足');
  }
  if (status === 503) {
    hints.push('上游服务暂时不可用或过载，请稍后重试；若持续出现，检查网关/模型服务是否正常');
  }
  if (status === 502 || status === 504) {
    hints.push('网关或上游超时，请检查 Base URL、代理与模型服务状态');
  }
  if (
    errnoInfo ||
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network|socket|connect/i.test(providerMsg)
  ) {
    hints.push(`无法稳定连接 ${baseURL || '服务地址'}，请检查网络、防火墙与 Base URL`);
  }

  const parts = [];
  if (status) {
    parts.push(statusZh ? `HTTP ${status}（${statusZh}）` : `HTTP ${status}`);
  }
  if (errnoInfo) {
    parts.push(`错误码 ${errnoInfo.code}（${errnoInfo.label}）`);
  } else if (code && !HTTP_STATUS_ZH[code]) {
    const codeZh = ERRNO_ZH[code] || ERRNO_ZH[String(code).toUpperCase()];
    parts.push(codeZh ? `代码 ${code}（${codeZh}）` : `代码 ${code}`);
  }

  // 原始英文过长时压缩；已有中文概括时仍保留简短原文便于排查
  const shortRaw = String(providerMsg).replace(/\s+/g, ' ').slice(0, 160);
  if (shortRaw && !/^\d+$/.test(shortRaw)) {
    parts.push(`原文：${shortRaw}`);
  }
  if (model) parts.push(`请求模型=${model}`);
  if (baseURL) parts.push(`地址=${baseURL}`);

  let text = parts.join(' · ');
  if (hints.length) {
    text += `\n建议：${[...new Set(hints)].join('；')}`;
  }
  return text;
}

module.exports = { formatProviderError, HTTP_STATUS_ZH, ERRNO_ZH };
