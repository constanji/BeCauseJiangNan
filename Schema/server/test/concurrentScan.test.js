const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runConcurrentScan } = require('../src/lib/concurrentScan');

describe('runConcurrentScan', () => {
  it('以有限并发处理全部任务', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const seen = [];
    let maxActive = 0;
    let active = 0;

    await runConcurrentScan(items, 4, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(item);
      active -= 1;
    });

    assert.deepEqual(seen.sort((a, b) => a - b), items);
    assert.ok(maxActive <= 4, `max concurrency was ${maxActive}`);
    assert.equal(seen.length, items.length);
  });

  it('空列表不报错', async () => {
    await runConcurrentScan([], 4, async () => {
      throw new Error('should not run');
    });
  });
});
