const { countTokens } = require('./TokenCounter');
const { STEP_DEFS, parseMessages, getStepDef, stringifyPart } = require('./MessageParser');

/**
 * Build reconstructed chain token report from BeCause materials.
 * This is NOT exact per-LLM-request-frame accounting.
 *
 * @param {object} params
 * @param {Array} params.messages
 * @param {object|null} params.agent
 * @param {string} params.encoding
 * @param {object} params.meta
 */
function analyzeChain({ messages, agent, encoding = 'cl100k_base', meta = {} }) {
  const parsed = parseMessages(messages);
  const buckets = new Map();

  function ensure(id) {
    if (!buckets.has(id)) {
      const def = getStepDef(id);
      buckets.set(id, {
        id,
        label: def.label,
        phase: def.phase,
        toolName: null,
        commands: [],
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        events: [],
      });
    }
    return buckets.get(id);
  }

  // System prompt from Agent.instructions (config), not guaranteed full runtime frame
  const instructions = agent?.instructions || agent?.system || '';
  if (instructions) {
    const b = ensure('system_prompt');
    const n = countTokens(instructions, encoding);
    b.inputTokens += n;
    b.totalTokens += n;
    b.events.push({ kind: 'agent.instructions', chars: String(instructions).length });
  }

  // Tools schema estimate from agent.tools / tool_kwargs
  const toolsPayload = {
    tools: agent?.tools || [],
    tool_kwargs: agent?.tool_kwargs || undefined,
  };
  const toolsText = stringifyPart(toolsPayload);
  if ((agent?.tools && agent.tools.length) || agent?.tool_kwargs) {
    const b = ensure('tools_schema');
    const n = countTokens(toolsText, encoding);
    b.inputTokens += n;
    b.totalTokens += n;
    b.events.push({ kind: 'agent.tools_config', toolCount: (agent.tools || []).length });
  }

  if (parsed.userQuestion) {
    const b = ensure('user_question');
    const n = countTokens(parsed.userQuestion, encoding);
    b.inputTokens += n;
    b.totalTokens += n;
  }

  for (const ev of parsed.toolEvents) {
    const b = ensure(ev.stepId);
    const inN = countTokens(ev.input, encoding);
    const outN = countTokens(ev.output, encoding);
    b.inputTokens += inN;
    b.outputTokens += outN;
    b.totalTokens += inN + outN;
    if (!b.toolName && ev.toolName) b.toolName = ev.toolName;
    if (ev.command && !b.commands.includes(ev.command)) b.commands.push(ev.command);
    b.events.push({
      messageId: ev.messageId,
      toolCallId: ev.toolCallId,
      toolName: ev.toolName,
      command: ev.command,
      inputTokens: inN,
      outputTokens: outN,
    });
  }

  if (parsed.finalAnswer) {
    const b = ensure('final_answer');
    const n = countTokens(parsed.finalAnswer, encoding);
    b.outputTokens += n;
    b.totalTokens += n;
  }

  if (parsed.errorTexts.length) {
    const b = ensure('errors');
    for (const t of parsed.errorTexts) {
      const n = countTokens(t, encoding);
      b.outputTokens += n;
      b.totalTokens += n;
    }
  }

  const orderedIds = STEP_DEFS.map((s) => s.id);
  const steps = orderedIds
    .filter((id) => buckets.has(id) && buckets.get(id).totalTokens > 0)
    .map((id) => buckets.get(id));

  // append any unexpected ids
  for (const [id, b] of buckets) {
    if (!steps.find((s) => s.id === id) && b.totalTokens > 0) steps.push(b);
  }

  const chainTotalTokens = steps.reduce((a, s) => a + s.totalTokens, 0);
  for (const s of steps) {
    s.share = chainTotalTokens > 0 ? Number((s.totalTokens / chainTotalTokens).toFixed(4)) : 0;
  }

  const askPhaseTokens = steps
    .filter((s) => s.phase === 'ask' || s.id === 'user_question')
    .reduce((a, s) => a + s.totalTokens, 0);
  const attributionPhaseTokens = steps
    .filter((s) => s.phase === 'attribution')
    .reduce((a, s) => a + s.totalTokens, 0);
  const overheadTokens = steps
    .filter((s) => s.phase === 'overhead')
    .reduce((a, s) => a + s.totalTokens, 0);

  // Peak estimate: instructions + tools schema + user + cumulative tool I/O + final
  // NOT equal to provider request frame.
  let cumulativeTool = 0;
  let peakContextTokens = countTokens(instructions, encoding) + countTokens(toolsText, encoding);
  peakContextTokens += countTokens(parsed.userQuestion, encoding);
  for (const ev of parsed.toolEvents) {
    cumulativeTool += countTokens(ev.input, encoding) + countTokens(ev.output, encoding);
    const candidate =
      countTokens(instructions, encoding) +
      countTokens(toolsText, encoding) +
      countTokens(parsed.userQuestion, encoding) +
      cumulativeTool;
    if (candidate > peakContextTokens) peakContextTokens = candidate;
  }
  peakContextTokens += countTokens(parsed.finalAnswer, encoding);

  const wasteHints = [];
  const schemaStep = steps.find((s) => s.id === 'tool_schema');
  const attrStep = steps.find((s) => s.id === 'tool_attribution');
  const knowStep = steps.find((s) => s.id === 'tool_knowledge');
  if (schemaStep && schemaStep.share >= 0.25) {
    wasteHints.push('数据表结构（Schema/LightSchema）占比偏高，可检查是否未按问题裁表或仍返回过宽字段');
  }
  if (attrStep && attrStep.share >= 0.2) {
    wasteHints.push('归因工具 I/O 占比较高，可检查是否未启用 compact/TopN 裁剪');
  }
  if (knowStep && knowStep.share >= 0.15) {
    wasteHints.push('知识检索输出较大，可检查同义词/指标/机构知识是否可按文件或 topK 裁剪');
  }
  if (!wasteHints.length) {
    wasteHints.push('未发现单一类目极端占比；仍建议对照 LightSchema / 归因 compact 做压缩模拟');
  }

  // Naive compress sim: assume 50% cut on schema+knowledge+attribution outputs
  const compressible = steps
    .filter((s) => ['tool_schema', 'tool_knowledge', 'tool_attribution', 'tool_sql_exec'].includes(s.id))
    .reduce((a, s) => a + s.outputTokens, 0);
  const compressSimPeak = Math.max(
    0,
    Math.round(peakContextTokens - compressible * 0.5),
  );
  const compressRatio =
    peakContextTokens > 0
      ? `${Math.round(((peakContextTokens - compressSimPeak) / peakContextTokens) * 100)}%`
      : '0%';

  let windowRecommendation = '建议可用上下文 ≥ 16K（材料量较低，仍需留输出与多轮余量）';
  if (peakContextTokens >= 48000) {
    windowRecommendation = '峰值估值已近/超过 48K：复杂归因建议 ≥ 64K 可用上下文';
  } else if (peakContextTokens >= 24000) {
    windowRecommendation = '峰值估值约 24K+：问数+归因建议 ≥ 32K，复杂机构场景建议 ≥ 64K';
  } else if (peakContextTokens >= 12000) {
    windowRecommendation = '峰值估值约 12K+：建议可用上下文 ≥ 32K（含输出与多轮余量）';
  }

  return {
    methodology: {
      kind: 'because-message-reconstruction',
      summary:
        '基于 BeCause 真实落库消息与工具 I/O 的全链路 token 重构统计。不等于每次模型真实请求帧的精确 token 数。',
      canMeasure: [
        '用户问题',
        '工具名 / command',
        '工具入参与出参',
        '最终回复文本',
        'Agent.instructions（配置侧系统提示）',
        'Agent.tools 配置估算的工具 schema',
      ],
      cannotMeasure: [
        '每轮 LLM 真实完整 messages 帧',
        '运行时动态拼接的额外系统规则（若未落库）',
        '实际发给模型的完整 tools schema JSON',
        '上下文裁剪 / summary 后的真实帧',
        '按 Schema/同义词/示例拆分的 provider usage',
      ],
      peakNote:
        'peakContextTokens 为基于落库消息、工具 I/O、Agent instructions、工具配置的重构估值，不等同于 provider 实际请求帧。若需硬证明窗口需求，请启用主站 TOKEN_TRACE。',
      encoding,
    },
    summary: {
      chainTotalTokens,
      peakContextTokens,
      askPhaseTokens,
      attributionPhaseTokens,
      overheadTokens,
      windowRecommendation,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      toolEventCount: parsed.toolEvents.length,
    },
    steps,
    optimization: {
      wasteHints,
      compressSimPeak,
      compressRatio,
      note: '压缩模拟为对 Schema/知识/归因/SQL结果 输出按约 50% 削减的粗估，非二次真跑结果',
    },
    samples: {
      userQuestion: parsed.userQuestion?.slice(0, 500) || '',
      finalAnswerPreview: parsed.finalAnswer?.slice(0, 500) || '',
    },
    meta: {
      ...meta,
      agentId: agent?.id || agent?.agent_id || meta.agentId || null,
      agentName: agent?.name || null,
    },
  };
}

module.exports = { analyzeChain };
