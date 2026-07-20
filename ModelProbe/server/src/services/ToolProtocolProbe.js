const {
  assembleOpenAIRequest,
  createOpenAIClient,
} = require('./RequestAssembler');
const { MOCK_TOOLS } = require('../lib/capabilityFixtures');
const {
  scoreFormatChecks,
  scoreToolChecks,
} = require('./ComplianceScorer');
const { formatProviderError } = require('../lib/formatProviderError');

async function completionRequest({ client, body, timeoutMs = 120000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await client.chat.completions.create(body, { signal: controller.signal });
    return {
      ok: true,
      response,
      message: response.choices?.[0]?.message,
      model: response.model,
      usage: response.usage,
    };
  } catch (err) {
    return {
      ok: false,
      error: formatProviderError(err, { model: body.model, baseURL: client.baseURL }),
      status: err?.status ?? err?.statusCode,
      raw: err,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildChatBody({ model, messages, endpoint, layer, extra = {} }) {
  const base = {
    model,
    messages,
    stream: false,
    max_tokens: extra.max_tokens ?? 512,
    temperature: extra.temperature ?? 0,
    ...extra,
  };

  if (layer === 'assembled') {
    const { tools, tool_choice, ...restExtra } = extra;
    const { body, assemblyNotes } = assembleOpenAIRequest({
      model,
      messages,
      stream: false,
      max_tokens: base.max_tokens,
      temperature: base.temperature,
      endpointType: endpoint.type,
      azure: endpoint.azure,
      dropParams: endpoint.dropParams,
      addParams: endpoint.addParams,
      useResponsesApi: endpoint.useResponsesApi,
      ...restExtra,
    });
    if (tools) body.tools = tools;
    if (tool_choice != null) body.tool_choice = tool_choice;
    return { body, assemblyNotes };
  }

  return {
    body: base,
    assemblyNotes: ['直连：未做组装'],
  };
}

function toolsPreservedInBody(body) {
  return Array.isArray(body.tools) && body.tools.length > 0;
}

async function runFormatCase({ endpoint, model, layer, caseDef, timeoutMs }) {
  const client = createOpenAIClient(endpoint);
  const messages = [{ role: 'user', content: caseDef.prompt }];
  const { body, assemblyNotes } = buildChatBody({ model, messages, endpoint, layer });

  const startedAt = Date.now();
  const result = await completionRequest({ client, body, timeoutMs });
  const elapsedMs = Date.now() - startedAt;

  if (!result.ok) {
    return {
      caseId: caseDef.id,
      label: caseDef.label,
      pass: false,
      error: result.error,
      elapsedMs,
      assemblyNotes,
    };
  }

  const scored = scoreFormatChecks(result.response, caseDef);
  return {
    caseId: caseDef.id,
    label: caseDef.label,
    pass: scored.failures.length === 0,
    score: scored.score,
    checks: scored.checks,
    failures: scored.failures,
    excerpt: scored.excerpt,
    elapsedMs,
    assemblyNotes,
    responseModel: result.model,
  };
}

async function runToolCase({ endpoint, model, layer, caseDef, timeoutMs }) {
  const client = createOpenAIClient(endpoint);
  const messages = caseDef.messages;
  const probeTools = caseDef.tools || MOCK_TOOLS;
  const { body, assemblyNotes } = buildChatBody({
    model,
    messages,
    endpoint,
    layer,
    extra: {
      tools: probeTools,
      tool_choice: 'auto',
    },
  });

  const toolsInOutbound = toolsPreservedInBody(body);
  const startedAt = Date.now();
  const result = await completionRequest({ client, body, timeoutMs });
  const elapsedMs = Date.now() - startedAt;

  if (!result.ok) {
    return {
      caseId: caseDef.id,
      label: caseDef.label,
      pass: false,
      error: result.error,
      elapsedMs,
      assemblyNotes,
      toolsInOutbound,
      toolsPreserved: toolsInOutbound,
    };
  }

  let roundtripResponse = null;
  let roundtripError = null;

  if (caseDef.roundtrip) {
    const msg = result.message;
    const toolCalls = msg?.tool_calls || [];
    if (toolCalls.length > 0) {
      const toolMessages = toolCalls.map((tc) => ({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(caseDef.mockToolResult || { ok: true }),
      }));
      const followMessages = [
        ...messages,
        { role: 'assistant', content: msg.content || null, tool_calls: toolCalls },
        ...toolMessages,
      ];
      const { body: body2 } = buildChatBody({
        model,
        messages: followMessages,
        endpoint,
        layer,
        extra: { max_tokens: 256, temperature: 0 },
      });
      const rt = await completionRequest({ client, body: body2, timeoutMs });
      if (rt.ok) roundtripResponse = rt.response;
      else roundtripError = rt.error;
    }
  }

  const scored = scoreToolChecks(result.response, roundtripResponse, caseDef);
  const checks = [...scored.checks];
  if (layer === 'assembled' && !toolsInOutbound) {
    checks.push({
      id: 'tools_preserved',
      pass: false,
      detail: '组装后请求体未保留 tools 字段',
    });
  } else if (layer === 'assembled') {
    checks.push({
      id: 'tools_preserved',
      pass: true,
      detail: '组装后 tools 字段已保留',
    });
  }

  const failures = checks.filter((c) => !c.pass).map((c) => c.id);
  const pass = failures.length === 0 && !roundtripError;

  return {
    caseId: caseDef.id,
    label: caseDef.label,
    pass,
    score: checks.length ? checks.filter((c) => c.pass).length / checks.length : 0,
    checks,
    failures,
    sampleToolCalls: scored.sampleToolCalls,
    excerpt: scored.excerpt,
    elapsedMs,
    assemblyNotes,
    toolsInOutbound,
    toolsPreserved: toolsInOutbound,
    roundtripError,
    responseModel: result.model,
  };
}

module.exports = {
  completionRequest,
  buildChatBody,
  toolsPreservedInBody,
  runFormatCase,
  runToolCase,
};
