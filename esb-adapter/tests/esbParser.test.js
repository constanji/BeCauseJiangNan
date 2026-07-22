const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateEsbRequest,
  buildSuccessResponse,
  buildErrorResponse,
  buildSystemErrorResponse,
} = require('../src/esbParser');

const validRequest = {
  Transaction: {
    Header: {
      sysHeader: {
        msgId: 'test001',
        msgDate: '20260608',
        msgTime: '120000',
        serviceCd: 'P00002006946',
        clientCd: '538',
        serverCd: '033',
      },
    },
    Body: {
      request: {
        bizHeader: null,
        bizBody: {
          orgCode: '538',
          userNum: 'u1',
          scene: 'result',
          text: '你好',
        },
      },
    },
  },
};

describe('esbParser', () => {
  it('validateEsbRequest 通过合法报文', () => {
    const result = validateEsbRequest(validRequest);
    assert.equal(result.ok, true);
    assert.equal(result.bizBody.scene, 'result');
  });

  it('validateEsbRequest 拒绝缺少 text 且无 queryContext', () => {
    const bad = JSON.parse(JSON.stringify(validRequest));
    delete bad.Transaction.Body.request.bizBody.text;
    const result = validateEsbRequest(bad);
    assert.equal(result.ok, false);
    assert.match(result.error, /text/);
  });

  it('validateEsbRequest 有有效 queryContext 时可省略 text', () => {
    const req = JSON.parse(JSON.stringify(validRequest));
    delete req.Transaction.Body.request.bizBody.text;
    req.Transaction.Body.request.bizBody.queryContext =
      '指标:各项存款余额；日期:20260623；机构:FR001';
    const result = validateEsbRequest(req);
    assert.equal(result.ok, true);
  });

  it('validateEsbRequest queryContext 为空对象且无 text 时仍拒绝', () => {
    const bad = JSON.parse(JSON.stringify(validRequest));
    delete bad.Transaction.Body.request.bizBody.text;
    bad.Transaction.Body.request.bizBody.queryContext = {};
    const result = validateEsbRequest(bad);
    assert.equal(result.ok, false);
    assert.match(result.error, /text/);
  });

  it('validateEsbRequest 拒绝缺少 scene', () => {
    const bad = JSON.parse(JSON.stringify(validRequest));
    delete bad.Transaction.Body.request.bizBody.scene;
    const result = validateEsbRequest(bad);
    assert.equal(result.ok, false);
    assert.match(result.error, /scene/);
  });

  it('validateEsbRequest 业务字段校验失败时仍回填原始 sysHeader', () => {
    const bad = JSON.parse(JSON.stringify(validRequest));
    delete bad.Transaction.Body.request.bizBody.orgCode;
    const result = validateEsbRequest(bad);
    assert.equal(result.ok, false);
    assert.equal(result.sysHeader.msgId, 'test001');
  });

  it('validateEsbRequest 完全缺少 sysHeader 时不回填', () => {
    const bad = JSON.parse(JSON.stringify(validRequest));
    delete bad.Transaction.Header.sysHeader;
    const result = validateEsbRequest(bad);
    assert.equal(result.ok, false);
    assert.equal(result.sysHeader, undefined);
  });

  it('validateEsbRequest 允许 POLL 不传 text 和 scene', () => {
    const pollReq = JSON.parse(JSON.stringify(validRequest));
    delete pollReq.Transaction.Body.request.bizBody.text;
    delete pollReq.Transaction.Body.request.bizBody.scene;
    pollReq.Transaction.Body.request.bizBody.streamId = 'stream-1';
    const result = validateEsbRequest(pollReq);
    assert.equal(result.ok, true);
    assert.equal(result.bizBody.streamId, 'stream-1');
  });

  it('validateEsbRequest 允许 queryContext 字符串', () => {
    const req = JSON.parse(JSON.stringify(validRequest));
    req.Transaction.Body.request.bizBody.queryContext =
      '指标:各项存款余额；日期:20260623；机构:FR001';
    const result = validateEsbRequest(req);
    assert.equal(result.ok, true);
    assert.equal(result.bizBody.queryContext, '指标:各项存款余额；日期:20260623；机构:FR001');
  });

  it('validateEsbRequest 允许 queryContext 对象（兼容）', () => {
    const req = JSON.parse(JSON.stringify(validRequest));
    req.Transaction.Body.request.bizBody.queryContext = {
      indexName: '各项存款余额',
      dataDate: '20260623',
      orgCode: 'FR001',
    };
    const result = validateEsbRequest(req);
    assert.equal(result.ok, true);
    assert.equal(result.bizBody.queryContext.indexName, '各项存款余额');
  });

  it('validateEsbRequest 忽略 streamMode 字段', () => {
    const req = JSON.parse(JSON.stringify(validRequest));
    req.Transaction.Body.request.bizBody.streamMode = 'START';
    const result = validateEsbRequest(req);
    assert.equal(result.ok, true);
    assert.equal(result.bizBody.streamMode, undefined);
  });

  it('buildSuccessResponse 包含 answer', () => {
    const { sysHeader, bizBody } = validateEsbRequest(validRequest);
    const resp = buildSuccessResponse(sysHeader, bizBody, {
      answer: '回复内容',
      conversationId: 'conv-1',
    });
    assert.equal(resp.Transaction.Header.sysHeader.resCode, '000000');
    assert.equal(resp.Transaction.Body.response.bizBody.result, '1');
    assert.equal(resp.Transaction.Body.response.bizBody.answer, '回复内容');
  });

  it('buildErrorResponse 标记失败', () => {
    const { sysHeader, bizBody } = validateEsbRequest(validRequest);
    const resp = buildErrorResponse(sysHeader, bizBody, '测试错误');
    assert.equal(resp.Transaction.Body.response.bizBody.result, '0');
    assert.equal(resp.Transaction.Header.sysHeader.bizResText, '测试错误');
  });

  it('buildSystemErrorResponse 无 sysHeader 时字段为空但 resCode 仍为 999999', () => {
    const resp = buildSystemErrorResponse('系统错误');
    assert.equal(resp.Transaction.Header.sysHeader.resCode, '999999');
    assert.equal(resp.Transaction.Header.sysHeader.msgId, '');
  });

  it('buildSystemErrorResponse 有 sysHeader 时回填 msgId 等字段供调用方对账，resCode 仍为 999999', () => {
    const bad = JSON.parse(JSON.stringify(validRequest));
    delete bad.Transaction.Body.request.bizBody.orgCode;
    const validated = validateEsbRequest(bad);
    const resp = buildSystemErrorResponse(validated.error, validated.sysHeader);
    assert.equal(resp.Transaction.Header.sysHeader.msgId, 'test001');
    assert.equal(resp.Transaction.Header.sysHeader.resCode, '999999');
    assert.equal(resp.Transaction.Header.sysHeader.bizResCode, '0');
  });
});
