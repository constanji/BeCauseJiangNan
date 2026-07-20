/**
 * Parse BeCause Message.content[] tool_call parts with field/name compatibility.
 * DB field is `content` (frontend often calls it contentParts).
 */

const STEP_DEFS = [
  { id: 'system_prompt', label: '系统提示词', phase: 'overhead' },
  { id: 'tools_schema', label: '工具 Schema（配置估算）', phase: 'overhead' },
  { id: 'user_question', label: '用户问题', phase: 'ask' },
  { id: 'tool_knowledge', label: '知识获取', phase: 'ask', commands: ['knowledge-discovery', 'rag-retrieval'] },
  {
    id: 'tool_schema',
    label: '数据表结构',
    phase: 'ask',
    commands: ['database-schema', 'light-schema', 'light_schema'],
  },
  {
    id: 'tool_sql_gen',
    label: 'SQL 生成/校验',
    phase: 'ask',
    commands: ['sql-validation', 'text-to-sql', 'sql-generation', 'result-analysis'],
  },
  { id: 'tool_sql_exec', label: 'SQL 执行结果', phase: 'ask', commands: ['sql-executor', 'sql_executor'] },
  {
    id: 'tool_attribution',
    label: '归因整理',
    phase: 'attribution',
    commands: ['fluctuation-attribution', 'fluctuation_attribution'],
  },
  { id: 'tool_chart', label: '图表工具', phase: 'ask', commands: ['echarts', 'chart', 'generate-chart'] },
  { id: 'tool_other', label: '其他工具', phase: 'ask', commands: [] },
  { id: 'final_answer', label: '最终回复', phase: 'final' },
  { id: 'errors', label: '错误内容', phase: 'other' },
];

function safeJsonParse(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function stringifyPart(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {object} toolCall
 * @returns {{ name: string, input: string, output: string, command: string|null, toolCallId: string|null }}
 */
function normalizeToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') {
    return { name: '', input: '', output: '', command: null, toolCallId: null };
  }

  const fn = toolCall.function && typeof toolCall.function === 'object' ? toolCall.function : {};
  const name = String(fn.name || toolCall.name || toolCall.tool || '').trim();
  const toolCallId = toolCall.id || toolCall.tool_call_id || toolCall.toolCallId || null;

  const inputRaw =
    fn.arguments ??
    fn.input ??
    toolCall.arguments ??
    toolCall.args ??
    toolCall.input ??
    '';
  const outputRaw = fn.output ?? toolCall.output ?? toolCall.result ?? '';

  const inputStr = stringifyPart(inputRaw);
  const outputStr = stringifyPart(outputRaw);

  let command = null;
  const parsed = safeJsonParse(inputRaw) || safeJsonParse(inputStr);
  if (parsed && typeof parsed === 'object') {
    command =
      parsed.command ||
      parsed.Command ||
      (parsed.arguments && (safeJsonParse(parsed.arguments)?.command || parsed.arguments.command)) ||
      null;
    if (typeof command === 'string') command = command.trim();
    else command = null;
  }

  return { name, input: inputStr, output: outputStr, command, toolCallId };
}

/**
 * Resolve step id from tool name + nested command (because_skills_2).
 * @param {string} name
 * @param {string|null} command
 */
function resolveStepId(name, command) {
  const candidates = [command, name]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().replace(/_/g, '-'));

  for (const c of candidates) {
    for (const def of STEP_DEFS) {
      if (!def.commands?.length) continue;
      if (def.commands.some((cmd) => cmd.toLowerCase() === c || c.includes(cmd.toLowerCase()))) {
        return def.id;
      }
    }
  }

  // because_skills_2 without parseable command → other
  if (name && /because.?skills/i.test(name)) {
    return 'tool_other';
  }
  if (name) return 'tool_other';
  return 'tool_other';
}

function extractTextFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return stringifyPart(content);
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' || part.type === 'TEXT') {
      parts.push(part.text ?? part[part.type] ?? '');
    } else if (part.type === 'think' || part.type === 'THINK') {
      // skip thinking for final answer volume; counted separately if needed
    } else if (typeof part.text === 'string') {
      parts.push(part.text);
    }
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * @param {Array<object>} messages BeCause messages
 * @returns {{
 *   userQuestion: string,
 *   finalAnswer: string,
 *   toolEvents: Array<object>,
 *   errorTexts: string[],
 * }}
 */
function parseMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let userQuestion = '';
  let finalAnswer = '';
  const toolEvents = [];
  const errorTexts = [];

  for (const msg of list) {
    const isUser = msg.isCreatedByUser === true || msg.role === 'user' || msg.sender === 'User';
    const content = msg.content;
    const textFallback = typeof msg.text === 'string' ? msg.text : '';

    if (isUser) {
      const t = extractTextFromContent(content) || textFallback;
      if (t && !userQuestion) userQuestion = t;
      continue;
    }

    if (!Array.isArray(content)) {
      if (textFallback) finalAnswer = textFallback;
      continue;
    }

    let assistantText = '';
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const type = String(part.type || '').toLowerCase();

      if (type === 'error') {
        errorTexts.push(stringifyPart(part.error ?? part.text ?? part));
        continue;
      }

      if (type === 'tool_call' || type === 'tool-call') {
        const raw = part.tool_call || part.toolCall || part;
        const normalized = normalizeToolCall(raw);
        const stepId = resolveStepId(normalized.name, normalized.command);
        toolEvents.push({
          stepId,
          messageId: msg.messageId || msg.id || null,
          toolName: normalized.name,
          command: normalized.command,
          toolCallId: normalized.toolCallId,
          input: normalized.input,
          output: normalized.output,
        });
        continue;
      }

      if (type === 'text' || type === 'TEXT') {
        assistantText += (part.text ?? part[part.type] ?? '') || '';
      }
    }

    if (assistantText) finalAnswer = assistantText;
    else if (textFallback) finalAnswer = textFallback;
  }

  return { userQuestion, finalAnswer, toolEvents, errorTexts };
}

function getStepDef(id) {
  return STEP_DEFS.find((s) => s.id === id) || { id, label: id, phase: 'other' };
}

module.exports = {
  STEP_DEFS,
  normalizeToolCall,
  resolveStepId,
  parseMessages,
  extractTextFromContent,
  getStepDef,
  stringifyPart,
  safeJsonParse,
};
