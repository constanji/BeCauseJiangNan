const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeDecodeRates,
  resolveThroughputSpec,
} = require('../src/services/MetricsCollector');

test('computeDecodeRates: completion / (total - ttft)', () => {
  const r = computeDecodeRates({ outputTokens: 100, totalMs: 2500, ttftMs: 500 });
  assert.equal(r.decodeTps, 50);
  assert.equal(r.tpotMs, roundOrExact(2000 / 99));
  assert.equal(r.genMs, 2000);
});

function roundOrExact(n) {
  return Math.round(n * 100) / 100;
}

test('computeDecodeRates: rejects missing ttft or zero output', () => {
  assert.equal(computeDecodeRates({ outputTokens: 10, totalMs: 1000, ttftMs: null }), null);
  assert.equal(computeDecodeRates({ outputTokens: 0, totalMs: 1000, ttftMs: 100 }), null);
  assert.equal(computeDecodeRates({ outputTokens: 10, totalMs: 100, ttftMs: 200 }), null);
});

test('resolveThroughputSpec short / longOutput / longInput', () => {
  const short = resolveThroughputSpec('short', {});
  assert.equal(short.mode, 'short');
  assert.equal(short.max_tokens, 8);
  assert.match(short.prompt, /ping/i);

  const longOut = resolveThroughputSpec('longOutput', { longOutputMaxTokens: 512 });
  assert.equal(longOut.mode, 'longOutput');
  assert.equal(longOut.max_tokens, 512);
  assert.ok(longOut.prompt.length > 20);

  const longIn = resolveThroughputSpec('longInput', { longInputTokens: 2048, longInputMaxTokens: 16 });
  assert.equal(longIn.mode, 'longInput');
  assert.equal(longIn.max_tokens, 16);
  assert.equal(longIn.longInputTokens, 2048);
  assert.ok(Array.isArray(longIn.messages));
  assert.ok(longIn.messages[0].content.includes('filler') || longIn.messages[0].content.length > 100);
});
