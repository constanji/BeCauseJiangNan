const {
  assembleOpenAIRequest,
  createOpenAIClient,
  l2Snapshot,
  l3FromResponse,
  identityMatch,
} = require('./RequestAssembler');
const { estimateTokens } = require('../lib/stats');

const DEFAULT_PROMPT = 'Reply with exactly one word: ping';

async function streamCompletion({ client, body, timeoutMs = 120000 }) {
  const startedAt = Date.now();
  let firstTokenAt = null;
  const chunkTimes = [];
  let content = '';
  let responseModel = null;
  let usage = null;
  let lastChunkAt = startedAt;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const stream = await client.chat.completions.create(body, { signal: controller.signal });

    for await (const chunk of stream) {
      const now = Date.now();
      if (chunk.model) responseModel = chunk.model;

      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
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
  }

  const endedAt = Date.now();
  const ttftMs = firstTokenAt != null ? firstTokenAt - startedAt : null;

  return {
    startedAt,
    endedAt,
    ttftMs,
    totalMs: endedAt - startedAt,
    chunkTimes,
    content,
    responseModel,
    usage,
    outputTokens: usage?.completion_tokens ?? estimateTokens(content),
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

  const result = await streamCompletion({ client, body, timeoutMs: options.timeoutMs });

  const l1 = model;
  const l2 = l2Snapshot(body);
  const l3 = l3FromResponse(result.responseModel, result.usage);

  return {
    layer: 'direct',
    l1,
    l2,
    l3,
    match: identityMatch(l1, l2, l3),
    assemblyNotes: ['direct: no assembly; model sent as configured'],
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

  const result = await streamCompletion({ client, body, timeoutMs: options.timeoutMs });

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
  streamCompletion,
  runDirectProbe,
  runAssembledProbe,
};
