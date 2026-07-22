const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  createStreamTask,
  appendChunk,
  markDone,
  readPollState,
  clearStreamStore,
  getTask,
  touchTask,
} = require('../src/streamStore');

describe('streamStore readPollState', () => {
  beforeEach(() => {
    clearStreamStore();
  });

  it('首轮无内容时 chunk 为空、seq=1', () => {
    const { streamId } = createStreamTask();
    const state = readPollState(streamId);
    assert.equal(state.chunk, '');
    assert.equal(state.seq, 1);
    assert.equal(state.answer, '');
    assert.equal(state.isFinal, false);
  });

  it('chunk 为相对上轮 answer 的新增尾部', () => {
    const { streamId } = createStreamTask();
    appendChunk(streamId, '您好');
    appendChunk(streamId, '！');

    const first = readPollState(streamId);
    assert.equal(first.chunk, '您好！');
    assert.equal(first.answer, '您好！');
    assert.equal(first.seq, 1);

    appendChunk(streamId, '正在查询');

    const second = readPollState(streamId);
    assert.equal(second.chunk, '正在查询');
    assert.equal(second.answer, '您好！正在查询');
    assert.equal(second.seq, 2);
  });

  it('无新增内容时 chunk 为空且 seq 不变', () => {
    const { streamId } = createStreamTask();
    appendChunk(streamId, 'abc');
    const first = readPollState(streamId);
    assert.equal(first.seq, 1);

    const second = readPollState(streamId);
    assert.equal(second.chunk, '');
    assert.equal(second.seq, 1);
    assert.equal(second.answer, 'abc');
    assert.equal(second.isFinal, false);
  });

  it('累加 chunk 与最终 answer 一致', () => {
    const { streamId } = createStreamTask();
    appendChunk(streamId, 'Mock ');
    appendChunk(streamId, 'Because ');
    appendChunk(streamId, '完整回复');
    markDone(streamId);

    let merged = '';
    let state;
    do {
      state = readPollState(streamId, { maxChunkChars: 5 });
      merged += state.chunk;
    } while (!state.isFinal);

    assert.equal(merged, 'Mock Because 完整回复');
    assert.equal(state.answer, 'Mock Because 完整回复');
    assert.equal(state.isFinal, true);
  });

  it('chunk 超长时分批下发尾部', () => {
    const { streamId } = createStreamTask();
    appendChunk(streamId, '1234567890');
    markDone(streamId);

    const first = readPollState(streamId, { maxChunkChars: 4 });
    assert.equal(first.chunk, '1234');
    assert.equal(first.answer, '1234567890');
    assert.equal(first.isFinal, false);

    const second = readPollState(streamId, { maxChunkChars: 4 });
    assert.equal(second.chunk, '5678');
    assert.equal(second.isFinal, false);

    const third = readPollState(streamId, { maxChunkChars: 4 });
    assert.equal(third.chunk, '90');
    assert.equal(third.isFinal, true);
  });

  it('错误结束时仍可下发未交付尾部', () => {
    const { streamId } = createStreamTask();
    appendChunk(streamId, '已生成部分');
    markDone(streamId, { error: 'Because 返回错误' });

    const state = readPollState(streamId);
    assert.equal(state.chunk, '已生成部分');
    assert.equal(state.answer, '已生成部分');
    assert.equal(state.isFinal, true);
    assert.equal(state.error, 'Because 返回错误');
  });

  it('answer 为空时丢弃开头纯空白', () => {
    const { streamId } = createStreamTask();
    appendChunk(streamId, '\n\n');
    appendChunk(streamId, '  \t');
    assert.equal(getTask(streamId).answer, '');

    appendChunk(streamId, '\n\n您好');
    assert.equal(getTask(streamId).answer, '您好');
  });

  it('answer 已有内容时保留后续 chunk 内的空白', () => {
    const { streamId } = createStreamTask();
    appendChunk(streamId, '您好');
    appendChunk(streamId, '\n\n');
    assert.equal(getTask(streamId).answer, '您好\n\n');
  });

  it('touchTask 仅刷新 expiresAt，不改变任何业务字段', () => {
    const { streamId } = createStreamTask();
    appendChunk(streamId, '您好');
    const before = getTask(streamId);
    const beforeExpiresAt = before.expiresAt;
    const beforeAnswer = before.answer;

    // 确保时间戳会前进，避免同一毫秒内断言无意义
    const start = Date.now();
    while (Date.now() === start) {
      /* busy wait a tick */
    }

    touchTask(streamId);
    const after = getTask(streamId);
    assert.ok(after.expiresAt >= beforeExpiresAt);
    assert.equal(after.answer, beforeAnswer);
    assert.equal(after.done, false);
  });

  it('touchTask 对不存在的 streamId 静默忽略', () => {
    assert.doesNotThrow(() => touchTask('not-exist'));
  });
});
