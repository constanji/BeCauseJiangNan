const { runDirectProbe, runAssembledProbe, DEFAULT_PROMPT } = require('./StreamingProbe');
const { summarize } = require('../lib/stats');
const { createOpenAIClient } = require('./RequestAssembler');

const CONTEXT_ERROR_RE = /context|token|length|413|too long|maximum/i;

function fillerTokens(targetTokens) {
  const unit = 'word ';
  const repeat = Math.max(1, Math.ceil((targetTokens * 4) / unit.length));
  return unit.repeat(repeat);
}

async function collectLatencySamples({ endpoint, model, layers, config, onLog }) {
  const warmup = config.warmup ?? 1;
  const samples = config.latencySamples ?? 3;
  const results = { direct: null, assembled: null };

  for (const layer of layers) {
    const runs = [];
    const runProbe = layer === 'direct' ? runDirectProbe : runAssembledProbe;

    for (let w = 0; w < warmup; w++) {
      onLog?.(`[latency] ${layer} warmup ${w + 1}/${warmup}`);
      await runProbe({ endpoint, model, options: { prompt: DEFAULT_PROMPT, max_tokens: 16 } });
    }

    for (let i = 0; i < samples; i++) {
      onLog?.(`[latency] ${layer} sample ${i + 1}/${samples}`);
      const r = await runProbe({ endpoint, model, options: { prompt: DEFAULT_PROMPT, max_tokens: 32 } });
      runs.push(r);
    }

    const ttftList = runs.map((r) => r.ttftMs).filter((v) => v != null);
    const itlList = runs.flatMap((r) => r.chunkTimes);
    const totalList = runs.map((r) => r.totalMs);

    results[layer] = {
      ttftMs: summarize(ttftList),
      itlMs: summarize(itlList),
      totalMs: summarize(totalList),
      outputTokens: summarize(runs.map((r) => r.outputTokens)),
      samples: runs.length,
      lastRun: {
        l1: runs[runs.length - 1]?.l1,
        l2: runs[runs.length - 1]?.l2,
        l3: runs[runs.length - 1]?.l3,
        match: runs[runs.length - 1]?.match,
        assemblyNotes: runs[runs.length - 1]?.assemblyNotes,
      },
    };
  }

  return results;
}

async function singleThroughputRequest({ endpoint, model, layer, useAssembled }) {
  const started = Date.now();
  try {
    const probe = useAssembled
      ? runAssembledProbe
      : runDirectProbe;
    const r = await probe({
      endpoint,
      model,
      options: { prompt: DEFAULT_PROMPT, max_tokens: 8, timeoutMs: 60000 },
    });
    const tokens = (r.promptTokens || 0) + (r.outputTokens || 0);
    return { ok: true, durationMs: Date.now() - started, tokens, layer };
  } catch (err) {
    return { ok: false, durationMs: Date.now() - started, error: err.message, layer };
  }
}

async function measureThroughput({ endpoint, model, layer, config, onLog }) {
  const concurrency = config.concurrency ?? 2;
  const durationSec = config.throughputDurationSec ?? 30;
  const useAssembled = layer === 'assembled';
  const deadline = Date.now() + durationSec * 1000;

  let success = 0;
  let failed = 0;
  let totalTokens = 0;
  const inFlight = new Set();

  onLog?.(`[throughput] ${layer} concurrency=${concurrency} duration=${durationSec}s`);

  while (Date.now() < deadline) {
    while (inFlight.size < concurrency && Date.now() < deadline) {
      const p = singleThroughputRequest({ endpoint, model, layer, useAssembled })
        .then((res) => {
          if (res.ok) {
            success += 1;
            totalTokens += res.tokens;
          } else {
            failed += 1;
          }
        })
        .finally(() => inFlight.delete(p));
      inFlight.add(p);
    }
    if (inFlight.size) {
      await Promise.race(inFlight);
    }
  }

  await Promise.allSettled([...inFlight]);

  const elapsedMin = durationSec / 60;
  return {
    layer,
    concurrency,
    durationSec,
    rpm: Math.round(success / elapsedMin),
    tpm: Math.round(totalTokens / elapsedMin),
    successCount: success,
    errorCount: failed,
    errorRate: success + failed > 0 ? Math.round((failed / (success + failed)) * 1000) / 1000 : 0,
    totalTokens,
  };
}

async function tryContextSize({ endpoint, model, layer, tokenTarget, useAssembled }) {
  const prompt = `Repeat after me:\n${fillerTokens(tokenTarget)}`;
  const messages = [{ role: 'user', content: prompt }];

  try {
    if (useAssembled) {
      await runAssembledProbe({
        endpoint,
        model,
        messages,
        options: { max_tokens: 1, timeoutMs: 120000 },
      });
    } else {
      await runDirectProbe({
        endpoint,
        model,
        messages,
        options: { max_tokens: 1, timeoutMs: 120000 },
      });
    }
    return { ok: true, tokenTarget };
  } catch (err) {
    const msg = err.message || String(err);
    if (CONTEXT_ERROR_RE.test(msg) || err.status === 413) {
      return { ok: false, tokenTarget, failReason: msg };
    }
    throw err;
  }
}

async function measureContextWindow({ endpoint, model, layer, config, onLog }) {
  const useAssembled = layer === 'assembled';
  const claimed = config.claimedContextTokens ?? endpoint.claimed_context_tokens ?? null;
  const steps = [4096, 8192, 16384, 32768, 65536, 128000, 200000];
  const filtered = claimed ? steps.filter((s) => s <= claimed * 1.1) : steps;

  let maxAccepted = 0;
  let failReason = null;

  for (const target of filtered) {
    onLog?.(`[context] ${layer} probing ~${target} tokens`);
    const res = await tryContextSize({ endpoint, model, layer, tokenTarget: target, useAssembled });
    if (res.ok) {
      maxAccepted = target;
    } else {
      failReason = res.failReason;
      break;
    }
  }

  if (maxAccepted === 0 && filtered.length) {
    let low = 512;
    let high = filtered[0];
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      onLog?.(`[context] ${layer} binary search ~${mid} tokens`);
      const res = await tryContextSize({ endpoint, model, layer, tokenTarget: mid, useAssembled });
      if (res.ok) {
        maxAccepted = mid;
        low = mid + 512;
      } else {
        failReason = res.failReason;
        high = mid - 512;
      }
    }
  }

  return {
    layer,
    claimed,
    measuredMaxAccepted: maxAccepted,
    failReason,
  };
}

async function testConnection({ endpoint, model }) {
  const client = createOpenAIClient(endpoint);
  const body = {
    model: model || endpoint.default_model || 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 5,
    stream: false,
  };
  const started = Date.now();
  const res = await client.chat.completions.create(body);
  return {
    ok: true,
    latencyMs: Date.now() - started,
    model: res.model,
    content: res.choices?.[0]?.message?.content,
  };
}

function buildCompareReport(identity, latency, throughput) {
  const compare = { modelMismatch: [], ttftDeltaMs: null };

  if (identity.direct && !identity.direct.match) compare.modelMismatch.push('direct');
  if (identity.assembled && !identity.assembled.match) compare.modelMismatch.push('assembled');

  if (latency?.direct?.ttftMs && latency?.assembled?.ttftMs) {
    compare.ttftDeltaMs =
      Math.round((latency.assembled.ttftMs.median - latency.direct.ttftMs.median) * 100) / 100;
  }

  if (throughput?.direct && throughput?.assembled) {
    compare.rpmDelta = throughput.assembled.rpm - throughput.direct.rpm;
    compare.tpmDelta = throughput.assembled.tpm - throughput.direct.tpm;
  }

  return compare;
}

module.exports = {
  collectLatencySamples,
  measureThroughput,
  measureContextWindow,
  testConnection,
  buildCompareReport,
};
