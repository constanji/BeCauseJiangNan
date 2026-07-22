/** 空字符串、纯空白视为未传（等同省略字段） */
function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * 解析会话 ID：仅使用 ESB 显式传入的 conversationId。
 * 未传（含空字符串/空白）一律视为新对话，由上游 chatStream 侧生成新会话
 * （不再回退到历史会话缓存，避免"不传 = 自动续接上一轮"）。
 */
function resolveConversationId(bizBody) {
  if (hasValue(bizBody.conversationId)) {
    return String(bizBody.conversationId).trim();
  }
  return null;
}

/**
 * 解析 parentMessageId：仅使用 ESB 显式传入的值。
 * 未传时不做续接——conversationId 都已视为新对话，延用旧的 parentMessageId
 * 没有意义，反而可能导致 Because 侧会话状态错乱。
 */
function resolveParentMessageId(bizBody) {
  if (hasValue(bizBody.parentMessageId)) {
    return String(bizBody.parentMessageId).trim();
  }
  return null;
}

module.exports = {
  hasValue,
  resolveConversationId,
  resolveParentMessageId,
};
