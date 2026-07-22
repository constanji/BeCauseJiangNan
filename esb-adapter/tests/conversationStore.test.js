const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveConversationId, resolveParentMessageId } = require('../src/conversationStore');

describe('conversationStore', () => {
  it('优先使用 bizBody.conversationId', () => {
    const id = resolveConversationId({ conversationId: 'fixed-id' });
    assert.equal(id, 'fixed-id');
  });

  it('bizBody.conversationId 去除首尾空白', () => {
    const id = resolveConversationId({ conversationId: '  fixed-id  ' });
    assert.equal(id, 'fixed-id');
  });

  it('未传 conversationId 时返回 null（视为新对话，交由 Because 生成）', () => {
    assert.equal(resolveConversationId({}), null);
  });

  it('空字符串 / 纯空白 conversationId 等同未传', () => {
    assert.equal(resolveConversationId({ conversationId: '' }), null);
    assert.equal(resolveConversationId({ conversationId: '   ' }), null);
  });

  it('优先使用 bizBody.parentMessageId', () => {
    const id = resolveParentMessageId({ parentMessageId: 'explicit-msg' });
    assert.equal(id, 'explicit-msg');
  });

  it('未传 parentMessageId 时返回 null（不做历史续接）', () => {
    assert.equal(resolveParentMessageId({}), null);
  });

  it('空字符串 / 纯空白 parentMessageId 等同未传', () => {
    assert.equal(resolveParentMessageId({ parentMessageId: '' }), null);
    assert.equal(resolveParentMessageId({ parentMessageId: '  ' }), null);
  });
});
