const AUTO_CHART_ID_PATTERN = /@ec@[^:@]+:chart_(\d+)@ec@/g;
const SESSION_CHART_ID_PATTERN = /@ec@[^:@]+:[^@\s]+_[a-f0-9]{16}_(\d+)@ec@/g;

function getMessageSearchText(message) {
  const parts = [];
  if (typeof message?.text === 'string') parts.push(message.text);
  if (typeof message?.content === 'string') parts.push(message.content);
  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      if (typeof part === 'string') {
        parts.push(part);
      } else if (part && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
  }
  return parts.join('\n');
}

/**
 * Finds the highest sequential chart id already rendered on the active
 * conversation branch. User-authored text is ignored so a prompt containing
 * a marker cannot influence server-generated ids.
 */
function getConversationChartIdOffset(messages) {
  let maxId = 0;
  for (const message of messages ?? []) {
    if (message?.isCreatedByUser === true) {
      continue;
    }
    const text = getMessageSearchText(message);
    AUTO_CHART_ID_PATTERN.lastIndex = 0;
    let match;
    while ((match = AUTO_CHART_ID_PATTERN.exec(text)) != null) {
      const id = Number.parseInt(match[1], 10);
      if (Number.isSafeInteger(id) && id > maxId) {
        maxId = id;
      }
    }
  }
  return maxId;
}

/** Next zero-based index for the session-scoped automatic id format. */
function getConversationChartIndexOffset(messages) {
  let nextIndex = 0;
  for (const message of messages ?? []) {
    if (message?.isCreatedByUser === true) continue;
    const text = getMessageSearchText(message);
    SESSION_CHART_ID_PATTERN.lastIndex = 0;
    let match;
    while ((match = SESSION_CHART_ID_PATTERN.exec(text)) != null) {
      const index = Number.parseInt(match[1], 10);
      if (Number.isSafeInteger(index) && index + 1 > nextIndex) nextIndex = index + 1;
    }
  }
  return nextIndex;
}

module.exports = {
  getConversationChartIdOffset,
  getConversationChartIndexOffset,
  getMessageSearchText,
};
