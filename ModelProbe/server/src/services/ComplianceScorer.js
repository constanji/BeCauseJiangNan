/**
 * 输出规范评分：Think 隔离、伪 tool JSON 等（逻辑对齐主站 parseThinkingContent，自包含无依赖）。
 */

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';
const LEGACY_THINK_RE = /:::thinking[\s\S]*?:::/g;

function parseThinkingContent(content) {
  const text = String(content || '');
  if (!text.includes(THINK_OPEN)) {
    return { text: text.trim(), thinking: '' };
  }

  let textResult = '';
  const thinkingResult = [];
  let position = 0;

  while (position < text.length) {
    const thinkStart = text.indexOf(THINK_OPEN, position);
    if (thinkStart === -1) {
      textResult += text.slice(position);
      break;
    }
    textResult += text.slice(position, thinkStart);
    const thinkEnd = text.indexOf(THINK_CLOSE, thinkStart);
    if (thinkEnd === -1) {
      textResult += text.slice(thinkStart);
      break;
    }
    thinkingResult.push(text.slice(thinkStart + THINK_OPEN.length, thinkEnd));
    position = thinkEnd + THINK_CLOSE.length;
  }

  return {
    text: textResult.trim(),
    thinking: thinkingResult.join('\n').trim(),
  };
}

/** 移除 markdown 围栏代码块后再做标签检测 */
function stripCodeFences(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, '');
}

function hasThinkTagsOutsideCodeFence(text) {
  const stripped = stripCodeFences(text);
  return stripped.includes(THINK_OPEN) || stripped.includes(THINK_CLOSE);
}

function hasUnclosedThink(text) {
  const stripped = stripCodeFences(text);
  let depth = 0;
  let pos = 0;
  while (pos < stripped.length) {
    const open = stripped.indexOf(THINK_OPEN, pos);
    const close = stripped.indexOf(THINK_CLOSE, pos);
    if (open === -1 && close === -1) break;
    if (open !== -1 && (close === -1 || open < close)) {
      depth += 1;
      pos = open + THINK_OPEN.length;
    } else {
      depth -= 1;
      pos = close + THINK_CLOSE.length;
    }
  }
  return depth > 0;
}

function hasLegacyThinkingMarker(text) {
  LEGACY_THINK_RE.lastIndex = 0;
  const withoutFence = stripCodeFences(text);
  return LEGACY_THINK_RE.test(withoutFence);
}

function visibleText(response) {
  const msg = response?.message || response?.choices?.[0]?.message || {};
  const parts = [];
  if (msg.content) parts.push(String(msg.content));
  if (msg.reasoning) parts.push(String(msg.reasoning));
  if (msg.reasoning_content) parts.push(String(msg.reasoning_content));
  return parts.join('\n');
}

function extractToolCalls(response) {
  const msg = response?.message || response?.choices?.[0]?.message || {};
  return msg.tool_calls || [];
}

function detectPseudoToolJson(text) {
  const t = String(text || '');
  // 大段 JSON 且含 function/tool 相关键，视为「对话里粘贴伪调用」
  const jsonLike = /\{[\s\S]{20,800}\}/g;
  let m;
  while ((m = jsonLike.exec(t)) !== null) {
    const block = m[0];
    if (
      /"(function|name|arguments|tool_call|tool_calls)"\s*:/.test(block) &&
      (/"(get_weather|lookup_account|city|id)"/.test(block) ||
        /"(because_skills_2|light-schema|sql-validation|command)"/.test(block))
    ) {
      try {
        JSON.parse(block);
        return { found: true, excerpt: block.slice(0, 120) };
      } catch {
        if (/function_call|tool_use/.test(block)) {
          return { found: true, excerpt: block.slice(0, 120) };
        }
      }
    }
  }
  return { found: false };
}

function validateToolCall(toolCall, { expectedTool, requiredArgs = [] }) {
  const fn = toolCall?.function || toolCall;
  const name = fn?.name || toolCall?.name;
  const rawArgs = fn?.arguments ?? toolCall?.arguments ?? '{}';
  let args;
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
  } catch {
    return { ok: false, reason: 'arguments 不是合法 JSON', name, rawArgs: String(rawArgs).slice(0, 200) };
  }
  for (const key of requiredArgs) {
    if (args[key] == null || args[key] === '') {
      return { ok: false, reason: `缺少必填参数「${key}」`, name, args };
    }
  }
  if (expectedTool && name !== expectedTool) {
    return { ok: false, reason: `工具名应为 ${expectedTool}，实际为 ${name}`, name, args };
  }
  return { ok: true, name, args };
}

function parseBecauseToolArgs(toolCall) {
  const fn = toolCall?.function || toolCall;
  const rawArgs = fn?.arguments ?? toolCall?.arguments ?? '{}';
  let args;
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
  } catch {
    return { ok: false, reason: 'arguments 不是合法 JSON', rawArgs: String(rawArgs).slice(0, 200) };
  }

  const command = args.command;
  let innerArgs = args.arguments;
  if (typeof innerArgs === 'string' && innerArgs.trim()) {
    try {
      innerArgs = JSON.parse(innerArgs);
    } catch {
      innerArgs = {};
    }
  }
  if (innerArgs == null || typeof innerArgs !== 'object') {
    innerArgs = {};
  }

  return { ok: true, command, innerArgs, raw: args };
}

function validateBecauseToolCall(toolCall, caseDef) {
  const fn = toolCall?.function || toolCall;
  const name = fn?.name || toolCall?.name;

  if (caseDef.expectedTool && name !== caseDef.expectedTool) {
    return { ok: false, reason: `工具名应为 ${caseDef.expectedTool}，实际为 ${name}`, name };
  }

  if (name === 'echarts_generator_app') {
    const parsed = parseBecauseToolArgs(toolCall);
    if (!parsed.ok) return parsed;
    if (!parsed.raw.charts) {
      return { ok: false, reason: 'echarts 调用缺少 charts 参数', name };
    }
    return { ok: true, name, command: null, innerArgs: parsed.raw };
  }

  const parsed = parseBecauseToolArgs(toolCall);
  if (!parsed.ok) return parsed;

  if (caseDef.expectedCommand && parsed.command !== caseDef.expectedCommand) {
    return {
      ok: false,
      reason: `command 应为 ${caseDef.expectedCommand}，实际为 ${parsed.command || '无'}`,
      name,
      command: parsed.command,
    };
  }

  for (const key of caseDef.requiredArgumentKeys || []) {
    const val = parsed.innerArgs[key];
    if (val == null || val === '') {
      return {
        ok: false,
        reason: `arguments 内缺少必填字段「${key}」`,
        name,
        command: parsed.command,
        innerArgs: parsed.innerArgs,
      };
    }
  }

  return { ok: true, name, command: parsed.command, innerArgs: parsed.innerArgs };
}

function makeCheck(id, pass, detail, excerpt) {
  return { id, pass, detail, excerpt: excerpt ? String(excerpt).slice(0, 300) : undefined };
}

function aggregateScore(checks) {
  if (!checks.length) return { score: 0, failures: [] };
  const passed = checks.filter((c) => c.pass).length;
  const failures = checks.filter((c) => !c.pass).map((c) => c.id);
  return {
    score: Math.round((passed / checks.length) * 1000) / 1000,
    failures,
  };
}

function scoreFormatChecks(response, caseDef) {
  const raw = visibleText(response);
  const parsed = parseThinkingContent(raw);
  const checks = [];

  for (const checkId of caseDef.checks || []) {
    switch (checkId) {
      case 'think_native': {
        const hasNative =
          Boolean(response?.message?.reasoning) ||
          Boolean(response?.message?.reasoning_content) ||
          Boolean(response?.choices?.[0]?.message?.reasoning) ||
          Boolean(response?.choices?.[0]?.message?.reasoning_content);
        const hasPairedTags = parsed.thinking.length > 0 && !hasUnclosedThink(raw);
        const textClean =
          !hasThinkTagsOutsideCodeFence(parsed.text) && !hasLegacyThinkingMarker(parsed.text);
        checks.push(
          makeCheck(
            checkId,
            hasNative || hasPairedTags ? textClean : true,
            hasNative || hasPairedTags
              ? textClean
                ? '推理在原生字段或成对标签内，可见正文无泄漏'
                : '推理泄漏到可见正文'
              : '未检测到原生推理字段或成对 think 标签（不强制失败）',
            parsed.text.slice(0, 120),
          ),
        );
        break;
      }
      case 'think_leak': {
        const leak =
          hasThinkTagsOutsideCodeFence(parsed.text) || hasLegacyThinkingMarker(parsed.text);
        checks.push(
          makeCheck(
            checkId,
            !leak,
            leak ? '可见正文含 think 标签或 :::thinking 标记' : '可见正文无 think 泄漏',
            parsed.text.slice(0, 120),
          ),
        );
        break;
      }
      case 'think_unclosed': {
        const bad = hasUnclosedThink(raw);
        checks.push(
          makeCheck(
            checkId,
            !bad,
            bad ? '存在未闭合的 <think> 标签' : 'think 标签成对或未使用',
          ),
        );
        break;
      }
      case 'think_in_codefence': {
        const inFence = /```[\s\S]*<think>[\s\S]*```/.test(raw);
        const leakOutside = hasThinkTagsOutsideCodeFence(stripCodeFences(raw));
        checks.push(
          makeCheck(
            checkId,
            inFence ? !leakOutside : true,
            inFence
              ? leakOutside
                ? '代码块外仍有 think 标签'
                : '代码块内样例标签未计为泄漏'
              : '未返回代码块样例（不强制失败）',
          ),
        );
        break;
      }
      case 'final_answer_only': {
        const empty = !parsed.text.trim();
        const leak = hasThinkTagsOutsideCodeFence(parsed.text) || hasLegacyThinkingMarker(parsed.text);
        checks.push(
          makeCheck(
            checkId,
            !empty && !leak,
            empty ? '可见答案为空' : leak ? '答案含 think 残留' : '有可见答案且无 think 残留',
            parsed.text.slice(0, 80),
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  const { score, failures } = aggregateScore(checks);
  return { checks, score, failures, excerpt: { content: raw.slice(0, 400) } };
}

function scoreToolChecks(firstResponse, roundtripResponse, caseDef) {
  const msg = firstResponse?.message || firstResponse?.choices?.[0]?.message || {};
  const content = String(msg.content || '');
  const toolCalls = extractToolCalls(firstResponse);
  const checks = [];

  for (const checkId of caseDef.checks || []) {
    switch (checkId) {
      case 'tool_emits_native':
        checks.push(
          makeCheck(
            checkId,
            toolCalls.length > 0,
            toolCalls.length > 0 ? `收到 ${toolCalls.length} 个 tool_calls` : '未返回原生 tool_calls',
            JSON.stringify(toolCalls.slice(0, 1)).slice(0, 200),
          ),
        );
        break;
      case 'tool_args_json': {
        if (!toolCalls.length) {
          checks.push(makeCheck(checkId, false, '无 tool_calls 可校验'));
          break;
        }
        const v =
          caseDef.expectedCommand != null ||
          caseDef.expectedTool === 'because_skills_2' ||
          caseDef.expectedTool === 'echarts_generator_app'
            ? validateBecauseToolCall(toolCalls[0], caseDef)
            : validateToolCall(toolCalls[0], caseDef);
        checks.push(
          makeCheck(
            checkId,
            v.ok,
            v.ok ? '参数 JSON 合法且必填字段存在' : v.reason,
            v.rawArgs || JSON.stringify(v.innerArgs || v.args || '').slice(0, 200),
          ),
        );
        break;
      }
      case 'tool_no_text_json': {
        const pseudo = detectPseudoToolJson(content);
        checks.push(
          makeCheck(
            checkId,
            !pseudo.found,
            pseudo.found ? '正文含疑似伪 function-call JSON' : '正文未粘贴伪 tool JSON',
            pseudo.excerpt,
          ),
        );
        break;
      }
      case 'tool_name_match': {
        if (!toolCalls.length) {
          checks.push(makeCheck(checkId, false, '无 tool_calls'));
          break;
        }
        const name = toolCalls[0]?.function?.name || toolCalls[0]?.name;
        const ok = name === caseDef.expectedTool;
        checks.push(
          makeCheck(
            checkId,
            ok,
            ok ? `工具名正确：${name}` : `期望 ${caseDef.expectedTool}，实际 ${name}`,
          ),
        );
        break;
      }
      case 'because_command_match': {
        if (!toolCalls.length) {
          checks.push(makeCheck(checkId, false, '无 tool_calls'));
          break;
        }
        const v = validateBecauseToolCall(toolCalls[0], caseDef);
        const ok = v.ok && (!caseDef.expectedCommand || v.command === caseDef.expectedCommand);
        checks.push(
          makeCheck(
            checkId,
            ok,
            ok
              ? `command 正确：${v.command}`
              : v.reason || `期望 ${caseDef.expectedCommand}，实际 ${v.command || '无'}`,
          ),
        );
        break;
      }
      case 'tool_roundtrip': {
        if (!roundtripResponse) {
          checks.push(makeCheck(checkId, false, '未执行第二轮往返'));
          break;
        }
        const rtMsg = roundtripResponse?.message || roundtripResponse?.choices?.[0]?.message || {};
        const rtContent = String(rtMsg.content || '').trim();
        const rtCalls = rtMsg.tool_calls || [];
        // 问数场景第二轮常继续调 sql-validation 等；允许有文本或合法后续 tool_calls
        // 失败条件：空回复，或 tool_calls 存在但 name/arguments 全空
        const emptyCalls = rtCalls.some((tc) => {
          const name = tc?.function?.name || tc?.name;
          const args = tc?.function?.arguments ?? tc?.arguments;
          return !name || args == null || args === '';
        });
        const ok =
          (rtContent.length > 0 || rtCalls.length > 0) && !emptyCalls;
        checks.push(
          makeCheck(
            checkId,
            ok,
            ok
              ? rtCalls.length
                ? `第二轮继续调用 ${rtCalls.length} 个工具（问数链路允许）`
                : '第二轮有最终文本且无空调用'
              : '第二轮无有效文本且无有效 tool_calls',
            rtContent.slice(0, 200) || JSON.stringify(rtCalls.slice(0, 1)).slice(0, 200),
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  const { score, failures } = aggregateScore(checks);
  return {
    checks,
    score,
    failures,
    sampleToolCalls: toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.function?.name || tc.name,
      arguments: tc.function?.arguments || tc.arguments,
    })),
    excerpt: { content: content.slice(0, 400) },
  };
}

function scoreLayerResults(cases) {
  const allChecks = cases.flatMap((c) => c.checks || []);
  return aggregateScore(allChecks);
}

module.exports = {
  parseThinkingContent,
  stripCodeFences,
  hasThinkTagsOutsideCodeFence,
  hasUnclosedThink,
  detectPseudoToolJson,
  validateToolCall,
  parseBecauseToolArgs,
  validateBecauseToolCall,
  extractToolCalls,
  visibleText,
  scoreFormatChecks,
  scoreToolChecks,
  scoreLayerResults,
  aggregateScore,
  makeCheck,
};
