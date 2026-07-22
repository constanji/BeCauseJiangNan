const http = require('http');
const { randomUUID } = require('crypto');

/** 远期过期的假 JWT，供 becauseClient 缓存逻辑使用 */
const FAKE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  Buffer.from(JSON.stringify({ exp: 9999999999, sub: 'test' })).toString('base64url') +
  '.fake-signature';

const REFRESHED_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  Buffer.from(JSON.stringify({ exp: 9999999999, sub: 'test-refreshed' })).toString('base64url') +
  '.fake-signature-refreshed';

function buildSseBody(payload) {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * 启动模拟 Because API 服务。
 * @param {object} [options]
 * @param {boolean} [options.chatUnauthorizedOnce] 首次 chat 返回 401，用于测重试
 * @param {boolean} [options.chatNotFound] chat 返回 404 JSON（模拟 Agent 不存在）
 * @param {string} [options.answer] SSE 回复文本
 * @param {number} [options.loginDelayMs] 登录接口人为延迟（毫秒），用于测超时
 * @param {number} [options.refreshDelayMs] refresh 接口人为延迟（毫秒），用于测超时
 */
function createMockBecauseServer(options = {}) {
  let chatCallCount = 0;
  const answer = Object.prototype.hasOwnProperty.call(options, 'answer')
    ? options.answer
    : '这是模拟 Because 回复';
  const requests = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      try {
        body = bodyRaw ? JSON.parse(bodyRaw) : {};
      } catch {
        body = {};
      }

      requests.push({ method: req.method, url: req.url, headers: req.headers, body });

      if (req.method === 'POST' && req.url === '/api/auth/login') {
        const respond = () => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': 'refreshToken=mock-refresh; Path=/; HttpOnly',
          });
          res.end(JSON.stringify({ token: FAKE_TOKEN, user: { id: 'u1' } }));
        };
        if (options.loginDelayMs) {
          setTimeout(respond, options.loginDelayMs);
        } else {
          respond();
        }
        return;
      }

      if (req.method === 'POST' && req.url === '/api/auth/refresh') {
        const respond = () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ token: REFRESHED_TOKEN, user: { id: 'u1' } }));
        };
        if (options.refreshDelayMs) {
          setTimeout(respond, options.refreshDelayMs);
        } else {
          respond();
        }
        return;
      }

      if (req.method === 'POST' && req.url === '/api/agents/chat') {
        chatCallCount += 1;
        if (options.chatUnauthorizedOnce && chatCallCount === 1) {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('Unauthorized');
          return;
        }

        if (options.chatNotFound) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Agent not found' }));
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        // 模拟真实 Because：未传 conversationId 时视为新对话，生成新 ID
        const convId = body.conversationId || randomUUID();
        const responseMessageId = `resp-${chatCallCount}`;
        res.write(
          buildSseBody({
            final: true,
            title: '模拟会话',
            conversation: { conversationId: convId, title: '模拟会话' },
            responseMessage: {
              messageId: responseMessageId,
              content: [{ type: 'text', text: answer }],
            },
          }),
        );
        res.end();
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        getRequests: () => requests,
        getChatCallCount: () => chatCallCount,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
    server.on('error', reject);
  });
}

module.exports = {
  createMockBecauseServer,
  FAKE_TOKEN,
  REFRESHED_TOKEN,
};
