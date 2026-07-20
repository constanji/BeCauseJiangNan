const test = require('node:test');
const assert = require('node:assert/strict');
const { formatProviderError } = require('../src/lib/formatProviderError');

test('formats 503 with errno 111 in Chinese', () => {
  const text = formatProviderError(
    { status: 503, message: '503 status code (no body)\nerror:111' },
    { model: 'gpt-x', baseURL: 'https://example.com/v1' },
  );
  assert.match(text, /服务不可用/);
  assert.match(text, /连接被拒绝/);
  assert.match(text, /gpt-x/);
});

test('formats ECONNREFUSED', () => {
  const text = formatProviderError(
    { code: 'ECONNREFUSED', errno: -111, message: 'connect ECONNREFUSED 127.0.0.1:443' },
    { baseURL: 'http://127.0.0.1:443/v1' },
  );
  assert.match(text, /连接被拒绝/);
});
