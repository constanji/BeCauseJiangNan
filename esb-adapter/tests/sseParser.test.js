const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSseResponse,
  extractTextFromContent,
  extractTextFromDeltaContent,
  normalizeToolOutput,
  parseChartOutput,
  consumeSseStreamWithProgress,
  buildDelta,
  extractAttributionData,
  extractDataDatesFromSqlExecute,
  extractOrgCodesFromSqlExecute,
  formatDataDtToYYYYMMDD,
} = require('../src/sseParser');

const SAMPLE_ASK_DATA_OUTPUT = [
  '--------------------- intent_classification ---------------------',
  '{"currency_name":"折人民币","rephrased_question":"查询各项存款余额人行口径","reasoning":"匹配KPI库中人行口径的各项存款余额指标。","intent":"TEXT_TO_SQL","currency_code":"CN","selected_index_numbers":[{"index_number":"BM10000001","standard_name":"各项存款余额(人行口径)"}],"selected_org_codes":["FR001"]}',
  '--------------------- source ---------------------',
  '{"tables":["kpi_result_cctx"]}',
  '--------------------- sql_generate ---------------------',
  'SQL: SELECT ...',
  '--------------------- sql_execute ---------------------',
  'Query Results: [{"index_number":"BM10000001","standard_name":"各项存款余额(人行口径)","data_dt":"2026-06-29T00:00:00","org_code":"FR001","index_value":396934356.4938},{"index_number":"BM10000001","standard_name":"各项存款余额(人行口径)","data_dt":"2026-06-28T00:00:00","org_code":"FR001","index_value":392965012.9289}]',
].join('\n');

describe('sseParser', () => {
  it('extractTextFromContent 只取最后一个 text 块（默认）', () => {
    const text = extractTextFromContent([
      { type: 'text', text: '思考过程…' },
      { type: 'text', text: '最终回复' },
    ]);
    assert.equal(text, '最终回复');
  });

  it('extractTextFromContent 关闭时拼接全部 text 块', () => {
    const text = extractTextFromContent(
      [
        { type: 'text', text: '你好' },
        { type: 'text', text: '世界' },
      ],
      { useLastTextBlockOnly: false },
    );
    assert.equal(text, '你好世界');
  });

  it('extractTextFromContent 从 *** 标记起截取', () => {
    const text = extractTextFromContent([
      {
        type: 'text',
        text: '正在查询…\n\n***数据来源***\n\n余额 100 亿',
      },
    ]);
    assert.equal(text, '***数据来源***\n\n余额 100 亿');
  });

  it('extractTextFromContent *** 在开头时不截断', () => {
    const text = extractTextFromContent([
      { type: 'text', text: '***数据来源***\n\n正文' },
    ]);
    assert.equal(text, '***数据来源***\n\n正文');
  });

  it('parseSseResponse 解析 final 事件', () => {
    const sse = [
      'event: message',
      'data: {"message":"partial"}',
      '',
      'event: message',
      'data: {"final":true,"conversation":{"conversationId":"c1","title":"标题"},"responseMessage":{"messageId":"msg-001","content":[{"type":"text","text":"完整回复"}]}}',
      '',
    ].join('\n');

    const result = parseSseResponse(sse);
    assert.equal(result.ok, true);
    assert.equal(result.answer, '完整回复');
    assert.equal(result.conversationId, 'c1');
    assert.equal(result.parentMessageId, 'msg-001');
    assert.equal(result.title, '标题');
  });

  it('parseSseResponse 处理 Agent 错误', () => {
    const sse =
      'data: {"final":true,"responseMessage":{"error":{"message":"Agent 执行失败"},"content":[]}}\n';
    const result = parseSseResponse(sse);
    assert.equal(result.ok, false);
    assert.match(result.error, /Agent 执行失败/);
  });

  it('parseSseResponse 识别 content 中的 error 段', () => {
    const sse =
      'data: {"final":true,"responseMessage":{"content":[{"type":"error","error":"Agent not found"}]}}\n';
    const result = parseSseResponse(sse);
    assert.equal(result.ok, false);
    assert.match(result.error, /Agent not found/);
  });

  it('parseSseResponse 识别 Because handleError 格式（error:true + text）', () => {
    const sse =
      'event: error\ndata: {"error":true,"final":true,"text":"An error occurred while processing the request: 503 upstream connect error","conversationId":"c-err"}\n';
    const result = parseSseResponse(sse);
    assert.equal(result.ok, false);
    assert.match(result.error, /503 upstream connect error/);
    assert.equal(result.conversationId, 'c-err');
  });

  it('extractTextFromDeltaContent 解析 on_message_delta 片段', () => {
    const text = extractTextFromDeltaContent([
      { type: 'text', text: '你好' },
      { type: 'text', text: '，世界' },
    ]);
    assert.equal(text, '你好，世界');
  });

  it('normalizeToolOutput 解析 JSON 编码的 output 字符串', () => {
    const raw = JSON.stringify('intent_classification{"similar_indices":[]}');
    assert.match(normalizeToolOutput(raw), /intent_classification/);
  });

  it('formatDataDtToYYYYMMDD 支持 ISO 与纯数字日期', () => {
    assert.equal(formatDataDtToYYYYMMDD('2026-06-29T00:00:00'), '20260629');
    assert.equal(formatDataDtToYYYYMMDD('2026-06-29'), '20260629');
    assert.equal(formatDataDtToYYYYMMDD('20260629'), '20260629');
  });

  it('extractDataDatesFromSqlExecute 从 Query Results 提取 data_dt 并去重', () => {
    const dates = extractDataDatesFromSqlExecute(SAMPLE_ASK_DATA_OUTPUT);
    assert.deepEqual(dates, ['20260629', '20260628']);
  });

  it('extractAttributionData 优先使用 sql_execute 中的 data_dt', () => {
    const attribution = extractAttributionData(SAMPLE_ASK_DATA_OUTPUT);
    assert.ok(attribution);
    assert.deepEqual(attribution.indexName, ['各项存款余额(人行口径)']);
    assert.deepEqual(attribution.orgCode, ['FR001']);
    assert.equal(attribution.dataDate, '20260629,20260628');
  });

  it('extractAttributionData 无 sql_execute 时使用默认 dataDate', () => {
    const output = [
      '--------------------- intent_classification ---------------------',
      '{"selected_index_numbers":[{"standard_name":"各项存款余额(人行口径)"}]}',
    ].join('\n');
    const attribution = extractAttributionData(output);
    assert.ok(attribution);
    assert.equal(attribution.dataDate, '查表中最新数据');
  });

  it('extractOrgCodesFromSqlExecute 从 Query Results 提取 org_code 并去重', () => {
    const orgCodes = extractOrgCodesFromSqlExecute(SAMPLE_ASK_DATA_OUTPUT);
    assert.deepEqual(orgCodes, ['FR001']);
  });

  it('extractAttributionData 缺少 selected_org_codes 时从 sql_execute 兜底 orgCode', () => {
    const output = [
      '--------------------- intent_classification ---------------------',
      '{"selected_index_numbers":[{"standard_name":"各项存款余额(人行口径)"}]}',
      '--------------------- sql_execute ---------------------',
      'Query Results: [{"data_dt":"2026-06-29T00:00:00","org_code":"FR001"},{"data_dt":"2026-06-28T00:00:00","org_code":"FR001"}]',
    ].join('\n');
    const attribution = extractAttributionData(output);
    assert.ok(attribution);
    assert.deepEqual(attribution.orgCode, ['FR001']);
  });

  it('extractAttributionData 有 selected_org_codes 时不使用 sql_execute 兜底', () => {
    const output = [
      '--------------------- intent_classification ---------------------',
      '{"selected_index_numbers":[{"standard_name":"各项存款余额(人行口径)"}],"selected_org_codes":["FR002"]}',
      '--------------------- sql_execute ---------------------',
      'Query Results: [{"data_dt":"2026-06-29T00:00:00","org_code":"FR001"}]',
    ].join('\n');
    const attribution = extractAttributionData(output);
    assert.ok(attribution);
    assert.deepEqual(attribution.orgCode, ['FR002']);
  });

  it('extractAttributionData 两处都缺失 orgCode 时返回 null', () => {
    const output = [
      '--------------------- intent_classification ---------------------',
      '{"selected_index_numbers":[{"standard_name":"各项存款余额(人行口径)"}]}',
    ].join('\n');
    const attribution = extractAttributionData(output);
    assert.ok(attribution);
    assert.equal(attribution.orgCode, null);
  });

  it('parseChartOutput 支持 charts 数组与单图 g2Spec', () => {
    const multi = parseChartOutput({
      charts: [{ id: 'id_1', title: '图1', analysisType: 'line', echartsOption: {} }],
    });
    assert.equal(multi?.[0]?.id, 'id_1');

    const single = parseChartOutput({
      __chartConfig: true,
      title: '单图',
      analysisType: 'bar',
      g2Spec: { type: 'interval' },
    });
    assert.equal(single?.[0]?.id, 'chart_1');
    assert.deepEqual(single?.[0]?.g2Spec, { type: 'interval' });
  });

  it('consumeSseStreamWithProgress 识别 chart_generator output', async () => {
    const chartPayload = JSON.stringify({
      __chartConfig: true,
      title: '存款趋势',
      analysisType: 'line',
      g2Spec: { type: 'line' },
    });
    const sse = [
      'event: message',
      'data: {"event":"on_run_step_completed","data":{"result":{"type":"tool_call","tool_call":{"id":"tc-chart","name":"chart_generator","args":"","output":""}}}}',
      '',
      'event: message',
      `data: {"event":"on_run_step_completed","data":{"result":{"type":"tool_call","tool_call":{"id":"tc-chart","name":"chart_generator","args":"","output":${JSON.stringify(chartPayload)}}}}}`,
      '',
      'data: {"final":true,"responseMessage":{"messageId":"msg-chart","content":[{"type":"text","text":"完成"}]}}',
      '',
    ].join('\n');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });

    let charts = null;
    await consumeSseStreamWithProgress(stream, {
      onEchartdata: (data) => {
        charts = data;
      },
    });

    assert.ok(charts);
    assert.equal(charts[0].title, '存款趋势');
    assert.deepEqual(charts[0].g2Spec, { type: 'line' });
  });

  it('consumeSseStreamWithProgress 可消费包装增量事件', async () => {
    const sse = [
      'event: message',
      'data: {"event":"on_message_delta","data":{"id":"step-1","delta":{"content":[{"type":"text","text":"你好"}]}}}',
      '',
      'event: message',
      'data: {"event":"on_message_delta","data":{"id":"step-1","delta":{"content":[{"type":"text","text":"，世界"}]}}}',
      '',
      'event: message',
      'data: {"final":true,"conversation":{"conversationId":"c2","title":"标题2"},"responseMessage":{"messageId":"msg-002","content":[{"type":"text","text":"你好，世界"}]}}',
      '',
    ].join('\n');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });

    const chunks = [];
    const result = await consumeSseStreamWithProgress(stream, {
      onDelta: (chunk) => chunks.push(chunk),
    });

    assert.equal(chunks.join(''), '你好，世界');
    assert.equal(result.ok, true);
    assert.equal(result.answer, '你好，世界');
  });

  it('buildDelta 正常前缀延续场景返回新增尾部', () => {
    assert.equal(buildDelta('你好', '你好，世界'), '，世界');
    assert.equal(buildDelta('', '你好'), '你好');
    assert.equal(buildDelta('你好', ''), '');
  });

  it('buildDelta 最终文本已完整包含在已发出文本尾部时不重复下发', () => {
    // 场景：流式阶段已发出「前置文案 + 最终正文」，随后 message 事件的 content
    // 只剩「最终正文」这一个 text 块（ECharts 工具调用后常见）
    const previous = '好的，我来分析，先调用工具生成图表：以下是基于月度数据的分析结论。';
    const full = '以下是基于月度数据的分析结论。';
    assert.equal(buildDelta(previous, full), '');
  });

  it('buildDelta 部分重叠时只追加真正新增的尾部', () => {
    const previous = '前置说明文字，以下是最终结论段落的开头部分';
    const full = '以下是最终结论段落的开头部分，以及后续补充的新内容';
    assert.equal(buildDelta(previous, full), '，以及后续补充的新内容');
  });

  it('buildDelta 完全不相关时按整段替换（无重叠兜底）', () => {
    assert.equal(buildDelta('第一次生成的回答', '完全不同的第二次回答'), '完全不同的第二次回答');
  });

  it('buildDelta 偶然的极短重叠不应被误判为重复', () => {
    // previous 以「。」结尾，full 恰好也以「。」开头附近有重合，但重叠长度太短，不应被吞掉
    assert.equal(buildDelta('这是第一段。', '。这不是重复内容而是新的一段'), '。这不是重复内容而是新的一段');
  });

  it('consumeSseStreamWithProgress 修复：final 快照与增量存在重叠时不重复追加', async () => {
    const sse = [
      'event: message',
      'data: {"event":"on_message_delta","data":{"id":"step-1","delta":{"content":[{"type":"text","text":"好的，我来分析，先调用工具生成图表："}]}}}',
      '',
      'event: message',
      'data: {"event":"on_message_delta","data":{"id":"step-1","delta":{"content":[{"type":"text","text":"以下是基于月度数据的分析结论。"}]}}}',
      '',
      'event: message',
      'data: {"final":true,"conversation":{"conversationId":"c3"},"responseMessage":{"messageId":"msg-003","content":[{"type":"text","text":"以下是基于月度数据的分析结论。"}]}}',
      '',
    ].join('\n');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });

    const chunks = [];
    await consumeSseStreamWithProgress(stream, {
      onDelta: (chunk) => chunks.push(chunk),
    });

    const finalAnswer = chunks.join('');
    assert.equal(finalAnswer, '好的，我来分析，先调用工具生成图表：以下是基于月度数据的分析结论。');
    // 明确断言"以下是基于月度数据的分析结论。"没有被重复拼接
    assert.equal(finalAnswer.split('以下是基于月度数据的分析结论。').length - 1, 1);
  });

  it('consumeSseStreamWithProgress 忽略 on_reasoning_delta（思考内容不进入 answer/chunk）', async () => {
    const sse = [
      'event: message',
      'data: {"event":"on_reasoning_delta","data":{"id":"step-1","delta":{"content":[{"type":"think","think":"用户想查询数据"}]}}}',
      '',
      'event: message',
      'data: {"event":"on_message_delta","data":{"id":"step-1","delta":{"content":[{"type":"text","text":"这是正式回复"}]}}}',
      '',
      'event: message',
      'data: {"final":true,"responseMessage":{"messageId":"msg-004","content":[{"type":"text","text":"这是正式回复"}]}}',
      '',
    ].join('\n');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });

    const chunks = [];
    const result = await consumeSseStreamWithProgress(stream, {
      onDelta: (chunk) => chunks.push(chunk),
    });

    assert.equal(chunks.join(''), '这是正式回复');
    assert.equal(result.answer, '这是正式回复');
  });
});
