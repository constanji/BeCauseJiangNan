const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiError } = require('../src/lib/apiErrors');

test('api error messages are Chinese', () => {
  assert.match(ApiError.UNAUTHORIZED, /未授权/);
  assert.match(ApiError.MODEL_REQUIRED, /模型/);
  assert.match(ApiError.ENDPOINT_AND_MODEL_REQUIRED, /端点/);
  assert.match(ApiError.ENDPOINT_FIELDS_REQUIRED, /API Key/);
  assert.equal(ApiError.NOT_FOUND.includes('Not found'), false);
});
