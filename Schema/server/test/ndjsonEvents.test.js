const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function writeNdjsonEvent(type, payload = {}) {
  return `${JSON.stringify({ type, ...payload })}\n`;
}

function parseNdjsonLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('deep-data-search NDJSON 事件格式', () => {
  it('事件行可被逐行解析', () => {
    const raw = [
      writeNdjsonEvent('start', { totalTables: 3 }),
      writeNdjsonEvent('progress', { scanned: 1, total: 3, tableName: 't1' }),
      writeNdjsonEvent('hit', { data: { tableName: 't1', lightSchemaId: 9 } }),
      writeNdjsonEvent('table_error', { tableName: 't2', error: '表不存在' }),
      writeNdjsonEvent('done', { elapsedMs: 120, hitCount: 1, scannedTables: 3, errorCount: 1 }),
    ].join('');

    const events = parseNdjsonLines(raw);
    assert.equal(events.length, 5);
    assert.equal(events[0].type, 'start');
    assert.equal(events[0].totalTables, 3);
    assert.equal(events[2].type, 'hit');
    assert.equal(events[2].data.lightSchemaId, 9);
    assert.equal(events[4].errorCount, 1);
  });
});
