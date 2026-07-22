const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createMockBecauseServer } = require('./helpers/mockBecauseServer');
const { applyTestEnv, buildEsbRequest } = require('./helpers/testEnv');

describe('Because 联调（Mock 服务）', () => {
  /** @type {Awaited<ReturnType<createMockBecauseServer>>} */
  let mockBecause;
  /** @type {import('http').Server} */
  let adapterServer;

  before(async () => {
    mockBecause = await createMockBecauseServer({ answer: 'Mock Because 完整回复' });
    applyTestEnv({ becauseBaseUrl: mockBecause.baseUrl });

    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();

    const { app } = require('../index');
    adapterServer = app.listen(0, '127.0.0.1');
    await new Promise((res) => adapterServer.once('listening', res));
  });

  after(async () => {
    if (adapterServer) {
      await new Promise((res) => adapterServer.close(res));
    }
    if (mockBecause) {
      await mockBecause.close();
    }
  });

  function adapterBaseUrl() {
    const { port } = adapterServer.address();
    return `http://127.0.0.1:${port}`;
  }

  function postJson(url, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          });
        },
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async function pollStreamToFinal(startRequest, maxPolls = 20) {
    const start = await postJson(`${adapterBaseUrl()}/esb/transaction`, startRequest);
    assert.equal(start.status, 200);
    const startBiz = start.body.Transaction.Body.response.bizBody;
    assert.equal(startBiz.result, '1');
    assert.ok(startBiz.streamId);

    const streamId = startBiz.streamId;
    const { orgCode, userNum } = startRequest.Transaction.Body.request.bizBody;
    let finalBody = startBiz;

    for (let i = 0; i < maxPolls && finalBody.isFinal !== 'Y'; i += 1) {
      await new Promise((res) => setTimeout(res, 50));
      const poll = await postJson(
        `${adapterBaseUrl()}/esb/transaction`,
        buildEsbRequest({
          bizBody: { orgCode, userNum, streamId },
        }),
      );
      assert.equal(poll.status, 200);
      finalBody = poll.body.Transaction.Body.response.bizBody;
    }

    return finalBody;
  }

  async function waitForChatRequest(timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const chatReq = mockBecause.getRequests().find((r) => r.url === '/api/agents/chat');
      if (chatReq) return chatReq;
      await new Promise((res) => setTimeout(res, 20));
    }
    return null;
  }

  it('becauseClient.login + chat 打通 Mock Because', async () => {
    const { resetAuthCache, login, chat } = require('../src/becauseClient');
    resetAuthCache();

    const token = await login();
    assert.ok(token);

    const result = await chat({
      agentId: 'agent_result_test',
      text: '你好',
      conversationId: 'conv-mock-1',
    });

    assert.equal(result.ok, true);
    assert.equal(result.answer, 'Mock Because 完整回复');
    assert.equal(result.conversationId, 'conv-mock-1');

    const reqs = mockBecause.getRequests();
    assert.ok(reqs.some((r) => r.url === '/api/auth/login'));
    assert.ok(reqs.some((r) => r.url === '/api/agents/chat'));
  });

  it('POST /esb/transaction scene=result 全链路返回 answer', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();

    const finalBody = await pollStreamToFinal(buildEsbRequest());

    assert.equal(finalBody.isFinal, 'Y');
    assert.equal(finalBody.answer, 'Mock Because 完整回复');
    assert.ok(finalBody.conversationId);
  });

  it('POST /esb/transaction scene=zb 路由到 zb Agent', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();
    mockBecause.getRequests().length = 0;

    await pollStreamToFinal(
      buildEsbRequest({ bizBody: { scene: 'zb', text: '指标查询测试' } }),
    );

    const chatReq = await waitForChatRequest();
    assert.ok(chatReq);
    assert.equal(chatReq.body.agent_id, 'agent_zb_test');
  });

  it('queryContext 字符串会拼接到 text 末尾并附加归因提示词', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();
    mockBecause.getRequests().length = 0;

    await pollStreamToFinal(
      buildEsbRequest({
        bizBody: {
          text: '请分析本期波动',
          queryContext: '指标:各项存款余额；日期:20260623；机构:FR001',
        },
      }),
    );

    const chatReq = await waitForChatRequest();
    assert.ok(chatReq);
    assert.match(chatReq.body.text, /请分析本期波动/);
    assert.match(chatReq.body.text, /指标:各项存款余额/);
    assert.match(chatReq.body.text, /根据以上信息，开始归因/);
  });

  it('queryContext 对象会拼接到 text 末尾并附加归因提示词', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();
    mockBecause.getRequests().length = 0;

    await pollStreamToFinal(
      buildEsbRequest({
        bizBody: {
          text: '请分析本期波动',
          queryContext: {
            indexName: '各项存款余额',
            dataDate: '20260623',
            orgCode: 'FR001',
            context: '较上月下降',
          },
        },
      }),
    );

    const chatReq = await waitForChatRequest();
    assert.ok(chatReq);
    assert.match(chatReq.body.text, /请分析本期波动/);
    assert.match(chatReq.body.text, /指标:各项存款余额/);
    assert.match(chatReq.body.text, /日期:20260623/);
    assert.match(chatReq.body.text, /机构:FR001/);
    assert.match(chatReq.body.text, /根据以上信息，开始归因/);
  });

  it('不传 text 但有 queryContext 时可正常发起归因（text 由 queryContext 生成）', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();
    mockBecause.getRequests().length = 0;

    const finalBody = await pollStreamToFinal(
      buildEsbRequest({
        bizBody: {
          text: undefined,
          queryContext: {
            indexName: '各项存款余额',
            dataDate: '20260623',
            orgCode: 'FR001',
          },
        },
      }),
    );
    assert.equal(finalBody.isFinal, 'Y');

    const chatReq = await waitForChatRequest();
    assert.ok(chatReq);
    assert.match(chatReq.body.text, /^【/);
    assert.match(chatReq.body.text, /指标:各项存款余额/);
    assert.match(chatReq.body.text, /根据以上信息，开始归因/);
  });

  it('不传 text 且无有效 queryContext 时首轮请求被拒绝', async () => {
    const req = buildEsbRequest({ bizBody: { text: undefined } });
    const resp = await postJson(`${adapterBaseUrl()}/esb/transaction`, req);
    assert.equal(resp.status, 200);
    const bizBody = resp.body.Transaction.Body.response.bizBody;
    assert.equal(bizBody.result, '0');
    assert.match(bizBody.error, /text|queryContext/);
  });

  it('不传 conversationId 时每次都视为新对话，不会自动复用上一轮', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();

    const beforeCount = mockBecause.getRequests().filter((r) => r.url === '/api/agents/chat').length;

    const firstFinal = await pollStreamToFinal(
      buildEsbRequest({
        bizBody: { userNum: 'no_convid_user', text: '第一条' },
      }),
    );
    const firstConvId = firstFinal.conversationId;
    assert.ok(firstConvId);

    const secondFinal = await pollStreamToFinal(
      buildEsbRequest({
        bizBody: { userNum: 'no_convid_user', text: '第二条' },
      }),
    );
    const secondConvId = secondFinal.conversationId;
    assert.ok(secondConvId);

    // 两次都未传 conversationId，视为两个独立新对话
    assert.notEqual(secondConvId, firstConvId);

    const chatReqs = mockBecause
      .getRequests()
      .filter((r) => r.url === '/api/agents/chat')
      .slice(beforeCount);
    assert.equal(chatReqs.length, 2);
    assert.ok(!chatReqs[0].body.conversationId);
    assert.ok(!chatReqs[1].body.conversationId);
    assert.ok(!chatReqs[1].body.parentMessageId);
  });

  it('多轮会话：显式传入 conversationId / parentMessageId 时才续接', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();

    const req = buildEsbRequest({
      bizBody: { userNum: 'multi_turn_user', text: '第一条' },
    });

    const beforeCount = mockBecause.getRequests().filter((r) => r.url === '/api/agents/chat').length;

    const firstFinal = await pollStreamToFinal(req);
    const convId = firstFinal.conversationId;
    const firstParentId = firstFinal.parentMessageId;
    assert.ok(convId);
    assert.ok(firstParentId);

    const secondFinal = await pollStreamToFinal(
      buildEsbRequest({
        bizBody: {
          userNum: 'multi_turn_user',
          text: '第二条',
          conversationId: convId,
          parentMessageId: firstParentId,
        },
      }),
    );

    const chatReqs = mockBecause
      .getRequests()
      .filter((r) => r.url === '/api/agents/chat')
      .slice(beforeCount);
    assert.equal(chatReqs.length, 2);
    // 第一轮未传 conversationId，视为新对话
    assert.ok(!chatReqs[0].body.conversationId);
    // 第二轮显式传入，才会带上续接
    assert.equal(chatReqs[1].body.conversationId, convId);
    assert.equal(chatReqs[1].body.parentMessageId, firstParentId);
    assert.equal(secondFinal.conversationId, convId);
    assert.ok(secondFinal.parentMessageId);
  });

  it('streamMode=START/POLL 支持循环调用模拟流式输出', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    const { clearStreamStore } = require('../src/streamStore');
    resetAuthCache();
    clearStreamStore();

    const start = await postJson(
      `${adapterBaseUrl()}/esb/transaction`,
      buildEsbRequest({
        bizBody: {
          userNum: 'stream_user',
          text: '请模拟流式输出',
        },
      }),
    );

    assert.equal(start.status, 200);
    const startBizBody = start.body.Transaction.Body.response.bizBody;
    assert.equal(startBizBody.result, '1');
    assert.ok(startBizBody.streamId);
    assert.ok(['Y', 'N'].includes(startBizBody.isFinal));

    const streamId = startBizBody.streamId;
    let merged = startBizBody.chunk || '';
    let finalBody = startBizBody;

    for (let i = 0; i < 20 && finalBody.isFinal !== 'Y'; i += 1) {
      const poll = await postJson(
        `${adapterBaseUrl()}/esb/transaction`,
        buildEsbRequest({
          bizBody: {
            userNum: 'stream_user',
            streamId,
          },
        }),
      );
      assert.equal(poll.status, 200);
      finalBody = poll.body.Transaction.Body.response.bizBody;
      merged += finalBody.chunk || '';
      if (finalBody.isFinal === 'Y') {
        break;
      }
    }

    assert.equal(finalBody.isFinal, 'Y');
    assert.match(merged, /Mock Because 完整回复/);
    assert.equal(merged, finalBody.answer);

    const expired = await postJson(
      `${adapterBaseUrl()}/esb/transaction`,
      buildEsbRequest({
        bizBody: {
          userNum: 'stream_user',
          streamId,
        },
      }),
    );
    assert.equal(expired.status, 200);
    assert.equal(expired.body.Transaction.Body.response.bizBody.result, '0');
  });

  it('错误最终轮保留未下发的 chunk', async () => {
    const { clearStreamStore, createStreamTask, appendChunk, markDone } = require('../src/streamStore');
    clearStreamStore();

    const { streamId } = createStreamTask({ agentId: 'agent_result_test' });
    appendChunk(streamId, '已生成部分');
    markDone(streamId, { error: 'Because 返回错误' });

    const poll = await postJson(
      `${adapterBaseUrl()}/esb/transaction`,
      buildEsbRequest({
        bizBody: {
          userNum: 'error_tail_user',
          streamId,
        },
      }),
    );

    assert.equal(poll.status, 200);
    const biz = poll.body.Transaction.Body.response.bizBody;
    assert.equal(biz.result, '0');
    assert.equal(biz.isFinal, 'Y');
    assert.equal(biz.chunk, '已生成部分');
    assert.equal(biz.answer, '已生成部分');
    assert.match(biz.error || poll.body.Transaction.Header.sysHeader.bizResText, /Because 返回错误/);
  });

  it('Because 空回复时最终轮返回 result=0 并提示检查 Agent 配置', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    const { clearStreamStore } = require('../src/streamStore');
    resetAuthCache();
    clearStreamStore();

    const emptyMock = await createMockBecauseServer({ answer: '' });
    applyTestEnv({ becauseBaseUrl: emptyMock.baseUrl });

    const { app } = require('../index');
    const server = app.listen(0, '127.0.0.1');
    await new Promise((res) => server.once('listening', res));
    const { port } = server.address();

    try {
      const start = await postJson(
        `http://127.0.0.1:${port}/esb/transaction`,
        buildEsbRequest({ bizBody: { userNum: 'empty_answer_user', text: '测试空回复' } }),
      );
      const streamId = start.body.Transaction.Body.response.bizBody.streamId;
      let finalBiz = start.body.Transaction.Body.response.bizBody;

      for (let i = 0; i < 10 && finalBiz.isFinal !== 'Y'; i += 1) {
        await new Promise((res) => setTimeout(res, 50));
        const poll = await postJson(
          `http://127.0.0.1:${port}/esb/transaction`,
          buildEsbRequest({
            bizBody: { userNum: 'empty_answer_user', streamId },
          }),
        );
        finalBiz = poll.body.Transaction.Body.response.bizBody;
      }

      assert.equal(finalBiz.isFinal, 'Y');
      assert.equal(finalBiz.result, '0');
      assert.match(finalBiz.error || '', /Agent ID|BECAUSE_BASE_URL/);
    } finally {
      await new Promise((res) => server.close(res));
      await emptyMock.close();
    }
  });

  it('Because 404 Agent not found 时最终轮返回明确错误', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    const { clearStreamStore } = require('../src/streamStore');
    resetAuthCache();
    clearStreamStore();

    const notFoundMock = await createMockBecauseServer({ chatNotFound: true });
    applyTestEnv({ becauseBaseUrl: notFoundMock.baseUrl });

    const { app } = require('../index');
    const server = app.listen(0, '127.0.0.1');
    await new Promise((res) => server.once('listening', res));
    const { port } = server.address();

    try {
      const start = await postJson(
        `http://127.0.0.1:${port}/esb/transaction`,
        buildEsbRequest({ bizBody: { userNum: 'not_found_user', text: '测试404' } }),
      );
      const streamId = start.body.Transaction.Body.response.bizBody.streamId;
      let finalBiz = start.body.Transaction.Body.response.bizBody;

      for (let i = 0; i < 10 && finalBiz.isFinal !== 'Y'; i += 1) {
        await new Promise((res) => setTimeout(res, 50));
        const poll = await postJson(
          `http://127.0.0.1:${port}/esb/transaction`,
          buildEsbRequest({
            bizBody: { userNum: 'not_found_user', streamId },
          }),
        );
        finalBiz = poll.body.Transaction.Body.response.bizBody;
      }

      assert.equal(finalBiz.isFinal, 'Y');
      assert.equal(finalBiz.result, '0');
      assert.match(finalBiz.error || '', /Agent not found|Agent ID/);
    } finally {
      await new Promise((res) => server.close(res));
      await notFoundMock.close();
    }
  });
});

describe('scene 专用 BECAUSE_BASE_URL', () => {
  /** @type {Awaited<ReturnType<createMockBecauseServer>>} */
  let mockResult;
  /** @type {Awaited<ReturnType<createMockBecauseServer>>} */
  let mockZb;
  /** @type {import('http').Server} */
  let adapterServer;

  before(async () => {
    mockResult = await createMockBecauseServer({ answer: 'RESULT 实例回复' });
    mockZb = await createMockBecauseServer({ answer: 'ZB 实例回复' });
    applyTestEnv({
      becauseBaseUrl: mockResult.baseUrl,
      becauseBaseUrlResult: mockResult.baseUrl,
      becauseBaseUrlZb: mockZb.baseUrl,
    });

    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();

    const { app } = require('../index');
    adapterServer = app.listen(0, '127.0.0.1');
    await new Promise((res) => adapterServer.once('listening', res));
  });

  after(async () => {
    if (adapterServer) {
      await new Promise((res) => adapterServer.close(res));
    }
    if (mockResult) await mockResult.close();
    if (mockZb) await mockZb.close();
  });

  function adapterBaseUrl() {
    const { port } = adapterServer.address();
    return `http://127.0.0.1:${port}`;
  }

  function postJson(url, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          });
        },
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async function pollStreamToFinal(startRequest, maxPolls = 20) {
    const start = await postJson(`${adapterBaseUrl()}/esb/transaction`, startRequest);
    assert.equal(start.status, 200);
    const startBiz = start.body.Transaction.Body.response.bizBody;
    assert.equal(startBiz.result, '1');
    assert.ok(startBiz.streamId);

    const streamId = startBiz.streamId;
    const { orgCode, userNum } = startRequest.Transaction.Body.request.bizBody;
    let finalBody = startBiz;

    for (let i = 0; i < maxPolls && finalBody.isFinal !== 'Y'; i += 1) {
      await new Promise((res) => setTimeout(res, 50));
      const poll = await postJson(
        `${adapterBaseUrl()}/esb/transaction`,
        buildEsbRequest({
          bizBody: { orgCode, userNum, streamId },
        }),
      );
      assert.equal(poll.status, 200);
      finalBody = poll.body.Transaction.Body.response.bizBody;
    }

    return finalBody;
  }

  it('scene=result 路由到 BECAUSE_BASE_URL_RESULT', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();
    mockResult.getRequests().length = 0;
    mockZb.getRequests().length = 0;

    const finalBody = await pollStreamToFinal(buildEsbRequest({ bizBody: { scene: 'result' } }));

    assert.equal(finalBody.answer, 'RESULT 实例回复');
    assert.ok(mockResult.getRequests().some((r) => r.url === '/api/agents/chat'));
    assert.equal(
      mockZb.getRequests().filter((r) => r.url === '/api/agents/chat').length,
      0,
    );
  });

  it('scene=zb 路由到 BECAUSE_BASE_URL_ZB', async () => {
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();
    mockResult.getRequests().length = 0;
    mockZb.getRequests().length = 0;

    const finalBody = await pollStreamToFinal(
      buildEsbRequest({ bizBody: { scene: 'zb', text: '指标查询' } }),
    );

    assert.equal(finalBody.answer, 'ZB 实例回复');
    assert.ok(mockZb.getRequests().some((r) => r.url === '/api/agents/chat'));
    assert.equal(
      mockResult.getRequests().filter((r) => r.url === '/api/agents/chat').length,
      0,
    );
  });
});

describe('Because 联调（Mock 401 重试）', () => {
  let mockBecause;

  before(async () => {
    mockBecause = await createMockBecauseServer({
      chatUnauthorizedOnce: true,
      answer: '重试后成功',
    });
    applyTestEnv({ becauseBaseUrl: mockBecause.baseUrl });
    const { resetAuthCache } = require('../src/becauseClient');
    resetAuthCache();
  });

  after(async () => {
    if (mockBecause) await mockBecause.close();
  });

  it('chat 首次 401 后自动重新登录并重试', async () => {
    const { chat } = require('../src/becauseClient');
    const result = await chat({
      agentId: 'agent_result_test',
      text: '触发重试',
      conversationId: 'conv-retry',
    });

    assert.equal(result.ok, true);
    assert.equal(result.answer, '重试后成功');
    assert.equal(mockBecause.getChatCallCount(), 2);
  });
});
