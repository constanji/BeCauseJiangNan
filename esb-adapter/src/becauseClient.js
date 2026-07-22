const { config, resolveTextExtractOptions } = require('./config');
const { consumeSseStream, consumeSseStreamWithProgress } = require('./sseParser');
const { logger } = require('./logger');

/** @type {Map<string, { token: string | null, refreshCookie: string | null, expiresAt: number }>} */
const authCacheByBaseUrl = new Map();

function resolveBaseUrl(becauseBaseUrl) {
  const baseUrl = (becauseBaseUrl || config.becauseBaseUrl || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('Because 服务地址未配置');
  }
  return baseUrl;
}

function getAuthState(baseUrl) {
  if (!authCacheByBaseUrl.has(baseUrl)) {
    authCacheByBaseUrl.set(baseUrl, { token: null, refreshCookie: null, expiresAt: 0 });
  }
  return authCacheByBaseUrl.get(baseUrl);
}

function getJwtExpMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function parseSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

function extractRefreshCookie(setCookieHeaders) {
  for (const header of setCookieHeaders) {
    const match = header.match(/refreshToken=([^;]+)/);
    if (match) return `refreshToken=${match[1]}`;
  }
  return null;
}

function defaultHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'User-Agent': config.userAgent,
    ...extra,
  };
}

function formatBecauseHttpError(status, errText) {
  let detail = String(errText || '').slice(0, 500);
  try {
    const parsed = JSON.parse(detail);
    detail = parsed.error || parsed.message || detail;
  } catch {
    // 保留原始文本
  }
  if (status === 404 || /agent not found|Agent not found|invalid agent/i.test(detail)) {
    return `Because 聊天失败 (${status}): ${detail}；请检查 scene 对应的 Agent ID 与 BECAUSE_BASE_URL 是否匹配`;
  }
  return `Because 聊天失败 (${status}): ${detail}`;
}

/**
 * 带超时的 fetch：仅用于登录/refresh 这类应快速返回的接口，超时即 abort。
 * AbortError 时抛出携带上下文的错误，方便与业务错误区分。
 */
async function fetchWithTimeout(url, options, timeoutMs, timeoutLabel) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`${timeoutLabel}超时（>${timeoutMs}ms）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function login(becauseBaseUrl) {
  const baseUrl = resolveBaseUrl(becauseBaseUrl);
  const state = getAuthState(baseUrl);

  logger.info('Because 登录中', { baseUrl });
  const res = await fetchWithTimeout(
    `${baseUrl}/api/auth/login`,
    {
      method: 'POST',
      headers: defaultHeaders(),
      body: JSON.stringify({
        email: config.becauseEmail,
        password: config.becausePassword,
      }),
    },
    config.authTimeoutMs,
    'Because 登录',
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const msg = `Because 登录失败 (${res.status}): ${text.slice(0, 200)}`;
    logger.error('Because 登录失败', { baseUrl, status: res.status, body: text.slice(0, 200) });
    throw new Error(msg);
  }

  const data = await res.json();
  if (!data.token) {
    throw new Error('Because 登录响应缺少 token');
  }

  state.token = data.token;
  state.expiresAt = getJwtExpMs(data.token);
  state.refreshCookie = extractRefreshCookie(parseSetCookie(res.headers)) || state.refreshCookie;

  const expMin = state.expiresAt ? Math.round((state.expiresAt - Date.now()) / 60000) : '?';
  logger.info('Because 登录成功', { baseUrl, expiresInMin: expMin });
  return state.token;
}

async function refreshToken(becauseBaseUrl) {
  const baseUrl = resolveBaseUrl(becauseBaseUrl);
  const state = getAuthState(baseUrl);

  if (!state.refreshCookie) {
    return login(baseUrl);
  }

  let res;
  try {
    res = await fetchWithTimeout(
      `${baseUrl}/api/auth/refresh`,
      {
        method: 'POST',
        headers: defaultHeaders({ Cookie: state.refreshCookie }),
      },
      config.authTimeoutMs,
      'Because refresh token',
    );
  } catch (err) {
    logger.warn('Because refresh token 请求异常，回退重新登录', { baseUrl, message: err.message });
    return login(baseUrl);
  }

  if (!res.ok) {
    logger.warn('Because refresh token 失败，回退重新登录', { baseUrl, status: res.status });
    return login(baseUrl);
  }

  const data = await res.json();
  if (!data.token) {
    logger.warn('Because refresh token 响应无 token，回退重新登录', { baseUrl });
    return login(baseUrl);
  }

  state.token = data.token;
  state.expiresAt = getJwtExpMs(data.token);
  state.refreshCookie = extractRefreshCookie(parseSetCookie(res.headers)) || state.refreshCookie;

  return state.token;
}

async function getAccessToken(becauseBaseUrl) {
  const baseUrl = resolveBaseUrl(becauseBaseUrl);
  const state = getAuthState(baseUrl);
  const now = Date.now();

  if (state.token && state.expiresAt - config.tokenRefreshSkewMs > now) {
    return state.token;
  }

  if (state.token && state.refreshCookie) {
    try {
      return await refreshToken(baseUrl);
    } catch {
      return login(baseUrl);
    }
  }

  return login(baseUrl);
}

function resetAuthCache(becauseBaseUrl) {
  if (becauseBaseUrl) {
    authCacheByBaseUrl.delete(resolveBaseUrl(becauseBaseUrl));
    return;
  }
  authCacheByBaseUrl.clear();
}

/**
 * 空闲超时：仅在连续 idleMs 内无任何 SSE 活动时才 abort。
 * touch() 在收到 SSE 数据时调用，正在输出内容不会累计超时。
 */
function createIdleAbortController(idleMs) {
  const controller = new AbortController();
  let timer = null;

  const dispose = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = () => {
    dispose();
    timer = setTimeout(() => controller.abort(), idleMs);
  };

  const touch = () => {
    schedule();
  };

  schedule();

  return { signal: controller.signal, touch, dispose };
}

function formatChatTimeoutError() {
  return `Because 聊天空闲超时（连续 ${config.chatTimeoutMs}ms 无 SSE 数据）`;
}

function buildChatBody({ agentId, text, conversationId, parentMessageId, orgCode, userNum }) {
  const body = {
    endpoint: 'agents',
    endpointType: 'agents',
    agent_id: agentId,
    text,
    conversationId,
  };
  if (parentMessageId) {
    body.parentMessageId = parentMessageId;
  }
  if (orgCode) {
    body.orgCode = orgCode;
  }
  if (userNum) {
    body.userNum = userNum;
  }
  return body;
}

async function chat({
  agentId,
  text,
  conversationId,
  parentMessageId,
  becauseBaseUrl,
}) {
  const baseUrl = resolveBaseUrl(becauseBaseUrl);
  const token = await getAccessToken(baseUrl);
  const payload = buildChatBody({ agentId, text, conversationId, parentMessageId });

  const idleAbort = createIdleAbortController(config.chatTimeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/agents/chat`, {
      method: 'POST',
      headers: defaultHeaders({
        Authorization: `Bearer ${token}`,
      }),
      body: JSON.stringify(payload),
      signal: idleAbort.signal,
    });

    if (res.status === 401) {
      resetAuthCache(baseUrl);
      const newToken = await getAccessToken(baseUrl);
      const retry = await fetch(`${baseUrl}/api/agents/chat`, {
        method: 'POST',
        headers: defaultHeaders({
          Authorization: `Bearer ${newToken}`,
        }),
        body: JSON.stringify(payload),
        signal: idleAbort.signal,
      });

      if (!retry.ok) {
        const errText = await retry.text().catch(() => '');
        throw new Error(formatBecauseHttpError(retry.status, errText));
      }

      if (!retry.body) {
        throw new Error('Because 聊天响应体为空');
      }

      idleAbort.touch();
      return consumeSseStream(retry.body, { onActivity: idleAbort.touch });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(formatBecauseHttpError(res.status, errText));
    }

    if (!res.body) {
      throw new Error('Because 聊天响应体为空');
    }

    idleAbort.touch();
    return consumeSseStream(res.body, { onActivity: idleAbort.touch });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(formatChatTimeoutError());
    }
    throw err;
  } finally {
    idleAbort.dispose();
  }
}

async function chatStream({
  agentId,
  text,
  conversationId,
  parentMessageId,
  orgCode,
  userNum,
  becauseBaseUrl,
  scene,
  onDelta,
  onDone,
  onEchartdata,
  onSimilarQuestions,
  onAttributionData,
  onActivity,
}) {
  const baseUrl = resolveBaseUrl(becauseBaseUrl);
  const token = await getAccessToken(baseUrl);
  const payload = buildChatBody({ agentId, text, conversationId, parentMessageId, orgCode, userNum });
  const textExtractOptions = resolveTextExtractOptions(scene);

  const idleAbort = createIdleAbortController(config.chatTimeoutMs);
  // 除了驱动空闲超时计时器，还把活动信号透传给调用方（例如刷新 streamStore 任务 TTL），
  // 避免长时间只有工具调用/心跳但无文本增量时，任务被 TTL cleanup 提前清掉。
  const notifyActivity = () => {
    idleAbort.touch();
    if (typeof onActivity === 'function') onActivity();
  };

  try {
    const request = async (accessToken) =>
      fetch(`${baseUrl}/api/agents/chat`, {
        method: 'POST',
        headers: defaultHeaders({
          Authorization: `Bearer ${accessToken}`,
        }),
        body: JSON.stringify(payload),
        signal: idleAbort.signal,
      });

    let res = await request(token);
    if (res.status === 401) {
      resetAuthCache(baseUrl);
      const newToken = await getAccessToken(baseUrl);
      res = await request(newToken);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const msg = formatBecauseHttpError(res.status, errText);
      logger.error('Because 聊天 HTTP 错误', {
        baseUrl,
        agentId,
        scene,
        status: res.status,
        body: errText.slice(0, 300),
      });
      throw new Error(msg);
    }

    if (!res.body) {
      throw new Error('Because 聊天响应体为空');
    }

    notifyActivity();
    return consumeSseStreamWithProgress(res.body, {
      onDelta,
      onDone,
      onEchartdata,
      onSimilarQuestions,
      onAttributionData,
    }, { textExtractOptions, onActivity: notifyActivity });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(formatChatTimeoutError());
    }
    throw err;
  } finally {
    idleAbort.dispose();
  }
}

module.exports = {
  login,
  refreshToken,
  getAccessToken,
  resetAuthCache,
  chat,
  chatStream,
  buildChatBody,
  getJwtExpMs,
  resolveBaseUrl,
};
