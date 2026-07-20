const {
  assembleOpenAIRequest,
  createOpenAIClient,
  l2Snapshot,
  l3FromResponse,
  identityMatch,
} = require('./RequestAssembler');
const { estimateTokens } = require('../lib/stats');

const DEFAULT_PROMPT = 'Reply with exactly one word: ping';
/** 延迟采样用：短段落即可；禁止冗长思考，避免思考模型把单次采样拖到 1～2 分钟 */
const LATENCY_PROMPT =
  'Reply immediately with no chain-of-thought. Write exactly 3 short English sentences about river fog. No bullets.';

async function streamCompletion({ client, body, timeoutMs = 90000, onHeartbeat }) {
  const startedAt = Date.now();
  let firstTokenAt = null;
  const chunkTimes = [];
  let content = '';
  let responseModel = null;
  let usage = null;
  let lastChunkAt = startedAt;
  let contentChunkCount = 0;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const heartbeat = onHeartbeat
    ? setInterval(() => {
        onHeartbeat(Math.round((Date.now() - startedAt) / 1000));
      }, 15000)
    : null;

  try {
    const stream = await client.chat.completions.create(body, { signal: controller.signal });

    for await (const chunk of stream) {
      const now = Date.now();
      if (chunk.model) responseModel = chunk.model;

      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        contentChunkCount += 1;
        if (firstTokenAt == null) {
          firstTokenAt = now;
        } else {
          chunkTimes.push(now - lastChunkAt);
        }
        lastChunkAt = now;
        content += delta;
      }

      if (chunk.usage) {
        usage = chunk.usage;
      }
    }
  } finally {
    clearTimeout(timer);
    if (heartbeat) clearInterval(heartbeat);
  }

  const endedAt = Date.now();
  const ttftMs = firstTokenAt != null ? firstTokenAt - startedAt : null;
  const outputTokens = usage?.completion_tokens ?? estimateTokens(content);

  // 网关常把整段打成 1 个 chunk，此时无相邻间隔；用「首 token 后到结束 / (tokens-1)」作近似 ITL
  let effectiveItlMs = null;
  if (chunkTimes.length > 0) {
    effectiveItlMs = null; // 优先用真实 chunk 间隔
  } else if (firstTokenAt != null && outputTokens > 1) {
    effectiveItlMs = Math.round(((endedAt - firstTokenAt) / (outputTokens - 1)) * 100) / 100;
  }

  return {
    startedAt,
    endedAt,
    ttftMs,
    totalMs: endedAt - startedAt,
    chunkTimes,
    contentChunkCount,
    effectiveItlMs,
    content,
    responseModel,
    usage,
    outputTokens,
    promptTokens: usage?.prompt_tokens ?? estimateTokens(body.messages?.map((m) => m.content).join(' ')),
  };
}

async function runDirectProbe({ endpoint, model, messages, options = {} }) {
  const client = createOpenAIClient(endpoint);
  const body = {
    model,
    messages: messages || [{ role: 'user', content: options.prompt || DEFAULT_PROMPT }],
    stream: true,
    max_tokens: options.max_tokens ?? 32,
    temperature: options.temperature ?? 0,
  };

  const result = await streamCompletion({
    client,
    body,
    timeoutMs: options.timeoutMs,
    onHeartbeat: options.onHeartbeat,
  });

  const l1 = model;
  const l2 = l2Snapshot(body);
  const l3 = l3FromResponse(result.responseModel, result.usage);

  return {
    layer: 'direct',
    l1,
    l2,
    l3,
    match: identityMatch(l1, l2, l3),
    assemblyNotes: ['直连：未做组装，模型名按配置原样发送'],
    ...result,
    outboundBody: body,
  };
}

async function runAssembledProbe({ endpoint, model, messages, options = {} }) {
  const client = createOpenAIClient(endpoint);
  const baseMessages = messages || [{ role: 'user', content: options.prompt || DEFAULT_PROMPT }];

  const { body, assemblyNotes } = assembleOpenAIRequest({
    model,
    messages: baseMessages,
    stream: true,
    max_tokens: options.max_tokens ?? 32,
    temperature: options.temperature ?? 0,
    endpointType: endpoint.type,
    azure: endpoint.azure,
    dropParams: endpoint.dropParams,
    addParams: endpoint.addParams,
    useResponsesApi: endpoint.useResponsesApi,
  });

  const result = await streamCompletion({
    client,
    body,
    timeoutMs: options.timeoutMs,
    onHeartbeat: options.onHeartbeat,
  });

  const l1 = model;
  const l2 = l2Snapshot(body);
  const l3 = l3FromResponse(result.responseModel, result.usage);

  return {
    layer: 'assembled',
    l1,
    l2,
    l3,
    match: identityMatch(l1, l2, l3),
    assemblyNotes,
    ...result,
    outboundBody: body,
  };
}

module.exports = {
  DEFAULT_PROMPT,
  LATENCY_PROMPT,
  streamCompletion,
  runDirectProbe,
  runAssembledProbe,
};
