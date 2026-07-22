/**
 * 解析 Because Agents SSE 流，拼装完整回复。
 */

function extractTextFromContent(content, options = {}) {
  if (!Array.isArray(content)) return '';

  const useLastTextBlockOnly = options.useLastTextBlockOnly !== false;

  if (!useLastTextBlockOnly) {
    const parts = [];
    for (const part of content) {
      if (!part) continue;
      if (part.type === 'text' && part.text) {
        parts.push(part.text);
      } else if (typeof part === 'string') {
        parts.push(part);
      }
    }
    return parts.join('');
  }

  // 只取最后一个 text 块（前面块常为思考/中间态，PC 端以最终块为准）
  let lastText = '';
  for (const part of content) {
    if (!part) continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      lastText = part.text;
    }
  }

  // 从 *** 标记开始截取（问数最终回复常以 ***数据来源*** 等格式化标记开头）
  const markerIdx = lastText.indexOf('***');
  if (markerIdx > 0) {
    return lastText.slice(markerIdx);
  }

  return lastText;
}

function extractErrorFromContent(content) {
  if (!Array.isArray(content)) return '';

  for (const part of content) {
    if (!part || part.type !== 'error') continue;
    if (typeof part.error === 'string' && part.error.trim()) {
      return part.error.trim();
    }
    if (part.error?.message) {
      return String(part.error.message).trim();
    }
  }
  return '';
}

/**
 * 从 SSE 事件或 message 对象提取错误文案。
 * Because handleError 格式：{ error: true, text: "..." }（error 为布尔值，正文在 text）
 */
function extractErrorMessage(source) {
  if (!source || !source.error) return '';

  if (typeof source.error === 'string' && source.error.trim()) {
    return source.error.trim();
  }
  if (typeof source.error === 'object' && source.error?.message) {
    return String(source.error.message).trim();
  }
  if (source.error === true) {
    if (typeof source.text === 'string' && source.text.trim()) {
      return source.text.trim();
    }
    const fromContent = extractErrorFromContent(source.content);
    if (fromContent) return fromContent;
  }
  return '';
}

function extractChartBlocks(content) {
  if (!Array.isArray(content)) return [];

  const blocks = [];
  for (const part of content) {
    if (part?.type === 'chart' || part?.chartBlock) {
      blocks.push(part.chartBlock || part);
    }
  }
  return blocks;
}

/**
 * 从 SSE 事件的 on_run_step_delta 中提取 tool_call args 分片。
 * @returns {Map<string, { name: string, argsParts: string[] }>}
 */
function extractToolCallChunksFromEvent(toolCalls) {
  const result = new Map();
  if (!Array.isArray(toolCalls)) return result;

  for (const tc of toolCalls) {
    if (!tc || typeof tc !== 'object') continue;
    const id = tc.id || '';
    const name = tc.name || '';
    const args = tc.args || '';

    if (!id) continue;

    let entry = result.get(id);
    if (!entry) {
      entry = { name, argsParts: [] };
      result.set(id, entry);
    }
    if (name) entry.name = name;
    if (args) entry.argsParts.push(args);
  }
  return result;
}

/**
 * 从 SSE 事件的 on_run_step_completed 中提取完整的 tool_call。
 * @returns {Map<string, { name: string, args: string }>}
 */
function extractToolCallsFromResult(result) {
  const toolCalls = new Map();
  if (!result || typeof result !== 'object') return toolCalls;
  if (result.type !== 'tool_call') return toolCalls;

  const tc = result.tool_call;
  if (!tc || typeof tc !== 'object') return toolCalls;

  const id = tc.id || '';
  const name = tc.name || '';
  const args = tc.args || '';
  if (id && name) {
    toolCalls.set(id, { name, args });
  }
  return toolCalls;
}

/**
 * 将 tool_call args 分片拼接并解析为 JSON。
 * @param {string[]} argsParts
 * @returns {object|null}
 */
function parseToolCallArgs(argsParts) {
  if (!argsParts || argsParts.length === 0) return null;
  const full = argsParts.join('');
  try {
    return JSON.parse(full);
  } catch {
    return null;
  }
}

/**
 * 规范 tool_call output：部分 output 是 JSON 字符串（首尾带引号），需要二次解析。
 * @param {string} output
 * @returns {string}
 */
function normalizeToolOutput(output) {
  if (!output || typeof output !== 'string') return '';
  if (output.startsWith('"') || output.startsWith('\\"')) {
    try {
      const inner = JSON.parse(output);
      if (typeof inner === 'string') return inner;
    } catch {
      return output.replace(/^["\\"]/, '').replace(/["\\"]$/, '');
    }
  }
  return output;
}

/**
 * 从 tool_call output / args 解析图表列表。
 * @param {object} parsed
 * @returns {Array<object>|null}
 */
function parseChartOutput(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  if (Array.isArray(parsed.charts)) {
    return parsed.charts;
  }

  if (
    (parsed.__chartConfig || parsed.__echartsConfig) &&
    (parsed.g2Spec || parsed.echartsOption)
  ) {
    return [{
      id: 'chart_1',
      title: parsed.title || '',
      analysisType: parsed.analysisType || '',
      g2Spec: parsed.g2Spec || null,
      echartsOption: parsed.echartsOption || null,
    }];
  }

  return null;
}

/**
 * 从 tool_call output 字符串中提取某个 section 后的 JSON。
 * @param {string} output
 * @param {string} sectionName 如 'intent_classification'、'similar_question'
 * @returns {object|null}
 */
function extractSectionJson(output, sectionName) {
  if (!output || typeof output !== 'string') return null;

  const marker = sectionName;
  const idx = output.indexOf(marker);
  if (idx === -1) return null;

  const afterMarker = output.slice(idx + marker.length);
  const jsonStart = afterMarker.indexOf('{');
  if (jsonStart === -1) return null;

  let depth = 0;
  let jsonStr = '';
  for (let i = jsonStart; i < afterMarker.length; i++) {
    const ch = afterMarker[i];
    jsonStr += ch;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
  }

  if (!jsonStr) return null;

  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * 从 tool_call output 字符串中提取 similar_question 数据。
 * @param {string} output
 * @returns {object|null}
 */
function extractSimilarQuestions(output) {
  const parsed = extractSectionJson(output, 'similar_question');
  return parsed?.similar_indices || null;
}

/**
 * 从 tool_call output 的 intent_classification 中提取 selected_index_numbers（对象数组）。
 * 每个元素形如 {index_number, standard_name}
 * @param {string} output
 * @returns {Array<{index_number: string, standard_name: string}>|null}
 */
function extractIndexSource(output) {
  const parsed = extractSectionJson(output, 'intent_classification');
  const items = parsed?.selected_index_numbers;
  if (!Array.isArray(items)) return null;
  return items;
}

/** sql_execute 中无 data_dt 时的 dataDate 默认值 */
const DEFAULT_DATA_DATE = '查表中最新数据';

/**
 * 将 data_dt 规范为 YYYYMMDD。
 * 支持 2026-06-29、2026-06-29T00:00:00、20260629 等格式。
 * @param {string} value
 * @returns {string}
 */
function formatDataDtToYYYYMMDD(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  }
  if (/^\d{8}$/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

/**
 * 定位 tool_call output 中 sql_execute / Query Results 段落的原始文本片段。
 * @param {string} output
 * @returns {string} 空字符串代表未找到该段落
 */
function getSqlExecuteQueryResultsChunk(output) {
  if (!output || typeof output !== 'string') return '';

  const sectionIdx = output.indexOf('sql_execute');
  if (sectionIdx === -1) return '';

  const afterSection = output.slice(sectionIdx);
  const queryIdx = afterSection.indexOf('Query Results:');
  if (queryIdx === -1) return '';

  let queryChunk = afterSection.slice(queryIdx + 'Query Results:'.length);
  const nextSectionMatch = queryChunk.match(/\n-+\s+\w[\w_]*\s+-+/);
  if (nextSectionMatch && nextSectionMatch.index != null) {
    queryChunk = queryChunk.slice(0, nextSectionMatch.index);
  }
  return queryChunk;
}

/**
 * 从 tool_call output 的 sql_execute / Query Results 中提取 data_dt，去重后按逗号拼接。
 * @param {string} output
 * @returns {string[]}
 */
function extractDataDatesFromSqlExecute(output) {
  const queryChunk = getSqlExecuteQueryResultsChunk(output);
  if (!queryChunk) return [];

  const dates = [];
  const seen = new Set();
  for (const match of queryChunk.matchAll(/"data_dt"\s*:\s*"([^"]+)"/g)) {
    const formatted = formatDataDtToYYYYMMDD(match[1]);
    if (formatted && !seen.has(formatted)) {
      seen.add(formatted);
      dates.push(formatted);
    }
  }
  return dates;
}

/**
 * 从 tool_call output 的 sql_execute / Query Results 中提取 org_code，去重。
 * 作为 intent_classification.selected_org_codes 缺失时的兜底来源。
 * @param {string} output
 * @returns {string[]}
 */
function extractOrgCodesFromSqlExecute(output) {
  const queryChunk = getSqlExecuteQueryResultsChunk(output);
  if (!queryChunk) return [];

  const orgCodes = [];
  const seen = new Set();
  for (const match of queryChunk.matchAll(/"org_code"\s*:\s*"([^"]+)"/g)) {
    const code = match[1].trim();
    if (code && !seen.has(code)) {
      seen.add(code);
      orgCodes.push(code);
    }
  }
  return orgCodes;
}

/**
 * 从 tool_call output 的 intent_classification 中提取归因数据。
 * indexName 取 selected_index_numbers 中每个对象的 standard_name；
 * orgCode 优先取 selected_org_codes，缺失/为空时从 sql_execute / Query Results 的 org_code 兜底；
 * dataDate 优先取 sql_execute / Query Results 中各行的 data_dt（YYYYMMDD，多个逗号分隔），
 * 提取不到时使用默认值「查表中最新数据」。
 * @param {string} output
 * @returns {{indexName: Array<string>, orgCode: Array<string>|null, dataDate: string}|null}
 */
function extractAttributionData(output) {
  const parsed = extractSectionJson(output, 'intent_classification');
  if (!parsed) return null;
  const items = parsed.selected_index_numbers;
  if (!Array.isArray(items)) return null;
  const indexName = items
    .map((it) => (it && typeof it === 'object' ? it.standard_name : null))
    .filter((name) => typeof name === 'string' && name.length > 0);
  if (indexName.length === 0) return null;
  let orgCode = Array.isArray(parsed.selected_org_codes) && parsed.selected_org_codes.length > 0
    ? parsed.selected_org_codes
    : null;
  if (!orgCode) {
    const fallbackOrgCodes = extractOrgCodesFromSqlExecute(output);
    orgCode = fallbackOrgCodes.length > 0 ? fallbackOrgCodes : null;
  }
  const dataDates = extractDataDatesFromSqlExecute(output);
  const dataDate = dataDates.length > 0
    ? dataDates.join(',')
    : DEFAULT_DATA_DATE;
  return { indexName, orgCode, dataDate };
}

function extractTextFromDeltaContent(content) {
  if (!content) return '';
  const parts = Array.isArray(content) ? content : [content];
  const out = [];
  for (const part of parts) {
    if (!part) continue;
    if (typeof part === 'string') {
      out.push(part);
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string') {
      out.push(part.text);
      continue;
    }
    if (part.type === 'think' && typeof part.think === 'string') {
      out.push(part.think);
      continue;
    }
    if (typeof part.text === 'string') {
      out.push(part.text);
      continue;
    }
    if (typeof part.think === 'string') {
      out.push(part.think);
    }
  }
  return out.join('');
}

function normalizeWrappedEvent(event) {
  if (!event || typeof event !== 'object') {
    return { eventName: '', data: event };
  }
  if (typeof event.event === 'string' && 'data' in event) {
    return { eventName: event.event, data: event.data };
  }
  return { eventName: '', data: event };
}

function extractDeltaFromEvent(event) {
  const wrapped = normalizeWrappedEvent(event);
  if (!wrapped.eventName) return '';

  // 仅 on_message_delta 承载最终展示给用户的正文增量。
  // on_reasoning_delta 承载的是模型思考过程（type=think），不应进入对外 answer/chunk：
  // 1) 思考内容本身不该暴露给 ESB 调用方；
  // 2) 思考文本会被累积进 emittedText，但最终 content 快照（extractTextFromContent）
  //    只取最后一个 text 块、从不包含 think 内容，二者口径不一致是 buildDelta 误判重复的诱因之一。
  if (wrapped.eventName === 'on_message_delta') {
    return extractTextFromDeltaContent(wrapped.data?.delta?.content);
  }

  return '';
}

function extractMetaFromEvent(event, fallbackMessage = {}) {
  const wrapped = normalizeWrappedEvent(event);
  const data = wrapped.data || {};
  const conversation = data.conversation || event?.conversation || {};
  return {
    conversationId:
      conversation.conversationId ||
      data.conversationId ||
      event?.conversationId ||
      fallbackMessage.conversationId ||
      null,
    parentMessageId: fallbackMessage.messageId || data.messageId || null,
    title: event?.title || conversation.title || null,
  };
}

function extractEventPayload(line) {
  if (!line.startsWith('data:')) return null;
  const raw = line.slice(5).trim();
  if (!raw || raw === '[DONE]') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractMessagePayload(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.final || event.responseMessage || event.message) {
    return event.responseMessage || event.message || {};
  }
  return null;
}

/** 重叠长度低于该阈值时不认为是"真实重复"，按无重叠处理，避免把偶然的同字符/同词尾误判为重复。 */
const MIN_OVERLAP_FOR_DEDUP = 6;

/**
 * 计算 haystack 末尾与 needle 开头的最长重叠长度：即 haystack 的某个后缀 === needle 的对应前缀。
 * 用经典 KMP 前缀函数实现（拼接 needle + 分隔符 + haystack尾部 后求前缀函数），
 * 复杂度 O(len(needle) + len(haystack后段))，避免朴素双重循环在长文本下的 O(n^2)。
 */
function longestSuffixPrefixOverlap(haystack, needle) {
  if (!haystack || !needle) return 0;

  const tail = haystack.length > needle.length ? haystack.slice(-needle.length) : haystack;
  // \u0000 作为哨兵分隔符：只要 needle/tail 本身不含它，就能保证 border 不会跨越分隔符误判
  const combined = `${needle}\u0000${tail}`;
  const n = combined.length;
  const lps = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    let len = lps[i - 1];
    while (len > 0 && combined[i] !== combined[len]) {
      len = lps[len - 1];
    }
    if (combined[i] === combined[len]) {
      len++;
    }
    lps[i] = len;
  }

  return lps[n - 1];
}

/**
 * 计算「已发出文本」到「最新完整文本快照」之间真正新增的部分。
 *
 * 背景：Because 的 SSE 流会交替吐出两类信号——增量 delta（on_message_delta）与阶段性/最终的完整
 * content 快照（message/final 事件里的 responseMessage.content，只取最后一个 text 块）。二者口径
 * 不完全一致时（例如快照只剩「调用工具后的最终正文」，而 delta 阶段已经把「前置文案 + 最终正文」都
 * 发过一遍），如果只用 `fullText.startsWith(previousText)` 判断，一旦不满足就会把 fullText 整段当
 * 成新增内容重新拼接，导致同一段文本在 answer 里出现两次。
 *
 * 这里在原有前缀判断基础上补两层兜底：
 * 1) fullText 已完整包含在 previousText 尾部 → 无新增内容；
 * 2) 二者存在部分重叠（previousText 结尾与 fullText 开头有公共子串）→ 只追加真正新增的尾部。
 * 完全无重叠时保留原行为（整段视为新内容，覆盖式替换），例如模型确实重新生成了不相关的回复。
 */
function buildDelta(previousText, fullText) {
  if (!fullText) return '';
  if (!previousText) return fullText;

  if (fullText.startsWith(previousText)) {
    return fullText.slice(previousText.length);
  }

  if (previousText.endsWith(fullText)) {
    return '';
  }

  const overlap = longestSuffixPrefixOverlap(previousText, fullText);
  if (overlap >= MIN_OVERLAP_FOR_DEDUP) {
    return fullText.slice(overlap);
  }

  return fullText;
}

/**
 * 从 SSE 文本解析最终事件。
 * @param {string} sseText
 * @param {{ useLastTextBlockOnly?: boolean }} [textExtractOptions]
 */
function parseSseResponse(sseText, textExtractOptions = {}) {
  const lines = sseText.split(/\r?\n/);
  let lastFinal = null;
  let lastMessage = null;

  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;

    try {
      const data = JSON.parse(raw);
      if (data.final) {
        lastFinal = data;
      } else if (data.responseMessage || data.message) {
        lastMessage = data;
      }
    } catch {
      // 忽略非 JSON 行
    }
  }

  const event = lastFinal || lastMessage;
  if (!event) {
    return { ok: false, error: 'SSE 流中未找到有效 data 事件' };
  }

  const topLevelError = extractErrorMessage(event);
  if (topLevelError || event.error) {
    const errMsg = topLevelError || 'Because 返回错误';
    const conversation = event.conversation || {};
    const conversationId =
      conversation.conversationId || event.conversationId || null;
    return { ok: false, error: errMsg, conversationId };
  }

  const responseMessage = event.responseMessage || event.message || {};
  const conversation = event.conversation || {};
  const conversationId =
    conversation.conversationId || event.conversationId || responseMessage.conversationId || null;
  const content = responseMessage.content || [];
  const contentError = extractErrorFromContent(content);
  if (contentError) {
    return { ok: false, error: contentError, conversationId };
  }
  const answer = extractTextFromContent(content, textExtractOptions);
  const chartBlocks = extractChartBlocks(content);

  const responseError = extractErrorMessage(responseMessage);
  if (responseError || responseMessage.error) {
    const errMsg = responseError || 'Because Agent 返回错误';
    return { ok: false, error: errMsg, conversationId };
  }

  return {
    ok: true,
    answer,
    conversationId,
    /** 下一轮续聊应作为 parentMessageId 回传 */
    parentMessageId: responseMessage.messageId || null,
    title: event.title || conversation.title || null,
    extras: {
      hasChart: chartBlocks.length > 0,
      chartBlocks,
    },
  };
}

/**
 * 从 ReadableStream 读取 SSE 并解析。
 * @param {ReadableStream<Uint8Array>} body
 * @param {{ onActivity?: () => void }} [options]
 */
async function consumeSseStream(body, options = {}) {
  const onActivity = options.onActivity;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (onActivity) onActivity();
    buffer += decoder.decode(value, { stream: true });
  }

  return parseSseResponse(buffer);
}

/**
 * 以增量方式读取 SSE；每收到新的文本片段调用 onDelta。
 * @param {ReadableStream<Uint8Array>} body
 * @param {{
 *   onDelta?: (chunk: string, meta?: { conversationId?: string | null, parentMessageId?: string | null, title?: string | null }) => void,
 *   onDone?: (result: object) => void,
 *   onEchartdata?: (charts: Array<{id: string, title: string, analysisType: string, echartsOption: object}>) => void,
 *   onSimilarQuestions?: (data: {similar_indices: Array<object>, index_source: Array<{index_number: string, standard_name: string}>}) => void,
 *   onAttributionData?: (data: {indexName: Array<string>, orgCode: Array<string> | null, dataDate: string}) => void
 * }} handlers
 * @param {{ textExtractOptions?: { useLastTextBlockOnly?: boolean }, onActivity?: () => void }} [parserOptions]
 */
async function consumeSseStreamWithProgress(body, handlers = {}, parserOptions = {}) {
  const textExtractOptions = parserOptions.textExtractOptions || { useLastTextBlockOnly: true };
  const onActivity = parserOptions.onActivity;
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let fullBuffer = '';
  let lineBuffer = '';
  let emittedText = '';

  // 累积 tool_call 数据：id → { name, argsParts }
  const toolCallTracker = new Map();
  // 已完成的 echarts_generator 数据（去重）
  let echartdataExtracted = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (onActivity) onActivity();

    const piece = decoder.decode(value, { stream: true });
    fullBuffer += piece;
    lineBuffer += piece;

    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const event = extractEventPayload(line);
      if (!event) continue;

      // 处理 on_run_step_delta：提取 tool_call chunks
      const deltaData = event.data;
      if (deltaData && typeof deltaData === 'object') {
        const delta = deltaData.delta;
        if (delta && typeof delta === 'object') {
          const toolCalls = delta.tool_calls;
          if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              if (!tc || typeof tc !== 'object') continue;
              const tcId = tc.id || '';
              const tcName = tc.name || '';
              const tcArgs = tc.args || '';
              const tcOutput = tc.output || '';
              if (!tcId) continue;

              let entry = toolCallTracker.get(tcId);
              if (!entry) {
                entry = { name: tcName, argsParts: [], outputParts: [] };
                toolCallTracker.set(tcId, entry);
              }
              if (tcName) entry.name = tcName;
              if (tcArgs) entry.argsParts.push(tcArgs);
              if (tcOutput) entry.outputParts.push(tcOutput);
            }
          }
        }

        // 处理 on_run_step_completed：提取完整 tool_call
        const result = deltaData.result;
        if (result && typeof result === 'object' && result.type === 'tool_call') {
          const tc = result.tool_call;
          if (tc && typeof tc === 'object') {
            const tcId = tc.id || '';
            const tcName = tc.name || '';
            const tcArgs = tc.args || '';

            // 整合 tracker 中的 chunks 与 completed 中的完整 args
            let fullArgs = tcArgs;
            const tracked = toolCallTracker.get(tcId);
            if (tracked && tracked.argsParts.length > 0) {
              fullArgs = tracked.argsParts.join('');
            }

            // 检查是否是 chart_generator / echarts_generator_app
            const isChartTool = tcName === 'chart_generator' || tcName === 'echarts_generator_app';
            if (isChartTool && !echartdataExtracted) {
              let chartSource = tc.output || fullArgs || '';
              chartSource = normalizeToolOutput(chartSource);
              try {
                let parsed = typeof chartSource === 'string' ? JSON.parse(chartSource) : chartSource;
                let charts = parseChartOutput(parsed);
                if (!charts && fullArgs) {
                  charts = parseChartOutput(JSON.parse(fullArgs));
                }
                if (charts && charts.length > 0) {
                  echartdataExtracted = true;
                  if (typeof handlers.onEchartdata === 'function') {
                    handlers.onEchartdata(charts);
                  }
                }
              } catch {
                // JSON 解析失败时忽略
              }
            }

            // 从 tool_call output 中提取 similar_question / index_source / attributiondata
            let fullOutput = tc.output || '';
            if (!fullOutput) {
              const tracked = toolCallTracker.get(tcId);
              fullOutput = tracked?.outputParts?.join('') || '';
            }
            const normalizedOutput = normalizeToolOutput(fullOutput);
            if (tcName === 'ask_data_mcp_becauseai-server' && normalizedOutput) {
              if (typeof handlers.onSimilarQuestions === 'function') {
                const similarIndices = extractSimilarQuestions(normalizedOutput);
                const indexSource = extractIndexSource(normalizedOutput);
                if (similarIndices || indexSource) {
                  handlers.onSimilarQuestions({
                    similar_indices: similarIndices || [],
                    index_source: indexSource || [],
                  });
                }
              }
              if (typeof handlers.onAttributionData === 'function') {
                const attributiondata = extractAttributionData(normalizedOutput);
                if (attributiondata) {
                  handlers.onAttributionData(attributiondata);
                }
              }
            }

            // 清理已处理的 tool_call
            if (tcId) toolCallTracker.delete(tcId);
          }
        }
      }

      const wrappedDelta = extractDeltaFromEvent(event);
      if (wrappedDelta && typeof handlers.onDelta === 'function') {
        handlers.onDelta(wrappedDelta, extractMetaFromEvent(event, {}));
        emittedText += wrappedDelta;
      }

      const responseMessage = extractMessagePayload(event);
      if (!responseMessage) continue;

      const content = responseMessage.content || [];
      const fullText = extractTextFromContent(content, textExtractOptions);
      const delta = buildDelta(emittedText, fullText);
      emittedText = fullText;

      if (delta && typeof handlers.onDelta === 'function') {
        handlers.onDelta(delta, extractMetaFromEvent(event, responseMessage));
      }
    }
  }

  const tail = decoder.decode();
  if (tail) {
    fullBuffer += tail;
    lineBuffer += tail;
  }

  if (lineBuffer) {
    const lastEvent = extractEventPayload(lineBuffer.trim());
    if (lastEvent) {
      const responseMessage = extractMessagePayload(lastEvent);
      if (responseMessage) {
        const content = responseMessage.content || [];
        const fullText = extractTextFromContent(content, textExtractOptions);
        const delta = buildDelta(emittedText, fullText);
        if (delta && typeof handlers.onDelta === 'function') {
          handlers.onDelta(delta, extractMetaFromEvent(lastEvent, responseMessage));
        }
      }
    }
  }

  const result = parseSseResponse(fullBuffer, textExtractOptions);
  if (typeof handlers.onDone === 'function') {
    handlers.onDone(result);
  }
  return result;
}

module.exports = {
  extractTextFromContent,
  extractErrorFromContent,
  extractTextFromDeltaContent,
  extractChartBlocks,
  extractToolCallChunksFromEvent,
  extractToolCallsFromResult,
  parseToolCallArgs,
  normalizeToolOutput,
  parseChartOutput,
  extractSectionJson,
  extractSimilarQuestions,
  extractIndexSource,
  extractAttributionData,
  extractDataDatesFromSqlExecute,
  extractOrgCodesFromSqlExecute,
  formatDataDtToYYYYMMDD,
  buildDelta,
  parseSseResponse,
  consumeSseStream,
  consumeSseStreamWithProgress,
};
