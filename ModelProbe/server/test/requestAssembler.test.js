const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assembleOpenAIRequest,
  l2Snapshot,
  identityMatch,
  sanitizeModelName,
} = require('../src/services/RequestAssembler');
const { summarize, estimateTokens } = require('../src/lib/stats');

test('sanitizeModelName removes dots and colons', () => {
  assert.equal(sanitizeModelName('gpt-4.1:preview'), 'gpt-41preview');
});

test('google assembly maps model to modelName', () => {
  const { body, assemblyNotes } = assembleOpenAIRequest({
    model: 'gemini-2.0-flash',
    messages: [{ role: 'user', content: 'hi' }],
    endpointType: 'google',
  });
  assert.equal(body.modelName, 'gemini-2.0-flash');
  assert.equal(body.model, undefined);
  assert.ok(assemblyNotes.some((n) => /modelName|Google/.test(n)));
});

test('azure assembly uses deployment name', () => {
  const prev = process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME;
  process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME = 'true';
  const { body } = assembleOpenAIRequest({
    model: 'my-deploy',
    messages: [{ role: 'user', content: 'hi' }],
    endpointType: 'azure',
  });
  assert.equal(body.model, 'my-deploy');
  if (prev === undefined) delete process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME;
  else process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME = prev;
});

test('l2Snapshot captures model fields', () => {
  const snap = l2Snapshot({ model: 'a', stream: true });
  assert.deepEqual(snap, { model: 'a', stream: true });
});

test('identityMatch tolerates partial alias', () => {
  assert.equal(identityMatch('gpt-4o', { model: 'gpt-4o' }, { model: 'gpt-4o-2024-08-06' }), true);
});

test('summarize computes median', () => {
  const s = summarize([10, 20, 30]);
  assert.equal(s.median, 20);
  assert.equal(s.count, 3);
});

test('summarize empty returns null means', () => {
  const s = summarize([]);
  assert.equal(s.count, 0);
  assert.equal(s.mean, null);
});

test('estimateTokens from char length', () => {
  assert.ok(estimateTokens('hello world') >= 1);
});
