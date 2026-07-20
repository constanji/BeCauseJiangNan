const { randomUUID } = require('node:crypto');
const logger = require('../lib/logger');

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const TOKEN_REFRESH_SKEW_MS = 60_000;
const AUTH_TIMEOUT_MS = 30_000;

/** @type {Map<string, { token: string|null, refreshCookie: string|null, expiresAt: number }>} */
const authCache = new Map();

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function cacheKey(baseUrl, email) {
  return `${normalizeBaseUrl(baseUrl)}::${String(email || '').trim().toLowerCase()}`;
}

function getAuthState(key) {
  if (!authCache.has(key)) {
    authCache.set(key, { token: null, refreshCookie: null, expiresAt: 0 });
  }
  return authCache.get(key);
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

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`${label}超时（>${timeoutMs}ms）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{
 *   baseUrl: string,
 *   email?: string,
 *   password?: string,
 *   jwtToken?: string,
 * }} conn
 */
function createBecauseClient(conn) {
  const baseUrl = normalizeBaseUrl(conn.baseUrl);
  const email = String(conn.email || '').trim();
  const password = String(conn.password || '');
  const staticJwt = String(conn.jwtToken || '').trim();
  const key = cacheKey(baseUrl, email || staticJwt || 'static');

  if (!baseUrl) {
    throw new Error('BeCause Base URL 未配置');
  }

  async function login() {
    if (!email || !password) {
      throw new Error('请配置 BeCause 登录邮箱和密码');
    }
    const state = getAuthState(key);
    logger.info('Because 登录中', { baseUrl, email });
    const res = await fetchWithTimeout(
      `${baseUrl}/api/auth/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': BROWSER_UA,
        },
        body: JSON.stringify({ email, password }),
      },
      AUTH_TIMEOUT_MS,
      'Because 登录',
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Because 登录失败 (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data.token) throw new Error('Because 登录响应缺少 token');
    state.token = data.token;
    state.expiresAt = getJwtExpMs(data.token);
    state.refreshCookie = extractRefreshCookie(parseSetCookie(res.headers)) || state.refreshCookie;
    logger.info('Because 登录成功', {
      baseUrl,
      expiresInMin: state.expiresAt ? Math.round((state.expiresAt - Date.now()) / 60000) : '?',
    });
    return state.token;
  }

  async function refresh() {
    const state = getAuthState(key);
    if (!state.refreshCookie) return login();
    let res;
    try {
      res = await fetchWithTimeout(
        `${baseUrl}/api/auth/refresh`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': BROWSER_UA,
            Cookie: state.refreshCookie,
          },
        },
        AUTH_TIMEOUT_MS,
        'Because refresh',
      );
    } catch (err) {
      logger.warn('refresh 异常，回退登录', { message: err.message });
      return login();
    }
    if (!res.ok) {
      logger.warn('refresh 失败，回退登录', { status: res.status });
      return login();
    }
    const data = await res.json().catch(() => ({}));
    if (!data.token) return login();
    state.token = data.token;
    state.expiresAt = getJwtExpMs(data.token);
    state.refreshCookie = extractRefreshCookie(parseSetCookie(res.headers)) || state.refreshCookie;
    return state.token;
  }

  async function getAccessToken() {
    if (staticJwt && !email) {
      return staticJwt;
    }
    const state = getAuthState(key);
    const now = Date.now();
    if (state.token && state.expiresAt - TOKEN_REFRESH_SKEW_MS > now) {
      return state.token;
    }
    if (state.token && state.refreshCookie) {
      try {
        return await refresh();
      } catch {
        return login();
      }
    }
    return login();
  }

  function resetAuth() {
    authCache.delete(key);
  }

  async function request(path, { method = 'GET', body, timeoutMs = 120_000, retryOn401 = true } = {}) {
    const token = await getAccessToken();
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'User-Agent': BROWSER_UA,
        },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (res.status === 401 && retryOn401 && email) {
        resetAuth();
        const newToken = await getAccessToken();
        res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${newToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'User-Agent': BROWSER_UA,
          },
          body: body != null ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async function healthish() {
    try {
      const res = await fetchWithTimeout(
        `${baseUrl}/api/health`,
        { headers: { 'User-Agent': BROWSER_UA } },
        15_000,
        'health',
      );
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, error: err.message || '无法连接 BeCause' };
    }
  }

  async function loginTest() {
    resetAuth();
    const token = await getAccessToken();
    return { ok: Boolean(token), email: email || null };
  }

  async function getAgent(agentId) {
    const id = encodeURIComponent(agentId);
    const res = await request(`/api/agents/${id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `获取 Agent 失败 HTTP ${res.status}`);
    }
    return data;
  }

  async function listAgents() {
    const res = await request('/api/agents');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `获取 Agent 列表失败 HTTP ${res.status}`);
    }
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.agents)) return data.agents;
    return [];
  }

  async function getMessages(conversationId) {
    const id = encodeURIComponent(conversationId);
    const res = await request(`/api/messages/${id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `获取消息失败 HTTP ${res.status}`);
    }
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.messages)) return data.messages;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  async function runAgentChat({ agentId, text, conversationId, dataSourceId, timeoutMs = 600_000 }) {
    const convId = conversationId || randomUUID();
    const body = {
      endpoint: 'agents',
      endpointType: 'agents',
      agent_id: agentId,
      text,
      conversationId: convId,
    };
    if (dataSourceId) {
      body.data_source_id = dataSourceId;
    }

    const res = await request('/api/agents/chat', {
      method: 'POST',
      body,
      timeoutMs,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`聊天失败 HTTP ${res.status}: ${errText.slice(0, 400)}`);
    }

    const contentType = res.headers.get('content-type') || '';
    let resolvedConvId = convId;
    let finalPayload = null;

    if (contentType.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n');
        buffer = chunks.pop() || '';
        for (const line of chunks) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const raw = trimmed.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const payload = JSON.parse(raw);
            if (payload.conversationId) resolvedConvId = payload.conversationId;
            if (payload.conversation?.conversationId) {
              resolvedConvId = payload.conversation.conversationId;
            }
            if (payload.final === true || payload.final === 'true') {
              finalPayload = payload;
            }
          } catch {
            // ignore
          }
        }
      }
    } else {
      finalPayload = await res.json().catch(() => null);
      if (finalPayload?.conversationId) resolvedConvId = finalPayload.conversationId;
    }

    logger.info('BeCause chat finished', { conversationId: resolvedConvId });
    return { conversationId: resolvedConvId, finalPayload };
  }

  return {
    healthish,
    loginTest,
    getAgent,
    listAgents,
    getMessages,
    runAgentChat,
    getAccessToken,
    baseUrl,
  };
}

function clientFromDbRow(row) {
  return createBecauseClient({
    baseUrl: row.base_url,
    email: row.email || '',
    password: row.password || '',
    jwtToken: row.jwt_token || '',
  });
}

module.exports = { createBecauseClient, clientFromDbRow, normalizeBaseUrl };
